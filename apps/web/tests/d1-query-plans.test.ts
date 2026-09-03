import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SCHEMA_FIXTURE = path.join(
  repoRoot,
  "apps/web/tests/fixtures/d1-schema.sql",
);
const INDEX_SQL = path.join(repoRoot, "scripts/f1db-d1-indexes.sql");
const DUMP_SCRIPT = path.join(repoRoot, "scripts/f1db-d1-dump.sh");
const IMPORT_SCRIPT = path.join(repoRoot, "scripts/f1db-d1-import.sh");

// 查询常量都写成模块级模板字符串（部分未导出），从源码提取比要求逐个 export 更省事，
// 也顺带覆盖私有常量——恰恰是最容易漏索引的那些
const REPOSITORY_SOURCES = [
  "driver-repository.ts",
  "team-repository.ts",
  "race-results-repository.ts",
  "ask/tools.ts",
];

// 允许全表扫的查询：目录页与名称匹配本来就要遍历整张小维度表，加索引没有意义。
// 其余任何裸全扫都是缺索引，按 scripts/f1db-d1-indexes.sql 的维度族规则补。
const FULL_SCAN_BY_DESIGN: Record<string, string> = {
  "driver-repository.ts:driversSql": "车手目录页遍历全部车手",
  "team-repository.ts:constructorsSql": "车队目录页遍历全部车队",
  "ask/tools.ts:driverRefSql": "按名字解析车手，匹配多个名称列",
  "ask/tools.ts:constructorRefSql": "按名字解析车队，匹配多个名称列",
  "ask/tools.ts:grandPrixRefSql": "按名字解析分站，匹配多个名称列",
};

interface QueryConstant {
  key: string;
  file: string;
  sql: string;
}

function collectQueryConstants(): QueryConstant[] {
  const raw = new Map<string, { file: string; body: string }>();
  for (const file of REPOSITORY_SOURCES) {
    const source = readFileSync(
      path.join(repoRoot, "apps/web/src/lib", file),
      "utf8",
    );
    const pattern = /(?:export )?const (\w+(?:Sql|Subquery)) = `([\s\S]*?)`;/g;
    for (const match of source.matchAll(pattern)) {
      raw.set(`${file}:${match[1]}`, { file, body: match[2] });
    }
  }
  // raceResultSql 这类把 raceIdSubquery 插值进来，展开后才是真正下发给 D1 的语句
  const expand = (file: string, body: string): string =>
    body.replace(/\$\{(\w+)\}/g, (fallback, name) => {
      const referenced = raw.get(`${file}:${name}`);
      return referenced ? expand(file, referenced.body) : fallback;
    });
  const constants: QueryConstant[] = [];
  for (const [key, { file, body }] of raw) {
    const sql = expand(file, body).replace(/\?\d+/g, "?").trim();
    if (/^(SELECT|WITH)/i.test(sql)) constants.push({ key, file, sql });
  }
  return constants;
}

// EXPLAIN 输出里 "SCAN x USING INDEX ..." 是索引扫描（部分索引下反而是最优计划），
// 只有不带 USING 的裸 SCAN 才是全表扫。CTE 与子查询别名扫的是中间结果，不算。
function fullyScannedTables(sql: string, queryPlan: string): string[] {
  const derived = new Set<string>();
  for (const match of sql.matchAll(/(?:WITH|,)\s*(\w+)\s+AS\s*\(/gi))
    derived.add(match[1].toLowerCase());
  for (const match of sql.matchAll(/\)\s*(?:AS\s+)?([a-z][a-z0-9_]*)/gi))
    derived.add(match[1].toLowerCase());
  const aliases = new Map<string, string>();
  for (const match of sql.matchAll(
    /\b(?:FROM|JOIN)\s+([a-z_]+)(?:\s+(?:AS\s+)?([a-z][a-z0-9_]*))?/gi,
  )) {
    const alias = match[2];
    if (alias && !/^(on|where|group|order|union|limit)$/i.test(alias))
      aliases.set(alias, match[1]);
  }
  const scanned = new Set<string>();
  for (const line of queryPlan.split("\n")) {
    if (line.includes("USING")) continue;
    const match = line.match(/\bSCAN (\w+)\b/);
    if (!match) continue;
    const table = aliases.get(match[1]) ?? match[1];
    if (!derived.has(table.toLowerCase())) scanned.add(table);
  }
  return [...scanned];
}

