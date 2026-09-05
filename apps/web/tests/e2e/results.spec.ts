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

  test("@desktop finished race keeps the weekend schedule without result links", async ({
    page,
  }) => {
    await page.goto("/results/2026/races/australia/race-result");
    const progress = page.locator(".weekend-progress");
    await expect(progress.locator("li")).toHaveCount(5);
    // 进度条只报时间：唯一的链接是无 JS 降级行里的两条 ics（弹窗内的不计入可见树）
    await expect(progress.locator("li a")).toHaveCount(0);
  });

  test("@desktop upcoming race shows the weekend progress and calendar link", async ({
    page,
  }) => {
    await page.goto("/results/2026/races/japan/race-result");
    const progress = page.locator(".weekend-progress");
    await expect(progress.locator("li")).toHaveCount(5);
    await expect(progress).toContainText("Qualifying");
    await expect(progress).toContainText("Track");
    // 无 JS 降级行给两条 ics：本站与整季；有 JS 时换成弹窗按钮
    await expect(progress.locator("[data-calendar-race]")).toHaveAttribute(
      "href",
      /\/api\/calendar\.ics\?year=2026&race=japan$/,
    );
  });

  // 天气三来源三形态：trackside 给赛道温度、forecast 给降水概率、缺温度时留空。
  // 缺温度那格最关键——曾经会渲染成 0°，跟合成的 00:00 是同一类编造。
  test("@desktop weekend weather shows per-source values and never fakes a temperature", async ({
    page,
  }) => {
    await page.goto("/results/2026/races/australia/race-result");
    const progress = page.locator(".weekend-progress");
    const weather = progress.locator("[data-session-weather]");
    // 有天气时每格都占位，格子高度才齐
    await expect(weather).toHaveCount(5);
    // trackside：气温 + 赛道温度，后缀不能省
    await expect(weather.nth(0)).toContainText("18°");
    await expect(weather.nth(0)).toContainText("31° track");
    // forecast：气温 + 降水概率
    await expect(weather.nth(4)).toContainText("24°");
    await expect(weather.nth(4)).toContainText("35% rain");
    // 排位赛只有赛道温度、没有气温：只显示 26° track，不得出现 0°
    await expect(weather.nth(3)).toContainText("26° track");
    await expect(progress).not.toContainText("0°");
    // 用到 Open-Meteo 的预报才出署名（许可要求）
    await expect(
      progress.getByRole("link", { name: "Open-Meteo" }),
    ).toBeVisible();
  });

  test("@desktop weekend without weather renders no weather row", async ({
    page,
  }) => {
    await page.goto("/results/2026/races/monaco/race-result");
    const progress = page.locator(".weekend-progress");
    await expect(progress.locator("[data-session-weather]")).toHaveCount(0);
    await expect(
      progress.getByRole("link", { name: "Open-Meteo" }),
    ).toHaveCount(0);
  });

  test("@desktop bare slug lands on the latest session with results", async ({
    page,
  }) => {
    await page.goto("/results/2026/races/china");
    await page.waitForURL(/\/results\/2026\/races\/china\/qualifying$/);
    await expect(page.locator(".weekend-progress__node")).toHaveCount(5);
  });

  // f1db 只从 2024 起补齐发车时刻，历史赛普遍只有日期；合成的 00:00 一旦按赛道
  // 时区换算就会造出假时刻（UTC+4 变 04:00，负偏移赛道连星期都退一天）
  test("@desktop sessions without a published start time show no clock", async ({
    page,
  }) => {
    await page.goto("/results/2026/races/monaco/race-result");
    const progress = page.locator(".weekend-progress");
    await expect(progress.locator("li")).toHaveCount(5);
    await expect(progress.locator("[data-session-date]").first()).toHaveText(
      /^[A-Z][a-z]{2} \d{2} [A-Z][a-z]{2}$/,
    );
    await expect(progress.locator("[data-track-time]")).toHaveCount(0);
    await expect(progress.locator("[data-my-time]")).toHaveCount(0);
    await expect(progress).not.toContainText("00:00");
    // ics 里一个事件都不会有，calendar.ics 直接 404：入口不能出现
    await expect(progress.locator("[data-calendar-trigger]")).toHaveCount(0);
    await expect(progress.locator("[data-calendar-race]")).toHaveCount(0);
  });

  test("@desktop hero shows the circuit map as plain content", async ({
    page,
  }) => {
    await page.goto("/results/2026/races/australia/race-result");
    const svg = page.locator("svg.circuit-map");
    await expect(svg).toBeVisible();
    // 方形画布裁成赛道包围盒：上下留白不再占掉将近一半高度
    await expect(svg).not.toHaveAttribute("viewBox", "0 0 500 500");
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

  test("@desktop header shows local race date and circuit facts", async ({
    page,
  }) => {
    await page.goto("/results/2026/races/australia/race-result");
    await expect(page.locator(".race-hero__subtitle")).toHaveText(
      "08 Mar 2026 · Melbourne · Australia",
    );
    const facts = page.locator(".circuit-facts");
    await expect(facts).toContainText("Melbourne Grand Prix Circuit");
    await expect(facts).toContainText("5.278");
    await expect(facts).toContainText("Turns");
    await expect(facts).toContainText("1:19.813");
    await expect(facts).toContainText("Charles Leclerc (2024)");
    await expect(facts).toContainText("306.124 km");
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
      (await page.goto("/results/2026/races/australia/warm-up"))?.status(),
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
    await expect(table).toHaveClass(/\bresult-table\b/);
    await expect(table.locator("tbody tr")).toHaveCount(22);
    const first = table.locator("tbody tr").first();
    await expect(first).toContainText("Kimi Antonelli");
    await expect(first.getByRole("link").first()).toHaveAttribute(
      "href",
      "/drivers/kimi-antonelli",
    );
    await expect(first).toContainText("219");
    // 归队列指向车队页，头像底色用该年队色（不再是中性灰回落）
    await expect(first.getByRole("link").nth(1)).toHaveAttribute(
      "href",
      "/teams/mercedes",
    );
    await expect(first).toContainText("Mercedes");
    await expect(first.getByRole("link").first()).toHaveAttribute(
      "style",
      /--monogram-bg:/,
    );
  });

  // 窄屏上车手名是主信息，不能像密列成绩表那样只剩三字码圆标
  test("@mobile driver standings keeps the driver name visible", async ({
    page,
  }) => {
    await page.goto("/results/2026/drivers");
    const first = page
      .getByRole("table", { name: "Driver standings" })
      .locator("tbody tr")
      .first();
    // 断言可视宽度而非 toBeVisible：sr-only 的 1px 盒子也会被判可见，
    // 必须确认车手名真的有可读宽度（防止将来被误收成 sr-only）
    const winnerName = first.locator("a[href^='/drivers/'] .vendor-cell__name");
    const box = await winnerName.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(40);
    await expect(first).toContainText("Kimi Antonelli");
  });

  test("@desktop constructor standings table from f1db", async ({ page }) => {
    await page.goto("/results/2026/teams");
    const table = page.getByRole("table", { name: "Constructor standings" });
    await expect(table).toHaveClass(/\bresult-table\b/);
    await expect(table.locator("tbody tr")).toHaveCount(11);
    await expect(table.locator("tbody tr").first()).toContainText("Mercedes");
    await expect(
      table.locator("tbody tr").first().getByRole("link"),
    ).toHaveAttribute("href", "/teams/mercedes");
  });
});

