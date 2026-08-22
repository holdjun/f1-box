import { describe, expect, it } from "vitest";
import { createAskHandler } from "../src/lib/ask/handler.js";
import { createStaticAskDatabase } from "../src/lib/ask/db.js";
import { driverIdentitySql } from "../src/lib/ask/tools.js";

function sseStream() {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('event: delta\ndata: {"text":"七冠"}\n\n'));
      controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
      controller.close();
    },
  });
}

type AskHandler = ReturnType<typeof createAskHandler>;
type AskHandlerDeps = Parameters<typeof createAskHandler>[0];

function handler(overrides: Partial<AskHandlerDeps> = {}): AskHandler {
  return createAskHandler({
    ai: {} as Ai,
    db: createStaticAskDatabase({ [driverIdentitySql]: [] }),
    runAgent: () => sseStream(),
    ...overrides,
  });
}

const body = JSON.stringify({
  messages: [{ role: "user", content: "汉密尔顿几个冠军" }],
});

function ask(handlerFn: AskHandler, init: RequestInit = {}) {
  return handlerFn(
    new Request("https://f1-box.com/api/ask", {
      ...init,
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://f1-box.com",
        ...((init.headers ?? {}) as Record<string, string>),
      },
      body,
    }),
  );
}

describe("ask handler", () => {
  it("streams SSE with no-store for valid requests", async () => {
    const response = await ask(handler());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).toContain('event: delta\ndata: {"text":"七冠"}');
    expect(text.endsWith("event: done\ndata: {}\n\n")).toBe(true);
  });

  it("rejects non-POST with 405", async () => {
    const response = await handler()(
      new Request("https://f1-box.com/api/ask", { method: "GET" }),
    );
    expect(response.status).toBe(405);
  });

  it("rejects cross-origin with 403", async () => {
    const response = await ask(handler(), {
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("rejects missing origin with 403", async () => {
    const response = await ask(handler(), { headers: { origin: "" } });
    expect(response.status).toBe(403);
  });

  it("rejects non-json content type with 400", async () => {
    const response = await ask(handler(), {
      headers: { "content-type": "text/plain" },
    });
    expect(response.status).toBe(400);
  });

  it("rejects invalid messages with 400 error json", async () => {
    const response = await handler()(
      new Request("https://f1-box.com/api/ask", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://f1-box.com",
        },
        body: JSON.stringify({ messages: [] }),
      }),
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("invalid_request");
  });

  it("returns 429 when rate limited", async () => {
    const limited = handler({
      limiter: { limit: async () => ({ success: false }) },
    });
    const response = await ask(limited);
    expect(response.status).toBe(429);
  });

  it("passes CF-Connecting-IP as rate limit key", async () => {
    const limit = async () => ({ success: true });
    const spy = { calls: [] as string[][], limit };
    const tracked = async (o: { key: string }) => {
      spy.calls.push([o.key]);
      return { success: true };
    };
    const response = await ask(
      handler({ limiter: { limit: tracked } }),
      { headers: { "cf-connecting-ip": "203.0.113.9" } },
    );
    expect(response.status).toBe(200);
    expect(spy.calls).toEqual([["203.0.113.9"]]);
  });

  it("returns 500 error json when the agent throws before streaming", async () => {
    const response = await ask(
      handler({
        runAgent: (() => {
          throw new Error("boom");
        }) as unknown as AskHandlerDeps["runAgent"],
      }),
    );
    expect(response.status).toBe(500);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("model_error");
  });

  it("rejects oversized bodies with 400", async () => {
    const big = await handler()(
      new Request("https://f1-box.com/api/ask", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://f1-box.com",
        },
        body: `{"messages":[{"role":"user","content":"${"x".repeat(40_000)}"}]}`,
      }),
    );
    expect(big.status).toBe(400);
  });

  it("passes the request signal to the agent so stops end server work", async () => {
    let received: AbortSignal | undefined;
    const response = await ask(
      handler({
        runAgent: ((options: { signal?: AbortSignal }) => {
          received = options.signal;
          return sseStream();
        }) as unknown as AskHandlerDeps["runAgent"],
      }),
    );
    expect(response.status).toBe(200);
    expect(received).toBeInstanceOf(AbortSignal);
  });

  it("rate limits before reading the request body", async () => {
    let limitCalls = 0;
    const limited = handler({
      limiter: {
        limit: async () => {
          limitCalls++;
          return { success: false };
        },
      },
    });
    const response = await limited(
      new Request("https://f1-box.com/api/ask", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://f1-box.com",
          "content-length": "999999",
        },
        body: "x",
      }),
    );
    expect(limitCalls).toBe(1);
    expect(response.status).toBe(429);
  });
});
