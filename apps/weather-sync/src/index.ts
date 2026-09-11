import { getContainer } from "@cloudflare/containers";
import type { WeatherContainer } from "./container";
import {
  BATCH_LIMIT,
  buildPersistPlan,
  candidateSql,
  MAX_ATTEMPTS,
  outboxDeleteSql,
  outboxInsertSql,
  outboxSql,
  parseRunRequest,
  SETTLE_DELAY_MS,
  type SessionCandidate,
  stateUpsertSql,
  statusSql,
  weatherUpsertSql,
} from "./domain";

export { WeatherContainer } from "./container";

const weatherCountSql = `SELECT COUNT(*) AS count FROM session_weather`;
const failuresSql = `SELECT year, round, session_key AS sessionKey, status, attempts,
       last_error AS lastError, next_attempt_at AS nextAttemptAt
FROM weather_sync_state
WHERE status IN ('failed', 'exhausted', 'mismatch')
ORDER BY updated_at DESC
LIMIT 50`;

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function authorized(request: Request, token: string): boolean {
  return request.headers.get("authorization") === `Bearer ${token}`;
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
  if (!purgeResponse.ok) return false;

  await env.F1_DB.batch(
    outbox.results.map((row) =>
      env.F1_DB.prepare(outboxDeleteSql).bind(row.cache_tag),
    ),
  );
  return true;
}

async function runIngestion(env: Env, limit: number) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - SETTLE_DELAY_MS).toISOString();
  const candidates = (
    await env.F1_DB.prepare(candidateSql)
      .bind(cutoff, MAX_ATTEMPTS, now.toISOString(), limit)
      .all<SessionCandidate>()
  ).results;

  if (candidates.length === 0) {
    return { requested: 0, cachePurged: await purgeOutbox(env) };
  }

  const response = await getContainer<WeatherContainer>(
    env.WEATHER_CONTAINER,
    "weather-sync",
  ).collect({
    sessions: candidates.map((candidate) => ({
      year: candidate.year,
      round: candidate.round,
      sessionKey: candidate.sessionKey,
      apiPath: candidate.apiPath,
    })),
  });
  const plan = buildPersistPlan(candidates, response.sessions, now);
  const statements = [
    ...plan.weather.map((weather) =>
      env.F1_DB.prepare(weatherUpsertSql).bind(
        weather.year,
        weather.round,
        weather.sessionKey,
        weather.tempC,
        weather.trackTempC,
        weather.weatherCode,
        weather.fetchedAt,
      ),
    ),
    ...plan.rows.map((state) =>
      env.F1_DB.prepare(stateUpsertSql).bind(
        state.year,
        state.round,
        state.sessionKey,
        state.status,
        state.attempts,
        state.lastError,
        state.lastAttemptAt,
        state.nextAttemptAt,
        state.updatedAt,
      ),
    ),
  ];
  if (plan.cacheDirty && env.CLOUDFLARE_ZONE_NAME !== undefined) {
    statements.push(env.F1_DB.prepare(outboxInsertSql).bind(now.toISOString()));
  }
  await env.F1_DB.batch(statements);

  return { ...plan.summary, cachePurged: await purgeOutbox(env) };
}

async function status(env: Env): Promise<Response> {
  const [states, weather, failures, outbox] = (await env.F1_DB.batch([
    env.F1_DB.prepare(statusSql),
    env.F1_DB.prepare(weatherCountSql),
    env.F1_DB.prepare(failuresSql),
    env.F1_DB.prepare(outboxSql),
  ])) as Array<D1Result<Record<string, unknown>>>;
  return jsonResponse({
    statuses: states.results,
    weatherRows: weather.results[0]?.count ?? 0,
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
