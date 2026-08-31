import { expect, test } from "@playwright/test";

test.describe("results races list", () => {
  test("@desktop lists completed races with winners", async ({ page }) => {
    await page.goto("/results/2026/races");
    const table = page.getByRole("table", { name: "2026 race results" });
    await expect(table).toBeVisible();
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(11);
    await expect(rows.first()).toContainText("Australia");
    await expect(rows.first()).toContainText("George Russell");
    await expect(rows.first().locator("th a")).toHaveAttribute(
      "href",
      "/results/2026/races/australia/race-result",
    );
    await expect(
      rows.first().locator("td").nth(1).getByRole("link"),
    ).toHaveAttribute("href", "/drivers/george-russell");
    await expect(
      rows.first().locator("td").nth(2).getByRole("link"),
    ).toHaveAttribute("href", "/teams/mercedes");
    await expect(rows.first()).toContainText("1:23:06.801");
  });

  test("@desktop unknown year renders empty state", async ({ page }) => {
    await page.goto("/results/2027/races");
    await expect(page.locator("main")).toContainText("No race results");
  });

  test("@desktop season selection moved into the page filter", async ({
    page,
  }) => {
    await page.goto("/results/2026/races");
    await expect(page.locator(".year-selector")).toHaveCount(0);
    const filter = page.locator("main .season-filter");
    await expect(filter).toBeVisible();
    await expect(filter.locator(".season-filter__summary")).toHaveText("2026");
    await filter.getByRole("button", { name: "Season" }).click();
    await expect(
      page.locator('.season-filter__panel a[href="/results/2025/races"]'),
    ).toBeVisible();
  });

  test("@desktop results root and year redirect to races", async ({ page }) => {
    await page.goto("/results");
    await page.waitForURL(/\/results\/2026\/races$/);
    await page.goto("/results/2026");
    await page.waitForURL(/\/results\/2026\/races$/);
  });
});

test.describe("race detail", () => {
  test("@desktop shows race result table with winner", async ({ page }) => {
    await page.goto("/results/2026/races/australia/race-result");
    await expect(page.locator("main h1")).toHaveText("Australia");
    const table = page.getByRole("table", { name: "Race classification" });
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr").first()).toContainText(
      "George Russell",
    );
    await expect(
      table.locator("tbody tr").first().locator("td").nth(2).getByRole("link"),
    ).toHaveAttribute("href", "/drivers/george-russell");
    await expect(table.locator("tbody tr").first()).toContainText(
      "1:23:06.801",
    );
    // 徽标改三字码：George Russell 为 RUS（不再是名字首字母 GR）
    await expect(
      table.locator("tbody tr").first().locator(".vendor-cell__monogram"),
    ).toHaveText("RUS");
  });

  test("@desktop hero lists the weekend sessions", async ({ page }) => {
    await page.goto("/results/2026/races/australia/race-result");
    const schedule = page.locator(".weekend-schedule");
    await expect(schedule.locator("li")).toHaveCount(5);
    await expect(schedule).toContainText("Qualifying");
  });

  test("@desktop hero shows the circuit map as plain content", async ({
    page,
  }) => {
    await page.goto("/results/2026/races/australia/race-result");
    const svg = page.locator("svg.circuit-map");
    await expect(svg).toBeVisible();
    // 赛道图不再是链接（指向 /circuits 的 <a> 已移除）
    await expect(svg.locator("xpath=ancestor::a")).toHaveCount(0);
    // 注解地图渲染图例（melbourne-2 有 sectors/corners，DRS 数据为空故仅 4 项）
    const legend = page.locator(".circuit-map__legend");
    await expect(legend).toBeVisible();
    await expect(legend.locator(".legend")).toHaveCount(4);
    await expect(legend).toContainText("Sector 1");
    await expect(legend).toContainText("Sector 2");
    await expect(legend).toContainText("Sector 3");
    await expect(legend).toContainText("Corner");
  });

  test("@desktop header shows local race date and circuit card", async ({
    page,
  }) => {
    await page.goto("/results/2026/races/australia/race-result");
    await expect(page.locator(".race-hero__subtitle")).toHaveText(
      "08 Mar 2026 · Melbourne · Australia",
    );
    const card = page.locator(".info-panel");
    await expect(card).toContainText("Melbourne Grand Prix Circuit");
    await expect(card).toContainText("5.278 km");
    await expect(card).toContainText("306.124 km");
    await expect(card).toContainText("29");
    await expect(card).toContainText("1:19.813");
    await expect(card).toContainText("Charles Leclerc (2024)");
  });

  test("@desktop bare slug redirects to race-result", async ({ page }) => {
    await page.goto("/results/2026/races/australia");
    await page.waitForURL(/\/results\/2026\/races\/australia\/race-result$/);
  });

  test("@desktop unknown slug and unknown tab are 404", async ({ page }) => {
    expect(
      (await page.goto("/results/2026/races/nope/race-result"))?.status(),
    ).toBe(404);
    expect(
      (await page.goto("/results/2026/races/australia/sprint"))?.status(),
    ).toBe(404);
  });

  test("@desktop tab nav switches between result types", async ({ page }) => {
    await page.goto("/results/2026/races/australia/race-result");
    const nav = page.getByRole("navigation", { name: "Race result types" });
    await nav.getByRole("link", { name: "Qualifying" }).click();
    await page.waitForURL(/\/results\/2026\/races\/australia\/qualifying$/);
    await expect(
      page.getByRole("table", { name: "Qualifying classification" }),
    ).toBeVisible();
    await nav.getByRole("link", { name: "Fastest Laps" }).click();
    await page.waitForURL(/\/results\/2026\/races\/australia\/fastest-laps$/);
    await expect(
      page.getByRole("table", { name: "Fastest laps" }),
    ).toBeVisible();
    await nav.getByRole("link", { name: "Pit Stop Summary" }).click();
    await expect(
      page.getByRole("table", { name: "Pit stop summary" }),
    ).toBeVisible();
  });
});

