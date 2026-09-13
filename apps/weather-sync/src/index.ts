import { getContainer } from "@cloudflare/containers";
import type { WeatherContainer } from "./container";
import {
  BATCH_LIMIT,
  buildCollectionFailureResults,
  buildPersistPlan,
  type ContainerSessionResult,
  failuresSql,
  LOCK_TTL_MS,
  lockAcquireSql,
  lockReleaseSql,
  MAX_ATTEMPTS,
  outboxDeleteSql,
  outboxInsertSql,
  outboxSql,
  parseRunRequest,
  RESULT_LOOKBACK_MS,
  referenceCountSql,
  resultCandidateSql,
  resultStateUpsertSql,
  resultStatusSql,
  SETTLE_DELAY_MS,
  type SessionCandidate,
  type SnapshotUpsert,
  snapshotCountSql,
  snapshotDeleteSql,
  snapshotUpsertSql,
  weatherCandidateSql,
  weatherCountSql,
  weatherStateUpsertSql,
  weatherStatusSql,
  weatherUpsertSql,
} from "./domain";

export { WeatherContainer } from "./container";

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function authorized(request: Request, token: string): boolean {
  return (
    typeof token === "string" &&
    token.length > 0 &&
    request.headers.get("authorization") === `Bearer ${token}`
  );
}

interface OutboxRow {
  cache_tag: string;
  created_at: string;
}

async function purgeOutbox(env: Env): Promise<boolean> {
  const outbox = await env.F1_DB.prepare(outboxSql).all<OutboxRow>();
  if (outbox.results.length === 0) return true;
  if (
    env.CLOUDFLARE_ZONE_NAME === undefined ||
    env.CLOUDFLARE_API_TOKEN === undefined
  ) {
    return false;
  }

  const headers = {
    authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    "content-type": "application/json",
  };
  const zoneResponse = await fetch(
    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(
      env.CLOUDFLARE_ZONE_NAME,
    )}`,
    { headers },
  );
  const zoneJson = (await zoneResponse.json()) as {
    result?: Array<{ id?: string }>;
  };
  const zoneId = zoneJson.result?.[0]?.id;
  if (!zoneResponse.ok || zoneId === undefined) return false;

  const purgeResponse = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        tags: outbox.results.map((row) => row.cache_tag),
      }),
    },
  );
  const purgeJson = (await purgeResponse.json().catch(() => null)) as {
    success?: boolean;
  } | null;
  if (!purgeResponse.ok || purgeJson?.success !== true) return false;

  await env.F1_DB.batch(
    outbox.results.map((row) =>
      env.F1_DB.prepare(outboxDeleteSql).bind(row.cache_tag),
    ),
  );
  return true;
}

async function acquireIngestionLock(
  env: Env,
  owner: string,
  now: Date,
): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS).toISOString();
  const result = await env.F1_DB.prepare(lockAcquireSql)
    .bind(owner, expiresAt, now.toISOString())
    .run();
  return result.meta.changes === 1;
}

interface CandidateKindRow {
  year: number;
  round: number;
  sessionKey: string;
  apiPath: string;
  raceDate: string;
  startsAtUtc: string;
  attempts: number;
  previousStatus: SessionCandidate["weather"]["previousStatus"];
}

function candidateIdentity(row: CandidateKindRow): string {
  return `${row.year}:${row.round}:${row.sessionKey}`;
}

function mergeCandidates(
  weatherRows: CandidateKindRow[],
  resultRows: CandidateKindRow[],
): SessionCandidate[] {
  const candidates = new Map<string, SessionCandidate>();
  const upsert = (row: CandidateKindRow, kind: "weather" | "results") => {
    const key = candidateIdentity(row);
    const candidate =
      candidates.get(key) ??
      ({
        year: row.year,
        round: row.round,
        sessionKey: row.sessionKey,
        apiPath: row.apiPath,
        raceDate: row.raceDate,
        startsAtUtc: row.startsAtUtc,
        weather: { due: false, attempts: 0, previousStatus: null },
        results: { due: false, attempts: 0, previousStatus: null },
      } satisfies SessionCandidate);
    candidate[kind] = {
      due: true,
      attempts: row.attempts,
      previousStatus: row.previousStatus,
    };
    candidates.set(key, candidate);
  };
  for (const row of weatherRows) upsert(row, "weather");
  for (const row of resultRows) upsert(row, "results");
  return [...candidates.values()].sort(
    (a, b) =>
      b.startsAtUtc.localeCompare(a.startsAtUtc) ||
      b.year - a.year ||
      b.round - a.round ||
      a.sessionKey.localeCompare(b.sessionKey),
  );
}

function stateStatement(env: Env, sql: string, state: StateUpsert) {
  return bindState(env.F1_DB.prepare(sql), state);
}

type StateUpsert = import("./domain").StateUpsert;

function bindState(
  statement: D1PreparedStatement,
  state: StateUpsert,
): D1PreparedStatement {
  return statement.bind(
    state.year,
    state.round,
    state.sessionKey,
    state.status,
    state.attempts,
    state.lastError,
    state.lastAttemptAt,
    state.nextAttemptAt,
    state.updatedAt,
    state.refApiPath,
    state.refRaceDate,
    state.refStartsAtUtc,
  );
}

function snapshotsBySession(
  snapshots: SnapshotUpsert[],
): Map<string, SnapshotUpsert[]> {
  const grouped = new Map<string, SnapshotUpsert[]>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.year}:${snapshot.round}:${snapshot.sessionKey}`;
    const rows = grouped.get(key);
    if (rows === undefined) grouped.set(key, [snapshot]);
    else rows.push(snapshot);
  }
  return grouped;
}

