import { expect, test } from "@playwright/test";

test("@desktop theme toggle switches and persists", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/racing/2026");
  const html = page.locator("html");
  const toggle = page.getByRole("button", {
    name: /switch to (light|dark) theme/i,
  });

  await expect(html).toHaveAttribute("data-theme", "dark");
  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#f3f0e9",
  );
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");

  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
});

test("@desktop theme survives client-side navigation", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/racing/2026");
  const html = page.locator("html");
  await page
    .getByRole("button", { name: /switch to (light|dark) theme/i })
    .click();
  await expect(html).toHaveAttribute("data-theme", "light");

  // ClientRouter 客户端导航：新文档的 <html> 没有 data-theme，
  // 路由同步属性时会把主题抹掉，必须在 swap 后重新应用
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Drivers" })
    .click();
  await page.waitForURL(/\/drivers/);
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(html).toHaveAttribute("data-theme", "light");
});

test("@desktop follows system preference when no stored choice", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/racing/2026");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("@mobile theme toggle is reachable at 375px", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/racing/2026");
  const toggle = page.getByRole("button", {
    name: /switch to (light|dark) theme/i,
  });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

// 全套件默认深色跑，这里专门覆盖亮色令牌与白色稿 logo 底托
test.describe("light theme rendering", () => {
  test.use({ colorScheme: "light" });

  test("@desktop light surfaces and white-variant logo backplate", async ({
    page,
  }) => {
    await page.goto("/racing/2026");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // body 背景 = --surface 亮色值
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(243, 240, 233)",
    );

    // 头部 wordmark 继承 --ink 亮色值
    await expect(page.locator('header a[aria-label="F1 Box home"]')).toHaveCSS(
      "color",
      "rgb(20, 23, 28)",
    );

    // race-card 表面 = --surface-raised 亮色值
    await expect(page.locator(".race-card > a").first()).toHaveCSS(
      "background-color",
      "rgb(251, 250, 245)",
    );

    // 白色稿车队 logo 亮色下靠墨底托保持可见
    await page.goto("/results/2026/races/australia/race-result");
    const logo = page
      .getByRole("table", { name: "Race classification" })
      .locator("tbody tr")
      .first()
      .locator(".vendor-cell__logo");
    await expect(logo).toHaveCSS("background-color", "rgb(20, 23, 28)");
  });
});
