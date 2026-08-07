import { expect, test } from "@playwright/test";

test("ferrari page renders identity, totals and history table @desktop", async ({
  page,
}) => {
  await page.goto("/teams/ferrari");

  await expect(page.locator("main h1")).toHaveText("Scuderia Ferrari");
  await expect(page.getByLabel("Career statistics")).toContainText("1135");

  const rows = page.locator(".history-table tbody tr");
  await expect(rows).toHaveCount(77);
  await expect(rows.first()).toContainText("2026");
  await expect(rows.last()).toContainText("1950");
  await expect(rows.first()).toContainText("Charles Leclerc");
  await expect(page.locator(".history-table tr.champion")).toHaveCount(16);
  await expect(page.getByText("Historical data: f1db")).toBeVisible();
});

test("marks the current season row @desktop", async ({ page }) => {
  await page.goto("/teams/ferrari");
  const current = page.locator(".history-table tbody tr.current");
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("2026");
});

test("unknown team returns 404 @desktop", async ({ page }) => {
  const response = await page.goto("/teams/unknown-team");
  expect(response?.status()).toBe(404);
  await expect(page.locator("main h1")).toHaveText("Team not found");
});

test("ferrari page renders on mobile @mobile", async ({ page }) => {
  await page.goto("/teams/ferrari");
  await expect(page.locator("main h1")).toHaveText("Scuderia Ferrari");
  await expect(page.locator(".history-table tbody tr")).toHaveCount(77);
});
