import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";

import { getAppData } from "./lib/repositories.js";

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.app = await getAppData(env);
  const response = await next();
  // 默认缓存只对 GET 页面响应生效；API、重定向、错误、页面已显式设置
  // （如列表页空数据时的 no-store 信号）一律不覆盖，与原逐页行为一致
  const url = new URL(context.request.url);
  if (
    context.request.method === "GET" &&
    !url.pathname.startsWith("/api/") &&
    response.status >= 200 &&
    response.status < 300 &&
    !response.headers.has("Cache-Control")
  ) {
    // opt-in 边缘缓存：provider 生成 Cloudflare-CDN-Cache-Control + Cache-Tag，
    // 命中时 Worker 完全不执行；列表页空数据 no-store 信号由上方条件跳过
    context.cache.set({ maxAge: 300, swr: 600, tags: ["f1db"] });
    // ClientRouter 后退导航用普通 fetch 重拉整页 HTML，只认浏览器可见的
    // Cache-Control；必须在此写入（边缘命中时后续中间件不执行）。预算
    // max-age=60 + SWR=300：f1db 按周同步，分钟级新鲜度足够，后退可命中
    // 本地磁盘缓存而不走网络
    response.headers.set(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
  }
  return response;
});
