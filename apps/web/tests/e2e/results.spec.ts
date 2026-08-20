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
    await expect(rows.first()).toContainText("1:23:06.801");
  });

  test("@desktop unknown year renders empty state", async ({ page }) => {
    await page.goto("/results/2027/races");
    await expect(page.locator("main")).toContainText("No race results");
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
    await expect(table.locator("tbody tr").first()).toContainText("George Russell");
    await expect(table.locator("tbody tr").first()).toContainText("1:23:06.801");
  });

  test("@desktop hero lists the weekend sessions", async ({ page }) => {
    await page.goto("/results/2026/races/australia/race-result");
    const schedule = page.locator(".weekend-schedule");
    await expect(schedule.locator("li")).toHaveCount(5);
    await expect(schedule).toContainText("Qualifying");
  });

  test("@desktop bare slug redirects to race-result", async ({ page }) => {
    await page.goto("/results/2026/races/australia");
    await page.waitForURL(/\/results\/2026\/races\/australia\/race-result$/);
  });

  test("@desktop unknown slug and unknown tab are 404", async ({ page }) => {
    expect((await page.goto("/results/2026/races/nope/race-result"))?.status()).toBe(404);
    expect((await page.goto("/results/2026/races/australia/sprint"))?.status()).toBe(404);
  });
});

test("@mobile results pages have no page overflow", async ({ page }) => {
  for (const path of ["/results/2026/races", "/results/2026/races/australia/race-result"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow, path).toBe(false);
  }
});
