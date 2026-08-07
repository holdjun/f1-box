import { expect, test } from "@playwright/test";

test("ferrari page renders identity, totals and season blocks @desktop", async ({
  page,
}) => {
  await page.goto("/teams/ferrari");

  await expect(page.locator("main h1")).toHaveText("Scuderia Ferrari");
  await expect(page.getByLabel("Career statistics")).toContainText("1135");

  const blocks = page.locator(".season-block");
  await expect(blocks).toHaveCount(77);
  await expect(blocks.first()).toContainText("2026");
  await expect(blocks.last()).toContainText("1950");
  await expect(page.locator(".season-block.champion")).toHaveCount(16);
  await expect(page.getByText("Historical data: f1db")).toBeVisible();
  await expect(page.getByLabel("Table legend")).toContainText("Win");
});

test("current season leads with stats panels and markers @desktop", async ({
  page,
}) => {
  await page.goto("/teams/ferrari");

  await expect(page.getByLabel("2026 season")).toContainText("Season Position2");
  await expect(page.getByLabel("2026 season")).toContainText("Sprint Points39");
  await expect(page.getByLabel("Team summary")).toContainText(
    "First Team Entry1950",
  );
  await expect(page.getByLabel("Team summary")).toContainText("Power UnitFerrari");

  const current = page.locator(".season-block.current");
  await expect(current).toHaveCount(1);
  await expect(current.locator(".season-year")).toHaveText("2026");
  await expect(current.locator(".tyre-P")).toBeVisible();
  await expect(current).toContainText("Charles Leclerc");
  // 2026 揭幕战勒克莱尔第 3、汉密尔顿第 4
  await expect(current.locator("td.result-podium")).not.toHaveCount(0);
  await expect(current.locator("td.result-points")).not.toHaveCount(0);
  // 最快圈只标全场最快（2026 两度），不再每格都带 F
  await expect(current.locator("sup.sup-f")).toHaveCount(2);
  await expect(current.locator("sup.sup-sprint")).not.toHaveCount(0);
});

test("drivers link to their future global pages @desktop", async ({ page }) => {
  await page.goto("/teams/ferrari");

  const link = page.locator('a[href="/drivers/lewis-hamilton"]');
  await expect(link.first()).toBeVisible();
  // 车手全局页尚未实现，先 404
  const response = await page.goto("/drivers/lewis-hamilton");
  expect(response?.status()).toBe(404);
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
