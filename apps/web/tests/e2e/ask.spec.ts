import { expect, test, type Page } from "@playwright/test";

const SSE_OK = [
  'event: status\ndata: {"phase":"querying"}\n\n',
  'event: delta\ndata: {"text":"刘易斯·汉密尔顿 "}\n\n',
  'event: delta\ndata: {"text":"共七次夺冠"}\n\n',
  "event: done\ndata: {}\n\n",
].join("");

function mockAsk(page: Page, body = SSE_OK, status = 200) {
  void page.route("**/api/ask", async (route) => {
    if (status !== 200) {
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "rate_limited", message: "请求太频繁" },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body,
    });
  });
}

test.describe("ask panel", () => {
  test("@desktop opens, asks, renders streamed answer", async ({ page }) => {
    mockAsk(page);
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await expect(page.locator(".ask__panel")).toBeVisible();
    await expect(page.locator(".ask__trigger")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.locator(".ask__input").fill("汉密尔顿哪几年夺冠？");
    await page.locator(".ask__send").click();
    await expect(page.locator(".ask__messages")).toContainText(
      "刘易斯·汉密尔顿 共七次夺冠",
    );
    await expect(page.locator(".ask__status")).toBeHidden();
  });

  test("@desktop second ask carries the prior turns in the request body", async ({
    page,
  }) => {
    const bodies: { role: string; content: string }[][] = [];
    await page.route("**/api/ask", async (route) => {
      bodies.push(route.request().postDataJSON().messages);
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: SSE_OK,
      });
    });
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await page.locator(".ask__input").fill("第一问");
    await page.locator(".ask__send").click();
    await expect(page.locator(".ask__messages")).toContainText("共七次夺冠");
    await page.locator(".ask__input").fill("第二问");
    await page.locator(".ask__send").click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[0]).toEqual([{ role: "user", content: "第一问" }]);
    expect(bodies[1]).toEqual([
      { role: "user", content: "第一问" },
      { role: "assistant", content: "刘易斯·汉密尔顿 共七次夺冠" },
      { role: "user", content: "第二问" },
    ]);
  });

  test("@desktop escape closes and focus returns to trigger", async ({ page }) => {
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await expect(page.locator(".ask__panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ask__panel")).toBeHidden();
    await expect(page.locator(".ask__trigger")).toBeFocused();
  });

  test("@desktop shows rate limit message on 429 and keeps the question", async ({ page }) => {
    mockAsk(page, "", 429);
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await page.locator(".ask__input").fill("hi");
    await page.locator(".ask__send").click();
    await expect(page.locator(".ask__error")).toContainText("请求太频繁");
    // 失败后问题保留在输入框，可直接重试
    await expect(page.locator(".ask__input")).toHaveValue("hi");
  });

  test("@desktop stop aborts an in-flight request", async ({ page }) => {
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await page.route("**/api/ask", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: SSE_OK,
      });
    });
    await page.locator(".ask__input").fill("慢问题");
    await page.locator(".ask__send").click();
    await expect(page.locator(".ask__stop")).toBeVisible();
    await page.locator(".ask__stop").click();
    await expect(page.locator(".ask__stop")).toBeHidden();
    await expect(page.locator(".ask__send")).toBeEnabled();
  });

  test("@desktop clear resets conversation", async ({ page }) => {
    mockAsk(page);
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await page.locator(".ask__input").fill("问题一");
    await page.locator(".ask__send").click();
    await expect(page.locator(".ask__messages").locator(".ask__bubble")).toHaveCount(2);
    await page.locator(".ask__clear").click();
    await expect(page.locator(".ask__messages")).toBeEmpty();
  });

  test("@desktop conversation survives client navigation with one listener set", async ({
    page,
  }) => {
    mockAsk(page);
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await page.locator(".ask__input").fill("跨页面问题");
    await page.locator(".ask__send").click();
    await expect(page.locator(".ask__messages")).toContainText("跨页面问题");
    await page.getByRole("link", { name: "Drivers" }).click();
    await expect(page.locator(".ask__messages")).toContainText("跨页面问题");
    await page.locator(".ask__close").click();
    await page.locator(".ask__trigger").click();
    // 若监听器重复绑定，一次 click 会开关两次导致面板最终关闭
    await expect(page.locator(".ask__panel")).toBeVisible();
  });

  test("@mobile panel covers viewport at 375px", async ({ page }) => {
    mockAsk(page);
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    const box = await page.locator(".ask__panel").boundingBox();
    expect(box?.width).toBe(375);
    await page.locator(".ask__input").fill("移动端问题");
    await page.locator(".ask__send").click();
    await expect(page.locator(".ask__messages")).toContainText("刘易斯·汉密尔顿");
  });
});
