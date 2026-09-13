export const MAX_ATTEMPTS = 5;
export const WEATHER_SETTLE_DELAY_MS = 4 * 60 * 60 * 1000;
export const RESULT_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const BATCH_LIMIT = 10;
export const LOCK_TTL_MS = 25 * 60 * 1000;

export type SyncStatus =
  | "success"
  | "empty"
  | "no_data"
  | "failed"
  | "exhausted"
  | "mismatch";

export type ContainerStatus = "success" | "empty" | "unavailable" | "mismatch";

export interface CandidateState {
  due: boolean;
  attempts: number;
  previousStatus: SyncStatus | null;
}

export interface SessionCandidate {
  year: number;
  round: number;
  sessionKey: string;
  apiPath: string;
  raceDate: string;
  startsAtUtc: string;
  weather: CandidateState;
  results: CandidateState;
}

export interface ContainerWeatherResult {
  status: ContainerStatus;
  sampleCount: number;
  tempC: number | null;
  trackTempC: number | null;
  humidityPct: number | null;
  pressureHpa: number | null;
  windSpeedKph: number | null;
  windDirectionDeg: number | null;
  rainfall: boolean | null;
  observedAtUtc: string | null;
  weatherCode: string | null;
  fetchedAt: string;
  error: string | null;
}

export interface ContainerResultRow {
  driverNumber: string;
  driverSourceId: string | null;
  driverName: string;
  driverCode: string;
  constructorSourceId: string | null;
  constructorName: string;
  position: number | null;
  positionText: string;
  bestLapMs: number | null;
  q1Ms: number | null;
  q2Ms: number | null;
  q3Ms: number | null;
  totalTimeMs: number | null;
  gapMs: number | null;
  gapText: string | null;
  laps: number | null;
  status: string | null;
  points: number | null;
}

export interface ContainerResultsResult {
  status: ContainerStatus;
  rowCount: number;
  rows: ContainerResultRow[];
  sourceRevision: string;
  fetchedAt: string;
  error: string | null;
  adapter: "fastf1-session-results" | "extended-timing-fallback";
  schemaVersion: 1;
}

export interface ContainerSessionResult {
  year: number;
  round: number;
  sessionKey: string;
  weather?: ContainerWeatherResult;
  results?: ContainerResultsResult;
}

export interface ContainerResponse {
  fastf1Version: string;
  requestsVersion: string;
  resultsAdapterVersion: string;
  sessions: ContainerSessionResult[];
}

export interface CollectRequestSession {
  year: number;
  round: number;
  sessionKey: string;
  apiPath: string;
  startsAtUtc: string;
  weather: boolean;
  results: boolean;
}

export interface CollectRequest {
  sessions: CollectRequestSession[];
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
  refApiPath: string;
  refRaceDate: string;
  refStartsAtUtc: string;
}

export interface WeatherUpsert {
  year: number;
  round: number;
  sessionKey: string;
  tempC: number | null;
  trackTempC: number | null;
  humidityPct: number | null;
  pressureHpa: number | null;
  windSpeedKph: number | null;
  windDirectionDeg: number | null;
  rainfall: boolean | null;
  sampleCount: number;
  observedAtUtc: string | null;
  weatherCode: string | null;
  fetchedAt: string;
  refApiPath: string;
  refRaceDate: string;
  refStartsAtUtc: string;
}

