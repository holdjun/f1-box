import cloudflare from "@astrojs/cloudflare";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  // Cloudflare 对 Worker 路由的 sec-purpose=prefetch 请求返回 503；关闭无效预取，
  // 避免 hover 白跑一次请求，真实导航期间由 ClientRouter 进度条即时反馈。
  prefetch: false,
  cache: { provider: cacheCloudflare() },
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      // 预包含运行时才动态解析的 noop 图片服务，否则 dev 下二次依赖优化会让
      // workerd runner 请求已失效的旧哈希产物，服务起不来
      optimizeDeps: { include: ["astro/assets/services/noop"] },
    },
  },
  adapter: cloudflare({
    imageService: "passthrough",
    configPath: process.env.F1BOX_WRANGLER_CONFIG,
  }),
});
