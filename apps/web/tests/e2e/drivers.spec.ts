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