export interface SnapshotUpsert {
  year: number;
  round: number;
  sessionKey: string;
  driverNumber: string;
  driverSourceId: string | null;
  driverName: string;
  driverCode: string;
  constructorSourceId: string | null;
  constructorName: string;
  position: number | null;
  positionText: string;
  bestLapMs: number | null;
  q1Ms: number | null;
  q2Ms: number | null;
  q3Ms: number | null;
  totalTimeMs: number | null;
  gapMs: number | null;
  gapText: string | null;
  laps: number | null;
  status: string | null;
  points: number | null;
  sourceRevision: string;
  fetchedAt: string;
  refApiPath: string;
  refRaceDate: string;
  refStartsAtUtc: string;
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

export interface SyncSummaries {
  weather: SyncSummary;
  results: SyncSummary;
}

export interface RunRequest {
  limit: number;
}

// session_source_ref 由本地/GitHub Actions 从 FastF1 schedule 预生成；
// Worker 只消费明确的 api_path，不在 Cloudflare 内做年度赛程发现。
// 天气没有时间窗口限制；成绩只保留近两周，避免历史回补任务长期占用批次。
export const weatherCandidateSql = `SELECT sr.year, sr.round,
       sr.session_key AS sessionKey, sr.api_path AS apiPath,
       sr.race_date AS raceDate, sr.starts_at_utc AS startsAtUtc,
       COALESCE(ws.attempts, 0) AS attempts,
       ws.status AS previousStatus
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
      (ws.status = 'empty' OR (ws.status = 'failed' AND ws.attempts < ?2))
      AND (ws.next_attempt_at IS NULL OR ws.next_attempt_at <= ?3)
    )
  )
ORDER BY sr.starts_at_utc DESC, sr.year DESC, sr.round DESC, sr.session_key
LIMIT ?4`;

export const resultCandidateSql = `SELECT sr.year, sr.round,
       sr.session_key AS sessionKey, sr.api_path AS apiPath,
       sr.race_date AS raceDate, sr.starts_at_utc AS startsAtUtc,
       COALESCE(rs.attempts, 0) AS attempts,
       rs.status AS previousStatus
FROM session_source_ref sr
LEFT JOIN session_result_sync_state rs
  ON rs.year = sr.year AND rs.round = sr.round AND rs.session_key = sr.session_key
WHERE unixepoch(sr.starts_at_utc) + CASE sr.session_key
    WHEN 'race' THEN 14400
    WHEN 'sprint' THEN 7200
    WHEN 'qualifying' THEN 7200
    WHEN 'sprint-qualifying' THEN 5400
    ELSE 5400
  END <= unixepoch(?1)
  AND sr.starts_at_utc >= ?2
  AND (
    rs.year IS NULL
    OR (
      (rs.status = 'empty' OR (rs.status = 'failed' AND rs.attempts < ?3))
      AND (rs.next_attempt_at IS NULL OR rs.next_attempt_at <= ?4)
    )
  )
ORDER BY sr.starts_at_utc DESC, sr.year DESC, sr.round DESC, sr.session_key
LIMIT ?5`;

export const lockAcquireSql = `INSERT INTO weather_sync_lock
  (name, owner, expires_at)
VALUES ('ingestion', ?1, ?2)
ON CONFLICT(name) DO UPDATE SET
  owner = excluded.owner,
  expires_at = excluded.expires_at
WHERE weather_sync_lock.expires_at <= ?3
`;

export const lockReleaseSql = `DELETE FROM weather_sync_lock
WHERE name = 'ingestion' AND owner = ?1`;

export const weatherUpsertSql = `INSERT OR REPLACE INTO session_weather
  (year, round, session_key, temp_c, track_temp_c, humidity_pct, pressure_hpa,
   wind_speed_kph, wind_direction_deg, rainfall, sample_count, observed_at_utc,
   weather_code, source, fetched_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'fastf1', ?14
FROM session_source_ref sr
WHERE sr.year = ?1 AND sr.round = ?2 AND sr.session_key = ?3
  AND sr.api_path = ?15 AND sr.race_date = ?16 AND sr.starts_at_utc = ?17`;

const stateUpsertSqlFor = (table: string) => `INSERT INTO ${table}
  (year, round, session_key, status, attempts, last_error, last_attempt_at, next_attempt_at, updated_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
FROM session_source_ref sr
WHERE sr.year = ?1 AND sr.round = ?2 AND sr.session_key = ?3
  AND sr.api_path = ?10 AND sr.race_date = ?11 AND sr.starts_at_utc = ?12
ON CONFLICT(year, round, session_key) DO UPDATE SET
  status = excluded.status,
  attempts = excluded.attempts,
  last_error = excluded.last_error,
  last_attempt_at = excluded.last_attempt_at,
  next_attempt_at = excluded.next_attempt_at,
  updated_at = excluded.updated_at`;

export const weatherStateUpsertSql = stateUpsertSqlFor("weather_sync_state");
export const resultStateUpsertSql = stateUpsertSqlFor(
  "session_result_sync_state",
);

export const snapshotDeleteSql = `DELETE FROM session_result_snapshot
WHERE year = ?1 AND round = ?2 AND session_key = ?3
  AND EXISTS (
    SELECT 1 FROM session_source_ref sr
    WHERE sr.year = ?1 AND sr.round = ?2 AND sr.session_key = ?3
      AND sr.api_path = ?4 AND sr.race_date = ?5 AND sr.starts_at_utc = ?6
  )`;

export const snapshotUpsertSql = `INSERT OR REPLACE INTO session_result_snapshot
  (year, round, session_key, driver_number, driver_source_id, driver_name,
   driver_code, constructor_source_id, constructor_name, position_number,
   position_text, best_lap_ms, q1_ms, q2_ms, q3_ms, total_time_ms, gap_ms,
   gap_text, laps, status, points, source_revision, fetched_at)
SELECT ?1, ?2, ?3,
       json_extract(row.value, '$.driverNumber'),
       json_extract(row.value, '$.driverSourceId'),
       json_extract(row.value, '$.driverName'),
       json_extract(row.value, '$.driverCode'),
       json_extract(row.value, '$.constructorSourceId'),
       json_extract(row.value, '$.constructorName'),
       json_extract(row.value, '$.position'),
       json_extract(row.value, '$.positionText'),
       json_extract(row.value, '$.bestLapMs'),
       json_extract(row.value, '$.q1Ms'),
       json_extract(row.value, '$.q2Ms'),
       json_extract(row.value, '$.q3Ms'),
       json_extract(row.value, '$.totalTimeMs'),
       json_extract(row.value, '$.gapMs'),
       json_extract(row.value, '$.gapText'),
       json_extract(row.value, '$.laps'),
       json_extract(row.value, '$.status'),
       json_extract(row.value, '$.points'),
       ?5, ?6
FROM session_source_ref sr, json_each(?4) AS row
WHERE sr.year = ?1 AND sr.round = ?2 AND sr.session_key = ?3
  AND sr.api_path = ?7 AND sr.race_date = ?8 AND sr.starts_at_utc = ?9`;

export const outboxInsertSql = `INSERT OR IGNORE INTO weather_cache_outbox
  (cache_tag, created_at)
VALUES (?1, ?2)`;

export const outboxSql = `SELECT cache_tag, created_at
FROM weather_cache_outbox
ORDER BY created_at`;

export const outboxDeleteSql = `DELETE FROM weather_cache_outbox
WHERE cache_tag = ?1`;

export const weatherStatusSql = `SELECT status, COUNT(*) AS count
FROM weather_sync_state
GROUP BY status
ORDER BY status`;

export const resultStatusSql = `SELECT status, COUNT(*) AS count
FROM session_result_sync_state
GROUP BY status
ORDER BY status`;

export const weatherCountSql = `SELECT COUNT(*) AS count FROM session_weather`;

export const snapshotCountSql = `SELECT COUNT(*) AS count FROM session_result_snapshot`;

export const referenceCountSql = `SELECT COUNT(*) AS count FROM session_source_ref`;

export const failuresSql = `SELECT year, round, session_key AS sessionKey, status, attempts,
       last_error AS lastError, next_attempt_at AS nextAttemptAt, updated_at AS updatedAt
FROM weather_sync_state
WHERE status IN ('failed', 'exhausted', 'mismatch')
UNION ALL
SELECT year, round, session_key AS sessionKey, status, attempts,
       last_error AS lastError, next_attempt_at AS nextAttemptAt, updated_at AS updatedAt
FROM session_result_sync_state
WHERE status IN ('failed', 'exhausted', 'mismatch')
ORDER BY updatedAt DESC
LIMIT 50`;

const failedRetryDelaysMinutes = [15, 60, 360, 1440];

export function nextRetryAt(
  status: "empty" | "failed",
  attempt: number,
  now: Date,
): string | null {
  if (status === "failed" && attempt >= MAX_ATTEMPTS) return null;
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

function parseBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (value === true || value === false) return value;
  throw new Error("container result boolean is invalid");
}

function parseTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`container result ${label} is invalid`);
  }
  return value;
}

