import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  roundsSql as driverRoundsSql,
  standingsSql as driverStandingsSql,
  teammateResultsSql,
} from "../src/lib/driver-repository.js";
import {
  circuitInfoSql,
  recordLapSql,
} from "../src/lib/race-results-repository.js";
import {
  roundsSql as teamRoundsSql,
  standingsSql as teamStandingsSql,
} from "../src/lib/team-repository.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const INDEX_SQL = path.join(repoRoot, "scripts/f1db-d1-indexes.sql");
const DUMP_SCRIPT = path.join(repoRoot, "scripts/f1db-d1-dump.sh");
const IMPORT_SCRIPT = path.join(repoRoot, "scripts/f1db-d1-import.sh");

// 复刻 f1db 上游 schema 的关键事实：除主键/唯一约束外，每张表的每个外键列与
// 大多数普通列上都有单列索引（race_data 10+ 条、race 11 条）。这些索引正是规划器
// 退化的来源——rcda_type_idx 让它误以为可以从 type 分区驱动，从而扫满整个
// FASTEST_LAP 分区。夹具必须带上它们，否则计划断言测的是生产上不存在的世界。
// 核对方式：scripts/f1db-d1-dump.sh 拉的 f1db-sqlite.zip 里
// SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='race_data'。
const FIXTURE_SCHEMA = `
CREATE TABLE race (
  id INTEGER NOT NULL, year INTEGER NOT NULL, round INTEGER NOT NULL,
  grand_prix_id TEXT NOT NULL, circuit_id TEXT NOT NULL,
  CONSTRAINT race_pk PRIMARY KEY (id),
  CONSTRAINT race_year_round_uk UNIQUE (year, round)
);
CREATE INDEX race_year_idx ON race (year);
CREATE INDEX race_round_idx ON race (round);
CREATE INDEX race_grand_prix_id_idx ON race (grand_prix_id);
CREATE INDEX race_circuit_id_idx ON race (circuit_id);
CREATE TABLE circuit (id TEXT NOT NULL, total_races_held INTEGER NOT NULL, CONSTRAINT circuit_pk PRIMARY KEY (id));
CREATE TABLE country (id TEXT NOT NULL, alpha2_code TEXT NOT NULL, CONSTRAINT country_pk PRIMARY KEY (id));
CREATE TABLE driver (
  id TEXT NOT NULL, name TEXT NOT NULL, nationality_country_id TEXT NOT NULL,
  CONSTRAINT driver_pk PRIMARY KEY (id)
);
CREATE INDEX drvr_name_idx ON driver (name);
CREATE INDEX drvr_nationality_country_id_idx ON driver (nationality_country_id);
CREATE TABLE race_data (
  race_id INTEGER NOT NULL, type TEXT NOT NULL, position_display_order INTEGER NOT NULL,
  position_number INTEGER, position_text TEXT, driver_id TEXT, constructor_id TEXT,
  pole_position INTEGER, fastest_lap INTEGER, reason_retired TEXT,
  fastest_lap_time TEXT, fastest_lap_time_millis INTEGER,
  CONSTRAINT rcda_pk PRIMARY KEY (race_id, type, position_display_order)
);
CREATE INDEX rcda_race_id_idx ON race_data (race_id);
CREATE INDEX rcda_type_idx ON race_data (type);
CREATE INDEX rcda_position_display_order_idx ON race_data (position_display_order);
CREATE INDEX rcda_position_number_idx ON race_data (position_number);
CREATE INDEX rcda_position_text_idx ON race_data (position_text);
CREATE INDEX rcda_driver_id_idx ON race_data (driver_id);
CREATE INDEX rcda_constructor_id_idx ON race_data (constructor_id);
-- 赛季维度表：上游主键都以 year 打头，按 driver_id/constructor_id 过滤时无索引可用
CREATE TABLE grand_prix (id TEXT NOT NULL, abbreviation TEXT, name TEXT, CONSTRAINT gp_pk PRIMARY KEY (id));
CREATE TABLE season_driver_standing (
  year INTEGER NOT NULL, position_display_order INTEGER NOT NULL,
  position_text TEXT NOT NULL, driver_id TEXT NOT NULL,
  points REAL NOT NULL, championship_won INTEGER NOT NULL,
  CONSTRAINT ssds_pk PRIMARY KEY (year, position_display_order)
);
CREATE TABLE season_constructor_standing (
  year INTEGER NOT NULL, position_display_order INTEGER NOT NULL,
  position_text TEXT NOT NULL, constructor_id TEXT NOT NULL,
  points REAL NOT NULL, championship_won INTEGER NOT NULL,
  CONSTRAINT sscs_pk PRIMARY KEY (year, position_display_order)
);
CREATE TABLE season_entrant_driver (
  year INTEGER NOT NULL, entrant_id TEXT NOT NULL, constructor_id TEXT NOT NULL,
  engine_manufacturer_id TEXT NOT NULL, driver_id TEXT NOT NULL, test_driver INTEGER NOT NULL,
  CONSTRAINT sedr_pk PRIMARY KEY (year, entrant_id, constructor_id, engine_manufacturer_id, driver_id)
);
CREATE TABLE season_entrant_constructor (
  year INTEGER NOT NULL, entrant_id TEXT NOT NULL, constructor_id TEXT NOT NULL,
  engine_manufacturer_id TEXT NOT NULL,
  CONSTRAINT secn_pk PRIMARY KEY (year, entrant_id, constructor_id, engine_manufacturer_id)
);
CREATE VIEW fastest_lap AS
SELECT race_id, driver_id, fastest_lap_time AS time, fastest_lap_time_millis AS time_millis
FROM race_data WHERE type = 'FASTEST_LAP';
CREATE VIEW race_result AS
SELECT race_id, position_display_order, position_number, position_text,
       driver_id, constructor_id, pole_position, fastest_lap, reason_retired
FROM race_data WHERE type = 'RACE_RESULT';

INSERT INTO circuit (id, total_races_held) VALUES ('circuit-a', 80), ('circuit-b', 1120);
INSERT INTO country (id, alpha2_code) VALUES ('gb', 'GB');

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1200)
INSERT INTO race (id, year, round, grand_prix_id, circuit_id)
SELECT n, 1950 + (n % 76), n, 'gp-' || n, CASE WHEN n <= 80 THEN 'circuit-a' ELSE 'circuit-b' END FROM seq;

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 21)
INSERT INTO driver (id, name, nationality_country_id) SELECT 'driver-' || n, 'Driver ' || n, 'gb' FROM seq;

-- 每场 20 条 RACE_RESULT + 20 条 FASTEST_LAP，10 支车队各 2 名车手
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 48000)
INSERT INTO race_data (race_id, type, position_display_order, position_number, position_text,
                       driver_id, constructor_id, pole_position, fastest_lap, reason_retired,
                       fastest_lap_time, fastest_lap_time_millis)
SELECT (n - 1) / 40 + 1,
       CASE WHEN (n - 1) % 40 < 20 THEN 'FASTEST_LAP' ELSE 'RACE_RESULT' END,
       (n - 1) % 20 + 1,
       (n - 1) % 20 + 1,
       CAST((n - 1) % 20 + 1 AS TEXT),
       'driver-' || ((n - 1) % 20 + 1),
       'team-' || (((n - 1) % 20) / 2 + 1),
       0, 0, NULL,
       '1:23.456',
       80000 + (n * 7) % 9000
FROM seq;

-- circuit-a 第 42 场埋一个全场最快圈，验证结果正确性
INSERT INTO race_data (race_id, type, position_display_order, driver_id, fastest_lap_time, fastest_lap_time_millis)
VALUES (42, 'FASTEST_LAP', 99, 'driver-7', '1:19.000', 79000);

INSERT INTO grand_prix (id, abbreviation, name)
SELECT DISTINCT grand_prix_id, 'GP', grand_prix_id FROM race;

-- 76 个赛季 × 20 名车手/车队的积分榜与参赛登记
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1520)
INSERT INTO season_driver_standing (year, position_display_order, position_text, driver_id, points, championship_won)
SELECT 1950 + (n - 1) / 20, (n - 1) % 20 + 1, CAST((n - 1) % 20 + 1 AS TEXT),
       'driver-' || ((n - 1) % 20 + 1), 100 - (n - 1) % 20, (n - 1) % 20 = 0 FROM seq;

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 760)
INSERT INTO season_constructor_standing (year, position_display_order, position_text, constructor_id, points, championship_won)
SELECT 1950 + (n - 1) / 10, (n - 1) % 10 + 1, CAST((n - 1) % 10 + 1 AS TEXT),
       'team-' || ((n - 1) % 10 + 1), 200 - (n - 1) % 10, (n - 1) % 10 = 0 FROM seq;

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1520)
INSERT INTO season_entrant_driver (year, entrant_id, constructor_id, engine_manufacturer_id, driver_id, test_driver)
SELECT 1950 + (n - 1) / 20, 'entrant-' || (((n - 1) % 20) / 2 + 1),
       'team-' || (((n - 1) % 20) / 2 + 1), 'engine-1', 'driver-' || ((n - 1) % 20 + 1), 0 FROM seq;

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 760)
INSERT INTO season_entrant_constructor (year, entrant_id, constructor_id, engine_manufacturer_id)
SELECT 1950 + (n - 1) / 10, 'entrant-' || ((n - 1) % 10 + 1),
       'team-' || ((n - 1) % 10 + 1), 'engine-1' FROM seq;
ANALYZE;
`;

