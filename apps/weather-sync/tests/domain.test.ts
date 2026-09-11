import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildPersistPlan,
  type ContainerSessionResult,
  candidateSql,
  MAX_ATTEMPTS,
  nextRetryAt,
  parseContainerResponse,
  parseRunRequest,
  summarize,
  yearsSql,
} from "../src/domain";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const now = new Date("2026-09-11T12:00:00.000Z");

const candidate = {
  year: 2023,
  round: 1,
  sessionKey: "qualifying",
  raceDate: "2023-03-05",
  startsAtUtc: "2023-03-04T16:00:00.000Z",
  attempts: 0,
};

const successfulResult: ContainerSessionResult = {
  year: 2023,
  round: 1,
  sessionKey: "qualifying",
  status: "success",
  tempC: 24,
  trackTempC: 32,
  weatherCode: "rain",
  fetchedAt: "2026-09-11T12:00:01.000Z",
  error: null,
};

const containerResponse = {
  fastf1Version: "3.8.3",
  requestsVersion: "2.34.2",
  hosts: ["livetiming.formula1.com"],
  sessions: [successfulResult],
};

describe("Cloudflare weather sync domain", () => {
  it("validates container responses at the boundary", () => {
    expect(parseContainerResponse(containerResponse, [candidate])).toEqual(
      containerResponse,
    );

    expect(() =>
      parseContainerResponse({ ...containerResponse, sessions: [] }, [
        candidate,
      ]),
    ).toThrow(/missing container result/i);
    expect(() =>
      parseContainerResponse(
        { ...containerResponse, hosts: ["api.jolpi.ca"] },
        [candidate],
      ),
    ).toThrow(/banned host/i);
    expect(() =>
      parseContainerResponse(
        {
          ...containerResponse,
          sessions: [{ ...successfulResult, status: "unknown" }],
        },
        [candidate],
      ),
    ).toThrow(/unknown container status/i);
  });

  it("keeps explicit no-data and identity mismatch terminal", () => {
    const plan = buildPersistPlan(
      [candidate],
      [
        {
          ...successfulResult,
          status: "no_data",
          tempC: null,
          trackTempC: null,
          weatherCode: null,
        },
      ],
      now,
    );
    expect(plan.rows[0]?.state.status).toBe("no_data");
    expect(plan.rows[0]?.state.nextAttemptAt).toBeNull();
    expect(plan.weather).toHaveLength(0);
  });

  it("separates retrieval failures from no-data and bounds retries", () => {
    expect(nextRetryAt(1, now)).toBe("2026-09-11T12:15:00.000Z");
    expect(nextRetryAt(2, now)).toBe("2026-09-11T13:00:00.000Z");
    expect(nextRetryAt(3, now)).toBe("2026-09-11T18:00:00.000Z");
    expect(nextRetryAt(4, now)).toBe("2026-09-12T12:00:00.000Z");
    expect(nextRetryAt(MAX_ATTEMPTS, now)).toBeNull();

    const first = buildPersistPlan(
      [candidate],
      [
        {
          ...successfulResult,
          status: "unavailable",
          tempC: null,
          trackTempC: null,
          weatherCode: null,
          error: "HTTP 403",
        },
      ],
      now,
    );
    expect(first.rows[0]?.state).toMatchObject({
      status: "failed",
      attempts: 1,
      nextAttemptAt: "2026-09-11T12:15:00.000Z",
      lastError: "HTTP 403",
    });

    const exhausted = buildPersistPlan(
      [{ ...candidate, attempts: MAX_ATTEMPTS - 1 }],
      [
        {
          ...successfulResult,
          status: "unavailable",
          tempC: null,
          trackTempC: null,
          weatherCode: null,
          error: "HTTP 403",
        },
      ],
      now,
    );
    expect(exhausted.rows[0]?.state.status).toBe("exhausted");
    expect(exhausted.rows[0]?.state.nextAttemptAt).toBeNull();
  });

  it("writes successful FastF1 summaries and state together", () => {
    const plan = buildPersistPlan([candidate], [successfulResult], now);
    expect(plan.weather[0]).toEqual({
      year: 2023,
      round: 1,
      sessionKey: "qualifying",
      tempC: 24,
      trackTempC: 32,
      weatherCode: "rain",
      fetchedAt: "2026-09-11T12:00:01.000Z",
    });
    expect(plan.rows[0]?.state).toMatchObject({
      status: "success",
      attempts: 1,
      nextAttemptAt: null,
      lastError: null,
    });
    expect(summarize([successfulResult])).toEqual({
      requested: 1,
      success: 1,
      noData: 0,
      mismatch: 0,
      failed: 0,
      exhausted: 0,
    });
  });

  it("validates manual run requests", () => {
    expect(parseRunRequest({ mode: "backfill", years: [2023, 2024] })).toEqual({
      mode: "backfill",
      years: [2023, 2024],
    });
    expect(parseRunRequest({ mode: "current" })).toEqual({
      mode: "current",
      years: null,
    });
    expect(() => parseRunRequest({ mode: "weather" })).toThrow(/mode/i);
    expect(() => parseRunRequest({ mode: "backfill", years: [2017] })).toThrow(
      /2018/i,
    );
    expect(() =>
      parseRunRequest({ mode: "backfill", years: [2023, "bad"] }),
    ).toThrow(/years/i);
  });

  it("uses native f1db session times within D1 limits", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "weather-current-"));
    const dbPath = path.join(dir, "d1.db");
    const run = (script: string) =>
      execFileSync("sqlite3", ["-json", dbPath], {
        input: `.limit compound_select 5\n${script}`,
        encoding: "utf8",
      });
    const runJson = (script: string) =>
      JSON.parse(run(script).replace(/^\s*compound_select 5\n/, ""));
    run(
      readFileSync(
        path.join(repoRoot, "apps/web/tests/fixtures/d1-schema.sql"),
        "utf8",
      ),
    );
    run(readFileSync(path.join(repoRoot, "scripts/site-tables.sql"), "utf8"));
    run(
      readFileSync(path.join(repoRoot, "scripts/f1db-d1-indexes.sql"), "utf8"),
    );
    run(`
      INSERT INTO season (year) VALUES (2026);
      INSERT INTO race (
        id, year, round, date, time, grand_prix_id, official_name,
        qualifying_format, circuit_id, circuit_layout_id, circuit_type,
        direction, course_length, turns, laps, distance,
        drivers_championship_decider, constructors_championship_decider,
        free_practice_1_date, free_practice_1_time,
        qualifying_date, qualifying_time
      ) VALUES (
        1, 2026, 1, '2026-03-08', '04:00', 'bahrain', 'Bahrain Grand Prix',
        'standard', 'bahrain', 'bahrain-2026', 'track',
        'clockwise', 5.412, 15, 57, 308.238, 0, 0,
        '2026-03-06', '01:30', '2026-03-07', '05:00'
      );
    `);
    const bind = (sql: string) =>
      sql
        .replace(/\?1/g, "2026")
        .replace(/\?2/g, "'2026-09-12T00:00:00.000Z'")
        .replace(/\?3/g, "5")
        .replace(/\?4/g, "'2026-09-11T00:00:00.000Z'");
    const years = runJson(bind(yearsSql));
    const candidates = runJson(bind(candidateSql));
    expect(years).toEqual([{ year: 2026 }]);
    expect(candidates).toEqual([
      {
        year: 2026,
        round: 1,
        sessionKey: "practice-1",
        raceDate: "2026-03-08",
        startsAtUtc: "2026-03-06T01:30:00Z",
        attempts: 0,
      },
      {
        year: 2026,
        round: 1,
        sessionKey: "qualifying",
        raceDate: "2026-03-08",
        startsAtUtc: "2026-03-07T05:00:00Z",
        attempts: 0,
      },
      {
        year: 2026,
        round: 1,
        sessionKey: "race",
        raceDate: "2026-03-08",
        startsAtUtc: "2026-03-08T04:00:00Z",
        attempts: 0,
      },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses an indexed candidate query", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "weather-plan-"));
    const dbPath = path.join(dir, "d1.db");
    const run = (script: string) =>
      execFileSync("sqlite3", ["-json", dbPath], {
        input: script,
        encoding: "utf8",
      });
    run(
      readFileSync(
        path.join(repoRoot, "apps/web/tests/fixtures/d1-schema.sql"),
        "utf8",
      ),
    );
    run(readFileSync(path.join(repoRoot, "scripts/site-tables.sql"), "utf8"));
    run(
      readFileSync(path.join(repoRoot, "scripts/f1db-d1-indexes.sql"), "utf8"),
    );
    const plan = execFileSync("sqlite3", [dbPath], {
      input: `EXPLAIN QUERY PLAN ${candidateSql};`,
      encoding: "utf8",
    });
    const unindexedScans = plan
      .split("\n")
      .filter((line) =>
        /SCAN (race|session_time|weather_sync_state)(?! USING)/.test(line),
      );
    expect(unindexedScans).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
