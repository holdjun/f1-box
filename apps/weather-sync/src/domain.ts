export const WEATHER_SINCE = 2018;
export const MAX_ATTEMPTS = 5;
export const EMPTY_CONFIRMATIONS = 2;
export const SETTLE_DELAY_MS = 4 * 60 * 60 * 1000;
export const BATCH_LIMIT = 50;

export type SyncStatus =
  | "success"
  | "empty"
  | "no_data"
  | "failed"
  | "exhausted"
  | "mismatch";

export type ContainerStatus = "success" | "empty" | "unavailable" | "mismatch";

export interface SessionCandidate {
  year: number;
  round: number;
  sessionKey: string;
  apiPath: string;
  raceDate: string;
  startsAtUtc: string;
  attempts: number;
}

export interface ContainerSessionResult {
  year: number;
  round: number;
  sessionKey: string;
  status: ContainerStatus;
  sampleCount: number;
  tempC: number | null;
  trackTempC: number | null;
  weatherCode: string | null;
  fetchedAt: string;
  error: string | null;
}

export interface ContainerResponse {
  fastf1Version: string;
  requestsVersion: string;
  sessions: ContainerSessionResult[];
}

export interface CollectRequest {
  sessions: Array<
    Pick<SessionCandidate, "year" | "round" | "sessionKey" | "apiPath">
  >;
}

export interface StateUpsert {
  year: number;
  round: number;
  sessionKey: string;
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: string;
  nextAttemptAt: string | null;
  updatedAt: string;
}

export interface WeatherUpsert {
  year: number;
  round: number;
  sessionKey: string;
  tempC: number | null;
  trackTempC: number | null;
  weatherCode: string | null;
  fetchedAt: string;
}

export interface SyncSummary {
  requested: number;
  success: number;
  empty: number;
  noData: number;
  failed: number;
  exhausted: number;
  mismatch: number;
}

export interface RunRequest {
  limit: number;
}

// session_source_ref 由本地/GitHub Actions 从 FastF1 schedule 预生成；
// Worker 只消费明确的 api_path，不在 Cloudflare 内做年度赛程发现。
export const candidateSql = `SELECT sr.year, sr.round,
       sr.session_key AS sessionKey, sr.api_path AS apiPath,
       sr.race_date AS raceDate, sr.starts_at_utc AS startsAtUtc,
       COALESCE(ws.attempts, 0) AS attempts
FROM session_source_ref sr
LEFT JOIN session_weather sw
  ON sw.year = sr.year AND sw.round = sr.round AND sw.session_key = sr.session_key
LEFT JOIN weather_sync_state ws
  ON ws.year = sr.year AND ws.round = sr.round AND ws.session_key = sr.session_key
WHERE sr.starts_at_utc <= ?1
  AND sw.year IS NULL
  AND (
    ws.year IS NULL
    OR (
      ws.status IN ('empty', 'failed')
      AND ws.attempts < ?2
      AND (ws.next_attempt_at IS NULL OR ws.next_attempt_at <= ?3)
    )
  )
ORDER BY sr.starts_at_utc, sr.year, sr.round, sr.session_key
LIMIT ?4`;

export const weatherUpsertSql = `INSERT OR REPLACE INTO session_weather
  (year, round, session_key, temp_c, track_temp_c, weather_code, source, fetched_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'fastf1', ?7)`;

export const stateUpsertSql = `INSERT INTO weather_sync_state
  (year, round, session_key, status, attempts, last_error, last_attempt_at, next_attempt_at, updated_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
ON CONFLICT(year, round, session_key) DO UPDATE SET
  status = excluded.status,
  attempts = excluded.attempts,
  last_error = excluded.last_error,
  last_attempt_at = excluded.last_attempt_at,
  next_attempt_at = excluded.next_attempt_at,
  updated_at = excluded.updated_at`;

export const outboxInsertSql = `INSERT OR IGNORE INTO weather_cache_outbox
  (cache_tag, created_at)
VALUES ('f1db', ?1)`;

export const outboxSql = `SELECT cache_tag, created_at
FROM weather_cache_outbox
ORDER BY created_at`;

export const outboxDeleteSql = `DELETE FROM weather_cache_outbox
WHERE cache_tag = ?1`;

export const statusSql = `SELECT status, COUNT(*) AS count
FROM weather_sync_state
GROUP BY status
ORDER BY status`;

const failedRetryDelaysMinutes = [15, 60, 360, 1440];

export function nextRetryAt(
  status: "empty" | "failed",
  attempt: number,
  now: Date,
): string | null {
  if (attempt >= MAX_ATTEMPTS) return null;
  const minutes =
    status === "empty"
      ? 60
      : failedRetryDelaysMinutes[
          Math.min(attempt - 1, failedRetryDelaysMinutes.length - 1)
        ];
  return new Date(now.getTime() + minutes * 60 * 1000).toISOString();
}

function sessionKey(candidate: {
  year: number;
  round: number;
  sessionKey: string;
}): string {
  return `${candidate.year}:${candidate.round}:${candidate.sessionKey}`;
}

function parseNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseResult(raw: unknown): ContainerSessionResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("container result must be an object");
  }
  const value = raw as Record<string, unknown>;
  const status = value.status;
  if (
    status !== "success" &&
    status !== "empty" &&
    status !== "unavailable" &&
    status !== "mismatch"
  ) {
    throw new Error(`unknown container status: ${String(status)}`);
  }
  if (
    typeof value.year !== "number" ||
    typeof value.round !== "number" ||
    typeof value.sessionKey !== "string" ||
    typeof value.sampleCount !== "number" ||
    !Number.isInteger(value.sampleCount) ||
    value.sampleCount < 0
  ) {
    throw new Error("container result identity is invalid");
  }
  const fetchedAt =
    typeof value.fetchedAt === "string" &&
    !Number.isNaN(Date.parse(value.fetchedAt))
      ? value.fetchedAt
      : "";
  if (status === "success" && fetchedAt === "") {
    throw new Error("successful container result has no fetchedAt");
  }
  const weatherCode =
    value.weatherCode === null || value.weatherCode === "rain"
      ? value.weatherCode
      : null;
  if (value.weatherCode !== null && value.weatherCode !== "rain") {
    throw new Error(`unknown weather code: ${String(value.weatherCode)}`);
  }
  const error =
    value.error === null || typeof value.error === "string"
      ? value.error
      : null;
  if (value.error !== null && typeof value.error !== "string") {
    throw new Error("container result error is invalid");
  }
  return {
    year: value.year,
    round: value.round,
    sessionKey: value.sessionKey,
    status,
    sampleCount: value.sampleCount,
    tempC: parseNumber(value.tempC),
    trackTempC: parseNumber(value.trackTempC),
    weatherCode,
    fetchedAt: fetchedAt || new Date().toISOString(),
    error,
  };
}

export function parseContainerResponse(
  raw: unknown,
  expected: Array<{
    year: number;
    round: number;
    sessionKey: string;
  }>,
): ContainerResponse {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("container response must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (
    typeof value.fastf1Version !== "string" ||
    typeof value.requestsVersion !== "string" ||
    !Array.isArray(value.sessions)
  ) {
    throw new Error("container response shape is invalid");
  }
  const sessions = value.sessions.map(parseResult);
  const expectedKeys = new Set(expected.map(sessionKey));
  const actualKeys = new Set(sessions.map(sessionKey));
  const missing = [...expectedKeys].filter((key) => !actualKeys.has(key));
  const extra = [...actualKeys].filter((key) => !expectedKeys.has(key));
  if (missing.length > 0 && extra.length > 0) {
    throw new Error(
      `container result mismatch: missing ${missing.join(", ")}; unexpected ${extra.join(", ")}`,
    );
  }
  if (missing.length > 0) {
    throw new Error(`missing container result: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    throw new Error(`unexpected container result: ${extra.join(", ")}`);
  }
  return {
    fastf1Version: value.fastf1Version,
    requestsVersion: value.requestsVersion,
    sessions,
  };
}

export function buildPersistPlan(
  candidates: SessionCandidate[],
  results: ContainerSessionResult[],
  now: Date,
): {
  rows: StateUpsert[];
  weather: WeatherUpsert[];
  cacheDirty: boolean;
  summary: SyncSummary;
} {
  const byKey = new Map(
    candidates.map((candidate) => [sessionKey(candidate), candidate]),
  );
  const rows: StateUpsert[] = [];
  const weather: WeatherUpsert[] = [];
  for (const result of results) {
    const candidate = byKey.get(sessionKey(result));
    if (candidate === undefined) {
      throw new Error(`unexpected container result: ${sessionKey(result)}`);
    }
    const attempts = candidate.attempts + 1;
    let status: SyncStatus;
    let nextAttemptAt: string | null = null;
    if (result.status === "success") {
      status = "success";
    } else if (result.status === "empty") {
      status = attempts >= EMPTY_CONFIRMATIONS ? "no_data" : "empty";
      nextAttemptAt =
        status === "empty" ? nextRetryAt("empty", attempts, now) : null;
    } else if (result.status === "unavailable") {
      status = attempts >= MAX_ATTEMPTS ? "exhausted" : "failed";
      nextAttemptAt =
        status === "failed" ? nextRetryAt("failed", attempts, now) : null;
    } else {
      status = "mismatch";
    }
    rows.push({
      year: result.year,
      round: result.round,
      sessionKey: result.sessionKey,
      status,
      attempts,
      lastError: result.error,
      lastAttemptAt: now.toISOString(),
      nextAttemptAt,
      updatedAt: now.toISOString(),
    });
    if (result.status === "success") {
      weather.push({
        year: result.year,
        round: result.round,
        sessionKey: result.sessionKey,
        tempC: result.tempC,
        trackTempC: result.trackTempC,
        weatherCode: result.weatherCode,
        fetchedAt: result.fetchedAt,
      });
    }
  }

  const summary: SyncSummary = {
    requested: rows.length,
    success: 0,
    empty: 0,
    noData: 0,
    failed: 0,
    exhausted: 0,
    mismatch: 0,
  };
  for (const row of rows) {
    if (row.status === "success") summary.success += 1;
    else if (row.status === "empty") summary.empty += 1;
    else if (row.status === "no_data") summary.noData += 1;
    else if (row.status === "failed") summary.failed += 1;
    else if (row.status === "exhausted") summary.exhausted += 1;
    else summary.mismatch += 1;
  }
  return { rows, weather, cacheDirty: weather.length > 0, summary };
}

export function parseRunRequest(raw: unknown): RunRequest {
  if (raw === undefined || raw === null) return { limit: BATCH_LIMIT };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("request body must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (value.limit === undefined) return { limit: BATCH_LIMIT };
  if (
    typeof value.limit !== "number" ||
    !Number.isInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > 100
  ) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  return { limit: value.limit };
}