function parseStatus(value: unknown): ContainerStatus {
  if (
    value !== "success" &&
    value !== "empty" &&
    value !== "unavailable" &&
    value !== "mismatch"
  ) {
    throw new Error(`unknown container status: ${String(value)}`);
  }
  return value;
}

function parseError(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new Error("container result error is invalid");
  return value;
}

function parseWeatherResult(raw: unknown): ContainerWeatherResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("container weather result must be an object");
  }
  const value = raw as Record<string, unknown>;
  const status = parseStatus(value.status);
  if (
    typeof value.sampleCount !== "number" ||
    !Number.isInteger(value.sampleCount) ||
    value.sampleCount < 0
  ) {
    throw new Error("container weather result sample count is invalid");
  }
  if (
    (status === "success" && value.sampleCount === 0) ||
    (status === "empty" && value.sampleCount !== 0)
  ) {
    throw new Error(
      `container weather ${status} result has invalid sample count`,
    );
  }
  const weatherCode =
    value.weatherCode === null || value.weatherCode === undefined
      ? null
      : value.weatherCode;
  if (weatherCode !== null && weatherCode !== "rain") {
    throw new Error(`unknown weather code: ${String(value.weatherCode)}`);
  }
  return {
    status,
    sampleCount: value.sampleCount,
    tempC: parseNumber(value.tempC),
    trackTempC: parseNumber(value.trackTempC),
    humidityPct: parseNumber(value.humidityPct),
    pressureHpa: parseNumber(value.pressureHpa),
    windSpeedKph: parseNumber(value.windSpeedKph),
    windDirectionDeg: parseNumber(value.windDirectionDeg),
    rainfall: parseBoolean(value.rainfall),
    observedAtUtc:
      value.observedAtUtc === null || value.observedAtUtc === undefined
        ? null
        : parseTimestamp(value.observedAtUtc, "observed timestamp"),
    weatherCode,
    fetchedAt: parseTimestamp(value.fetchedAt, "fetched timestamp"),
    error: parseError(value.error),
  };
}