let dbPath: string;
let queries: QueryConstant[];
// SQL 是仓储实现细节，不为了测试往模块接口上加导出
const query = (key: string): string => {
  const found = queries.find((constant) => constant.key === key);
  if (!found) throw new Error(`no query constant ${key}`);
  return found.sql;
};
const run = (script: string): string =>
  execFileSync("sqlite3", ["-json", dbPath], {
    input: script,
    encoding: "utf8",
  });
const plan = (sql: string): string =>
  execFileSync("sqlite3", [dbPath], {
    input: `EXPLAIN QUERY PLAN ${sql.replace(/;\s*$/, "")};`,
    encoding: "utf8",
  });

// f1db 每张表几乎每列都是 NOT NULL，测试只关心少数几列；其余按类型填占位值，
// 避免为了插一行样本数据把三十个列名抄进测试。表名只能来自夹具 schema，值均为
// 测试内字面量；sqlite3 CLI 无参数绑定，只能拼接
function insertRow(table: string, values: Record<string, string | number>) {
  const schema = readFileSync(SCHEMA_FIXTURE, "utf8");
  const ddl = schema.match(
    new RegExp(`CREATE TABLE "${table}"[\\s\\S]*?\\n\\);`),
  );
  if (!ddl) throw new Error(`no DDL for ${table}`);
  const row = { ...values };
  for (const column of ddl[0].matchAll(
    /"(\w+)"\s+(\w+)(?:\([\d,]+\))?\s+NOT NULL/g,
  )) {
    if (column[1] in row) continue;
    const type = column[2].toUpperCase();
    row[column[1]] =
      type === "DATE"
        ? "'2000-01-01'"
        : /INT|DECIMAL|DOUBLE|FLOAT/.test(type)
          ? 0
          : "'x'";
  }
  const columns = Object.keys(row)
    .map((name) => `"${name}"`)
    .join(", ");
  const literals = Object.values(row).join(", ");
  run(`INSERT INTO "${table}" (${columns}) VALUES (${literals});`);
}

beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "f1db-plan-"));
  dbPath = path.join(dir, "d1.db");
  // 真实 D1 的形态：上游的表与视图，加上索引脚本，没有别的索引。逐表 dump 不带索引，
  // 所以上游那 164 条单列索引一条都不在库里——夹具必须如实反映，否则计划断言测的是
  // 另一个世界。也没有 sqlite_stat1：规划器只能靠启发式，这是最坏情况下的验证。
  run(readFileSync(SCHEMA_FIXTURE, "utf8"));
  run(readFileSync(INDEX_SQL, "utf8"));
  queries = collectQueryConstants();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe("D1 查询计划护栏", () => {
  it("导入脚本附加索引文件并在结尾 ANALYZE", () => {
    expect(readFileSync(DUMP_SCRIPT, "utf8")).toContain("f1db-d1-indexes.sql");
    expect(readFileSync(IMPORT_SCRIPT, "utf8")).toContain("ANALYZE;");
  });

  it("夹具与索引脚本同源可再生", () => {
    expect(readFileSync(DUMP_SCRIPT, "utf8")).toContain("d1-schema.sql");
  });

  // 覆盖全部查询而不是挑几条：新增查询忘了配套索引时这里直接变红，
  // 不用等生产读放大暴露出来
  it("每条查询都不做无索引全表扫", () => {
    expect(queries.length).toBeGreaterThan(40);
    const offenders = queries
      .map((constant) => ({
        key: constant.key,
        tables: fullyScannedTables(constant.sql, plan(constant.sql)),
      }))
      .filter(
        (entry) =>
          entry.tables.length > 0 && !(entry.key in FULL_SCAN_BY_DESIGN),
      )
      .map((entry) => `${entry.key} -> ${entry.tables.join(",")}`);
    expect(offenders).toEqual([]);
  });

  it("白名单只留目录页与名称匹配", () => {
    const stale = Object.keys(FULL_SCAN_BY_DESIGN).filter(
      (key) => fullyScannedTables(query(key), plan(query(key))).length === 0,
    );
    expect(stale).toEqual([]);
  });
});

