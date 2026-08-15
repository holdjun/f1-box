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

test("russell card shows number, team and flag @desktop", async ({
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

test("pre-1974 legends show their last race number @desktop", async ({
  page,
}) => {
  await page.goto("/drivers");
  const card = page.locator('a[href="/drivers/juan-manuel-fangio"]');
  // fangio 1958 最后一场用 34 号
  await expect(card.locator(".card-number")).toHaveText("34");
  await expect(card.locator(".card-monogram")).toHaveCount(0);
});

test("drivers without a permanent number show their last race number @desktop", async ({
  page,
}) => {
  await page.goto("/drivers");
  const card = page.locator('a[href="/drivers/ayrton-senna"]');
  // senna 1994 最后用 2 号
  await expect(card.locator(".card-number")).toHaveText("2");
});

test("reigning champion card shows the current number @desktop", async ({
  page,
}) => {
  await page.goto("/drivers");
  // norris 永久 4 号，2026 作为卫冕冠军用 1 号；目录显示当前号码
  const card = page.locator('a[href="/drivers/lando-norris"]');
  await expect(card.locator(".card-number")).toHaveText("1");
});

test("drivers catalog orders by career points @desktop", async ({ page }) => {
  await page.goto("/drivers");
  await expect(page.locator(".card-name").first()).toHaveText("Lewis Hamilton");
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
  // chip 用该 stint 结束年份的队色：2019 Williams（#ffffff）与 2020–2021（#005aff）不同
  const williamsChips = teams.locator(".team-chip").filter({ hasText: "Williams" });
  await expect(williamsChips).toHaveCount(2);
  await expect(williamsChips.nth(0)).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(williamsChips.nth(1)).toHaveCSS("color", "rgb(0, 90, 255)");
  // 生涯矩阵：首行车手自己（白色），队友行灰色且可链接
  const current = page.locator(".season-block.current");
  await expect(
    current.locator(".driver-cell .driver-link").first(),
  ).toHaveText("George Russell");
  const antonelli = current.locator(
    ".driver-cell a[href='/drivers/kimi-antonelli']",
  );
  await expect(antonelli).toBeVisible();
  await expect(antonelli).toHaveClass(/is-muted/);
  // 2020 两队拆成两个表，中间有转队连线
  await expect(page.locator(".team-split")).toHaveCount(1);
  const block2020 = page.locator(".season-block").filter({
    has: page.locator(".season-year", { hasText: "2020" }),
  });
  await expect(block2020).toHaveCount(2);
  await expect(block2020.nth(0)).toContainText("Nicholas Latifi");
  await expect(block2020.nth(1)).toContainText("Valtteri Bottas");
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
  // 2016 季中转队：换队后的 Red Bull 在 Toro Rosso 之上
  const blocks2016 = page.locator(".season-block").filter({
    has: page.locator(".season-year", { hasText: "2016" }),
  });
  await expect(blocks2016).toHaveCount(2);
  await expect(blocks2016.nth(0)).toContainText("Red Bull");
  await expect(blocks2016.nth(1)).toContainText("Toro Rosso");
  // chips 与矩阵相反按时间序：先效力的 Toro Rosso 在前
  const teamChips = page.getByLabel("Teams driven for").locator(".team-chip");
  await expect(teamChips.nth(0)).toContainText("Toro Rosso");
  await expect(teamChips.nth(0)).toContainText("2015–2016");
  await expect(teamChips.nth(1)).toContainText("Red Bull");
  await expect(teamChips.nth(1)).toContainText("2016–2026");
});

test("year view shows that year's race number over the permanent one @desktop", async ({
  page,
}) => {
  await page.goto("/drivers?year=2023");
  // verstappen 永久 3 号，但 2023 作为卫冕冠军用 1 号
  const card = page.locator('a[href="/drivers/max-verstappen"]');
  await expect(card.locator(".card-number")).toHaveText("1");
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
  // 按该年积分排序：schumacher 78 分在 hakkinen 前，且显示该年号码与该年车队
  await expect(page.locator(".card-name").first()).toHaveText(
    "Michael Schumacher",
  );
  await expect(
    page.locator('a[href="/drivers/michael-schumacher"]'),
  ).toContainText("Ferrari");
  await expect(
    page.locator('a[href="/drivers/mika-hakkinen"] .card-number'),
  ).toHaveText("9");
});

test("drivers detail filters season blocks @desktop", async ({ page }) => {
  await page.goto("/drivers/george-russell");
  await page.getByRole("button", { name: "Filter by season" }).click();
  const panel = page.locator(".season-filter__panel");
  await panel.getByRole("button", { name: "2021", exact: true }).click();
  await expect(page.locator(".season-block:visible")).toHaveCount(1);
  await expect(page.locator(".season-block:visible .season-year")).toHaveText("2021");
  // 转队分隔线属于 2020，隐藏年份时不应残留
  await expect(page.locator(".team-split:visible")).toHaveCount(0);
  await expect(page.locator(".season-gap:visible")).toHaveCount(0);
  // 多选：追加 2020（两队拆成两个表）
  await panel.getByRole("button", { name: "2020", exact: true }).click();
  await expect(page.locator(".season-block:visible")).toHaveCount(3);
  // All 一键回到全量（8 年 9 个表：2020 拆两表）
  await panel.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator(".season-block:visible")).toHaveCount(9);
});

test("drivers detail selects a decade then adds a year @desktop", async ({
  page,
}) => {
  await page.goto("/drivers/george-russell");
  await page.getByRole("button", { name: "Filter by season" }).click();
  const panel = page.locator(".season-filter__panel");
  // 整组选 2020s（2020–2026，2020 两表）再追加 2019
  await panel.getByRole("button", { name: "2020s", exact: true }).click();
  await expect(page.locator(".season-block:visible")).toHaveCount(8);
  await panel.getByRole("button", { name: "2019", exact: true }).click();
  await expect(page.locator(".season-block:visible")).toHaveCount(9);
});

test("drivers detail closes the filter panel on Escape @desktop", async ({
  page,
}) => {
  await page.goto("/drivers/george-russell");
  await page.getByRole("button", { name: "Filter by season" }).click();
  const panel = page.locator(".season-filter__panel");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("drivers detail filters via URL @desktop", async ({ page }) => {
  await page.goto("/drivers/george-russell?year=2021");
  await expect(page.locator(".season-block:visible")).toHaveCount(1);
  await expect(page.locator(".season-block:visible .season-year")).toHaveText("2021");
  await expect(page.locator(".season-filter__summary")).toHaveText("2021");
});
