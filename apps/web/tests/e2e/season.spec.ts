import { expect, test } from "@playwright/test";

test("@desktop root redirects to active season racing page", async ({
  page,
}) => {
  const browserRequests: string[] = [];
  page.on("request", (request) => browserRequests.push(request.url()));

  await page.goto("/");
  await page.waitForURL(/\/racing\/2026$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  expect(browserRequests.some((url) => /jolpi|ergast/i.test(url))).toBe(false);
});

test("@desktop non-numeric year falls back home instead of chaining undefined", async ({
  page,
}) => {
  await page.goto("/undefined");
  await page.waitForURL(/\/racing\/2026$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("@desktop racing calendar links every round to its results page", async ({
  page,
}) => {
  await page.goto("/racing/2026");
  const cards = page.locator("main .race-card");
  await expect(cards).toHaveCount(22);
  // 卡面标题不含 Grand Prix 后缀；周末显示为日期范围
  await expect(cards.first()).toContainText("Australia");
  await expect(cards.first()).toContainText("🏁");
  await expect(cards.first()).toContainText("06-08 MAR");
  await expect(cards.first()).toContainText("Melbourne");
  await expect(cards.first().locator("img:visible")).toHaveCount(2); // 国旗 + 赛道
  const raceLinks = page.locator('main a[href^="/results/2026/races/"]');
  await expect(raceLinks).toHaveCount(22);
  await expect(raceLinks.first()).toHaveAttribute(
    "href",
    "/results/2026/races/australia/race-result",
  );
  // 年份选择在页面内容区的 SeasonFilter，header 不再有年份 pill
  const filter = page.locator("main .season-filter");
  await expect(filter).toBeVisible();
  await expect(filter.locator(".season-filter__summary")).toHaveText("2026");
  await filter.getByRole("button", { name: "Season" }).click();
  await expect(
    page.locator('.season-filter__panel a[href="/racing/2025"]'),
  ).toBeVisible();
  await expect(page.locator(".year-selector")).toHaveCount(0);
});

test("@desktop next round shows a live countdown to the next session", async ({
  page,
}) => {
  await page.goto("/racing/2026");
  // Next 面板倒计时指向下一个未开始 session；若周末已全部开始则显示 in progress
  const ticking = page.locator("[data-countdown-id]");
  const over = page.locator("[data-countdown-over]");
  await expect(ticking.or(over).first()).toBeVisible();
  if (await ticking.isVisible()) {
    const text = await ticking.textContent();
    expect(text).toMatch(/^(\d+d )?\d{2}:\d{2}:\d{2}$/);
    // 每秒跳动：两次采样间隔 1.2s，文本应变化
    await page.waitForTimeout(1200);
    const after = await ticking.textContent();
    expect(after).toMatch(/^(\d+d )?\d{2}:\d{2}:\d{2}$/);
    expect(after).not.toBe(text);
  }
});

test("@desktop legacy racing route redirects to new", async ({ page }) => {
  await page.goto("/2026/racing");
  await page.waitForURL(/\/racing\/2026$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // 垃圾年份不拼新路径，回首页再跳当季
  await page.goto("/undefined/racing");
  await page.waitForURL(/\/racing\/2026$/);
});

test("@desktop unknown year returns 404", async ({ page }) => {
  expect((await page.goto("/racing/1900"))?.status()).toBe(404);
  expect((await page.goto("/1900/racing"))?.status()).toBe(404);
});

test("@mobile 375px layout has no page overflow", async ({ page }) => {
  await page.goto("/racing/2026");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const hasPageOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(hasPageOverflow).toBe(false);
});

test("@reduced reduced motion leaves key content immediately visible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/racing/2026");

  const hero = page.getByRole("heading", { level: 1 });
  await expect(hero).toBeVisible();
  await expect(hero).toHaveCSS("animation-name", "none");
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
});
