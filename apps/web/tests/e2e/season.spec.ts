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
  await expect(page.getByRole("link", { name: "Teams" })).toHaveAttribute(
    "href",
    "/teams",
  );
});

test("@desktop race detail shows schedule and classifications", async ({
  page,
}) => {
  await page.goto("/2026/racing/10-belgian-grand-prix");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Belgian Grand Prix",
  );
  await expect(page.getByRole("heading", { name: "Weekend schedule" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Qualifying classification" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Race classification" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Next · Hungarian Grand Prix/ }),
  ).toHaveAttribute("href", "/2026/racing/11-hungarian-grand-prix");
});

test("@desktop unknown race under a valid year returns 404", async ({ page }) => {
  const response = await page.goto("/2026/racing/99-not-a-race");
  expect(response?.status()).toBe(404);
});

test("@desktop results pages show races, drivers and teams tables", async ({
  page,
}) => {
  await page.goto("/2026/results/races");
  await expect(page.getByRole("navigation", { name: "Results" })).toBeVisible();
  await expect(page.getByRole("table", { name: "2026 race results" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Belgian Grand Prix" }).first(),
  ).toBeVisible();

  await page.goto("/2026/results/drivers");
  await expect(page.getByRole("table", { name: "Driver standings" })).toBeVisible();

  await page.goto("/2026/results/teams");
  await expect(page.getByRole("table", { name: "Constructor standings" })).toBeVisible();
});

test("@desktop results index redirects to races", async ({ page }) => {
  await page.goto("/2026/results");
  await page.waitForURL(/\/2026\/results\/races$/);
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
