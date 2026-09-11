export const WEATHER_SINCE = 2018;
export const MAX_ATTEMPTS = 5;
export const SESSION_SETTLE_DELAY_MS = 4 * 60 * 60 * 1000;

// Worker 把站点 session_key 传给容器，避免 Python 侧再维护一份会漂移的映射。
export const SESSION_NAMES = {
  "Practice 1": "practice-1",
  "Practice 2": "practice-2",
  "Practice 3": "practice-3",
  Qualifying: "qualifying",
  "Sprint Shootout": "sprint-qualifying",
  "Sprint Qualifying": "sprint-qualifying",
  Sprint: "sprint",
  Race: "race",
} as const;

export type SyncStatus =
  | "success"
  | "no_data"
  | "mismatch"
  | "failed"
  | "exhausted";
export type ContainerStatus =
  | "success"
  | "no_data"
  | "mismatch"
  | "unavailable";

export interface SessionCandidate {
  year: number;
  round: number;
  sessionKey: string;
  raceDate: string;
  startsAtUtc: string;
  attempts: number;
}

export interface ContainerSessionResult {
  year: number;
  round: number;
  sessionKey: string;
  status: ContainerStatus;
  tempC: number | null;
  trackTempC: number | null;
  weatherCode: string | null;
  fetchedAt: string;
  error: string | null;
}

export interface ContainerResponse {
  fastf1Version: string;
  requestsVersion: string;
  hosts: string[];
  sessions: ContainerSessionResult[];
}

export interface CollectRequest {
  year: number;
  sessions: Array<Pick<SessionCandidate, "round" | "sessionKey" | "raceDate">>;
  sessionNames: Record<string, string>;
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
  noData: number;
  mismatch: number;
  failed: number;
  exhausted: number;
}

export interface WorkflowParams {
  mode: "current" | "backfill";
  years: number[] | null;
}

// current 赛季时刻在 f1db race 列；session_time 只补旧赛季缺失，不能当唯一来源。
export const candidateSql = `WITH session_keys(session_key) AS (
  VALUES ('practice-1'), ('practice-2'), ('practice-3'),
         ('qualifying'), ('sprint-qualifying'), ('sprint'), ('race')
),
session_start AS (
  SELECT st.year, st.round, st.session_key, st.starts_at_utc
  FROM session_time st
  WHERE st.year = ?1
  UNION ALL
  SELECT r.year, r.round, s.session_key,
         CASE s.session_key
           WHEN 'practice-1' THEN r.free_practice_1_date || 'T' || r.free_practice_1_time || ':00Z'
           WHEN 'practice-2' THEN r.free_practice_2_date || 'T' || r.free_practice_2_time || ':00Z'
           WHEN 'practice-3' THEN r.free_practice_3_date || 'T' || r.free_practice_3_time || ':00Z'
           WHEN 'qualifying' THEN r.qualifying_date || 'T' || r.qualifying_time || ':00Z'
           WHEN 'sprint-qualifying' THEN r.sprint_qualifying_date || 'T' || r.sprint_qualifying_time || ':00Z'
           WHEN 'sprint' THEN r.sprint_race_date || 'T' || r.sprint_race_time || ':00Z'
           ELSE r.date || 'T' || r.time || ':00Z'
         END AS starts_at_utc
  FROM race r
  JOIN session_keys s
  WHERE r.year = ?1
    AND NOT EXISTS (
      SELECT 1 FROM session_time st
      WHERE st.year = r.year
        AND st.round = r.round
        AND st.session_key = s.session_key
    )
)
SELECT ss.year, ss.round,
       ss.session_key AS sessionKey, r.date AS raceDate,
       ss.starts_at_utc AS startsAtUtc,
       COALESCE(ws.attempts, 0) AS attempts
FROM session_start ss
JOIN race r ON r.year = ss.year AND r.round = ss.round
LEFT JOIN session_weather sw
  ON sw.year = ss.year AND sw.round = ss.round AND sw.session_key = ss.session_key
LEFT JOIN weather_sync_state ws
  ON ws.year = ss.year AND ws.round = ss.round AND ws.session_key = ss.session_key
WHERE ss.year = ?1
  AND ss.starts_at_utc <= ?2
  AND sw.year IS NULL
  AND (
    ws.year IS NULL
    OR (
      ws.status = 'failed'
      AND ws.attempts < ?3
      AND (ws.next_attempt_at IS NULL OR ws.next_attempt_at <= ?4)
    )
  )
ORDER BY ss.year, ss.round, ss.session_key
LIMIT 500`;

export const yearsSql = `SELECT year
FROM season
WHERE year >= ?1
ORDER BY year`;

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

export function coverageSql(yearCount: number): string {
  const placeholders = Array.from(
    { length: yearCount },
    (_, index) => `?${index + 1}`,
  ).join(", ");
  return `SELECT status, COUNT(*) AS count
FROM weather_sync_state
WHERE year IN (${placeholders})
GROUP BY status
ORDER BY status`;
}

const retryDelaysMs = [15, 60, 360, 1440];

