import { runAgent } from "./agent.js";
import { MAX_BODY_BYTES, validateAskBody } from "./request.js";
import type { AskDatabase } from "./db.js";

export interface AskLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

function errorJson(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function createAskHandler(deps: {
  ai: Ai;
  db: AskDatabase;
  limiter?: AskLimiter;
  runAgent?: typeof runAgent;
}): (request: Request) => Promise<Response> {
  const agent = deps.runAgent ?? runAgent;
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return errorJson(405, "method_not_allowed", "只接受 POST");
    }
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("application/json")) {
      return errorJson(400, "invalid_request", "content-type 必须是 application/json");
    }
    const origin = request.headers.get("origin");
    const host = new URL(request.url).host;
    let sameOrigin = false;
    if (origin !== null && origin.length > 0) {
      try {
        sameOrigin = new URL(origin).host === host;
      } catch {
        sameOrigin = false;
      }
    }
    if (!sameOrigin) {
      return errorJson(403, "forbidden", "仅限同源请求");
    }
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_BODY_BYTES) {
      return errorJson(400, "invalid_request", "请求体过大");
    }
    let parsed: unknown;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) {
        return errorJson(400, "invalid_request", "请求体过大");
      }
      parsed = JSON.parse(raw);
    } catch {
      return errorJson(400, "invalid_request", "请求体不是合法 JSON");
    }
    const validated = validateAskBody(parsed);
    if (!validated.ok) {
      return errorJson(400, "invalid_request", validated.message);
    }
    if (deps.limiter) {
      const key = request.headers.get("cf-connecting-ip") ?? "unknown";
      const outcome = await deps.limiter.limit({ key });
      if (!outcome.success) {
        return errorJson(429, "rate_limited", "请求太频繁，请稍后再试");
      }
    }
    try {
      const stream = agent({
        ai: deps.ai,
        db: deps.db,
        messages: validated.messages,
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    } catch {
      // agent 内部已兜底流中错误；这里只兜 agent 同步抛错
      return errorJson(500, "model_error", "回答生成失败，请稍后重试");
    }
  };
}