async function runLockedIngestion(env: Env, limit: number, now: Date) {
  const cutoff = new Date(now.getTime() - SETTLE_DELAY_MS).toISOString();
  const lookback = new Date(now.getTime() - RESULT_LOOKBACK_MS).toISOString();
  const [weatherRows, resultRows] = (await env.F1_DB.batch([
    env.F1_DB.prepare(weatherCandidateSql).bind(
      cutoff,
      MAX_ATTEMPTS,
      now.toISOString(),
      limit,
    ),
    env.F1_DB.prepare(resultCandidateSql).bind(
      cutoff,
      lookback,
      MAX_ATTEMPTS,
      now.toISOString(),
      limit,
    ),
  ])) as Array<D1Result<CandidateKindRow>>;
  const candidates = mergeCandidates(weatherRows.results, resultRows.results);

  if (candidates.length === 0) {
    return { sessions: 0, cachePurged: await purgeOutbox(env) };
  }

  const request = {
    sessions: candidates.map((candidate) => ({
      year: candidate.year,
      round: candidate.round,
      sessionKey: candidate.sessionKey,
      apiPath: candidate.apiPath,
      startsAtUtc: candidate.startsAtUtc,
      weather: candidate.weather.due,
      results: candidate.results.due,
    })),
  };
  let results: ContainerSessionResult[];
  try {
    const response = await getContainer<WeatherContainer>(
      env.WEATHER_CONTAINER,
      "weather-sync",
    ).collect(request);
    results = response.sessions;
  } catch (error) {
    results = buildCollectionFailureResults(candidates, error, now);
  }
  const plan = buildPersistPlan(candidates, results, now);

  const statements = [
    ...plan.weather.map((weather) =>
      env.F1_DB.prepare(weatherUpsertSql).bind(
        weather.year,
        weather.round,
        weather.sessionKey,
        weather.tempC,
        weather.trackTempC,
        weather.humidityPct,
        weather.pressureHpa,
        weather.windSpeedKph,
        weather.windDirectionDeg,
        weather.rainfall,
        weather.sampleCount,
        weather.observedAtUtc,
        weather.weatherCode,
        weather.fetchedAt,
        weather.refApiPath,
        weather.refRaceDate,
        weather.refStartsAtUtc,
      ),
    ),
    ...plan.weatherStates.map((state) =>
      stateStatement(env, weatherStateUpsertSql, state),
    ),
    // 成功/明确空结果才替换快照；瞬时失败保留旧 provisional 行，
    // 避免一次容器抖动让页面上已有的结果消失。
    ...plan.resultStates
      .filter((state) => state.status === "success" || state.status === "empty")
      .map((state) =>
        env.F1_DB.prepare(snapshotDeleteSql).bind(
          state.year,
          state.round,
          state.sessionKey,
          state.refApiPath,
          state.refRaceDate,
          state.refStartsAtUtc,
        ),
      ),
    ...[...snapshotsBySession(plan.snapshots).values()].map((rows) =>
      env.F1_DB.prepare(snapshotUpsertSql).bind(
        rows[0].year,
        rows[0].round,
        rows[0].sessionKey,
        JSON.stringify(rows),
        rows[0].sourceRevision,
        rows[0].fetchedAt,
        rows[0].refApiPath,
        rows[0].refRaceDate,
        rows[0].refStartsAtUtc,
      ),
    ),
    ...plan.resultStates.map((state) =>
      stateStatement(env, resultStateUpsertSql, state),
    ),
    ...plan.cacheTags.map((cacheTag) =>
      env.F1_DB.prepare(outboxInsertSql).bind(cacheTag, now.toISOString()),
    ),
  ];
  await env.F1_DB.batch(statements);

  return {
    sessions: candidates.length,
    weather: plan.summary.weather,
    results: plan.summary.results,
    cachePurged: await purgeOutbox(env),
  };
}

async function runIngestion(env: Env, limit: number) {
  const now = new Date();
  const owner = crypto.randomUUID();
  if (!(await acquireIngestionLock(env, owner, now))) {
    return { sessions: 0, locked: true, cachePurged: false };
  }
  try {
    return await runLockedIngestion(env, limit, now);
  } finally {
    await env.F1_DB.prepare(lockReleaseSql).bind(owner).run();
  }
}

async function status(env: Env): Promise<Response> {
  const [
    weatherStates,
    resultStates,
    references,
    weather,
    snapshots,
    failures,
    outbox,
  ] = (await env.F1_DB.batch([
    env.F1_DB.prepare(weatherStatusSql),
    env.F1_DB.prepare(resultStatusSql),
    env.F1_DB.prepare(referenceCountSql),
    env.F1_DB.prepare(weatherCountSql),
    env.F1_DB.prepare(snapshotCountSql),
    env.F1_DB.prepare(failuresSql),
    env.F1_DB.prepare(outboxSql),
  ])) as Array<D1Result<Record<string, unknown>>>;
  return jsonResponse({
    weatherStatuses: weatherStates.results,
    resultStatuses: resultStates.results,
    sessionReferences: references.results[0]?.count ?? 0,
    weatherRows: weather.results[0]?.count ?? 0,
    snapshotRows: snapshots.results[0]?.count ?? 0,
    failures: failures.results,
    pendingCachePurges: outbox.results.length,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true });
    }
    if (!authorized(request, env.WEATHER_SYNC_TOKEN)) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    if (request.method === "POST" && url.pathname === "/run") {
      const params = parseRunRequest(await request.json());
      return jsonResponse(await runIngestion(env, params.limit));
    }
    if (request.method === "GET" && url.pathname === "/status") {
      return await status(env);
    }
    return jsonResponse({ error: "not found" }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runIngestion(env, BATCH_LIMIT);
  },
};
