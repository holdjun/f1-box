import { expect, test } from "@playwright/test";

test("ferrari page renders identity, summary and season blocks @desktop", async ({
  page,
}) => {
  await page.goto("/teams/ferrari");

  await expect(page.locator("main h1")).toHaveText("Scuderia Ferrari");
  await expect(page.getByLabel("Team summary")).toContainText("Entries1135");
  await expect(page.getByLabel("Team summary")).toContainText(
    "First Team Entry1950",
  );

  const blocks = page.locator(".season-block");
  await expect(blocks).toHaveCount(77);
  await expect(blocks.first()).toContainText("2026");
  await expect(blocks.last()).toContainText("1950");
  await expect(page.locator(".season-block.champion")).toHaveCount(16);
  await expect(page.getByLabel("Table legend")).toContainText("Win");
  // 车手冠军名字金色（1979 Scheckter 等）
  await expect(page.locator(".driver-champion").first()).toBeVisible();
  // 历史表之后有收尾块，页面不戛然而止
  await expect(page.locator(".history-end__summary")).toContainText(
    "1950–2026 · 77 seasons",
  );
  await expect(page.locator(".history-end__back")).toHaveAttribute(
    "href",
    "/teams",
  );
});

test("current season panel and markers @desktop", async ({ page }) => {
  await page.goto("/teams/ferrari");

  const panel = page.getByLabel("2026 season");
  await expect(panel).toContainText("Season Position2");
  await expect(panel).toContainText("Season Points307");
  await expect(panel).toContainText("39");

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

test("substitute drivers appear in the matrix @desktop", async ({ page }) => {
  await page.goto("/teams/ferrari");
  // 2024 沙特站 Bearman 替补患病的 Sainz 出战，第 7 名
  const block2024 = page
    .locator(".season-block")
    .filter({ has: page.locator(".season-year", { hasText: "2024" }) });
  await expect(block2024).toContainText("Oliver Bearman");
});

test("round headers link to future circuit pages @desktop", async ({
  page,
}) => {
  await page.goto("/teams/ferrari");

  const link = page.locator('a[href="/circuits/jeddah"]');
  await expect(link.first()).toBeVisible();
  // 赛道页尚未实现，先 404
  const response = await page.goto("/circuits/jeddah");
  expect(response?.status()).toBe(404);
});

test("drivers link to their global pages @desktop", async ({ page }) => {
  await page.goto("/teams/ferrari");

  const link = page.locator('a[href="/drivers/lewis-hamilton"]');
  await expect(link.first()).toBeVisible();
  // DEV 仅有 fixture 车手；hamilton 无 fixture 仍 404，russell 有 fixture 应 200
  const missing = await page.goto("/drivers/lewis-hamilton");
  expect(missing?.status()).toBe(404);
  const present = await page.goto("/drivers/george-russell");
  expect(present?.status()).toBe(200);
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

test("teams index lists all constructors @desktop", async ({ page }) => {
  await page.goto("/teams");
  await expect(page.locator("main h1")).toHaveText("Teams");
  await expect(page.locator(".team-card")).toHaveCount(187);
  await expect(page.locator('a[href="/teams/ferrari"]')).toBeVisible();
  await expect(page.locator('a[href="/teams/mercedes"]')).toBeVisible();
});

test("team logos render inside a stable contain frame @desktop", async ({
  page,
}) => {
  await page.goto("/teams");

  // 目录里的真实 logo（策展资产随仓库下发，DEV 也可见）
  const frame = page.locator('a[href="/teams/ferrari"] .card-logo-frame');
  await expect(frame).toHaveCSS("width", "128px");
  await expect(frame).toHaveCSS("height", "48px");
  const cardLogo = frame.locator("img.card-logo");
  await expect(cardLogo).toBeVisible();
  await expect(cardLogo).toHaveCSS("object-fit", "contain");
  const cardBounds = await frame.evaluate((element) => {
    const image = element.querySelector("img")!;
    const frameBox = element.getBoundingClientRect();
    const imageBox = image.getBoundingClientRect();
    return {
      frameWidth: frameBox.width,
      frameHeight: frameBox.height,
      imageWidth: imageBox.width,
      imageHeight: imageBox.height,
    };
  });
  expect(cardBounds.imageWidth).toBeLessThanOrEqual(cardBounds.frameWidth);
  expect(cardBounds.imageHeight).toBeLessThanOrEqual(cardBounds.frameHeight);

  // 无独立 logo 的车队回落为 monogram，不出现失效图片
  await expect(page.locator('a[href="/teams/adams"] .card-monogram')).toBeVisible();
  await expect(page.locator('a[href="/teams/adams"] img')).toHaveCount(0);

  await page.goto("/teams/ferrari");
  const teamFrame = page.locator(".team-logo-frame");
  await expect(teamFrame).toHaveCSS("width", "96px");
  await expect(teamFrame).toHaveCSS("height", "64px");
  const teamLogo = teamFrame.locator("img.team-logo");
  await expect(teamLogo).toBeVisible();
  await expect(teamLogo).toHaveCSS("object-fit", "contain");
});

test("year teams routes are retired @desktop", async ({ page }) => {
  const index = await page.goto("/2026/teams");
  expect(index?.status()).toBe(404);
  const detail = await page.goto("/2026/teams/ferrari");
  expect(detail?.status()).toBe(404);
});