function sql(dbPath: string, script: string): string {
  return execFileSync("sqlite3", ["-json", dbPath], {
    input: script,
    encoding: "utf8",
  });
}

// 位置参数替换成夹具字面量：?1/?2 -> 1992 年 gp-42（circuit-a）/ driver-7
function bind(query: string): string {
  return query.replaceAll("?1", "1992").replaceAll("?2", "'gp-42'");
}

function plan(dbPath: string, query: string): string {
  return sql(dbPath, `EXPLAIN QUERY PLAN ${bind(query)}`);
}

let dir: string;
let dbPath: string;
// 同样的索引但没跑过 ANALYZE：生产 D1 长期处于这个状态，规划器只能靠启发式排连接顺序
let unanalyzedPath: string;
let basePlans: { recordLap: string; circuitInfo: string };

const teammateQuery = (query = teammateResultsSql) =>
  query.replaceAll("?1", "'driver-7'");

// 车手/车队页的赛季维度查询：?1 是 slug
const bindSlug = (query: string, slug: string) =>
  query.replaceAll("?1", `'${slug}'`);

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "f1db-plan-"));
  dbPath = path.join(dir, "fixture.db");
  unanalyzedPath = path.join(dir, "unanalyzed.db");
  sql(dbPath, FIXTURE_SCHEMA);
  basePlans = {
    recordLap: plan(dbPath, recordLapSql),
    circuitInfo: plan(dbPath, circuitInfoSql),
  };
  const indexes = readFileSync(INDEX_SQL, "utf8");
  sql(dbPath, indexes);
  copyFileSync(dbPath, unanalyzedPath);
  sql(dbPath, "ANALYZE;");
  return () => rmSync(dir, { recursive: true, force: true });
});

