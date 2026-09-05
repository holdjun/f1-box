import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// axe 断言幂等：violations 是否为空不随重试改变，真违规重试也还是红；
// 慢因是 axe 扫描重页面的 CPU 耗时，重试不会变快。CI 全局 retries=2 会把一次
// 偶发负载超时放大成 90s×3（teams/ferrari 实测拖到 5.5 分钟）。此处按文件关掉
// 重试，只对 axe 这种重试无收益的用例生效；交互型 spec 的偶发时序 flaky 仍由其
// 各自文件兜底，不在此一刀切。
test.describe.configure({ retries: 0 });

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
  "/drivers/max-verstappen",
  "/teams/ferrari",
];

// 窄屏下多个列靠媒体查询收起文字（只剩 logo / 三字码徽标），隐错只在窄屏出现：
// 用 display:none 藏名字会直接造出无可访问名称的链接，桌面基线根本扫不到
const mobilePages = [
  "/results/2026/races",
  "/results/2026/races/australia/race-result",
  "/results/2026/drivers",
];

// 断言只读 violations，但实测关掉 passes / incomplete 的节点收集（resultTypes）
// 只快 8%，在噪声范围内：瓶颈是 color-contrast 规则本身的计算，不是结果返回

// /teams/ferrari 把历史赛季全列在一页，本地无竞争单次扰动就要 46 秒；CI 机器更慢
// 且 fullyParallel 下要与其他 worker 抢 CPU，90 秒必然不够。预算给够，才能把
// “真的挂住”与“只是慢”区分开；其余页面保持 90 秒，卡住时早点变红
const axeTimeout = (path: string) =>
  path === "/teams/ferrari" ? 180_000 : 90_000;

for (const path of mobilePages) {
  test(`@mobile ${path} has no axe violations`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(path);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(
      violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      ),
    ).toEqual([]);
  });
}

for (const scheme of ["dark", "light"] as const) {
  test.describe(`a11y (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    for (const path of pages) {
      test(`@desktop ${path} has no axe violations`, async ({ page }) => {
        test.setTimeout(axeTimeout(path));
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