function parseResultRow(raw: unknown): ContainerResultRow {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("container result row must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (
    typeof value.driverNumber !== "string" ||
    typeof value.driverName !== "string" ||
    typeof value.driverCode !== "string" ||
    typeof value.constructorName !== "string" ||
    typeof value.positionText !== "string"
  ) {
    throw new Error("container result row identity is invalid");
  }
  const nullableString = (input: unknown, label: string): string | null => {
    if (input === null || input === undefined) return null;
    if (typeof input !== "string") {
      throw new Error(`container result row ${label} is invalid`);
    }
    return input;
  };
  return {
    driverNumber: value.driverNumber,
    driverSourceId: nullableString(value.driverSourceId, "driver source id"),
    driverName: value.driverName,
    driverCode: value.driverCode,
    constructorSourceId: nullableString(
      value.constructorSourceId,
      "constructor source id",
    ),
    constructorName: value.constructorName,
    position: parseNumber(value.position),
    positionText: value.positionText,
    bestLapMs: parseNumber(value.bestLapMs),
    q1Ms: parseNumber(value.q1Ms),
    q2Ms: parseNumber(value.q2Ms),
    q3Ms: parseNumber(value.q3Ms),
    totalTimeMs: parseNumber(value.totalTimeMs),
    gapMs: parseNumber(value.gapMs),
    gapText: nullableString(value.gapText, "gap text"),
    laps: parseNumber(value.laps),
    status: nullableString(value.status, "status"),
    points: parseNumber(value.points),
  };
}

function parseResultsResult(raw: unknown): ContainerResultsResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("container results result must be an object");
  }
  const value = raw as Record<string, unknown>;
  const status = parseStatus(value.status);
  if (
    typeof value.rowCount !== "number" ||
    !Number.isInteger(value.rowCount) ||
    value.rowCount < 0 ||
    !Array.isArray(value.rows)
  ) {
    throw new Error("container results row count is invalid");
  }
  const rows = value.rows.map(parseResultRow);
  if (rows.length !== value.rowCount) {
    throw new Error("container results row count does not match rows");
  }
  if (
    (status === "success" && rows.length === 0) ||
    (status === "empty" && rows.length !== 0)
  ) {
    throw new Error(`container results ${status} result has invalid row count`);
  }
  if (
    typeof value.sourceRevision !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.sourceRevision)
  ) {
    throw new Error("container results source revision is invalid");
  }
  if (
    value.adapter !== "fastf1-session-results" &&
    value.adapter !== "extended-timing-fallback"
  ) {
    throw new Error("container results adapter is invalid");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("container results schema version is invalid");
  }
  return {
    status,
    rowCount: value.rowCount,
    rows,
    sourceRevision: value.sourceRevision,
    fetchedAt: parseTimestamp(value.fetchedAt, "fetched timestamp"),
    error: parseError(value.error),
    adapter: value.adapter as ContainerResultsResult["adapter"],
    schemaVersion: 1,
  };
}

