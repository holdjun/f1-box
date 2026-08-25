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

const CACHE_OPTIONS = { maxAge: 300, swr: 600, tags: ["f1db"] };

// context 只构造 middleware 用到的最小形状；locals 由 middleware 写入 app
function makeContext(
  path: string,
  method = "GET",
  status = 200,
  headers: Record<string, string> = {},
) {
  const request = new Request(`https://example.com${path}`, { method });
  const locals: { app?: unknown } = {};
  const cache = { set: vi.fn() };
  const next = vi.fn(async () => new Response(null, { status, headers }));
  return { context: { locals, request, cache } as never, next, cache };
}

async function run(
  path: string,
  opts: {
    method?: string;
    status?: number;
    headers?: Record<string, string>;
  } = {},
) {
  const { context, next, cache } = makeContext(
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
    cache: cache as { set: ReturnType<typeof vi.fn> },
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

  it("GET 渲染页 2xx 无显式头时 opt-in 边缘缓存", async () => {
    const { cache } = await run("/racing/2026");
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(CACHE_OPTIONS);
  });

  it("页面已显式设置 Cache-Control（no-store 信号）时不 opt-in", async () => {
    const { cache } = await run("/racing/2026", {
      headers: { "Cache-Control": "no-store" },
    });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("POST API 请求不 opt-in", async () => {
    const { cache } = await run("/api/ask", { method: "POST" });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("GET API 路由不 opt-in", async () => {
    const { cache } = await run("/api/health");
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("重定向（3xx）不 opt-in", async () => {
    const { cache } = await run("/", { status: 302 });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("404 不 opt-in", async () => {
    const { cache } = await run("/results/2026/drivers", { status: 404 });
    expect(cache.set).not.toHaveBeenCalled();
  });
});
