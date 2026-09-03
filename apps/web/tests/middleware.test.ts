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
  cacheEnabled = true,
  host = "f1-box.com",
) {
  const request = new Request(`https://${host}${path}`, { method });
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
    host?: string;
  } = {},
) {
  const { context, next, cache } = makeContext(
    path,
    opts.method,
    opts.status,
    opts.headers,
    opts.cacheEnabled,
    opts.host,
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

  // 首页 302 -> /racing/<当前赛季> 占生产总流量三分之一（2026-09-03 实测 23h
  // 60203 次），不缓存时每次都要唤醒 Worker 并查一次 season 表定重定向目标
  it("稳定重定向（301/302）opt-in 边缘缓存", async () => {
    for (const status of [301, 302]) {
      const { cache } = await run("/", { status });
      expect(cache.set).toHaveBeenCalledWith(CACHE_OPTIONS);
    }
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

  // 不设 ETag：Cloudflare 边缘对大体积 HTML 做压缩/缓存管线处理时会把强
  // 验证器弱化或整个剥掉（实测），浏览器永远拿不到，304 再验证在这套托管上
  // 不可行。写它纯属无效 D1 点查，回归测试防止再被加回来
  it("不写 ETag 验证器", async () => {
    const { response } = await run("/racing/2026");
    expect(response.headers.get("ETag")).toBeNull();
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

  it("重定向也带浏览器可见的 Cache-Control", async () => {
    const { response } = await run("/", { status: 302 });
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
  });

  it("API 与错误响应不带浏览器缓存头", async () => {
    for (const opts of [
      { method: "POST" },
      { method: "GET", path: "/api/health" },
      { status: 404 },
      { status: 500 },
    ]) {
      const { response } = await run(
        opts.path ?? "/racing/2026",
        opts.status ? { status: opts.status, method: opts.method } : opts,
      );
      expect(response.headers.get("Cache-Control")).toBeNull();
    }
  });
});

// robots.txt 的 Disallow 只拦抓取，拦不住索引；预览 worker 与生产内容相同，
// 被收录即构成重复内容。X-Robots-Tag 是唯一能拒绝索引的信号
describe("middleware 非生产域名拒绝索引", () => {
  it("预览 worker 域名带 noindex", async () => {
    const { response } = await run("/racing/2026", {
      host: "f1-box-preview.rj7c4mhzcp.workers.dev",
    });
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("本地开发域名带 noindex", async () => {
    const { response } = await run("/racing/2026", {
      host: "localhost",
      cacheEnabled: false,
    });
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("生产域名不带 noindex", async () => {
    const { response } = await run("/racing/2026", { host: "f1-box.com" });
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });

  // 边缘命中时 Worker 不执行，头必须随响应一同进缓存；API 与错误页同样适用
  it("API 与非 2xx 响应也带 noindex", async () => {
    for (const opts of [
      { path: "/api/health", host: "f1-box-preview.rj7c4mhzcp.workers.dev" },
      {
        path: "/x",
        status: 404,
        host: "f1-box-preview.rj7c4mhzcp.workers.dev",
      },
    ]) {
      const { response } = await run(opts.path, {
        status: opts.status,
        host: opts.host,
      });
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    }
  });
});
