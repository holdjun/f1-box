import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { recordLapSql } from "../src/lib/race-results-repository.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const INDEX_SQL = path.join(repoRoot, "scripts/f1db-d1-indexes.sql");
const DUMP_SCRIPT = path.join(repoRoot, "scripts/f1db-d1-dump.sh");
const IMPORT_SCRIPT = path.join(repoRoot, "scripts/f1db-d1-import.sh");

// 上游 f1db 只给 race_data 单列索引；fastest_lap 等"每场数据"都是
// race_data 按 type 过滤的视图，按 race+type 过滤的查询（比赛页纪录圈）
// 会退化成扫整个 type 分区（实测 20 万行读/次）。这里复刻最小 schema +
// 上游索引，验证 scripts/f1db-d1-indexes.sql 的复合索引让查询计划改走
// (race_id, type) 探针
const FIXTURE_SCHEMA = `
CREATE TABLE race (id INTEGER PRIMARY KEY, year INTEGER NOT NULL, grand_prix_id TEXT NOT NULL, circuit_id TEXT NOT NULL);
CREATE INDEX race_year_idx ON race (year);
CREATE INDEX race_circuit_id_idx ON race (circuit_id);
CREATE TABLE driver (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE race_data (race_id INTEGER NOT NULL, type TEXT NOT NULL, driver_id TEXT, constructor_id TEXT, fastest_lap_time TEXT, fastest_lap_time_millis INTEGER);
CREATE INDEX rcda_type_idx ON race_data (type);
CREATE VIEW fastest_lap AS
SELECT race_id, driver_id, fastest_lap_time AS time, fastest_lap_time_millis AS time_millis
FROM race_data WHERE type = 'FASTEST_LAP';

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1200)
INSERT INTO race (id, year, grand_prix_id, circuit_id)
SELECT n, 1950 + (n % 76), 'gp-' || n, CASE WHEN n <= 80 THEN 'circuit-a' ELSE 'circuit-b' END FROM seq;

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 50)
INSERT INTO driver (id, name) SELECT 'driver-' || n, 'Driver ' || n FROM seq;

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 48000)
INSERT INTO race_data (race_id, type, driver_id, fastest_lap_time, fastest_lap_time_millis)
SELECT (n - 1) / 40 + 1,
       CASE WHEN (n - 1) % 40 < 20 THEN 'FASTEST_LAP' ELSE 'RACE_RESULT' END,
       'driver-' || (n % 50 + 1),
       '1:23.456',
       80000 + (n * 7) % 9000
FROM seq;

-- circuit-a 第 42 场埋一个全场最快圈，验证结果正确性
INSERT INTO race_data (race_id, type, driver_id, fastest_lap_time, fastest_lap_time_millis)
VALUES (42, 'FASTEST_LAP', 'driver-7', '1:19.000', 79000);
`;

function sql(dbPath: string, script: string): string {
  return execFileSync("sqlite3", ["-json", dbPath], {
    input: script,
    encoding: "utf8",
  });
}

function queryPlan(dbPath: string): string {
  // 位置参数替换成夹具字面量：?1/?2 -> 1992 年 gp-42（circuit-a），LIMIT -> 1
  const query = recordLapSql
    .replace("?1", "1992")
    .replace("?2", "'gp-42'")
    .replace("LIMIT ?", "LIMIT 1");
  return sql(dbPath, `EXPLAIN QUERY PLAN ${query}`);
}

describe("race_data 复合索引（scripts/f1db-d1-indexes.sql）", () => {
  it("导入脚本在 race_data dump 后附加索引文件", () => {
    expect(readFileSync(DUMP_SCRIPT, "utf8")).toContain("f1db-d1-indexes.sql");
  });

  it("导入脚本结尾执行 ANALYZE 让规划器采用复合索引", () => {
    expect(readFileSync(IMPORT_SCRIPT, "utf8")).toContain("ANALYZE;");
  });

  it("索引让纪录圈查询改走 (race_id, type) 探针且结果正确", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "f1db-index-"));
    const dbPath = path.join(dir, "fixture.db");
    try {
      sql(dbPath, FIXTURE_SCHEMA);

      // 只有上游索引时不允许出现我们的复合索引（基线，防夹具失真）
      expect(queryPlan(dbPath)).not.toContain("idx_rd_race_type");

      sql(dbPath, `${readFileSync(INDEX_SQL, "utf8")}\nANALYZE;`);
      expect(queryPlan(dbPath)).toContain("idx_rd_race_type");

      const query = recordLapSql
        .replace("?1", "1992")
        .replace("?2", "'gp-42'")
        .replace("LIMIT ?", "LIMIT 1");
      const rows = JSON.parse(sql(dbPath, query)) as Array<{
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
