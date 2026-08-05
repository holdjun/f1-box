import { expect, test } from "@playwright/test";

test("@desktop root redirects to active season racing page", async ({ page }) => {
  const browserRequests: string[] = [];
  page.on("request", (request) => browserRequests.push(request.url()));

  await page.goto("/");
  await page.waitForURL(/\/2026\/racing$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  expect(browserRequests.some((url) => /jolpi|ergast/i.test(url))).toBe(false);
});

test("@desktop racing page lists the full calendar", async ({ page }) => {
  await page.goto("/2026/racing");
  const raceLinks = page.locator('main a[href^="/2026/racing/"]');
  await expect(raceLinks).toHaveCount(22);
  await expect(page.getByRole("navigation", { name: "Season" })).toBeVisible();
});

test("@desktop unknown year returns 404", async ({ page }) => {
  const response = await page.goto("/2019/racing");
  expect(response?.status()).toBe(404);
});

test("@mobile 375px layout has no page overflow", async ({ page }) => {
  await page.goto("/2026/racing");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const hasPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasPageOverflow).toBe(false);
});

test("@reduced reduced motion leaves key content immediately visible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/2026/racing");

  const hero = page.getByRole("heading", { level: 1 });
  await expect(hero).toBeVisible();
  await expect(hero).toHaveCSS("animation-name", "none");
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
});
