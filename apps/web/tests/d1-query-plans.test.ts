import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { teammateResultsSql } from "../src/lib/driver-repository.js";
import {
  circuitInfoSql,
  recordLapSql,
} from "../src/lib/race-results-repository.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const INDEX_SQL = path.join(repoRoot, "scripts/f1db-d1-indexes.sql");
const DUMP_SCRIPT = path.join(repoRoot, "scripts/f1db-d1-dump.sh");
const IMPORT_SCRIPT = path.join(repoRoot, "scripts/f1db-d1-import.sh");

// 复刻 f1db 上游 schema 的关键事实：只有主键/唯一约束索引，一条二级索引都没有。
// race_data 主键 (race_id, type, position_display_order) 已覆盖按 race+type 的过滤，
// 但 race.circuit_id 无索引，且 race_data 无 (race_id, type, constructor_id) 探针。
// 夹具照抄这套约束，才能验证 scripts/f1db-d1-indexes.sql 与查询本身的连接顺序
// 真的改变了生产上的查询计划。
const FIXTURE_SCHEMA = `
CREATE TABLE race (
  id INTEGER NOT NULL, year INTEGER NOT NULL, round INTEGER NOT NULL,
  grand_prix_id TEXT NOT NULL, circuit_id TEXT NOT NULL,
  CONSTRAINT race_pk PRIMARY KEY (id),
  CONSTRAINT race_year_round_uk UNIQUE (year, round)
);
CREATE TABLE circuit (id TEXT NOT NULL, total_races_held INTEGER NOT NULL, CONSTRAINT circuit_pk PRIMARY KEY (id));
CREATE TABLE country (id TEXT NOT NULL, alpha2_code TEXT NOT NULL, CONSTRAINT country_pk PRIMARY KEY (id));
CREATE TABLE driver (
  id TEXT NOT NULL, name TEXT NOT NULL, nationality_country_id TEXT NOT NULL,
  CONSTRAINT driver_pk PRIMARY KEY (id)
);
CREATE TABLE race_data (
  race_id INTEGER NOT NULL, type TEXT NOT NULL, position_display_order INTEGER NOT NULL,
  position_number INTEGER, position_text TEXT, driver_id TEXT, constructor_id TEXT,
  pole_position INTEGER, fastest_lap INTEGER, reason_retired TEXT,
  fastest_lap_time TEXT, fastest_lap_time_millis INTEGER,
  CONSTRAINT rcda_pk PRIMARY KEY (race_id, type, position_display_order)
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

  it("race(circuit_id, year) 让比赛页的赛道查询不再全扫 race", () => {
    // 基线：上游 schema 下两条查询都得扫遍 race
    expect(basePlans.recordLap).toContain("SCAN ra");
    expect(basePlans.circuitInfo).not.toContain("idx_race_circuit_year");

    const recordLapPlan = plan(dbPath, recordLapSql);
    expect(recordLapPlan).toContain(
      "SEARCH ra USING COVERING INDEX idx_race_circuit_year",
    );
    expect(recordLapPlan).not.toContain("SCAN");
    // race_data 按 (race_id, type) 的探针由上游主键自动索引提供，无需额外索引
    expect(recordLapPlan).toContain("SEARCH race_data USING INDEX");
    expect(plan(dbPath, circuitInfoSql)).toContain(
      "SEARCH ra2 USING COVERING INDEX idx_race_circuit_year",
    );
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

  it("CROSS JOIN 让队友查询不依赖 ANALYZE 统计", () => {
    const naive = teammateQuery(
      teammateResultsSql.replaceAll("CROSS JOIN", "JOIN"),
    );
    expect(plan(unanalyzedPath, naive)).toContain(
      "idx_rd_constructor_type (constructor_id=?",
    );
  });
});