function parseResultIdentity(raw: unknown): ContainerSessionResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("container result must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (
    typeof value.year !== "number" ||
    typeof value.round !== "number" ||
    typeof value.sessionKey !== "string"
  ) {
    throw new Error("container result identity is invalid");
  }
  return {
    year: value.year,
    round: value.round,
    sessionKey: value.sessionKey,
  };
}

function parseResult(
  raw: unknown,
  expected: CollectRequestSession,
): ContainerSessionResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("container result must be an object");
  }
  const value = raw as Record<string, unknown>;
  const result = parseResultIdentity(raw);
  if (expected.weather) {
    if (value.weather === undefined) {
      throw new Error("missing container weather result");
    }
    result.weather = parseWeatherResult(value.weather);
  } else if (value.weather !== undefined) {
    throw new Error("unexpected container weather result");
  }
  if (expected.results) {
    if (value.results === undefined) {
      throw new Error("missing container results result");
    }
    result.results = parseResultsResult(value.results);
  } else if (value.results !== undefined) {
    throw new Error("unexpected container results result");
  }
  return result;
}

export function parseContainerResponse(
  raw: unknown,
  expected: CollectRequestSession[],
): ContainerResponse {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("container response must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (
    typeof value.fastf1Version !== "string" ||
    typeof value.requestsVersion !== "string" ||
    value.resultsAdapterVersion !== "session-results-v1" ||
    !Array.isArray(value.sessions)
  ) {
    throw new Error("container response or results adapter version is invalid");
  }
  const rawSessions = value.sessions as unknown[];
  const identities = rawSessions.map(parseResultIdentity);
  const expectedKeys = new Set(expected.map(sessionKey));
  const actualKeys = new Set(identities.map(sessionKey));
  if (actualKeys.size !== identities.length) {
    throw new Error("duplicate container result identity");
  }
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
  const expectedByKey = new Map(
    expected.map((item) => [sessionKey(item), item]),
  );
  const sessions = identities.map((identity, index) =>
    parseResult(
      rawSessions[index],
      expectedByKey.get(sessionKey(identity)) as CollectRequestSession,
    ),
  );
  return {
    fastf1Version: value.fastf1Version,
    requestsVersion: value.requestsVersion,
    resultsAdapterVersion: value.resultsAdapterVersion,
    sessions,
  };
}

export function buildCollectionFailureResults(
  candidates: SessionCandidate[],
  error: unknown,
  now: Date,
): ContainerSessionResult[] {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const fetchedAt = now.toISOString();
  return candidates.map((candidate) => {
    const result: ContainerSessionResult = {
      year: candidate.year,
      round: candidate.round,
      sessionKey: candidate.sessionKey,
    };
    if (candidate.weather.due) {
      result.weather = {
        status: "unavailable",
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
        fetchedAt,
        error: message.slice(0, 1000),
      };
    }
    if (candidate.results.due) {
      result.results = {
        status: "unavailable",
        rowCount: 0,
        rows: [],
        sourceRevision: "0".repeat(64),
        fetchedAt,
        error: message.slice(0, 1000),
        adapter: "extended-timing-fallback",
        schemaVersion: 1,
      };
    }
    return result;
  });
}

function planState(
  state: CandidateState,
  status: ContainerStatus,
  now: Date,
): {
  status: SyncStatus;
  attempts: number;
  nextAttemptAt: string | null;
} {
  const attempts = state.attempts + 1;
  if (status === "success") {
    return { status: "success", attempts, nextAttemptAt: null };
  }
  if (status === "empty") {
    const confirmed = state.previousStatus === "empty";
    return {
      status: confirmed ? "no_data" : "empty",
      attempts,
      nextAttemptAt: confirmed ? null : nextRetryAt("empty", attempts, now),
    };
  }
  if (status === "unavailable") {
    const exhausted = attempts >= MAX_ATTEMPTS;
    return {
      status: exhausted ? "exhausted" : "failed",
      attempts,
      nextAttemptAt: exhausted ? null : nextRetryAt("failed", attempts, now),
    };
  }
  return { status: "mismatch", attempts, nextAttemptAt: null };
}

