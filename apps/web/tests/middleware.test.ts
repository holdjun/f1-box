import { beforeEach, describe, expect, it, vi } from "vitest";

// cloudflare:workers 与 astro:middleware 都是运行时虚拟模块；单测各自 mock
vi.mock("cloudflare:workers", () => ({ env: {} }));
// defineMiddleware 只提供类型与包装，运行时 identity 即可直接调用导出的 handler
vi.mock("astro:middleware", () => ({
  defineMiddleware: (handler: unknown) => handler,
}));

const getAppData = vi.hoisted(() => vi.fn());
const getF1dbVersion = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/repositories.js", () => ({
  getAppData,
  getF1dbVersion,
}));

import { onRequest } from "../src/middleware.js";

const F1DB_VERSION = 42;
// vitest 把 process.env 并入 import.meta.env：CI 盖了 sha 戳时期望值随之变化，
// 本地（未设 F1BOX_BUILD_ID）与 middleware 一同回落 "dev"
const BUILD_ID = process.env.F1BOX_BUILD_ID ?? "dev";
const CACHE_OPTIONS = {
  maxAge: 300,
  swr: 600,
  tags: ["f1db"],
  etag: `"${F1DB_VERSION}-${BUILD_ID}"`,
};

// context 只构造 middleware 用到的最小形状；locals 由 middleware 写入 app
function makeContext(
  path: string,
  method = "GET",
  status = 200,
  headers: Record<string, string> = {},
  cacheEnabled = true,
) {
  const request = new Request(`https://example.com${path}`, { method });
  const locals: { app?: unknown } = {};
  // 与运行时 CacheLike 对齐：AstroCache.enabled=true，dev 的 NoopAstroCache 为 false
  const cache = { set: vi.fn(), enabled: cacheEnabled };
  const next = vi.fn(async () => new Response(null, { status, headers }));
  return {
    context: { locals, request, cache, url: new URL(request.url) } as never,
    next,
    cache,
  };
}

async function run(
  path: string,
  opts: {
    method?: string;
    status?: number;
    headers?: Record<string, string>;
    cacheEnabled?: boolean;
  } = {},
) {
  const { context, next, cache } = makeContext(
    path,
    opts.method,
    opts.status,
    opts.headers,
    opts.cacheEnabled,
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
  getF1dbVersion.mockReset();
  getF1dbVersion.mockResolvedValue(F1DB_VERSION);
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

describe("middleware 浏览器缓存头", () => {
  // ClientRouter 后退导航用普通 fetch 重拉整页 HTML，只认浏览器可见的
  // Cache-Control；只设 Cloudflare-CDN-Cache-Control 时该 fetch 每次走网络，
  // 后退体感是"刷新出来的"。边缘命中时 Worker 不执行，浏览器头必须在
  // cache.set 同一分支内直接写进响应，不能依赖 middleware 的后处理
  it("opt-in 同时给浏览器可见的 Cache-Control", async () => {
    const { response } = await run("/racing/2026");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
  });

  // 与 edge 缓存的 ETag 同源：过期后的条件请求命中返回 304，不再付整页往返
  it("ETag 由 f1db 数据版本加构建 ID 组成", async () => {
    const { response, cache } = await run("/racing/2026");
    expect(response.headers.get("ETag")).toBe(`"${F1DB_VERSION}-${BUILD_ID}"`);
    // 浏览器与 edge 共用同一验证器，改一处必须两处同步
    expect(cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ etag: `"${F1DB_VERSION}-${BUILD_ID}"` }),
    );
  });

  // dev 的 NoopAstroCache 不做边缘缓存；此时也不该给浏览器写缓存头，
  // 否则本地改完 .astro 后 60s 内刷新拿不到新页面，e2e（跑 dev server）
  // 验证的也不是生产行为
  it("缓存禁用（dev/e2e）时不写浏览器缓存头", async () => {
    const { cache, response } = await run("/racing/2026", {
      cacheEnabled: false,
    });
    expect(cache.set).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBeNull();
    expect(response.headers.get("ETag")).toBeNull();
  });

  it("no-store 等显式头页面不覆盖", async () => {
    const { response } = await run("/racing/2026", {
      headers: { "Cache-Control": "no-store" },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("API、重定向、非 2xx 均不带浏览器缓存头", async () => {
    for (const opts of [
      { method: "POST" },
      { method: "GET", path: "/api/health" },
      { status: 302 },
      { status: 404 },
    ]) {
      const { response } = await run(
        opts.path ?? "/racing/2026",
        opts.status ? { status: opts.status, method: opts.method } : opts,
      );
      expect(response.headers.get("Cache-Control")).toBeNull();
    }
  });
});
