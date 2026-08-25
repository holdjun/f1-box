import { beforeEach, describe, expect, it, vi } from "vitest";

// cloudflare:workers 与 astro:middleware 都是运行时虚拟模块；单测各自 mock
vi.mock("cloudflare:workers", () => ({ env: {} }));
// defineMiddleware 只提供类型与包装，运行时 identity 即可直接调用导出的 handler
vi.mock("astro:middleware", () => ({
  defineMiddleware: (handler: unknown) => handler,
}));

const getAppData = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/repositories.js", () => ({
  getAppData,
}));

import { onRequest } from "../src/middleware.js";

const CACHE_HEADER = "public, s-maxage=300, stale-while-revalidate=600";

// context 只构造 middleware 用到的最小形状；locals 由 middleware 写入 app
function makeContext(
  path: string,
  method = "GET",
  status = 200,
  headers: Record<string, string> = {},
) {
  const request = new Request(`https://example.com${path}`, { method });
  const locals: { app?: unknown } = {};
  const next = vi.fn(async () => new Response(null, { status, headers }));
  return { context: { locals, request } as never, next };
}

async function run(
  path: string,
  opts: {
    method?: string;
    status?: number;
    headers?: Record<string, string>;
  } = {},
) {
  const { context, next } = makeContext(
    path,
    opts.method,
    opts.status,
    opts.headers,
  );
  const result = await onRequest(context, next);
  // MiddlewareHandler 返回类型含 void，实际执行路径恒返回 Response
  const response = result as Response;
  return {
    response,
    locals: (context as { locals: { app?: unknown } }).locals,
    next,
  };
}

beforeEach(() => {
  getAppData.mockReset();
  getAppData.mockResolvedValue({ repositories: {}, askDb: {} });
});

describe("middleware 默认缓存", () => {
  it("注入 AppData 到 locals", async () => {
    const { locals, next } = await run("/racing/2026");
    expect(locals.app).toEqual({ repositories: {}, askDb: {} });
    expect(getAppData).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("GET 渲染页 2xx 无显式头时设置默认缓存", async () => {
    const { response } = await run("/racing/2026");
    expect(response.headers.get("Cache-Control")).toBe(CACHE_HEADER);
  });

  it("页面已显式设置 Cache-Control（no-store 信号）时不覆盖", async () => {
    const { response } = await run("/racing/2026", {
      headers: { "Cache-Control": "no-store" },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("POST API 请求不设缓存", async () => {
    const { response } = await run("/api/ask", { method: "POST" });
    expect(response.headers.has("Cache-Control")).toBe(false);
  });

  it("GET API 路由不设缓存", async () => {
    const { response } = await run("/api/health");
    expect(response.headers.has("Cache-Control")).toBe(false);
  });

  it("重定向（3xx）不设缓存", async () => {
    const { response } = await run("/", { status: 302 });
    expect(response.headers.has("Cache-Control")).toBe(false);
  });

  it("404 不设缓存", async () => {
    const { response } = await run("/results/2026/drivers", { status: 404 });
    expect(response.headers.has("Cache-Control")).toBe(false);
  });
});
