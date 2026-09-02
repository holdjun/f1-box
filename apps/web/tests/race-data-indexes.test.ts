import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
// 但 race.circuit_id 无索引——比赛页的赛道纪录圈与首次举办年份都按它过滤，
// 缺索引时规划器只能全扫 race（1171 场）。夹具照抄这套约束，
// 才能验证 scripts/f1db-d1-indexes.sql 真的改变了生产上的查询计划。
const FIXTURE_SCHEMA = `
CREATE TABLE race (
  id INTEGER NOT NULL, year INTEGER NOT NULL, round INTEGER NOT NULL,
  grand_prix_id TEXT NOT NULL, circuit_id TEXT NOT NULL,
  CONSTRAINT race_pk PRIMARY KEY (id),
  CONSTRAINT race_year_round_uk UNIQUE (year, round)
);
CREATE TABLE circuit (id TEXT NOT NULL, total_races_held INTEGER NOT NULL, CONSTRAINT circuit_pk PRIMARY KEY (id));
CREATE TABLE driver (id TEXT NOT NULL, name TEXT NOT NULL, CONSTRAINT driver_pk PRIMARY KEY (id));
CREATE TABLE race_data (
  race_id INTEGER NOT NULL, type TEXT NOT NULL, position_display_order INTEGER NOT NULL,
  driver_id TEXT, constructor_id TEXT, fastest_lap_time TEXT, fastest_lap_time_millis INTEGER,
  CONSTRAINT rcda_pk PRIMARY KEY (race_id, type, position_display_order)
);
CREATE VIEW fastest_lap AS
SELECT race_id, driver_id, fastest_lap_time AS time, fastest_lap_time_millis AS time_millis
FROM race_data WHERE type = 'FASTEST_LAP';

INSERT INTO circuit (id, total_races_held) VALUES ('circuit-a', 80), ('circuit-b', 1120);

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1200)
INSERT INTO race (id, year, round, grand_prix_id, circuit_id)
SELECT n, 1950 + (n % 76), n, 'gp-' || n, CASE WHEN n <= 80 THEN 'circuit-a' ELSE 'circuit-b' END FROM seq;

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 50)
INSERT INTO driver (id, name) SELECT 'driver-' || n, 'Driver ' || n FROM seq;

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 48000)
INSERT INTO race_data (race_id, type, position_display_order, driver_id, fastest_lap_time, fastest_lap_time_millis)
SELECT (n - 1) / 40 + 1,
       CASE WHEN (n - 1) % 40 < 20 THEN 'FASTEST_LAP' ELSE 'RACE_RESULT' END,
       (n - 1) % 20 + 1,
       'driver-' || (n % 50 + 1),
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

// 位置参数替换成夹具字面量：?1/?2 -> 1992 年 gp-42（circuit-a）
function bind(query: string): string {
  return query.replaceAll("?1", "1992").replaceAll("?2", "'gp-42'");
}

function plan(dbPath: string, query: string): string {
  return sql(dbPath, `EXPLAIN QUERY PLAN ${bind(query)}`);
}

describe("D1 索引（scripts/f1db-d1-indexes.sql）", () => {
  it("导入脚本在 dump 后附加索引文件", () => {
    expect(readFileSync(DUMP_SCRIPT, "utf8")).toContain("f1db-d1-indexes.sql");
  });

  it("导入脚本结尾执行 ANALYZE 让规划器选对驱动表", () => {
    expect(readFileSync(IMPORT_SCRIPT, "utf8")).toContain("ANALYZE;");
  });

  it("race(circuit_id, year) 让比赛页的赛道查询不再全扫 race", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "f1db-index-"));
    const dbPath = path.join(dir, "fixture.db");
    try {
      sql(dbPath, FIXTURE_SCHEMA);

      // 基线：上游 schema 下两条查询都得扫遍 race
      expect(plan(dbPath, recordLapSql)).toContain("SCAN ra");
      expect(plan(dbPath, circuitInfoSql)).not.toContain(
        "idx_race_circuit_year",
      );

      sql(dbPath, `${readFileSync(INDEX_SQL, "utf8")}\nANALYZE;`);

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

      const rows = JSON.parse(sql(dbPath, bind(recordLapSql))) as Array<{
        time: string;
        driver_name: string;
        year: number;
      }>;
      expect(rows).toEqual([
        { time: "1:19.000", driver_name: "Driver 7", year: 1992 },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
