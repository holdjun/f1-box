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

test("drivers link to their future global pages @desktop", async ({ page }) => {
  await page.goto("/teams/ferrari");

  const link = page.locator('a[href="/drivers/lewis-hamilton"]');
  await expect(link.first()).toBeVisible();
  // 车手全局页尚未实现，先 404
  const response = await page.goto("/drivers/lewis-hamilton");
  expect(response?.status()).toBe(404);
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

test("team logos use a stable contain frame @desktop", async ({ page }) => {
  await page.goto("/teams");

  const frame = page.locator(".card-logo-frame").first();
  await expect(frame).toBeVisible();
  await expect(frame).toHaveCSS("width", "128px");
  await expect(frame).toHaveCSS("height", "48px");
  const cardLogoFit = await frame.evaluate((element) => {
    const scope = [...element.attributes].find((attribute) =>
      attribute.name.startsWith("data-astro-cid-"),
    );
    const image = document.createElement("img");
    image.className = "card-logo";
    image.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>";
    if (scope) image.setAttribute(scope.name, "");
    element.appendChild(image);
    return getComputedStyle(image).objectFit;
  });
  expect(cardLogoFit).toBe("contain");
  const cardLogoBounds = await frame.evaluate((element) => {
    const image = element.querySelector("img.card-logo")!;
    const frameBox = element.getBoundingClientRect();
    const imageBox = image.getBoundingClientRect();
    return { frameHeight: frameBox.height, imageHeight: imageBox.height };
  });
  expect(cardLogoBounds.imageHeight).toBeLessThanOrEqual(cardLogoBounds.frameHeight);
  const cardLogoBoxSizing = await frame.evaluate((element) => {
    const scope = [...element.attributes].find((attribute) =>
      attribute.name.startsWith("data-astro-cid-"),
    );
    const image = document.createElement("img");
    image.className = "card-logo logo-on-light";
    if (scope) image.setAttribute(scope.name, "");
    element.appendChild(image);
    return getComputedStyle(image).boxSizing;
  });
  expect(cardLogoBoxSizing).toBe("border-box");

  await page.goto("/teams/ferrari");
  await expect(page.locator(".team-logo-frame")).toHaveCSS("width", "96px");
  await expect(page.locator(".team-logo-frame")).toHaveCSS("height", "64px");
  const teamLogoFit = await page.locator(".team-logo-frame").evaluate((element) => {
    const scope = [...element.attributes].find((attribute) =>
      attribute.name.startsWith("data-astro-cid-"),
    );
    const image = document.createElement("img");
    image.className = "team-logo";
    if (scope) image.setAttribute(scope.name, "");
    element.appendChild(image);
    return getComputedStyle(image).objectFit;
  });
  expect(teamLogoFit).toBe("contain");
});

test("year teams route redirects to the global team catalog @desktop", async ({ page }) => {
  await page.goto("/2026/teams");
  await page.waitForURL(/\/teams$/);
  await expect(page.locator(".team-card")).toHaveCount(187);
  await expect(page.locator(".team-card").first()).not.toContainText("PTS");
  await expect(page.locator(".team-card").first()).not.toContainText("2026");
  await expect(page.getByRole("navigation", { name: "Season" })).not.toBeVisible();
  await expect(page.locator('a[href="/teams/ferrari"]').first()).toBeVisible();
});

test("year team detail route redirects to the global team detail page @desktop", async ({ page }) => {
  await page.goto("/2026/teams/ferrari");
  await page.waitForURL(/\/teams\/ferrari$/);
  await expect(page.locator("main h1")).toHaveText("Scuderia Ferrari");
});
