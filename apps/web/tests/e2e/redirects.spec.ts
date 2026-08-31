import { expect, test } from "@playwright/test";

test("@desktop circuit detail redirects to its latest race", async ({
  page,
}) => {
  await page.goto("/circuits/melbourne");
  await expect(page).toHaveURL(
    /\/results\/2026\/races\/australia\/race-result$/,
  );
});

test("@desktop circuit redirect responds 301 to the race page", async ({
  context,
}) => {
  const resp = await context.request.get("/circuits/melbourne", {
    maxRedirects: 0,
  });
  expect(resp.status()).toBe(301);
  expect(resp.headers().location).toBe(
    "/results/2026/races/australia/race-result",
  );
});

test("@desktop unknown circuit returns 404", async ({ page }) => {
  expect((await page.goto("/circuits/nope"))?.status()).toBe(404);
});

test("@desktop circuits catalog redirects to latest season races", async ({
  page,
}) => {
  await page.goto("/circuits");
  await expect(page).toHaveURL(/\/results\/2026\/races$/);
});
