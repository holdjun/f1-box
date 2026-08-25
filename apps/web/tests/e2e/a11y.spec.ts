import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// 双主题下的可访问性基线：对比度/标题层级/landmark 等规则类问题自动兜底，
// 无基线维护成本（区别于被否决的 pixel-diff 视觉回归）
const pages = [
  "/racing/2026",
  "/results/2026/races",
  "/results/2026/races/australia/race-result",
  "/results/2026/drivers",
  "/results/2026/teams",
  "/drivers",
  "/teams",
  "/circuits",
  "/drivers/max-verstappen",
  "/teams/ferrari",
];

for (const scheme of ["dark", "light"] as const) {
  test.describe(`a11y (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    for (const path of pages) {
      test(`@desktop ${path} has no axe violations`, async ({ page }) => {
        // axe 的 color-contrast 对重页面（teams/ferrari 数千元素）耗时
        // 与环境负载成正比，低负载数秒、高负载可达数十秒；30s 默认超时
        // 在 CI 偶发负载下不足，放宽到 90s 只影响本 spec
        test.setTimeout(90_000);
        await page.goto(path);
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(
          violations.map(
            (v) =>
              `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
          ),
        ).toEqual([]);
      });
    }
  });
}
