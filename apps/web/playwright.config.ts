import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      grep: /@desktop/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-375",
      grep: /@mobile/,
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "reduced-motion",
      grep: /@reduced/,
      use: {
        ...devices["Desktop Chrome"],
        reducedMotion: "reduce",
      },
    },
  ],
  webServer: {
    // AI 绑定在 dev 下默认建 remote proxy session（需 wrangler 登录），本地凭证
    // 过期与 CI 无凭证都起不来；e2e 全程 mock /api/ask，本地绑定足够
    command:
      "CLOUDFLARE_VITE_FORCE_LOCAL=true ASTRO_DEV_BACKGROUND=0 pnpm dev --host 127.0.0.1",
    url: "http://127.0.0.1:4321",
    reuseExistingServer: !process.env.CI,
  },
});
