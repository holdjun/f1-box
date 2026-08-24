import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";

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
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600",
    );
  }
  return response;
});
