import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";

import { getAppData } from "./lib/repositories.js";

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.app = await getAppData(env);
  const response = await next();
  // 默认缓存只对 GET 页面响应生效；API、错误、页面已显式设置（如列表页空数据时的
  // no-store 信号）一律不覆盖。稳定重定向（301/302）同样 opt-in：首页 302 到当前
  // 赛季占生产总流量三分之一，不缓存时每次都要唤醒 Worker 并查一次 season 表
  // cache.enabled 在 dev/e2e（NoopAstroCache）下为 false：不做边缘缓存，
  // 也不写浏览器头，否则本地改完 .astro 后 60s 内刷新拿不到新页面
  if (
    context.cache.enabled &&
    context.request.method === "GET" &&
    !context.url.pathname.startsWith("/api/") &&
    response.status >= 200 &&
    response.status < 400 &&
    !response.headers.has("Cache-Control")
  ) {
    // opt-in 边缘缓存：provider 生成 Cloudflare-CDN-Cache-Control + Cache-Tag，
    // 命中时 Worker 完全不执行；列表页空数据 no-store 信号由上方条件跳过
    context.cache.set({ maxAge: 300, swr: 600, tags: ["f1db"] });
    // ClientRouter 后退导航用普通 fetch 重拉整页 HTML，只认浏览器可见的
    // Cache-Control；必须在此写入（边缘命中时后续中间件不执行）。预算
    // max-age=60 + SWR=300：f1db 按周同步，分钟级新鲜度足够，后退可命中
    // 本地磁盘缓存而不走网络。不设 ETag：Cloudflare 边缘对大体积 HTML 做
    // 压缩/缓存管线处理时会把强验证器弱化或整个剥掉（实测），浏览器永远
    // 拿不到，304 再验证在这套托管上不可行
    response.headers.set(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
  }
  // 预览 worker 与本地跑的是和生产相同的内容，被收录即构成重复内容。
  // robots.txt 的 Disallow 只拦抓取、拦不住索引，X-Robots-Tag 才是索引开关。
  // 边缘命中时 Worker 不执行，故必须随响应一同写入缓存副本
  if (context.url.hostname !== "f1-box.com") {
    response.headers.set("X-Robots-Tag", "noindex");
  }
  return response;
});
