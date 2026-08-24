import { expect, type Page, test } from "@playwright/test";

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
  });

  test("@desktop hero lists the weekend sessions", async ({ page }) => {
    await page.goto("/results/2026/races/australia/race-result");
    const schedule = page.locator(".weekend-schedule");
    await expect(schedule.locator("li")).toHaveCount(5);
    await expect(schedule).toContainText("Qualifying");
  });

  test("@desktop hero shows the circuit map linking to its circuit page", async ({
    page,
  }) => {
    await page.goto("/results/2026/races/australia/race-result");
    const map = page.locator(".race-hero__map");
    await expect(map).toHaveAttribute("href", "/circuits/melbourne");
    await expect(map.locator("svg.circuit-map")).toBeVisible();
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

// 切 tab 后视图过渡会把视口带回页首；恢复完成后 tab 栏须回到视口内，
// 且不被 sticky 赛季筛选条遮挡（被盖住时整行都点不了）
async function expectTabsSettled(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector("[data-tab-anchor]");
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (rect.top < -50 || rect.top >= 300) return false;
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return !!hit?.closest("[data-tab-anchor]");
        }),
      { timeout: 3000 },
    )
    .toBe(true);
}

test("@desktop tab switch returns viewport to tabs instead of page top", async ({
  page,
}) => {
  await page.goto("/results/2026/races/australia/race-result");
  const tabs = page.locator("nav[data-tab-anchor]");
  await tabs.scrollIntoViewIfNeeded();
  await tabs.getByRole("link", { name: "Fastest Laps" }).click();
  await page.waitForURL(/\/fastest-laps$/);
  await expectTabsSettled(page);
});

test("@mobile race tab switch keeps tabs reachable below sticky season filter", async ({
  page,
}) => {
  await page.goto("/results/2026/races/australia/race-result");
  const tabs = page.locator("nav[data-tab-anchor]");
  await tabs.scrollIntoViewIfNeeded();
  await tabs.getByRole("link", { name: "Fastest Laps" }).click();
  await page.waitForURL(/\/fastest-laps$/);
  await expectTabsSettled(page);
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
