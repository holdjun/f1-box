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
    // 站点品牌主体验为深色；theme.spec 用 emulateMedia 单独覆盖两方向
    colorScheme: "dark",
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
    // dev 脚本已让 AI 绑定走本地模拟器（无需 wrangler 登录）；e2e 全程 mock /api/ask
    command: "ASTRO_DEV_BACKGROUND=0 pnpm dev --host 127.0.0.1",
    url: "http://127.0.0.1:4321",
    reuseExistingServer: !process.env.CI,
  },
});
