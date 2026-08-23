import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
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