function emptySummary(): SyncSummary {
  return {
    requested: 0,
    success: 0,
    empty: 0,
    noData: 0,
    failed: 0,
    exhausted: 0,
    mismatch: 0,
  };
}

function count(summary: SyncSummary, status: SyncStatus): void {
  summary.requested += 1;
  if (status === "success") summary.success += 1;
  else if (status === "empty") summary.empty += 1;
  else if (status === "no_data") summary.noData += 1;
  else if (status === "failed") summary.failed += 1;
  else if (status === "exhausted") summary.exhausted += 1;
  else summary.mismatch += 1;
}

export function buildPersistPlan(
  candidates: SessionCandidate[],
  results: ContainerSessionResult[],
  now: Date,
): {
  weatherStates: StateUpsert[];
  resultStates: StateUpsert[];
  weather: WeatherUpsert[];
  snapshots: SnapshotUpsert[];
  cacheTags: string[];
  summary: SyncSummaries;
} {
  const byKey = new Map(
    candidates.map((candidate) => [sessionKey(candidate), candidate]),
  );
  const weatherStates: StateUpsert[] = [];
  const resultStates: StateUpsert[] = [];
  const weather: WeatherUpsert[] = [];
  const snapshots: SnapshotUpsert[] = [];
  const cacheTags = new Set<string>();
  const summary: SyncSummaries = {
    weather: emptySummary(),
    results: emptySummary(),
  };

  for (const result of results) {
    const candidate = byKey.get(sessionKey(result));
    if (candidate === undefined) {
      throw new Error(`unexpected container result: ${sessionKey(result)}`);
    }
    const ref = {
      refApiPath: candidate.apiPath,
      refRaceDate: candidate.raceDate,
      refStartsAtUtc: candidate.startsAtUtc,
    };
    const timestamp = now.toISOString();

    if (candidate.weather.due && result.weather !== undefined) {
      const planned = planState(candidate.weather, result.weather.status, now);
      count(summary.weather, planned.status);
      weatherStates.push({
        year: result.year,
        round: result.round,
        sessionKey: result.sessionKey,
        ...planned,
        lastError: result.weather.error,
        lastAttemptAt: timestamp,
        updatedAt: timestamp,
        ...ref,
      });
      if (result.weather.status === "success") {
        weather.push({
          year: result.year,
          round: result.round,
          sessionKey: result.sessionKey,
          tempC: result.weather.tempC,
          trackTempC: result.weather.trackTempC,
          humidityPct: result.weather.humidityPct,
          pressureHpa: result.weather.pressureHpa,
          windSpeedKph: result.weather.windSpeedKph,
          windDirectionDeg: result.weather.windDirectionDeg,
          rainfall: result.weather.rainfall,
          sampleCount: result.weather.sampleCount,
          observedAtUtc: result.weather.observedAtUtc,
          weatherCode: result.weather.weatherCode,
          fetchedAt: result.weather.fetchedAt,
          ...ref,
        });
        cacheTags.add(`weather:${result.year}`);
      }
    }

    if (candidate.results.due && result.results !== undefined) {
      const planned = planState(candidate.results, result.results.status, now);
      count(summary.results, planned.status);
      resultStates.push({
        year: result.year,
        round: result.round,
        sessionKey: result.sessionKey,
        ...planned,
        lastError: result.results.error,
        lastAttemptAt: timestamp,
        updatedAt: timestamp,
        ...ref,
      });
      if (result.results.status === "success") {
        for (const row of result.results.rows) {
          snapshots.push({
            year: result.year,
            round: result.round,
            sessionKey: result.sessionKey,
            ...row,
            sourceRevision: result.results.sourceRevision,
            fetchedAt: result.results.fetchedAt,
            ...ref,
          });
        }
        cacheTags.add(`results:${result.year}`);
        cacheTags.add(`results:${result.year}:${result.round}`);
      }
    }
  }

  return {
    weatherStates,
    resultStates,
    weather,
    snapshots,
    cacheTags: [...cacheTags],
    summary,
  };
}

export function parseRunRequest(raw: unknown): RunRequest {
  if (raw === undefined || raw === null) return { limit: BATCH_LIMIT };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("request body must be an object");
  }
  const value = raw as Record<string, unknown>;
  const limit = value.limit === undefined ? BATCH_LIMIT : value.limit;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  return { limit };
}
