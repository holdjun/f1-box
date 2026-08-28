import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";

import { getAppData, getF1dbVersion } from "./lib/repositories.js";

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.app = await getAppData(env);
  const response = await next();
  // 默认缓存只对 GET 页面响应生效；API、重定向、错误、页面已显式设置
  // （如列表页空数据时的 no-store 信号）一律不覆盖，与原逐页行为一致
  // cache.enabled 在 dev/e2e（NoopAstroCache）下为 false：不做边缘缓存，
  // 也不写浏览器头，否则本地改完 .astro 后 60s 内刷新拿不到新页面
  if (
    context.cache.enabled &&
    context.request.method === "GET" &&
    !context.url.pathname.startsWith("/api/") &&
    response.status >= 200 &&
    response.status < 300 &&
    !response.headers.has("Cache-Control")
  ) {
    // ETag = f1db 数据版本 + 构建 ID，覆盖页面渲染的全部输入：数据同步或
    // 代码部署任一变化都会让 edge/浏览器缓存重新验证而不是 304 固化旧页面。
    // 数据版本每次渲染现读（不随 AppData memo）：同步后长活隔离实例拿着
    // 旧版本会让过期页面一直 304。仅在边缘未命中时执行，点查开销可忽略
    const etag = `"${await getF1dbVersion(env.F1_DB)}-${import.meta.env.F1BOX_BUILD_ID ?? "dev"}"`;
    // opt-in 边缘缓存：provider 生成 Cloudflare-CDN-Cache-Control + Cache-Tag，
    // 命中时 Worker 完全不执行；列表页空数据 no-store 信号由上方条件跳过
    context.cache.set({ maxAge: 300, swr: 600, tags: ["f1db"], etag });
    // ClientRouter 后退导航用普通 fetch 重拉整页 HTML，只认浏览器可见的
    // Cache-Control；必须在此写入（边缘命中时后续中间件不执行）。预算
    // max-age=60 + SWR=300：f1db 按周同步，分钟级新鲜度足够，后退可命中
    // 本地磁盘缓存而不走网络
    response.headers.set(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
    // 浏览器侧验证器与 edge 的 etag 同源：过期后的条件请求得到 304 而非
    // 整页往返（Chrome/Firefox 不做 SWR，新鲜期一过本会付全量请求）
    response.headers.set("ETag", etag);
  }
  return response;
});
