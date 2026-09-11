import { parseRunRequest } from "./domain";

export { WeatherContainer } from "./container";
export { WeatherSyncWorkflow } from "./workflow";

const statusCountsSql = `SELECT status, COUNT(*) AS count
FROM weather_sync_state
GROUP BY status
ORDER BY status`;
const weatherCountSql = `SELECT COUNT(*) AS count FROM session_weather`;
const failuresSql = `SELECT year, round, session_key AS sessionKey, status, attempts, last_error AS lastError, next_attempt_at AS nextAttemptAt
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
  const header = request.headers.get("authorization");
  return header === `Bearer ${token}`;
}

async function status(env: Env): Promise<Response> {
  const [counts, weather, failures] = (await env.F1_DB.batch([
    env.F1_DB.prepare(statusCountsSql),
    env.F1_DB.prepare(weatherCountSql),
    env.F1_DB.prepare(failuresSql),
  ])) as Array<D1Result<Record<string, unknown>>>;
  return jsonResponse({
    statuses: counts.results,
    weatherRows: weather.results[0]?.count ?? 0,
    failures: failures.results,
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
    if (request.method === "POST" && url.pathname === "/runs") {
      const params = parseRunRequest(await request.json());
      const instance = await env.WEATHER_SYNC.create({
        id: crypto.randomUUID(),
        params,
        retention: { successRetention: "7 days", errorRetention: "30 days" },
      });
      return jsonResponse({ instanceId: instance.id }, 202);
    }
    if (request.method === "GET" && url.pathname.startsWith("/runs/")) {
      const id = url.pathname.slice("/runs/".length);
      if (id === "")
        return jsonResponse({ error: "instance id required" }, 400);
      const instance = await env.WEATHER_SYNC.get(id);
      return jsonResponse({
        instanceId: instance.id,
        status: await instance.status(),
      });
    }
    if (request.method === "GET" && url.pathname === "/status") {
      return await status(env);
    }
    return jsonResponse({ error: "not found" }, 404);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await env.WEATHER_SYNC.create({
      id: `scheduled-${controller.scheduledTime}`,
      params: { mode: "current", years: null },
      retention: { successRetention: "7 days", errorRetention: "30 days" },
    });
  },
};
