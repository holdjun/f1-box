import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BATCH_LIMIT,
  buildCollectionFailureResults,
  buildPersistPlan,
  type CollectRequestSession,
  type ContainerResultRow,
  type ContainerSessionResult,
  MAX_ATTEMPTS,
  nextRetryAt,
  outboxInsertSql,
  parseContainerResponse,
  parseRunRequest,
  resultCandidateSql,
  resultStateUpsertSql,
  type SessionCandidate,
  snapshotDeleteSql,
  snapshotUpsertSql,
  weatherCandidateSql,
  weatherStateUpsertSql,
  weatherUpsertSql,
} from "../src/domain";

const now = new Date("2026-09-12T12:00:00.000Z");
const contract = JSON.parse(
  readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../container/contract-version.json",
    ),
    "utf8",
  ),
) as {
  containerApiVersion: number;
  resultsAdapterVersion: string;
  resultsSchemaVersion: number;
};

const candidate: SessionCandidate = {
  year: 2023,
  round: 14,
  sessionKey: "race",
  apiPath: "/static/2023/2023-09-03_Italian_Grand_Prix/2023-09-03_Race/",
  raceDate: "2023-09-03",
  startsAtUtc: "2023-09-03T14:00:00.000Z",
  weather: { due: true, attempts: 0, previousStatus: null },
  results: { due: true, attempts: 0, previousStatus: null },
};

const resultRow: ContainerResultRow = {
  driverNumber: "44",
  driverSourceId: "lewis_hamilton",
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
  totalTimeMs: 5400000,
  gapMs: null,
  gapText: null,
  laps: 58,
  status: null,
  points: null,
};

const successfulResult: ContainerSessionResult = {
  year: 2023,
  round: 14,
  sessionKey: "race",
  weather: {
    status: "success",
    sampleCount: 156,
    tempC: 29.3,
    trackTempC: 43,
    humidityPct: 48,
    pressureHpa: 1012,
    windSpeedKph: 14,
    windDirectionDeg: 220,
    rainfall: false,
    observedAtUtc: "2023-09-03T15:56:00.000Z",
    weatherCode: null,
    fetchedAt: "2026-09-12T12:00:01.000Z",
    error: null,
  },
  results: {
    status: "success",
    rowCount: 1,
    rows: [resultRow],
    sourceRevision:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    fetchedAt: "2026-09-12T12:00:02.000Z",
    error: null,
    adapter: "fastf1-session-results",
    schemaVersion: contract.resultsSchemaVersion,
  },
};

const containerResponse = {
  fastf1Version: "3.8.3",
  requestsVersion: "2.34.2",
  resultsAdapterVersion: contract.resultsAdapterVersion,
  containerApiVersion: contract.containerApiVersion,
  sessions: [successfulResult],
};

const collectCandidate = (input: SessionCandidate): CollectRequestSession => ({
  year: input.year,
  round: input.round,
  sessionKey: input.sessionKey,
  apiPath: input.apiPath,
  startsAtUtc: input.startsAtUtc,
  weather: input.weather.due,
  results: input.results.due,
});

