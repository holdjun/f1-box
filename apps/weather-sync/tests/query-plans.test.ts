import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import {
  lockAcquireSql,
  lockReleaseSql,
  resultCandidateSql,
  resultStateUpsertSql,
  snapshotUpsertSql,
  weatherCandidateSql,
  weatherStateUpsertSql,
  weatherUpsertSql,
} from "../src/domain";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const domainSource = readFileSync(
  path.join(repoRoot, "apps/weather-sync/src/domain.ts"),
  "utf8",
);
const siteTables = readFileSync(
  path.join(repoRoot, "scripts/site-tables.sql"),
  "utf8",
);

let dbPath: string;
let queries: Array<{ key: string; sql: string }>;

function bindSql(sql: string, values: string[]): string {
  return sql.replace(
    /\?(\d+)/g,
    (_, index: string) => values[Number(index) - 1],
  );
}

function parseJsonBatches(output: string): Array<Record<string, unknown>> {
  const batches: string[] = [];
  let depth = 0;
  let start = -1;
  for (const [index, char] of output.trim().split("").entries()) {
    if (char === "[" && depth === 0) {
      depth = 1;
      start = index;
    } else if (char === "]" && depth === 1) {
      depth = 0;
      batches.push(output.trim().slice(start, index + 1));
    }
  }
  return batches.flatMap((batch) => JSON.parse(batch));
}

beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "f1box-weather-plan-"));
  dbPath = path.join(dir, "weather.db");
  const run = (script: string) =>
    execFileSync("sqlite3", [dbPath], { input: script, encoding: "utf8" });
  run(siteTables);

  queries = [];
  const pattern = /export const (\w+Sql) = `([\s\S]*?)`;/g;
  for (const match of domainSource.matchAll(pattern)) {
    const sql = match[2].replace(/\?\d+/g, "?").trim();
    if (/^(SELECT|WITH)/i.test(sql)) queries.push({ key: match[1], sql });
  }
  return () => rmSync(dir, { recursive: true, force: true });
});