test.describe("standings", () => {
  test("@desktop driver standings table from f1db", async ({ page }) => {
    await page.goto("/results/2026/drivers");
    const table = page.getByRole("table", { name: "Driver standings" });
    await expect(table).toBeVisible();
    await expect(table).toHaveClass("result-table");
    await expect(table.locator("tbody tr")).toHaveCount(22);
    await expect(table.locator("tbody tr").first()).toContainText(
      "Kimi Antonelli",
    );
    await expect(
      table.locator("tbody tr").first().getByRole("link"),
    ).toHaveAttribute("href", "/drivers/kimi-antonelli");
    await expect(table.locator("tbody tr").first()).toContainText("219");
  });

  test("@desktop constructor standings table from f1db", async ({ page }) => {
    await page.goto("/results/2026/teams");
    const table = page.getByRole("table", { name: "Constructor standings" });
    await expect(table).toHaveClass("result-table");
    await expect(table.locator("tbody tr")).toHaveCount(11);
    await expect(table.locator("tbody tr").first()).toContainText("Mercedes");
    await expect(
      table.locator("tbody tr").first().getByRole("link"),
    ).toHaveAttribute("href", "/teams/mercedes");
  });
});

test.describe("session dual times", () => {
  // 固定浏览器时区为非 UTC，验证 My time 随浏览器时区变化、Track time（赛道当地）恒定
  for (const tz of ["Asia/Tokyo", "America/New_York"]) {
    test.use({ timezoneId: tz });
    test(`@desktop ${tz} shows my time in browser tz and track time in circuit tz`, async ({
      page,
    }) => {
      await page.goto("/results/2026/races/australia/race-result");
      const myTime = page.locator("[data-my-time]").first();
      const trackTime = page.locator("[data-track-time]").first();
      await expect(myTime).toBeVisible();
      await expect(trackTime).toBeVisible();
      // Track time 按赛道当地（Melbourne AEDT UTC+11）渲染，SSR 即正确
      await expect(trackTime).toContainText("GMT+11");
      // My time 水合后转浏览器时区，不再是 SSR 阶段输出的 UTC
      await expect(myTime).not.toContainText("04:00 UTC");
    });
  }
});

test("@mobile results pages have no page overflow", async ({ page }) => {
  for (const path of [
    "/results/2026/races",
    "/results/2026/races/australia/race-result",
    "/results/2026/drivers",
    "/results/2026/teams",
  ]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const hasOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(hasOverflow, path).toBe(false);
  }
});

// 比赛详情页各 tab 的表格在 SSR 时已全部渲染；点击 tab 应就地切换面板，
// 不发生视图过渡换页：点击前的面板节点仍在文档中（仅 hidden），
// 地址栏由 replaceState 同步。ClientRouter 换页会丢弃旧节点且重置滚动
test("@desktop race tab switch swaps panels in place without reload", async ({
  page,
}) => {
  await page.goto("/results/2026/races/australia/race-result");
  await page.evaluate(() => {
    const panel = document.querySelector('[data-race-tab-panel="race-result"]');
    (window as { __panel?: Element | null }).__panel = panel;
  });
  const nav = page.getByRole("navigation", { name: "Race result types" });
  await nav.scrollIntoViewIfNeeded();
  const beforeScroll = await page.evaluate(() => window.scrollY);
  expect(beforeScroll).toBeGreaterThan(0);
  await nav.getByRole("link", { name: "Qualifying" }).click();
  await page.waitForURL(/\/qualifying$/);
  expect(
    await page.evaluate(() =>
      document.contains(
        (window as { __panel?: Element | null }).__panel ?? null,
      ),
    ),
  ).toBe(true);
  await expect(
    page.getByRole("table", { name: "Qualifying classification" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Race classification" }),
  ).toBeHidden();
  // 视口保持点击前的位置，不再回页首
  expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll);
});

test("@mobile race tab switch also swaps panels in place", async ({ page }) => {
  await page.goto("/results/2026/races/australia/race-result");
  await page.evaluate(() => {
    (window as { __probe?: number }).__probe = 1;
  });
  const nav = page.getByRole("navigation", { name: "Race result types" });
  await nav.getByRole("link", { name: "Fastest Laps" }).click();
  await page.waitForURL(/\/fastest-laps$/);
  expect(
    await page.evaluate(() => (window as { __probe?: number }).__probe),
  ).toBe(1);
  await expect(page.getByRole("table", { name: "Fastest laps" })).toBeVisible();
});

test("@desktop direct tab url still opens at page top", async ({ page }) => {
  await page.goto("/results/2026/races/australia/fastest-laps");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test.describe("legacy results redirects", () => {
  test("@desktop old results paths redirect to new", async ({ page }) => {
    await page.goto("/2026/results/races");
    await page.waitForURL(/\/results\/2026\/races$/);
    await page.goto("/2026/results");
    await page.waitForURL(/\/results\/2026\/races$/);
    await page.goto("/2026/results/drivers");
    await page.waitForURL(/\/results\/2026\/drivers$/);
    await page.goto("/2026/results/teams");
    await page.waitForURL(/\/results\/2026\/teams$/);
  });

  test("@desktop old race detail path is gone", async ({ page }) => {
    expect(
      (await page.goto("/2026/racing/10-belgian-grand-prix"))?.status(),
    ).toBe(404);
  });
});
