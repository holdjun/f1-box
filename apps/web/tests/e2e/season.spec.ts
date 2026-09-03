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

test("@desktop racing calendar links every round to its results page", async ({
  page,
}) => {
  await page.goto("/racing/2026");
  const cards = page.locator("main .race-card");
  await expect(cards).toHaveCount(23);
  // 卡面标题不含 Grand Prix 后缀；顶部为周末日期范围；完成卡显示前三名
  await expect(cards.first()).toContainText("Australia");
  await expect(cards.first()).toContainText("🏁");
  await expect(cards.first()).toContainText("06-08 MAR");
  await expect(cards.first()).toContainText("Melbourne");
  await expect(cards.first()).toContainText("RUS");
  await expect(cards.first()).toContainText("1:23:06.801");
  await expect(cards.first()).not.toContainText("Grand Prix");
  await expect(cards.first()).not.toContainText("Pole");
  await expect(cards.first()).not.toContainText("COMPLETE");
  // 完赛卡以领奖台收尾，未开赛卡以赛道当地发车时刻收尾
  await expect(cards.first()).not.toContainText("Lights out");
  const italy = cards.filter({ hasText: "Italy" });
  await expect(italy).toContainText("Lights out");
  await expect(italy).toContainText("Sun 15:00 CEST");
  await expect(cards.first().locator("img:visible")).toHaveCount(2); // 国旗 + 赛道
  const raceLinks = page.locator('main a[href^="/results/2026/races/"]');
  await expect(raceLinks).toHaveCount(23);
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

test("@desktop browser back from race detail returns to the calendar", async ({
  page,
}) => {
  await page.goto("/racing/2026");
  await page.locator('main a[href^="/results/2026/races/"]').first().click();
  await page.waitForURL(/\/races\//);

  await page.goBack();
  await expect(page).toHaveURL(/\/racing\/2026$/);
  // 内容必须真的换回日历页，而不只是 URL 变化（popstate 被忽略时 DOM 不动）
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "2026 Season",
  );
  // ClientRouter popstate 恢复滚动的 scrollTo 不带 behavior，
  // 全局 smooth 会把它放大成从页首飞回原位的长滚动动画；必须保持 auto
  const scrollBehavior = await page.evaluate(
    () => getComputedStyle(document.documentElement).scrollBehavior,
  );
  expect(scrollBehavior).toBe("auto");
});

test("@desktop browser back still works after switching race tabs", async ({
  page,
}) => {
  await page.goto("/racing/2026");
  await page.locator('main a[href^="/results/2026/races/"]').first().click();
  await page.waitForURL(/\/races\//);
  const secondTab = page.locator("[data-tab-anchor] a").nth(1);
  await secondTab.click();
  await expect(secondTab).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await expect(page).toHaveURL(/\/racing\/2026$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "2026 Season",
  );

  // 前进同理：state 被抹时 forward popstate 也会被忽略
  await page.goForward();
  await expect(page).toHaveURL(/\/results\/2026\/races\//);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Australia");
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

test("@desktop header calendar button opens a dialog with subscribe links", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  // 统计 showModal 调用次数：双重接线时单击触发按钮会调两次
  // （规范上第二次对已打开弹窗抛 InvalidStateError，内置 Chromium 149 实际不抛，
  // 故用计数兜底断言）
  await page.addInitScript(() => {
    const counter = window as unknown as { __showModalCalls: number };
    counter.__showModalCalls = 0;
    const original = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () {
      counter.__showModalCalls += 1;
      return original.call(this);
    };
  });

  await page.goto("/racing/2026");
  const { host, origin } = new URL(page.url());
  // 有 JS 时降级行被增强脚本隐藏，只显示触发按钮
  await expect(page.locator("[data-calendar-fallback]")).toBeHidden();
  const trigger = page.locator("[data-calendar-trigger]");
  await expect(trigger).toBeVisible();

  await trigger.click();
  const dialog = page.locator("[data-calendar-dialog]");
  await expect(dialog).toBeVisible();
  // webcal 断言用正则：scheme 必须恰为 webcal://（防 webcals:// 回归），不耦合页面协议
  await expect(dialog.locator("[data-calendar-subscribe]")).toHaveAttribute(
    "href",
    new RegExp(
      `^webcal://${host.replace(/\./g, "\\.")}/api/calendar\\.ics\\?year=2026$`,
    ),
  );
  await expect(dialog.locator("[data-calendar-download]")).toHaveAttribute(
    "href",
    new RegExp(
      `^https?://${host.replace(/\./g, "\\.")}/api/calendar\\.ics\\?year=2026$`,
    ),
  );
  await expect(dialog.locator("[data-calendar-copy]")).toHaveAttribute(
    "data-calendar-copy",
    `${origin}/api/calendar.ics?year=2026`,
  );

  // 关闭三路径：✕ 按钮、Esc、点击弹窗自身（遮罩/内边距区）
  await dialog.locator("[data-calendar-close]").click();
  await expect(dialog).toBeHidden();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await dialog.click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeHidden();

  // 双重接线回归：初次加载时模块顶层调用与 ClientRouter 首次 astro:page-load
  // 都会跑，重复监听会让一次点击触发两次 showModal()（规范上第二次对已打开
  // 弹窗抛 InvalidStateError）；用例共点开 3 次，调用必须恰好 3 次
  expect(pageErrors).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __showModalCalls: number }).__showModalCalls,
    ),
  ).toBe(3);
});

test("@desktop server HTML ships no-JS calendar fallback", async ({
  request,
}) => {
  // 无 JS 降级直接看服务端产物：降级行存在、触发按钮带 hidden
  const res = await request.get("/racing/2026");
  const html = await res.text();
  expect(html).toContain("data-calendar-fallback");
  expect(html).toMatch(/data-calendar-trigger[^>]*hidden/);
});

test("@desktop calendar.ics endpoint serves a valid ICS snapshot", async ({
  request,
}) => {
  const res = await request.get("/api/calendar.ics?year=2026");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  const body = await res.text();
  expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  // 23 站 × 每站 5 session；bahrain(Sepang) 为普通周末
  expect((body.match(/BEGIN:VEVENT/g) ?? []).length).toBe(115);
  expect(body).toContain("UID:race-bahrain-2026@f1-box.com\r\n");
  expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);

  // year 缺失、非法、空赛季一律 404
  expect((await request.get("/api/calendar.ics")).status()).toBe(404);
  expect((await request.get("/api/calendar.ics?year=abc")).status()).toBe(404);
  expect((await request.get("/api/calendar.ics?year=2019")).status()).toBe(404);
});

test("@desktop unknown year returns 404", async ({ page }) => {
  expect((await page.goto("/racing/1900"))?.status()).toBe(404);
});

// Astro 的错误重路由会去请求 /500；没有 500.astro 时错误页本身会 404，
// D1 一挂就看不到任何可用提示
test("@desktop /500 renders the error page instead of redirecting home", async ({
  page,
}) => {
  const response = await page.goto("/500");
  expect(response?.status()).toBe(500);
  expect(new URL(page.url()).pathname).toBe("/500");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Red flag");
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
