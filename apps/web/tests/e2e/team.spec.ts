import { expect, test } from "@playwright/test";

test("ferrari page renders identity, totals and season blocks @desktop", async ({
  page,
}) => {
  await page.goto("/teams/ferrari");

  await expect(page.locator("main h1")).toHaveText("Scuderia Ferrari");
  await expect(page.getByLabel("Career statistics")).toContainText("1135");

  const blocks = page.locator(".season-block");
  await expect(blocks).toHaveCount(77);
  await expect(blocks.first()).toContainText("1950");
  await expect(page.locator(".season-block.champion")).toHaveCount(16);
  await expect(page.getByText("Historical data: f1db")).toBeVisible();
});

test("current season shows the race-by-race matrix @desktop", async ({
  page,
}) => {
  await page.goto("/teams/ferrari");

  const current = page.locator(".season-block.current");
  await expect(current).toHaveCount(1);
  await expect(current.locator(".season-year")).toHaveText("2026");
  await expect(current).toContainText("Charles Leclerc");
  // 2026 揭幕战勒克莱尔第 3、汉密尔顿第 4
  await expect(current.locator("td.result-podium")).not.toHaveCount(0);
  await expect(current.locator("td.result-points")).not.toHaveCount(0);
});

test("marks poles and fastest laps @desktop", async ({ page }) => {
  await page.goto("/teams/ferrari");
  await expect(page.locator(".season-block td sup").first()).toBeVisible();
});

test("unknown team returns 404 @desktop", async ({ page }) => {
  const response = await page.goto("/teams/unknown-team");
  expect(response?.status()).toBe(404);
  await expect(page.locator("main h1")).toHaveText("Team not found");
});

test("ferrari page renders on mobile @mobile", async ({ page }) => {
  await page.goto("/teams/ferrari");
  await expect(page.locator("main h1")).toHaveText("Scuderia Ferrari");
  await expect(page.locator(".season-block")).toHaveCount(77);
});