// test.use 作用于所在 describe 作用域而非单个 test：两个时区必须各自成组，
// 否则循环里的第二次调用会覆盖第一次，两个用例都跑同一个时区
for (const { tz, myTime } of [
  { tz: "Asia/Tokyo", myTime: "Fri 11:30" },
  { tz: "America/New_York", myTime: "Thu 22:30" },
]) {
  test.describe(`session dual times (${tz})`, () => {
    test.use({ timezoneId: tz });
    test(`@desktop shows my time in ${tz} and track time in the circuit tz`, async ({
      page,
    }) => {
      // 选未开赛的日本站（Suzuka, UTC+9）
      await page.goto("/results/2026/races/japan/race-result");
      // Track time 按赛道当地渲染，SSR 即正确、与浏览器时区无关
      await expect(page.locator("[data-track-time]").first()).toHaveText(
        "Fri 11:30",
      );
      // My time 只在客户端产生；两个时区的期望值不同，任一时区没生效都会失败
      await expect(page.locator("[data-my-time]").first()).toHaveText(myTime);
    });
  });
}

// 内容相同的内联模块脚本 ClientRouter 只执行一次：进入第二个比赛页时不再重跑，
// 必须靠 astro:page-load 补齐。只测整页加载会漏掉站内连续点击这条主路径
test.describe("session dual times after client navigation", () => {
  test.use({ timezoneId: "Asia/Tokyo" });
  test("@desktop my time renders on every race page reached by a link", async ({
    page,
  }) => {
    await page.goto("/racing/2026");
    await page.locator(".race-card a").first().click();
    await expect(page).toHaveURL(/\/results\/2026\/races\//);
    await expect(page.locator("[data-my-time]").first()).not.toBeEmpty();
    await page.goBack();
    await page.locator(".race-card a").nth(2).click();
    await expect(page.locator("[data-my-time]").first()).not.toBeEmpty();
  });
});

// 首列是粘滞列，它占多宽右侧就少看多宽：12rem 定值曾吃掉可视宽的 56%，
// 窄屏改为跟随内容并允许长名折行，名字一个字都不能少
test("@mobile race list first column follows its content", async ({ page }) => {
  await page.goto("/results/2026/races");
  const rows = page
    .getByRole("table", { name: "2026 race results" })
    .locator("tbody tr");
  const longest = rows.filter({ hasText: "Barcelona-Catalunya" });
  const width = await longest
    .locator("th")
    .evaluate((el) => el.getBoundingClientRect().width);
  const visible = await page
    .locator(".table-scroll")
    .evaluate((el) => el.clientWidth);
  expect(width).toBeLessThan(visible / 2);
  await expect(longest).toContainText("Barcelona-Catalunya");
  // 主列（冠军车手）不跟着次要归属列一起收成徽标；断言可视宽度而非 toBeVisible，
  // 否则 sr-only 的 1px 盒子也会被判可见，静默失效
  const winnerName = rows
    .first()
    .locator("a[href^='/drivers/'] .vendor-cell__name");
  const box = await winnerName.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(40);
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
  // hero 压成一行后 tab 已在首屏：滚到刚好让 nav 停在视口上沿下方，
  // 点击时 Playwright 不再自动滚动，才能验证切换本身不回页首
  await page.evaluate(() => {
    const el = document.querySelector("[data-tab-anchor]");
    if (el)
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 200);
  });
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

test("@desktop retired flat race paths return 404", async ({ page }) => {
  expect((await page.goto("/2026/results/races"))?.status()).toBe(404);
  expect(
    (await page.goto("/2026/racing/10-belgian-grand-prix"))?.status(),
  ).toBe(404);
});