describe("D1 查询计划的结构性属性", () => {
  const recordLap = () => query("race-results-repository.ts:recordLapSql");
  const teammate = () => query("driver-repository.ts:teammateResultsSql");

  // 赛道纪录圈要跨该赛道的全部场次，规划器一旦从 race_data 起步就会拉满 FASTEST_LAP
  // 分区（2026-09-02 实测 32924 行/次）。CROSS JOIN 禁止重排连接顺序，让计划恒定从
  // race 起步；生产库的 sqlite_stat1 曾长期缺失，不能把顺序交给统计信息决定
  it("纪录圈查询固定从 race 驱动", () => {
    const recordLapPlan = plan(recordLap());
    expect(recordLapPlan).toContain(
      "SEARCH ra USING COVERING INDEX idx_race_circuit_year",
    );
    expect(recordLapPlan).toContain("SEARCH race_data USING INDEX");
  });

  // 队友对比同样靠 CROSS JOIN 锁顺序：先按年份取该年的 race，再用
  // (race_id, type, constructor_id) 精确探针；从车队分区起步会把整支车队的成绩拉出来
  it("队友查询按赛事而非车队分区驱动", () => {
    const teammatePlan = plan(teammate());
    expect(teammatePlan).toContain("idx_rd_race_type_constructor");
    expect(teammatePlan).not.toContain(
      "idx_rd_constructor_type (constructor_id=?",
    );
  });

  // 积分榜每行算一次该赛季胜场。写成相关子查询时每行都从实体分区起步，索引里
  // 没有 year，只能拉出该车手/车队全生涯的成绩再回表过滤（2026-09-03 实测车手榜
  // 4166 行/次）。改成按年份一次算完物化，读量只与该赛季的场次有关
  it("积分榜胜场按赛季算一次，不扫全生涯", () => {
    for (const key of [
      "race-results-repository.ts:driverStandingsSql",
      "race-results-repository.ts:constructorStandingsSql",
    ]) {
      const standingsPlan = plan(query(key));
      expect(standingsPlan, key).not.toContain("CORRELATED SCALAR SUBQUERY");
      expect(standingsPlan, key).toContain(
        "SEARCH ra USING COVERING INDEX sqlite_autoindex_race_1 (year=?)",
      );
    }
  });

  it("纪录圈查询取到全场次最快的一圈", () => {
    insertRow("country", { id: "'gb'" });
    insertRow("circuit", { id: "'circuit-a'", country_id: "'gb'" });
    insertRow("grand_prix", { id: "'gp-1'" });
    insertRow("driver", {
      id: "'driver-slow'",
      name: "'Slow'",
      country_of_birth_country_id: "'gb'",
      nationality_country_id: "'gb'",
    });
    insertRow("driver", {
      id: "'driver-fast'",
      name: "'Fast'",
      country_of_birth_country_id: "'gb'",
      nationality_country_id: "'gb'",
    });
    for (const [id, year] of [
      [1, 1990],
      [2, 1991],
    ] as const) {
      insertRow("race", {
        id,
        year,
        round: 1,
        grand_prix_id: "'gp-1'",
        circuit_id: "'circuit-a'",
        circuit_layout_id: "'layout-a'",
      });
    }
    insertRow("race_data", {
      race_id: 1,
      type: "'FASTEST_LAP'",
      position_display_order: 1,
      driver_id: "'driver-slow'",
      fastest_lap_time: "'1:23.456'",
      fastest_lap_time_millis: 83456,
    });
    insertRow("race_data", {
      race_id: 2,
      type: "'FASTEST_LAP'",
      position_display_order: 1,
      driver_id: "'driver-fast'",
      fastest_lap_time: "'1:19.000'",
      fastest_lap_time_millis: 79000,
    });

    const rows = JSON.parse(
      run(
        query("race-results-repository.ts:recordLapSql")
          .replace("?", "1990")
          .replace("?", "'gp-1'"),
      ),
    ) as { time: string; driver_name: string; year: number }[];
    expect(rows).toEqual([
      { time: "1:19.000", driver_name: "Fast", year: 1991 },
    ]);
  });
});
