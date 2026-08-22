import { expect, test, type Page } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";

const SSE_OK = [
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

  test("@desktop answer bubbles keep their styles when created client-side", async ({
    page,
  }) => {
    mockAsk(page);
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await page.locator(".ask__input").fill("汉密尔顿哪几年夺冠？");
    await page.locator(".ask__send").click();
    const bubble = page.locator(".ask__bubble--assistant");
    await expect(bubble).toBeVisible();
    // 动态创建的气泡拿不到 Astro 作用域属性，样式必须全局可见才生效
    const styles = await bubble.evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        padding: computed.padding,
        whiteSpace: computed.whiteSpace,
        background: computed.backgroundColor,
      };
    });
    expect(styles.padding).toBe("10px 12px");
    expect(styles.whiteSpace).toBe("pre-wrap");
    expect(styles.background).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("@desktop stored answers are truncated to the server message cap", async ({
    page,
  }) => {
    const longAnswer = "答案".repeat(1500); // 3000 字符，超过单条 2000 上限
    const bodies: { role: string; content: string }[][] = [];
    await page.route("**/api/ask", async (route) => {
      bodies.push(route.request().postDataJSON().messages);
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: `event: delta\ndata: ${JSON.stringify({ text: longAnswer })}\n\nevent: done\ndata: {}\n\n`,
      });
    });
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await page.locator(".ask__input").fill("第一问");
    await page.locator(".ask__send").click();
    await expect(page.locator(".ask__messages")).toContainText("答案");
    await page.locator(".ask__input").fill("第二问");
    await page.locator(".ask__send").click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1][1].role).toBe("assistant");
    expect(bodies[1][1].content).toHaveLength(2000);
  });

  test("@desktop composition enter does not send", async ({ page }) => {
    let askRequests = 0;
    await page.route("**/api/ask", (route) => {
      askRequests++;
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: SSE_OK,
      });
    });
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await page.locator(".ask__input").fill("汉密尔");
    // 输入法组词期的回车只确认候选词，不得触发表单提交
    await page
      .locator(".ask__input")
      .dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await page.waitForTimeout(250);
    expect(askRequests).toBe(0);
    await expect(page.locator(".ask__input")).toHaveValue("汉密尔");
  });

  test("@desktop clear is disabled while an answer streams in", async ({
    page,
  }) => {
    const bodies: { role: string; content: string }[][] = [];
    let slow = false;
    await page.route("**/api/ask", async (route) => {
      bodies.push(route.request().postDataJSON().messages);
      if (slow) await new Promise((resolve) => setTimeout(resolve, 1000));
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
    await expect(page.locator(".ask__clear")).toBeVisible();
    slow = true;
    await page.locator(".ask__input").fill("第二问");
    await page.locator(".ask__send").click();
    await expect(page.locator(".ask__stop")).toBeVisible();
    await expect(page.locator(".ask__clear")).toBeDisabled();
    // 脚本强行 click 也清不掉：禁用按钮不响应，会话保持完整
    await page
      .locator(".ask__clear")
      .evaluate((el) => (el as HTMLButtonElement).click());
    await expect(page.locator(".ask__messages")).toContainText("第一问");
    await expect(page.locator(".ask__stop")).toBeHidden();
    slow = false;
    await page.locator(".ask__input").fill("第三问");
    await page.locator(".ask__send").click();
    await expect.poll(() => bodies.length).toBe(3);
    expect(bodies[2][0]).toEqual({ role: "user", content: "第一问" });
  });

  test("@desktop tab cycles through visible panel controls only", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await expect(page.locator(".ask__panel")).toBeVisible();
    // 打开时可见可聚焦：关闭、输入框、发送（清空/停止隐藏）
    await page.locator(".ask__send").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(".ask__close")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".ask__send")).toBeFocused();
  });

  test("@desktop tab cycles through enabled controls while streaming", async ({
    page,
  }) => {
    let slow = false;
    await page.route("**/api/ask", async (route) => {
      if (slow) await new Promise((resolve) => setTimeout(resolve, 1000));
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
    await expect(page.locator(".ask__clear")).toBeVisible();
    slow = true;
    await page.locator(".ask__input").fill("第二问");
    await page.locator(".ask__send").click();
    await expect(page.locator(".ask__stop")).toBeVisible();
    // 此刻启用中的控件：关闭、输入框、停止（发送/清空禁用）
    await page.locator(".ask__stop").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(".ask__close")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".ask__stop")).toBeFocused();
  });

  test("@desktop whitespace-only answer rolls back like an empty one", async ({
    page,
  }) => {
    await page.route("**/api/ask", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: 'event: delta\ndata: {"text":"  \\n"}\n\nevent: done\ndata: {}\n\n',
      }),
    );
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await page.locator(".ask__input").fill("测试问题");
    await page.locator(".ask__send").click();
    await expect(page.locator(".ask__bubble--assistant")).toHaveCount(0);
    await expect(page.locator(".ask__input")).toHaveValue("测试问题");
  });

  test("@desktop stop keeps a partial answer and shows clear", async ({
    page,
  }) => {
    // route.fulfill 会缓冲完整流，无法模拟挂起的 SSE；起一个真实流式服务，
    // 先写一段部分回答再不结束响应
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
      });
      res.write('event: delta\ndata: {"text":"部分回答"}\n\n');
      res.on("error", () => {});
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as AddressInfo).port;
    try {
      await page.route("**/api/ask", (route) =>
        route.continue({ url: `http://127.0.0.1:${port}/ask` }),
      );
      await page.goto("/");
      await page.locator(".ask__trigger").click();
      await page.locator(".ask__input").fill("长问题");
      await page.locator(".ask__send").click();
      await expect(page.locator(".ask__bubble--assistant")).toContainText(
        "部分回答",
      );
      await page.locator(".ask__stop").click();
      await expect(page.locator(".ask__stop")).toBeHidden();
      await expect(page.locator(".ask__clear")).toBeVisible();
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("@desktop failed request does not clobber the next draft", async ({
    page,
  }) => {
    await page.route("**/api/ask", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "rate_limited", message: "请求太频繁" },
        }),
      });
    });
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await page.locator(".ask__input").fill("第一问");
    await page.locator(".ask__send").click();
    await page.locator(".ask__input").fill("第二问草稿");
    await expect(page.locator(".ask__error")).toBeVisible();
    await expect(page.locator(".ask__input")).toHaveValue("第二问草稿");
  });

  test("@desktop mid-stream error keeps the answer and restores the question", async ({
    page,
  }) => {
    await page.route("**/api/ask", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body:
          'event: delta\ndata: {"text":"部分内容"}\n\n' +
          'event: error\ndata: {"code":"model_error","message":"回答生成失败，请稍后重试"}\n\n',
      }),
    );
    await page.goto("/");
    await page.locator(".ask__trigger").click();
    await page.locator(".ask__input").fill("难题");
    await page.locator(".ask__send").click();
    await expect(page.locator(".ask__bubble--assistant")).toContainText(
      "部分内容",
    );
    // 错误文案以服务端为准，问题回到空输入框可直接重试
    await expect(page.locator(".ask__error")).toContainText(
      "回答生成失败，请稍后重试",
    );
    await expect(page.locator(".ask__input")).toHaveValue("难题");
  });
});