export function nextRetryAt(attempt: number, now: Date): string | null {
  if (attempt >= MAX_ATTEMPTS) return null;
  const minutes =
    retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)];
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
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function parseResult(raw: unknown): ContainerSessionResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("container result must be an object");
  }
  const value = raw as Record<string, unknown>;
  const status = value.status;
  if (
    status !== "success" &&
    status !== "no_data" &&
    status !== "mismatch" &&
    status !== "unavailable"
  ) {
    throw new Error(`unknown container status: ${String(status)}`);
  }
  if (
    typeof value.year !== "number" ||
    typeof value.round !== "number" ||
    typeof value.sessionKey !== "string"
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
    tempC: parseNumber(value.tempC),
    trackTempC: parseNumber(value.trackTempC),
    weatherCode,
    fetchedAt: fetchedAt || new Date().toISOString(),
    error,
  };
}

export function parseContainerResponse(
  raw: unknown,
  expected: SessionCandidate[],
): ContainerResponse {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("container response must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (
    typeof value.fastf1Version !== "string" ||
    typeof value.requestsVersion !== "string"
  ) {
    throw new Error("container dependency versions are missing");
  }
  if (!Array.isArray(value.hosts) || !Array.isArray(value.sessions)) {
    throw new Error("container response shape is invalid");
  }
  const hosts = value.hosts.map((host) => String(host).toLowerCase());
  const banned = hosts.filter(
    (host) => host.includes("jolpi") || host.includes("ergast"),
  );
  if (banned.length > 0) {
    throw new Error(`banned host touched: ${banned.join(", ")}`);
  }
  const sessions = value.sessions.map(parseResult);
  const expectedKeys = new Set(expected.map(sessionKey));
  const actualKeys = new Set(sessions.map(sessionKey));
  const missing = [...expectedKeys].filter((key) => !actualKeys.has(key));
  const extra = [...actualKeys].filter((key) => !expectedKeys.has(key));
  if (missing.length > 0) {
    throw new Error(`missing container result: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    throw new Error(`unexpected container result: ${extra.join(", ")}`);
  }
  return {
    fastf1Version: value.fastf1Version,
    requestsVersion: value.requestsVersion,
    hosts: [...new Set(hosts)].sort(),
    sessions,
  };
}

export function buildPersistPlan(
  candidates: SessionCandidate[],
  results: ContainerSessionResult[],
  now: Date,
): {
  rows: Array<{ state: StateUpsert }>;
  weather: WeatherUpsert[];
  summary: SyncSummary;
} {
  const byKey = new Map(
    candidates.map((candidate) => [sessionKey(candidate), candidate]),
  );
  const rows: Array<{ state: StateUpsert }> = [];
  const weather: WeatherUpsert[] = [];
  for (const result of results) {
    const candidate = byKey.get(sessionKey(result));
    if (candidate === undefined) {
      throw new Error(`unexpected container result: ${sessionKey(result)}`);
    }
    const attempts = candidate.attempts + 1;
    const terminal =
      result.status === "success" ||
      result.status === "no_data" ||
      result.status === "mismatch";
    const status: SyncStatus =
      result.status === "unavailable" && attempts >= MAX_ATTEMPTS
        ? "exhausted"
        : result.status === "unavailable"
          ? "failed"
          : result.status;
    const nextAttemptAt =
      result.status === "unavailable" ? nextRetryAt(attempts, now) : null;
    const lastError =
      terminal && result.status !== "mismatch" ? null : result.error;
    rows.push({
      state: {
        year: result.year,
        round: result.round,
        sessionKey: result.sessionKey,
        status,
        attempts,
        lastError,
        lastAttemptAt: now.toISOString(),
        nextAttemptAt,
        updatedAt: now.toISOString(),
      },
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
  return { rows, weather, summary: summarize(rows.map((row) => row.state)) };
}

export function summarize(results: Array<{ status: string }>): SyncSummary {
  const summary: SyncSummary = {
    requested: results.length,
    success: 0,
    noData: 0,
    mismatch: 0,
    failed: 0,
    exhausted: 0,
  };
  for (const result of results) {
    if (result.status === "success") summary.success += 1;
    else if (result.status === "no_data") summary.noData += 1;
    else if (result.status === "mismatch") summary.mismatch += 1;
    else if (result.status === "exhausted") summary.exhausted += 1;
    else summary.failed += 1;
  }
  return summary;
}

export function parseRunRequest(raw: unknown): WorkflowParams {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("request body must be an object");
  }
  const value = raw as Record<string, unknown>;
  const mode = value.mode ?? "current";
  if (mode !== "current" && mode !== "backfill") {
    throw new Error("mode must be current or backfill");
  }
  if (mode === "current") {
    if (value.years !== undefined)
      throw new Error("years is only valid for backfill");
    return { mode, years: null };
  }
  if (value.years === undefined || value.years === null) {
    return { mode, years: null };
  }
  if (!Array.isArray(value.years)) throw new Error("years must be an array");
  const years = value.years.map((year) => {
    if (typeof year !== "number" || !Number.isInteger(year)) {
      throw new Error("years must contain integers");
    }
    return year;
  });
  if (years.some((year) => year < WEATHER_SINCE)) {
    throw new Error(`years must start at ${WEATHER_SINCE}`);
  }
  return { mode, years: [...new Set(years)].sort((a, b) => a - b) };
}
