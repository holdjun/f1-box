import { expect, test } from "@playwright/test";

test("@desktop theme toggle switches and persists", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/racing/2026");
  const html = page.locator("html");
  const toggle = page.getByRole("button", { name: /switch to (light|dark) theme/i });

  await expect(html).toHaveAttribute("data-theme", "dark");
  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f3f0e9");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");

  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
});

test("@desktop follows system preference when no stored choice", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/racing/2026");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("@mobile theme toggle is reachable at 375px", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/racing/2026");
  const toggle = page.getByRole("button", { name: /switch to (light|dark) theme/i });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