describe("D1 查询计划", () => {
  it("导入脚本在 dump 后附加索引文件", () => {
    expect(readFileSync(DUMP_SCRIPT, "utf8")).toContain("f1db-d1-indexes.sql");
  });

  it("导入脚本结尾执行 ANALYZE 让规划器选对驱动表", () => {
    expect(readFileSync(IMPORT_SCRIPT, "utf8")).toContain("ANALYZE;");
  });

  it("race(circuit_id, year) 让比赛页的赛道查询走覆盖索引", () => {
    // 基线：上游只有 race_circuit_id_idx（单列），取到 year 还要回表
    expect(basePlans.recordLap).not.toContain("idx_race_circuit_year");
    expect(basePlans.circuitInfo).not.toContain("idx_race_circuit_year");

    expect(plan(dbPath, circuitInfoSql)).toContain(
      "SEARCH ra2 USING COVERING INDEX idx_race_circuit_year",
    );
  });

  // 生产退化的形态是规划器从 race_data 的 rcda_type_idx 起步，把整个 FASTEST_LAP
  // 分区拉出来回表（2026-09-02 实测 75222 行/次，96 次调用烧掉 722 万行日配额）。
  // 触发条件是缺 ANALYZE 统计，而合成夹具的数据分布复现不出真实规划器的这个决策——
  // 别再试图让夹具"重现故障"，它做不到。这里锁定的是不依赖数据分布的结构性属性：
  // CROSS JOIN 禁止重排连接顺序，所以计划恒定从 ra 起步、与统计信息无关。
  // 真实数据上的验证（配额恢复后可重跑）：
  //   curl -L github.com/f1db/f1db/releases/latest/download/f1db-sqlite.zip 解出 f1db.db，
  //   套上 scripts/f1db-d1-indexes.sql 但不跑 ANALYZE，EXPLAIN QUERY PLAN 该查询。
  //   改写前是 SEARCH race_data USING INDEX rcda_type_idx，改写后是
  //   SEARCH ra USING COVERING INDEX idx_race_circuit_year。
  it("纪录圈查询固定从 race 驱动，不随 ANALYZE 统计摇摆", () => {
    for (const db of [dbPath, unanalyzedPath]) {
      const recordLapPlan = plan(db, recordLapSql);
      expect(recordLapPlan).toContain(
        "SEARCH ra USING COVERING INDEX idx_race_circuit_year",
      );
      expect(recordLapPlan).not.toContain("rcda_type_idx");
      expect(recordLapPlan).not.toContain("SCAN");
      // race_data 按 (race_id, type) 的探针由上游主键自动索引提供，无需额外索引
      expect(recordLapPlan).toContain("SEARCH race_data USING INDEX");
    }
  });

  it("纪录圈查询取到全场次最快的一圈", () => {
    const rows = JSON.parse(sql(dbPath, bind(recordLapSql))) as Array<{
      time: string;
      driver_name: string;
      year: number;
    }>;
    expect(rows).toEqual([
      { time: "1:19.000", driver_name: "Driver 7", year: 1992 },
    ]);
  });

  it("队友查询按赛事而非车队分区驱动", () => {
    for (const db of [dbPath, unanalyzedPath]) {
      const teammatePlan = plan(db, teammateQuery());
      // 先按 stint 年份取该年的 race，再按 (race_id, type, constructor_id) 精确探针
      expect(teammatePlan).toContain("SEARCH ra USING COVERING INDEX");
      expect(teammatePlan).toContain("idx_rd_race_type_constructor");
      // 反例：先拉整个车队分区，年份过滤只能事后生效
      expect(teammatePlan).not.toContain(
        "idx_rd_constructor_type (constructor_id=?",
      );
    }
  });

  // 车手页一次渲染要跑十余条按 slug 过滤的查询，赛季维度表主键都以 year 打头，
  // 缺列索引时每条都全扫（2026-09-03 实测 standings 1681 行/次、rounds 4189 行/次）
  it("赛季维度表按 slug 过滤走索引而非全表扫", () => {
    const cases: [string, string, string][] = [
      [
        "车手积分榜",
        bindSlug(driverStandingsSql, "driver-7"),
        "idx_sds_driver",
      ],
      ["车手参赛年份", bindSlug(driverRoundsSql, "driver-7"), "idx_sed_driver"],
      [
        "车队积分榜",
        bindSlug(teamStandingsSql, "team-3"),
        "idx_scs_constructor",
      ],
      [
        "车队参赛年份",
        bindSlug(teamRoundsSql, "team-3"),
        "idx_sec_constructor",
      ],
    ];
    for (const [label, query, index] of cases) {
      for (const db of [dbPath, unanalyzedPath]) {
        const queryPlan = plan(db, query);
        expect(queryPlan, label).toContain(index);
        expect(queryPlan, label).not.toContain("SCAN season_");
      }
    }
  });

  it("CROSS JOIN 让队友查询不依赖 ANALYZE 统计", () => {
    const naive = teammateQuery(
      teammateResultsSql.replaceAll("CROSS JOIN", "JOIN"),
    );
    expect(plan(unanalyzedPath, naive)).toContain(
      "idx_rd_constructor_type (constructor_id=?",
    );
  });
});
