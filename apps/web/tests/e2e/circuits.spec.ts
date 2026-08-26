import { expect, test } from "@playwright/test";

test("@desktop circuits catalog lists fixture circuits", async ({ page }) => {
  await page.goto("/circuits");
  await expect(page.locator("main h1")).toHaveText("Circuits");
  const cards = page.locator(".circuit-card");
  await expect(cards).toHaveCount(2);
  const shanghai = page.locator('a[href="/circuits/shanghai"]');
  await expect(shanghai).toContainText("Shanghai");
  await expect(shanghai.locator("img")).toHaveAttribute(
    "src",
    "/vendor/circuits/shanghai-1.svg",
  );
});

test("@desktop catalog year filter narrows to circuits used that season", async ({
  page,
}) => {
  await page.goto("/circuits?year=1990");
  await expect(page.locator(".circuit-card")).toHaveCount(1);
  await expect(page.locator(".circuit-card")).toContainText("Silverstone");
});

test("@desktop circuit detail shows stats and annotated layout map", async ({
  page,
}) => {
  await page.goto("/circuits/shanghai");
  await expect(page.locator("main h1")).toHaveText(
    "Shanghai International Circuit",
  );
  const map = page.locator(".circuit-hero__map svg.circuit-map");
  await expect(map).toBeVisible();
  // 注解图：16 个弯角标记 + 3 段 sector 着色
  await expect(map.locator(".circuit-map__corner")).toHaveCount(16);
  await expect(map.locator(".circuit-map__sector")).toHaveCount(3);
  const stats = page.locator(".circuit-stats");
  await expect(page.locator(".circuit-hero__length")).toContainText("5.451");
  await expect(stats).toContainText("2004");
  await expect(stats).toContainText("56");
  await expect(stats).toContainText("305.066km");
  await expect(stats).toContainText("1:32.238");
  await expect(stats).toContainText("Michael Schumacher (2004)");
});

test("@desktop unknown circuit returns 404", async ({ page }) => {
  expect((await page.goto("/circuits/nope"))?.status()).toBe(404);
});

test("@desktop race hero links to its circuit page", async ({ page }) => {
  await page.goto("/results/2026/races/australia/race-result");
  await expect(page.locator(".race-hero__circuit-link")).toHaveAttribute(
    "href",
    "/circuits/melbourne",
  );
});

test("@desktop header navigation drops circuits entry", async ({ page }) => {
  // 导航精简为 4 项：circuits 页面仍存在（由详情页电路链接进入），但不在主导航
  await page.goto("/");
  await expect(page.locator('header nav a[href="/circuits"]')).toHaveCount(0);
  const navLinks = page.locator("header nav a");
  await expect(navLinks).toHaveText(["Racing", "Results", "Drivers", "Teams"]);
});

test("@mobile 375px circuit detail has no page overflow", async ({ page }) => {
  await page.goto("/circuits/shanghai");
  await expect(page.locator("main h1")).toBeVisible();
  const hasPageOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(hasPageOverflow).toBe(false);
});
