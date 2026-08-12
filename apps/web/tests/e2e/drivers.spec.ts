import { expect, test } from "@playwright/test";

test("drivers catalog renders the full fixture field @desktop", async ({
  page,
}) => {
  await page.goto("/drivers");
  await expect(page.locator("main h1")).toHaveText("Drivers");
  await expect(page.locator(".driver-card")).toHaveCount(32);
  await expect(page.getByRole("navigation", { name: "Season" })).not.toBeVisible();
});

test("russell card shows permanent number, team and flag @desktop", async ({
  page,
}) => {
  await page.goto("/drivers");
  const card = page.locator('a[href="/drivers/george-russell"]');
  await expect(card.locator(".card-number")).toHaveText("63");
  await expect(card).toContainText("Mercedes");
  await expect(card.locator(".card-flag")).toHaveAttribute(
    "src",
    "/vendor/country-flags/gb.svg",
  );
});

test("numberless legends fall back to a monogram @desktop", async ({
  page,
}) => {
  await page.goto("/drivers");
  const card = page.locator('a[href="/drivers/ayrton-senna"]');
  await expect(card.locator(".card-monogram")).toHaveText("AS");
  await expect(card.locator(".card-number")).toHaveCount(0);
});

test("year drivers routes are retired @desktop", async ({ page }) => {
  const index = await page.goto("/2026/drivers");
  expect(index?.status()).toBe(404);
  const detail = await page.goto("/2026/drivers/RUS");
  expect(detail?.status()).toBe(404);
});

test("racing page navigation points to the global drivers catalog @desktop", async ({
  page,
}) => {
  await page.goto("/2026/racing");
  await expect(page.getByRole("link", { name: "Drivers" })).toHaveAttribute(
    "href",
    "/drivers",
  );
});

test("drivers catalog renders on mobile @mobile", async ({ page }) => {
  await page.goto("/drivers");
  await expect(page.locator("main h1")).toHaveText("Drivers");
  const hasPageOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(hasPageOverflow).toBe(false);
});

test("russell detail shows hero, bio and current season @desktop", async ({
  page,
}) => {
  await page.goto("/drivers/george-russell");
  await expect(page.locator("main h1")).toHaveText("George William Russell");
  await expect(page.locator(".driver-number")).toHaveText("63");
  await expect(page.locator(".driver-country")).toContainText("United Kingdom");
  await expect(page.locator(".flag")).toHaveAttribute(
    "src",
    "/vendor/country-flags/gb.svg",
  );
  await expect(page.locator(".driver-bio")).toContainText("15 February 1998");
  await expect(page.locator(".driver-bio")).toContainText("King's Lynn");
  await expect(page.getByLabel("2026 season")).toBeVisible();
  await expect(page.getByLabel("Career stats")).toBeVisible();
  await expect(page.locator(".season-block.current")).toHaveCount(1);
  // 待过车队链路：Williams → Mercedes，链向车队页
  const teams = page.getByLabel("Teams driven for");
  await expect(teams).toContainText("Williams");
  await expect(teams.locator('a[href="/teams/mercedes"]')).toBeVisible();
});

test("verstappen detail shows number history and champion blocks @desktop", async ({
  page,
}) => {
  await page.goto("/drivers/max-verstappen");
  await expect(page.locator(".number-chip")).toHaveCount(3);
  await expect(page.locator(".number-history")).toContainText("2015–2021");
  await expect(page.locator(".number-history")).toContainText("2022–2025");
  await expect(page.locator(".season-block.champion").first()).toBeVisible();
});

test("unknown driver returns 404 @desktop", async ({ page }) => {
  const response = await page.goto("/drivers/unknown-driver");
  expect(response?.status()).toBe(404);
  await expect(page.locator("main h1")).toHaveText("Driver not found");
});

test("russell detail renders on mobile @mobile", async ({ page }) => {
  await page.goto("/drivers/george-russell");
  await expect(page.locator("main h1")).toHaveText("George William Russell");
  const hasPageOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(hasPageOverflow).toBe(false);
});
