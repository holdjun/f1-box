import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import {
  lockAcquireSql,
  lockReleaseSql,
  stateUpsertSql,
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
      expect.arrayContaining(["candidateSql", "statusSql", "outboxSql"]),
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

  it("only persists results for the reference that was collected", () => {
    const identity = [
      "2023",
      "14",
      "'race'",
      "20",
      "30",
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
      ...identity.slice(7),
    ];
    const staleIdentity = [...identity];
    staleIdentity[7] = "'/static/stale/'";
    const staleState = [...state];
    staleState[9] = "'/static/stale/'";
    const output = execFileSync("sqlite3", ["-json", dbPath], {
      encoding: "utf8",
      input: `
        INSERT INTO session_source_ref VALUES
          (2023, 14, 'race', '/static/current/', '2023-09-03',
           '2023-09-03T14:00:00Z', 'fastf1-schedule');
        ${bindSql(weatherUpsertSql, identity)};
        ${bindSql(stateUpsertSql, state)};
        SELECT
          (SELECT COUNT(*) FROM session_weather) AS weather,
          (SELECT COUNT(*) FROM weather_sync_state) AS state;
        DELETE FROM session_weather;
        DELETE FROM weather_sync_state;
        ${bindSql(weatherUpsertSql, staleIdentity)};
        ${bindSql(stateUpsertSql, staleState)};
        SELECT
          (SELECT COUNT(*) FROM session_weather) AS weather,
          (SELECT COUNT(*) FROM weather_sync_state) AS state;
      `,
    });
    const rows = output
      .trim()
      .split("\n")
      .flatMap((line) => JSON.parse(line));
    expect(rows).toEqual([
      { weather: 1, state: 1 },
      { weather: 0, state: 0 },
    ]);
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
    const rows = output
      .trim()
      .split("\n")
      .flatMap((line) => JSON.parse(line));
    expect(rows).toEqual([
      { owner: "owner-a" },
      { owner: "owner-a" },
      { owner: "owner-b" },
      { locks: 0 },
    ]);
  });
});