describe("session ingestion domain", () => {
  it("validates container responses at the boundary", () => {
    expect(
      parseContainerResponse(containerResponse, [collectCandidate(candidate)]),
    ).toEqual(containerResponse);

    expect(() =>
      parseContainerResponse({ ...containerResponse, sessions: [] }, [
        collectCandidate(candidate),
      ]),
    ).toThrow(/missing container result/i);
    expect(() =>
      parseContainerResponse(
        {
          ...containerResponse,
          sessions: [
            successfulResult,
            { ...successfulResult, sessionKey: "qualifying" },
          ],
        },
        [collectCandidate(candidate)],
      ),
    ).toThrow(/unexpected container result/i);
    expect(() =>
      parseContainerResponse(
        {
          ...containerResponse,
          sessions: [
            {
              ...successfulResult,
              weather: { ...successfulResult.weather, status: "unknown" },
            },
          ],
        },
        [collectCandidate(candidate)],
      ),
    ).toThrow(/unknown container status/i);
    expect(() =>
      parseContainerResponse(
        { ...containerResponse, resultsAdapterVersion: "unknown" },
        [collectCandidate(candidate)],
      ),
    ).toThrow(/results adapter version/i);
    expect(() =>
      parseContainerResponse(
        { ...containerResponse, containerApiVersion: undefined },
        [collectCandidate(candidate)],
      ),
    ).toThrow(/container api version/i);
    expect(() =>
      parseContainerResponse(
        {
          ...containerResponse,
          sessions: [
            {
              ...successfulResult,
              results: { ...successfulResult.results, rowCount: 0 },
            },
          ],
        },
        [collectCandidate(candidate)],
      ),
    ).toThrow(/row count/i);
    expect(() =>
      parseContainerResponse(
        {
          ...containerResponse,
          sessions: [
            {
              ...successfulResult,
              results: {
                ...successfulResult.results!,
                adapter: "not-a-real-adapter",
              },
            },
          ],
        },
        [collectCandidate(candidate)],
      ),
    ).toThrow(/results adapter/i);

    const unavailableDuringRollout = {
      ...containerResponse,
      sessions: [
        {
          ...successfulResult,
          results: {
            ...successfulResult.results,
            status: "unavailable",
            rowCount: 0,
            rows: [],
            adapter: undefined,
            schemaVersion: undefined,
          },
        },
      ],
    };
    expect(
      parseContainerResponse(unavailableDuringRollout, [
        collectCandidate(candidate),
      ]).sessions[0].results,
    ).toMatchObject({
      status: "unavailable",
      adapter: "extended-timing-fallback",
      schemaVersion: 1,
    });
  });

  it("writes successful weather, results and cache tags together", () => {
    const plan = buildPersistPlan([candidate], [successfulResult], now);
    expect(plan.weather).toHaveLength(1);
    expect(plan.weather[0]).toMatchObject({
      tempC: 29.3,
      sampleCount: 156,
      fetchedAt: successfulResult.weather?.fetchedAt,
    });
    expect(plan.snapshots).toEqual([
      expect.objectContaining({
        driverNumber: "44",
        bestLapMs: 82123,
        sourceRevision: successfulResult.results?.sourceRevision,
        fetchedAt: successfulResult.results?.fetchedAt,
      }),
    ]);
    expect(plan.weatherStates[0]).toMatchObject({
      status: "success",
      attempts: 1,
      nextAttemptAt: null,
    });
    expect(plan.resultStates[0]).toMatchObject({
      status: "success",
      attempts: 1,
      nextAttemptAt: null,
    });
    expect(plan.cacheTags).toEqual([
      "weather:2023",
      "results:2023",
      "results:2023:14",
    ]);
  });

  it("keeps weather and result retry state independent", () => {
    const mixed: ContainerSessionResult = {
      ...successfulResult,
      weather: {
        ...successfulResult.weather!,
        status: "empty",
        sampleCount: 0,
        tempC: null,
        trackTempC: null,
        humidityPct: null,
        pressureHpa: null,
        windSpeedKph: null,
        windDirectionDeg: null,
        rainfall: null,
        observedAtUtc: null,
        weatherCode: null,
      },
      results: {
        ...successfulResult.results!,
        status: "unavailable",
        rowCount: 0,
        rows: [],
        error: "HTTP 503",
      },
    };
    const plan = buildPersistPlan([candidate], [mixed], now);
    expect(plan.weatherStates[0]).toMatchObject({
      status: "empty",
      attempts: 1,
      nextAttemptAt: "2026-09-12T13:00:00.000Z",
    });
    expect(plan.resultStates[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "HTTP 503",
      nextAttemptAt: "2026-09-12T12:15:00.000Z",
    });
    expect(plan.weather).toHaveLength(0);
    expect(plan.snapshots).toHaveLength(0);
    expect(plan.cacheTags).toEqual([]);
  });

  it("requires a second empty observation before terminal no-data", () => {
    const empty: ContainerSessionResult = {
      ...successfulResult,
      weather: {
        ...successfulResult.weather!,
        status: "empty",
        sampleCount: 0,
        tempC: null,
        trackTempC: null,
        humidityPct: null,
        pressureHpa: null,
        windSpeedKph: null,
        windDirectionDeg: null,
        rainfall: null,
        observedAtUtc: null,
        weatherCode: null,
      },
      results: {
        ...successfulResult.results!,
        status: "empty",
        rowCount: 0,
        rows: [],
      },
    };
    const first = buildPersistPlan([candidate], [empty], now);
    expect(first.weatherStates[0]).toMatchObject({ status: "empty" });
    expect(first.resultStates[0]).toMatchObject({ status: "empty" });

    const confirmed = buildPersistPlan(
      [
        {
          ...candidate,
          weather: { due: true, attempts: 1, previousStatus: "empty" },
          results: { due: true, attempts: 1, previousStatus: "empty" },
        },
      ],
      [empty],
      now,
    );
    expect(confirmed.weatherStates[0]).toMatchObject({ status: "no_data" });
    expect(confirmed.resultStates[0]).toMatchObject({ status: "no_data" });
  });

  it("turns a batch-level container error into retryable per-kind results", () => {
    expect(
      buildCollectionFailureResults(
        [candidate],
        new Error("container HTTP 503"),
        now,
      ),
    ).toEqual([
      expect.objectContaining({
        year: 2023,
        weather: expect.objectContaining({
          status: "unavailable",
          error: "Error: container HTTP 503",
        }),
        results: expect.objectContaining({
          status: "unavailable",
          error: "Error: container HTTP 503",
        }),
      }),
    ]);
  });

  it("uses separate candidate and state queries for weather and results", () => {
    expect(weatherCandidateSql).toContain("LEFT JOIN session_weather sw");
    expect(weatherCandidateSql).toContain("LEFT JOIN weather_sync_state ws");
    expect(resultCandidateSql).toContain(
      "LEFT JOIN session_result_sync_state rs",
    );
    expect(resultCandidateSql).not.toContain("session_weather");
    expect(resultCandidateSql).toContain("WHEN 'race' THEN 14400");
    expect(resultCandidateSql).toContain("WHEN 'sprint' THEN 7200");
    expect(resultCandidateSql).toContain("unixepoch(sr.starts_at_utc)");
    expect(weatherStateUpsertSql).toContain("INSERT INTO weather_sync_state");
    expect(resultStateUpsertSql).toContain(
      "INSERT INTO session_result_sync_state",
    );
  });

  it("guards persistence against a changed session reference", () => {
    for (const sql of [
      weatherUpsertSql,
      weatherStateUpsertSql,
      resultStateUpsertSql,
      snapshotDeleteSql,
      snapshotUpsertSql,
    ]) {
      expect(sql).toContain("FROM session_source_ref sr");
      expect(sql).toContain("sr.api_path =");
      expect(sql).toContain("sr.race_date =");
      expect(sql).toContain("sr.starts_at_utc =");
    }
  });

  it("separates retrieval failures from empty data and bounds retries", () => {
    expect(nextRetryAt("failed", 1, now)).toBe("2026-09-12T12:15:00.000Z");
    expect(nextRetryAt("failed", 2, now)).toBe("2026-09-12T13:00:00.000Z");
    expect(nextRetryAt("failed", 3, now)).toBe("2026-09-12T18:00:00.000Z");
    expect(nextRetryAt("failed", 4, now)).toBe("2026-09-13T12:00:00.000Z");
    expect(nextRetryAt("failed", MAX_ATTEMPTS, now)).toBeNull();

    const retryCandidate = {
      ...candidate,
      results: {
        due: true,
        attempts: MAX_ATTEMPTS - 1,
        previousStatus: "failed" as const,
      },
    };
    const unavailable = buildCollectionFailureResults(
      [retryCandidate],
      new Error("HTTP 403"),
      now,
    )[0];
    const plan = buildPersistPlan([retryCandidate], [unavailable], now);
    expect(plan.resultStates[0]).toMatchObject({
      status: "exhausted",
      attempts: MAX_ATTEMPTS,
      nextAttemptAt: null,
    });
  });

  it("queues year-scoped cache tags without touching the f1db tag", () => {
    expect(outboxInsertSql).toContain("weather_cache_outbox");
    expect(outboxInsertSql).toContain("VALUES (?1, ?2)");
    expect(outboxInsertSql).not.toContain("'f1db'");
  });

  it("validates manual run limits", () => {
    expect(parseRunRequest(undefined)).toEqual({ limit: BATCH_LIMIT });
    expect(parseRunRequest({})).toEqual({ limit: BATCH_LIMIT });
    expect(parseRunRequest({ limit: 1 })).toEqual({ limit: 1 });
    expect(() => parseRunRequest("{}")).toThrow(/object/i);
    expect(() => parseRunRequest([])).toThrow(/object/i);
    expect(() => parseRunRequest({ limit: 0 })).toThrow(/limit/i);
    expect(() => parseRunRequest({ limit: 101 })).toThrow(/limit/i);
    expect(() => parseRunRequest({ limit: 1.5 })).toThrow(/limit/i);
  });
});
