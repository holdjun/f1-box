import { expect, test } from "@playwright/test";

test("drivers catalog renders the full fixture field @desktop", async ({
  page,
}) => {
  await page.goto("/drivers");
  await expect(page.locator("main h1")).toHaveText("Drivers");
  await expect(page.locator(".driver-card")).toHaveCount(32);
  await expect(
    page.getByRole("button", { name: "Filter by season" }),
  ).toBeVisible();
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
  // 待过车队链路：Williams → Mercedes；chip 纯展示不可点击（与车号一致）
  const teams = page.getByLabel("Teams driven for");
  await expect(teams).toContainText("Williams");
  await expect(teams.locator(".team-chip").filter({ hasText: "Mercedes" }).first()).toBeVisible();
  await expect(teams.locator("a")).toHaveCount(0);
  // 生涯矩阵：首行车手自己（白色），队友行灰色带车队标注且可链接
  const current = page.locator(".season-block.current");
  await expect(
    current.locator(".driver-cell .driver-link").first(),
  ).toHaveText("George Russell");
  const antonelli = current.locator(
    ".driver-cell a[href='/drivers/kimi-antonelli']",
  );
  await expect(antonelli).toBeVisible();
  await expect(antonelli).toHaveClass(/is-muted/);
  await expect(current.locator(".row-team")).toContainText("Mercedes");
});

test("verstappen detail shows number history and champion blocks @desktop", async ({
  page,
}) => {
  await page.goto("/drivers/max-verstappen");
  const numbers = page.getByLabel("Car number history");
  await expect(numbers.locator(".number-chip")).toHaveCount(3);
  await expect(numbers).toContainText("2015–2021");
  await expect(numbers).toContainText("2022–2025");
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

test("drivers catalog filters to a season @desktop", async ({ page }) => {
  await page.goto("/drivers?year=1997");
  await expect(page.locator(".driver-card")).toHaveCount(2);
  await expect(page.locator('a[href="/drivers/michael-schumacher"]')).toBeVisible();
  await expect(page.locator('a[href="/drivers/mika-hakkinen"]')).toBeVisible();
  await expect(page.locator(".season-filter__summary")).toHaveText("1997");
});

test("drivers detail filters season blocks @desktop", async ({ page }) => {
  await page.goto("/drivers/george-russell");
  await page.getByRole("button", { name: "Filter by season" }).click();
  const panel = page.locator(".season-filter__panel");
  await panel.getByRole("button", { name: "2021", exact: true }).click();
  await expect(page.locator(".season-block:visible")).toHaveCount(1);
  await expect(page.locator(".season-block:visible .season-year")).toHaveText("2021");
  // 多选：追加 2020
  await panel.getByRole("button", { name: "2020", exact: true }).click();
  await expect(page.locator(".season-block:visible")).toHaveCount(2);
  // All 一键回到全量
  await panel.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator(".season-block:visible")).toHaveCount(8);
});

test("drivers detail selects a decade then adds a year @desktop", async ({
  page,
}) => {
  await page.goto("/drivers/george-russell");
  await page.getByRole("button", { name: "Filter by season" }).click();
  const panel = page.locator(".season-filter__panel");
  // 整组选 2020s（2020–2026）再追加 2019，得到 8 个全部——验证年代 + 单年组合
  await panel.getByRole("button", { name: "2020s", exact: true }).click();
  await expect(page.locator(".season-block:visible")).toHaveCount(7);
  await panel.getByRole("button", { name: "2019", exact: true }).click();
  await expect(page.locator(".season-block:visible")).toHaveCount(8);
});

test("drivers detail filters via URL @desktop", async ({ page }) => {
  await page.goto("/drivers/george-russell?year=2021");
  await expect(page.locator(".season-block:visible")).toHaveCount(1);
  await expect(page.locator(".season-block:visible .season-year")).toHaveText("2021");
  await expect(page.locator(".season-filter__summary")).toHaveText("2021");
});
