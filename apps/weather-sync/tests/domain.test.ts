import { describe, expect, it } from "vitest";

import {
  BATCH_LIMIT,
  buildCollectionFailureResults,
  buildPersistPlan,
  type ContainerSessionResult,
  candidateSql,
  MAX_ATTEMPTS,
  nextRetryAt,
  outboxInsertSql,
  parseContainerResponse,
  parseRunRequest,
  type SessionCandidate,
  stateUpsertSql,
  weatherUpsertSql,
} from "../src/domain";

const now = new Date("2026-09-12T12:00:00.000Z");

const candidate: SessionCandidate = {
  year: 2023,
  round: 14,
  sessionKey: "race",
  apiPath: "/static/2023/2023-09-03_Italian_Grand_Prix/2023-09-03_Race/",
  raceDate: "2023-09-03",
  startsAtUtc: "2023-09-03T14:00:00.000Z",
  attempts: 0,
  previousStatus: null,
};

const successfulResult: ContainerSessionResult = {
  year: 2023,
  round: 14,
  sessionKey: "race",
  status: "success",
  sampleCount: 156,
  tempC: 29.3,
  trackTempC: 43,
  weatherCode: null,
  fetchedAt: "2026-09-12T12:00:01.000Z",
  error: null,
};

const containerResponse = {
  fastf1Version: "3.8.3",
  requestsVersion: "2.34.2",
  sessions: [successfulResult],
};

describe("weather ingestion domain", () => {
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
        {
          ...containerResponse,
          sessions: [
            successfulResult,
            { ...successfulResult, sessionKey: "qualifying" },
          ],
        },
        [candidate],
      ),
    ).toThrow(/unexpected container result/i);
    expect(() =>
      parseContainerResponse(
        {
          ...containerResponse,
          sessions: [{ ...successfulResult, status: "unknown" }],
        },
        [candidate],
      ),
    ).toThrow(/unknown container status/i);
    expect(() =>
      parseContainerResponse(
        {
          ...containerResponse,
          sessions: [{ ...successfulResult, sampleCount: 0 }],
        },
        [candidate],
      ),
    ).toThrow(/sample count/i);
  });

  it("writes successful weather and terminal state together", () => {
    const plan = buildPersistPlan([candidate], [successfulResult], now);
    expect(plan.weather).toEqual([
      {
        year: 2023,
        round: 14,
        sessionKey: "race",
        tempC: 29.3,
        trackTempC: 43,
        weatherCode: null,
        fetchedAt: successfulResult.fetchedAt,
        refApiPath: candidate.apiPath,
        refRaceDate: candidate.raceDate,
        refStartsAtUtc: candidate.startsAtUtc,
      },
    ]);
    expect(plan.rows[0]).toMatchObject({
      status: "success",
      attempts: 1,
      lastError: null,
      nextAttemptAt: null,
    });
    expect(plan.cacheDirty).toBe(true);
  });

  it("requires a second empty observation before terminal no-data", () => {
    const emptyResult: ContainerSessionResult = {
      ...successfulResult,
      status: "empty",
      sampleCount: 0,
      tempC: null,
      trackTempC: null,
      weatherCode: null,
    };

    const first = buildPersistPlan([candidate], [emptyResult], now);
    expect(first.rows[0]).toMatchObject({
      status: "empty",
      attempts: 1,
      nextAttemptAt: "2026-09-12T13:00:00.000Z",
    });
    expect(first.weather).toHaveLength(0);
    expect(first.cacheDirty).toBe(false);

    const second = buildPersistPlan(
      [{ ...candidate, attempts: 1, previousStatus: "empty" }],
      [emptyResult],
      now,
    );
    expect(second.rows[0]).toMatchObject({
      status: "no_data",
      attempts: 2,
      nextAttemptAt: null,
    });
  });

  it("counts empty confirmations independently from retrieval failures", () => {
    const emptyResult: ContainerSessionResult = {
      ...successfulResult,
      status: "empty",
      sampleCount: 0,
      tempC: null,
      trackTempC: null,
      weatherCode: null,
    };
    const afterFailures = buildPersistPlan(
      [{ ...candidate, attempts: 4, previousStatus: "failed" }],
      [emptyResult],
      now,
    );
    expect(afterFailures.rows[0]).toMatchObject({
      status: "empty",
      attempts: 5,
      nextAttemptAt: "2026-09-12T13:00:00.000Z",
    });

    const unavailable = {
      ...emptyResult,
      status: "unavailable" as const,
      error: "container unavailable",
    };
    const afterEmpty = buildPersistPlan(
      [{ ...candidate, attempts: 1, previousStatus: "empty" }],
      [unavailable],
      now,
    );
    expect(afterEmpty.rows[0]).toMatchObject({
      status: "failed",
      attempts: 2,
    });
  });

  it("turns a batch-level container error into retryable per-session results", () => {
    expect(
      buildCollectionFailureResults(
        [candidate],
        new Error("container HTTP 503"),
        now,
      ),
    ).toEqual([
      expect.objectContaining({
        year: 2023,
        round: 14,
        sessionKey: "race",
        status: "unavailable",
        sampleCount: 0,
        fetchedAt: now.toISOString(),
        error: "Error: container HTTP 503",
      }),
    ]);
  });

  it("prioritizes the newest due sessions", () => {
    expect(candidateSql).toContain(
      "ORDER BY ws.year IS NOT NULL, sr.starts_at_utc DESC",
    );
  });

  it("queues year-scoped weather cache tags", () => {
    expect(outboxInsertSql).toContain("VALUES (?1, ?2)");
    expect(outboxInsertSql).not.toContain("'f1db'");
  });

  it("guards persistence against a changed session reference", () => {
    for (const sql of [weatherUpsertSql, stateUpsertSql]) {
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

    const unavailable: ContainerSessionResult = {
      ...successfulResult,
      status: "unavailable",
      sampleCount: 0,
      tempC: null,
      trackTempC: null,
      weatherCode: null,
      error: "HTTP 403",
    };
    const first = buildPersistPlan([candidate], [unavailable], now);
    expect(first.rows[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "HTTP 403",
      nextAttemptAt: "2026-09-12T12:15:00.000Z",
    });

    const exhausted = buildPersistPlan(
      [
        {
          ...candidate,
          attempts: MAX_ATTEMPTS - 1,
          previousStatus: "failed",
        },
      ],
      [unavailable],
      now,
    );
    expect(exhausted.rows[0]).toMatchObject({
      status: "exhausted",
      attempts: MAX_ATTEMPTS,
      nextAttemptAt: null,
    });
  });

  it("validates manual run limits", () => {
    expect(parseRunRequest(undefined)).toEqual({ limit: BATCH_LIMIT });
    expect(parseRunRequest({})).toEqual({ limit: BATCH_LIMIT });
    expect(parseRunRequest({ limit: 1 })).toEqual({ limit: 1 });
    expect(() => parseRunRequest({ limit: 0 })).toThrow(/limit/i);
    expect(() => parseRunRequest({ limit: 101 })).toThrow(/limit/i);
    expect(() => parseRunRequest({ limit: 1.5 })).toThrow(/limit/i);
  });
});
