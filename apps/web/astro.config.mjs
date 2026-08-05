import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    imageService: "passthrough",
    configPath: process.env.F1BOX_WRANGLER_CONFIG,
  }),
});