describe("weather ingestion query plans", () => {
  it("collects the read queries", () => {
    expect(queries.map((query) => query.key)).toEqual(
      expect.arrayContaining([
        "weatherCandidateSql",
        "resultCandidateSql",
        "weatherStatusSql",
        "resultStatusSql",
        "outboxSql",
        "weatherCountSql",
        "snapshotCountSql",
        "referenceCountSql",
        "failuresSql",
      ]),
    );
  });

  it("does not fully scan site tables", () => {
    for (const query of queries) {
      const plan = execFileSync("sqlite3", [dbPath], {
        input: `EXPLAIN QUERY PLAN ${query.sql.replace(/;\s*$/, "")};`,
        encoding: "utf8",
      });
      const scans = [
        ...plan
          .split("\n")
          .filter((line) => !line.includes("USING"))
          .join("\n")
          .matchAll(/\bSCAN (\w+)\b/g),
      ]
        .map((match) => match[1])
        .filter((table) => !["session_keys"].includes(table));
      expect(scans, query.key).toEqual([]);
    }
  });

  it("only persists derived rows for the reference that was collected", () => {
    const identity = [
      "2023",
      "14",
      "'race'",
      "20",
      "30",
      "48",
      "1012",
      "14",
      "220",
      "0",
      "156",
      "'2023-09-03T15:56:00Z'",
      "NULL",
      "'2026-09-12T12:00:00Z'",
      "'/static/current/'",
      "'2023-09-03'",
      "'2023-09-03T14:00:00Z'",
    ];
    const state = [
      "2023",
      "14",
      "'race'",
      "'success'",
      "1",
      "NULL",
      "'2026-09-12T12:00:00Z'",
      "NULL",
      "'2026-09-12T12:00:00Z'",
      ...identity.slice(14),
    ];
    const staleIdentity = [...identity];
    staleIdentity[14] = "'/static/stale/'";
    const staleState = [...state];
    staleState[9] = "'/static/stale/'";
    const resultState = [
      "2023",
      "14",
      "'race'",
      "'success'",
      "1",
      "NULL",
      "'2026-09-12T12:00:00Z'",
      "NULL",
      "'2026-09-12T12:00:00Z'",
      "'/static/current/'",
      "'2023-09-03'",
      "'2023-09-03T14:00:00Z'",
    ];
    const snapshotRows = JSON.stringify([
      {
        driverNumber: "44",
        driverSourceId: null,
        driverName: "Lewis Hamilton",
        driverCode: "HAM",
        constructorSourceId: null,
        constructorName: "Mercedes",
        position: 1,
        positionText: "1",
        bestLapMs: 82123,
        q1Ms: null,
        q2Ms: null,
        q3Ms: null,
        totalTimeMs: null,
        gapMs: null,
        gapText: null,
        laps: 58,
        status: null,
        points: null,
      },
    ]);
    const snapshot = [
      "2023",
      "14",
      "'race'",
      `'${snapshotRows.replaceAll("'", "''")}'`,
      "'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'",
      "'2026-09-12T12:00:00Z'",
      "'/static/current/'",
      "'2023-09-03'",
      "'2023-09-03T14:00:00Z'",
    ];
    const staleSnapshot = [...snapshot];
    staleSnapshot[6] = "'/static/stale/'";
    const output = execFileSync("sqlite3", ["-json", dbPath], {
      encoding: "utf8",
      input: `
        INSERT INTO session_source_ref VALUES
          (2023, 14, 'race', '/static/current/', '2023-09-03',
           '2023-09-03T14:00:00Z', 'fastf1-schedule');
        ${bindSql(weatherUpsertSql, identity)};
        ${bindSql(weatherStateUpsertSql, state)};
        ${bindSql(resultStateUpsertSql, resultState)};
        ${bindSql(snapshotUpsertSql, snapshot)};
        SELECT
          (SELECT COUNT(*) FROM session_weather) AS weather,
          (SELECT COUNT(*) FROM weather_sync_state) AS weatherState,
          (SELECT COUNT(*) FROM session_result_snapshot) AS snapshot,
          (SELECT COUNT(*) FROM session_result_sync_state) AS resultState;
        DELETE FROM session_weather;
        DELETE FROM weather_sync_state;
        DELETE FROM session_result_snapshot;
        DELETE FROM session_result_sync_state;
        ${bindSql(weatherUpsertSql, staleIdentity)};
        ${bindSql(weatherStateUpsertSql, staleState)};
        ${bindSql(resultStateUpsertSql, staleState)};
        ${bindSql(snapshotUpsertSql, staleSnapshot)};
        SELECT
          (SELECT COUNT(*) FROM session_weather) AS weather,
          (SELECT COUNT(*) FROM weather_sync_state) AS weatherState,
          (SELECT COUNT(*) FROM session_result_snapshot) AS snapshot,
          (SELECT COUNT(*) FROM session_result_sync_state) AS resultState;
      `,
    });
    const rows = parseJsonBatches(output);
    expect(rows).toEqual([
      { weather: 1, weatherState: 1, snapshot: 1, resultState: 1 },
      { weather: 0, weatherState: 0, snapshot: 0, resultState: 0 },
    ]);
  });

  it("replaces an entire session snapshot so removed drivers disappear", () => {
    const twoRows = JSON.stringify([
      {
        driverNumber: "44",
        driverName: "Lewis Hamilton",
        driverCode: "HAM",
        constructorName: "Ferrari",
        positionText: "1",
      },
      {
        driverNumber: "14",
        driverName: "Fernando Alonso",
        driverCode: "ALO",
        constructorName: "Aston Martin",
        positionText: "2",
      },
    ]);
    const oneRow = JSON.stringify([
      {
        driverNumber: "44",
        driverName: "Lewis Hamilton",
        driverCode: "HAM",
        constructorName: "Ferrari",
        positionText: "1",
      },
    ]);
    const bind = (rows: string, revision: string) =>
      bindSql(snapshotUpsertSql, [
        "2024",
        "15",
        "'qualifying'",
        `'${rows.replaceAll("'", "''")}'`,
        `'${revision}'`,
        "'2026-09-12T12:00:00Z'",
        "'/static/current/'",
        "'2023-09-03'",
        "'2023-09-03T14:00:00Z'",
      ]);
    const output = execFileSync("sqlite3", ["-json", dbPath], {
      encoding: "utf8",
      input: `
        INSERT INTO session_source_ref VALUES
          (2024, 15, 'qualifying', '/static/current/', '2023-09-03',
           '2023-09-03T14:00:00Z', 'fastf1-schedule');
        ${bind(twoRows, "a".repeat(64))};
        DELETE FROM session_result_snapshot
          WHERE year = 2024 AND round = 15 AND session_key = 'qualifying';
        ${bind(oneRow, "b".repeat(64))};
        SELECT driver_number FROM session_result_snapshot;
      `,
    });
    expect(parseJsonBatches(output)).toEqual([{ driver_number: "44" }]);
  });

  it("lets only one ingestion owner hold the lease", () => {
    const output = execFileSync("sqlite3", ["-json", dbPath], {
      encoding: "utf8",
      input: `
        ${bindSql(lockAcquireSql, ["'owner-a'", "'2026-09-12T10:25:00Z'", "'2026-09-12T10:00:00Z'"])};
        SELECT owner FROM weather_sync_lock;
        ${bindSql(lockAcquireSql, ["'owner-b'", "'2026-09-12T10:30:00Z'", "'2026-09-12T10:05:00Z'"])};
        SELECT owner FROM weather_sync_lock;
        ${bindSql(lockAcquireSql, ["'owner-b'", "'2026-09-12T11:00:00Z'", "'2026-09-12T10:30:00Z'"])};
        SELECT owner FROM weather_sync_lock;
        ${bindSql(lockReleaseSql, ["'owner-b'"])};
        SELECT COUNT(*) AS locks FROM weather_sync_lock;
      `,
    });
    const rows = parseJsonBatches(output);
    expect(rows).toEqual([
      { owner: "owner-a" },
      { owner: "owner-a" },
      { owner: "owner-b" },
      { locks: 0 },
    ]);
  });

  it("prioritizes recent retries and scopes results to the lookback window", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "weather-priority-"));
    const priorityDb = path.join(dir, "weather.db");
    const weatherSql = bindSql(weatherCandidateSql, [
      "'2026-09-12T00:00:00Z'",
      "5",
      "'2026-09-12T00:00:00Z'",
      "2",
    ]);
    const resultSql = bindSql(resultCandidateSql, [
      "'2026-09-12T00:00:00Z'",
      "'2026-08-29T00:00:00Z'",
      "5",
      "'2026-09-12T00:00:00Z'",
      "2",
    ]);
    const output = execFileSync("sqlite3", ["-json", priorityDb], {
      encoding: "utf8",
      input: `${siteTables}
        INSERT INTO session_source_ref VALUES
          (2026, 1, 'race', '/static/2026/race/', '2026-09-11',
           '2026-09-11T04:00:00Z', 'fastf1-schedule'),
          (2023, 1, 'race', '/static/2023/race-1/', '2023-03-05',
           '2023-03-05T15:00:00Z', 'fastf1-schedule'),
          (2023, 2, 'race', '/static/2023/race-2/', '2023-03-19',
           '2023-03-19T15:00:00Z', 'fastf1-schedule');
        INSERT INTO weather_sync_state VALUES
          (2026, 1, 'race', 'failed', 1, 'HTTP 503',
           '2026-09-11T23:00:00Z', '2026-09-11T23:15:00Z',
           '2026-09-11T23:00:00Z');
        ${weatherSql};
        ${resultSql};
      `,
    });
    const rows = parseJsonBatches(output);
    expect(rows.map((row) => row.year)).toEqual([2026, 2023, 2026]);
    rmSync(dir, { recursive: true, force: true });
  });
});
