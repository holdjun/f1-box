# CSS 现代化（Tailwind v4 + 双主题 + 视觉刷新）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Tailwind CSS v4 重建样式架构（双层令牌 + 深色/亮色双主题 + 主题切换），删除全部死样式，升级 Astro 至最新稳定版，并把视觉观感刷新到现代水准。

**Architecture:** 令牌单源在 `styles/theme.css`（`@theme` 原始层 + `:root`/`[data-theme]` 语义层 + `@theme inline` 桥接）；`styles/base.css` 承载元素级基础样式（`@layer base`）；`styles/components.css` 承载高频组件类（`@layer components`）。迁移期间旧 `global.css` 以未分层样式临时共存（未迁移区域继续生效），逐区域删除，最后整文件移除。主题切换靠 `html[data-theme]` 翻转语义变量，`<head>` 内联脚本防闪烁。

**Tech Stack:** Astro 7.2.4、@astrojs/cloudflare 14.2.3、tailwindcss 4.3.3、@tailwindcss/vite 4.3.3、Playwright e2e、VLM 网关截图审阅。

**Spec:** `docs/requirements/2026-08-23-css-modernization.md`

## Global Constraints

- 版本锁定：astro@7.2.4、@astrojs/cloudflare@14.2.3、tailwindcss@4.3.3、@tailwindcss/vite@4.3.3；Node >= 22.12，pnpm 11.9.0。
- 以下类名是 e2e 钩子，迁移时必须保留在标记上（样式可完全换成工具类）：`race-card`、`season-filter`、`season-filter__summary`、`season-filter__panel`、`ask__panel`、`ask__trigger`、`ask__bubble`、`ask__bubble--assistant`、`ask__messages`、`ask__input`、`ask__send`、`ask__stop`、`ask__clear`、`ask__close`、`ask__error`、`ask__status`、`driver-card`、`driver-bio`、`driver-cell`、`driver-champion`、`driver-country`、`driver-link`、`driver-number`、`team-card`、`team-chip`、`team-logo`、`team-logo-frame`、`team-split`、`circuit-card`、`circuit-hero__map`、`circuit-hero__length`、`circuit-map`、`circuit-map__corner`、`circuit-map__sector`、`circuit-stats`、`card-flag`、`card-logo`、`card-logo-frame`、`card-monogram`、`card-name`、`card-number`、`number-chip`、`champion`、`result-podium`、`result-points`、`season-block`、`season-year`、`season-gap`、`sup-f`、`sup-sprint`、`tyre-`（前缀类）、`weekend-schedule`、`race-hero__map`、`race-hero__circuit-link`、`history-end__back`、`history-end__summary`。另外 e2e 断言 `.year-selector` 数量为 0，不得引入该类名。
- 组件与页面只消费语义令牌（`bg-surface`、`text-ink-muted`、`border-line` 等），禁止硬编码颜色（`currentColor` 与 SVG 描边除外）。
- 视觉刷新方向（保留设计基因）：深色为品牌底色；卡片/面板圆角统一 `rounded-md`（6px），按钮保留切角 `clip-path` 身份；亮色主题用暖纸底色 + 加深珊瑚/橄榄强调色 + 轻阴影（`light:shadow-panel`）；保留 180ms 过渡与 `prefers-reduced-motion` 处理；正文对比度两主题都达 WCAG AA。
- 验证命令（每个任务结束必须全绿）：`pnpm check`、`pnpm test`、`pnpm -r build`、`pnpm --filter @f1-box/web test:e2e`。
- 提交：Conventional Commits 英文祈使句 ≤72 字符；`git add` 具体文件；注释只解释"为什么"；死代码当场删除。
- 分支：已在 `feat/css-modernization`，不另建分支；一个任务一个提交。
- 截图审阅流程（每个任务的评审检查点）：本地 `pnpm --filter @f1-box/web dev` 起站，用 Playwright 对页面清单在 1280×800 与 375×812、`data-theme=dark`/`light` 四种组合截图，经 VLM 网关（配置见 `.env.example` 的 `VLM_*`）审阅；重点看布局破坏、文字对比度、主题一致性。

## 现状事实（执行者必读）

- 首页 `/` 重定向到 `/racing/{activeSeason}`；`pages/racing/[year].astro` 是事实上的首页（标题 + SeasonFilter + race-grid）。
- global.css 中以下区块已无使用者，属于死代码，任务 1 直接删除：`.next-race-hero*`、`.giant-round`（仅 RaceHeader 用，保留）、`.countdown*`、`.countdown-passed`、`.session-list*`、`.hero-enter*` + keyframes、`.section-heading*`、`.section-count`、`.latest-section*`、`.podium*`、`.standings-preview`、`.standings-panel`、`.source-strip`、`.page-hero*`、`.breadcrumbs*`、`.text-link`、`.empty-state`、`.season-rail*`（含 `.race-card` 之外的 rail 布局）。
- `scripts/client.ts` 中 `enhanceCountdowns` 与 `enhanceRails` 无标记使用者（`[data-countdown]`、`.season-rail` 均不存在于任何页面），任务 5 删除。
- `client.ts` 的 season-filter 逻辑操作 `is-active` 类与 `aria-pressed`，迁移 SeasonFilter 时样式必须兼容这两个状态钩子。
- 现有断点语义：980px 与 640px（桌面优先写法）。迁移后统一为移动优先：`md` = 40rem（640px）、`lg` = 61.25rem（980px）。

## 目标文件结构

- `apps/web/astro.config.mjs` — 注册 `@tailwindcss/vite`
- `apps/web/src/styles/theme.css` — `@import "tailwindcss"` + 原始令牌 + 语义变量 + `@theme inline` 桥接 + `light:` 变体（样式系统单源）
- `apps/web/src/styles/base.css` — `@layer base`：元素级样式、网格背景、焦点环、选区、跳转链接、视图过渡、减少动效
- `apps/web/src/styles/components.css` — `@layer components`：`.shell`、`.title-page`、`.button*`、`.freshness-badge*`、`.status-label*`、`.table-scroll`、`.empty-cell`、表格基础、`.info-panel*`、`.vendor-cell*`
- `apps/web/src/styles/global.css` — 迁移期残留，任务 5 删除
- `apps/web/src/layouts/BaseLayout.astro` — 样式入口、防闪烁脚本、`theme-color`
- `apps/web/src/components/SiteHeader.astro` — 含主题切换按钮
- `apps/web/src/scripts/client.ts` — `enhanceThemeToggles`（任务 5 删死函数）
- `apps/web/tests/e2e/theme.spec.ts` — 主题行为测试

---

### Task 1: 基建 — 依赖升级、令牌体系、主题机制、布局框架

**Files:**
- Modify: `pnpm-workspace.yaml`（minimumReleaseAgeExclude 版本号）
- Modify: `apps/web/package.json`（依赖版本）
- Modify: `apps/web/astro.config.mjs`
- Create: `apps/web/src/styles/theme.css`、`apps/web/src/styles/base.css`、`apps/web/src/styles/components.css`
- Modify: `apps/web/src/styles/global.css`（删元素级与死区块）
- Create: `apps/web/tests/e2e/theme.spec.ts`
- Modify: `apps/web/src/layouts/BaseLayout.astro`、`apps/web/src/components/SiteHeader.astro`、`apps/web/src/components/SiteFooter.astro`、`apps/web/src/components/FreshnessBadge.astro`、`apps/web/src/components/StatusPage.astro`
- Modify: `apps/web/src/scripts/client.ts`

**Interfaces:**
- Produces（后续任务依赖）：语义工具类 `bg-surface`、`bg-surface-raised`、`bg-surface-overlay`、`bg-surface-sunken`、`text-ink`、`text-ink-strong`、`text-ink-muted`、`border-line`、`text-accent`、`bg-accent`、`text-on-accent`、`text-highlight`、`bg-highlight`、`text-on-highlight`；字体 `font-display`；字号 `text-display-sm/md/lg/xl`；间距 `mt-section` 等（`--spacing-section`）；变体 `light:`、`md:`（≥40rem）、`lg:`（≥61.25rem）；组件类 `.shell`、`.title-page`、`.button`、`.button--primary`、`.button--text`、`.freshness-badge(--fresh/--delayed/--stale/--unavailable)`、`.status-label(--accent)`、`.table-scroll`、`.empty-cell`、`.info-panels`、`.info-panel`、`.vendor-cell*`；DOM 钩子 `html[data-theme]`、`[data-theme-toggle]`、localStorage 键 `f1-theme`。

- [ ] **Step 1: 升级 Astro 与适配器**

修改 `pnpm-workspace.yaml`，把 minimumReleaseAgeExclude 条目换成新版本：

```yaml
minimumReleaseAgeExclude:
  - '@astrojs/cloudflare@14.2.3'
  - astro@7.2.4
```

修改 `apps/web/package.json`：`@astrojs/cloudflare` → `14.2.3`，`astro` → `7.2.4`。

- [ ] **Step 2: 安装并验证升级**

Run: `cd /Users/hj/workspace/f1-box && pnpm install && pnpm check && pnpm test && pnpm -r build`
Expected: 全绿。升级出问题先修升级，不带入后续改动。

- [ ] **Step 3: 安装 Tailwind 并注册插件**

Run: `cd /Users/hj/workspace/f1-box/apps/web && pnpm add -D tailwindcss@4.3.3 @tailwindcss/vite@4.3.3`

`apps/web/astro.config.mjs` 改为：

```js
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare({
    imageService: "passthrough",
    configPath: process.env.F1BOX_WRANGLER_CONFIG,
  }),
});
```

- [ ] **Step 4: 写失败的主题行为 e2e**

创建 `apps/web/tests/e2e/theme.spec.ts`：

```ts
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
```

- [ ] **Step 5: 运行确认失败**

Run: `cd /Users/hj/workspace/f1-box/apps/web && pnpm test:e2e -- theme.spec.ts`
Expected: FAIL（`data-theme-toggle` 按钮不存在 / `data-theme` 未设置）。dev server 可用 `ASTRO_DEV_BACKGROUND=0` 提前起好避免重复等待。

- [ ] **Step 6: 创建 styles/theme.css（令牌单源）**

```css
@import "tailwindcss";

/* 原始令牌：静态定义，两主题共用；组件不直接使用这里的颜色 */
@theme {
  --font-display: "Barlow Condensed", "Arial Narrow", sans-serif;
  --font-sans: "Space Grotesk Variable", "Space Grotesk", sans-serif;

  /* 只保留两个断点：对齐现有 640/980 语义，移动优先 */
  --breakpoint-sm: initial;
  --breakpoint-md: 40rem;
  --breakpoint-lg: 61.25rem;
  --breakpoint-xl: initial;
  --breakpoint-2xl: initial;

  /* 展示字号（流体），行高随字号定义 */
  --text-display-sm: clamp(2.3rem, 3.5vw, 3.75rem);
  --text-display-sm--line-height: 0.96;
  --text-display-md: clamp(3.25rem, 6vw, 5.5rem);
  --text-display-md--line-height: 0.96;
  --text-display-lg: clamp(4.5rem, 9vw, 8.5rem);
  --text-display-lg--line-height: 0.92;
  --text-display-xl: clamp(5rem, 10vw, 10.5rem);
  --text-display-xl--line-height: 0.9;

  /* 区块级留白 */
  --spacing-section: clamp(4.75rem, 9vw, 9rem);

  --ease-hero: cubic-bezier(0.2, 0.75, 0.25, 1);
  --shadow-panel: 0 1px 2px rgb(20 23 28 / 0.05), 0 10px 28px rgb(20 23 28 / 0.08);
}

/* 语义令牌：深色为默认值，[data-theme="light"] 整套翻转 */
:root {
  color-scheme: dark;
  --surface: #0b0d10;
  --surface-raised: #11151a;
  --surface-overlay: #191e24;
  --surface-sunken: #080a0c;
  --grid-line: rgb(137 145 154 / 0.055);
  --ink: #f3f0e9;
  --ink-strong: #b9bec4;
  --ink-muted: #89919a;
  --line: #2a3037;
  --accent: #ff5148;
  --on-accent: #0b0d10;
  --highlight: #c7f45b;
  --on-highlight: #0b0d10;
}

[data-theme="light"] {
  color-scheme: light;
  --surface: #f3f0e9;
  --surface-raised: #fbfaf5;
  --surface-overlay: #e9e5da;
  --surface-sunken: #e4dfd2;
  --grid-line: rgb(20 23 28 / 0.05);
  --ink: #14171c;
  --ink-strong: #3c434c;
  --ink-muted: #5d646e;
  --line: #d0cbbe;
  --accent: #c33329;
  --on-accent: #fdf9f3;
  --highlight: #4d5d10;
  --on-highlight: #f7f5ee;
}

/* 桥接：让语义变量生成工具类（bg-surface / text-ink-muted / border-line ...） */
@theme inline {
  --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised);
  --color-surface-overlay: var(--surface-overlay);
  --color-surface-sunken: var(--surface-sunken);
  --color-ink: var(--ink);
  --color-ink-strong: var(--ink-strong);
  --color-ink-muted: var(--ink-muted);
  --color-line: var(--line);
  --color-accent: var(--accent);
  --color-on-accent: var(--on-accent);
  --color-highlight: var(--highlight);
  --color-on-highlight: var(--on-highlight);
}

/* 少数无法靠变量翻转覆盖的场景（阴影、图片明暗）用 light: 变体 */
@custom-variant light (&:where([data-theme="light"], [data-theme="light"] *));
```

- [ ] **Step 7: 创建 styles/base.css**

```css
/* 元素级基础样式：放 @layer base，保证工具类可以覆盖 */
@layer base {
  html {
    min-width: 320px;
    background: var(--surface);
    scroll-behavior: smooth;
  }

  body {
    min-width: 320px;
    overflow-x: hidden;
    background:
      linear-gradient(var(--grid-line) 1px, transparent 1px),
      linear-gradient(90deg, var(--grid-line) 1px, transparent 1px),
      var(--surface);
    background-size: 48px 48px;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    text-rendering: optimizeLegibility;
  }

  @media (width < 40rem) {
    body { background-size: 32px 32px; }
  }

  /* 斜向珊瑚扫描线：品牌装饰，两主题通用 */
  body::before {
    position: fixed;
    inset: 0;
    z-index: -1;
    background: linear-gradient(
      115deg,
      transparent 0 69%,
      color-mix(in oklab, var(--accent) 3%, transparent) 69% 70%,
      transparent 70%
    );
    content: "";
    pointer-events: none;
  }

  h1, h2, h3, p, ol, dl, dd { margin: 0; }

  h1, h2, h3 {
    font-family: var(--font-display);
    font-weight: 600;
    line-height: 0.96;
  }

  a { color: inherit; text-decoration: none; }

  a:focus-visible,
  button:focus-visible,
  [tabindex="0"]:focus-visible {
    outline: 3px solid var(--highlight);
    outline-offset: 4px;
  }

  svg { display: block; }
  [hidden] { display: none !important; }

  ::selection { background: var(--highlight); color: var(--on-highlight); }

  .skip-link {
    position: fixed;
    top: 0.75rem;
    left: 0.75rem;
    z-index: 100;
    padding: 0.75rem 1rem;
    transform: translateY(-160%);
    background: var(--highlight);
    color: var(--on-highlight);
    font-weight: 700;
  }
  .skip-link:focus { transform: translateY(0); }
}

/* 主题切换按钮图标：深色下显示"去亮色"图标，反之亦然 */
[data-theme-toggle] .icon-to-light { display: block; }
[data-theme-toggle] .icon-to-dark { display: none; }
[data-theme="light"] [data-theme-toggle] .icon-to-light { display: none; }
[data-theme="light"] [data-theme-toggle] .icon-to-dark { display: block; }

/* 视图过渡与减少动效：保持现有行为 */
::view-transition-old(root) { animation: page-out 160ms ease both; }
::view-transition-new(root) { animation: page-in 240ms ease both; }

@keyframes page-out { to { opacity: 0; transform: translateX(-8px); } }
@keyframes page-in { from { opacity: 0; transform: translateX(8px); } }

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
  ::view-transition-old(root), ::view-transition-new(root) {
    animation-name: none !important;
  }
}
```

- [ ] **Step 8: 创建 styles/components.css**

```css
@layer components {
  /* 页面外壳：替代旧 .page-shell，留白随断点递增 */
  .shell {
    width: min(100% - 2rem, 1440px);
    margin-inline: auto;
  }
  @media (min-width: 40rem) {
    .shell { width: min(100% - 3rem, 1440px); }
  }
  @media (min-width: 61.25rem) {
    .shell { width: min(100% - 6rem, 1440px); }
  }

  /* 页面级大标题：所有列表/枢纽页的 h1 统一用 */
  .title-page {
    font-size: var(--text-display-md);
    line-height: 0.96;
    letter-spacing: -0.03em;
    text-transform: uppercase;
  }

  .button {
    display: inline-flex;
    min-height: 48px;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    padding: 0.8rem 1.2rem;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    transition: color 180ms ease, background-color 180ms ease, transform 180ms ease;
  }
  .button svg {
    width: 28px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: square;
    stroke-linejoin: miter;
    stroke-width: 1.5;
  }
  .button--primary {
    background: var(--accent);
    color: var(--on-accent);
    clip-path: polygon(0 0, calc(100% - 13px) 0, 100% 13px, 100% 100%, 0 100%);
  }
  .button--primary:hover {
    background: var(--highlight);
    color: var(--on-highlight);
    transform: translateY(-2px);
  }
  .button--text {
    border-bottom: 1px solid var(--ink-muted);
    color: var(--ink);
  }
  .button--text:hover { border-color: var(--highlight); color: var(--highlight); }

  .freshness-badge {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    gap: 0.5rem;
    color: var(--ink-strong);
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .freshness-badge > span {
    width: 7px;
    height: 7px;
    background: var(--ink-muted);
    transform: rotate(45deg);
  }
  .freshness-badge--fresh > span { background: var(--highlight); }
  .freshness-badge--delayed > span,
  .freshness-badge--stale > span,
  .freshness-badge--unavailable > span { background: var(--accent); }

  .status-label {
    display: inline-flex;
    align-items: center;
    color: var(--ink-strong);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }
  .status-label--accent { color: var(--accent); }

  .table-scroll {
    max-width: 100%;
    overflow-x: auto;
    scrollbar-color: var(--accent) var(--line);
    scrollbar-width: thin;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
    text-align: left;
  }
  thead {
    color: var(--ink-muted);
    font-size: 0.64rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  th, td {
    padding: 0.95rem 0.75rem;
    border-bottom: 1px solid var(--line);
    font-weight: 450;
    white-space: nowrap;
  }
  th:first-child, td:first-child { padding-left: 0; }
  th:last-child, td:last-child { padding-right: 0; text-align: right; }
  tbody tr { transition: background-color 160ms ease; }
  tbody tr:hover { background: color-mix(in oklab, var(--ink-muted) 8%, transparent); }
  tbody th[scope="row"] {
    position: relative;
    min-width: 12rem;
    color: var(--ink);
    font-weight: 560;
  }

  .empty-cell {
    height: 8rem;
    color: var(--ink-muted);
    text-align: center !important;
    white-space: normal;
  }

  /* 信息面板：车队/车手/赛道详情的统计卡 */
  .info-panels {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
    margin-top: 1.75rem;
  }
  .info-panel {
    flex: 1 1 18rem;
    padding: 1.1rem 1.35rem 1.35rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface-raised);
  }
  .info-panel h2 {
    margin: 0 0 0.9rem;
    font-family: var(--font-display);
    font-size: 1.05rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .info-panel h2::before {
    display: inline-block;
    width: 0.55rem;
    height: 0.55rem;
    margin-right: 0.5rem;
    background: var(--accent);
    content: "";
  }
  .info-panel h3 {
    margin: 1rem 0 0.45rem;
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }
  .info-panel dl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    gap: 0.7rem 1rem;
    margin: 0;
  }
  .info-panel dt { font-size: 0.68rem; color: var(--ink-muted); }
  .info-panel dd { margin: 0; font-size: 1rem; font-weight: 600; }

  /* 厂商/车手单元格：旗帜、logo、monogram 组合 */
  .vendor-cell {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  a.vendor-cell:hover { color: var(--accent); }
  .vendor-cell__flag {
    width: 1.25rem;
    height: 0.875rem;
    object-fit: contain;
    flex: none;
  }
  .vendor-cell__monogram {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    flex: none;
    background: var(--monogram-bg, #84909e);
    color: var(--surface);
    font-family: var(--font-display);
    font-size: 0.6rem;
    font-weight: 700;
  }
  .vendor-cell__logo { height: 1.1rem; width: auto; flex: none; }
  .vendor-cell small {
    color: var(--ink-muted);
    font-size: 0.65rem;
    letter-spacing: 0.08em;
  }
  @media (width < 40rem) {
    .vendor-cell--driver .vendor-cell__name { display: none; }
  }
}
```

注意：`--monogram-bg` 是标记内联传入的车队色，保持现状；`vendor-cell__monogram` 的文字色从 `--paper` 改为 `var(--surface)`，语义等价且随主题翻转。

- [ ] **Step 9: 清理 global.css（只留未迁移的组件区块）**

从 `styles/global.css` 删除：`:root` 变量块、`*`/`html`/`body`/`body::before`/`::selection`/标题与链接重置/`a,button` outline/`svg`/`[hidden]`、`.page-shell`、`.skip-link`、`.muted`（RaceHeader 用到的 `muted` 类在任务 3 换成 `text-ink-muted`，删之前先确认无引用：`grep -rn '"muted"\|muted ' src --include="*.astro"`）、`.site-header*`、`.wordmark`、`.freshness-badge*`、`.button*`、`.site-footer*`、`.status-page*`、`.table-scroll`、`table`/`thead`/`th,td`/`tbody *`、`.empty-cell`/`.empty-state`、`.info-panel*`、`.vendor-cell*`、`::view-transition*` + keyframes、`prefers-reduced-motion` 块，以及"现状事实"一节列出的全部死区块。

随后对剩余规则做机械变量改名（旧 `:root` 已删，旧变量名必须映射到新语义令牌，否则残留区域样式全部失效；注意旧 `--ink` 是背景色、新 `--ink` 是文字色，方向相反，逐个替换不能混）：

| 旧引用 | 新引用 |
| --- | --- |
| `var(--ink)` | `var(--surface)` |
| `var(--ink-soft)` | `var(--surface-raised)` |
| `var(--paper)` | `var(--ink)` |
| `var(--muted-light)` | `var(--ink-strong)` |
| `var(--muted)` | `var(--ink-muted)` |
| `var(--coral)` | `var(--accent)` |
| `var(--acid)` | `var(--highlight)` |
| `var(--display)` | `var(--font-display)` |
| `var(--body)` | `var(--font-sans)` |
| `#191e24`（race-card hover） | `var(--surface-overlay)` |

`var(--line)` 名称不变（新令牌深色值相同）；`var(--line-light)` 只出现在死区块里，随死区块删除。改完后 `grep -n "var(--ink-soft\|var(--paper\|var(--muted\|var(--coral\|var(--acid\|var(--display)\|var(--body)" styles/global.css` 必须为空。

剩余内容应只有：`.status-label*`、`.muted`、`.race-card*`、`.race-grid`、`.race-hero*`、`.giant-round`、`.weekend-schedule*`、`.session-index`、`.result-table`、`.position-cell`、`.points-cell` 及未迁移区域的媒体查询（`.position-cell`/`.points-cell` 任务 3 迁移时再删）。删除后跑一次 `pnpm --filter @f1-box/web build` 确认无语法错误。

- [ ] **Step 10: BaseLayout — 样式入口与防闪烁脚本**

`layouts/BaseLayout.astro` frontmatter 中把 `import "../styles/global.css";` 替换为（顺序敏感：新系统在前，遗留全局样式在后保护未迁移区域）：

```ts
import "../styles/theme.css";
import "../styles/base.css";
import "../styles/components.css";
import "../styles/global.css"; // 迁移期临时保留，任务 5 删除
```

`<head>` 内、`<title>` 之前插入防闪烁脚本（必须在样式生效前设置 data-theme）：

```html
<script is:inline>
  // 首次渲染前定主题，避免闪烁：本地偏好 > 系统偏好 > 深色
  (() => {
    let theme = "dark";
    try {
      const stored = localStorage.getItem("f1-theme");
      if (stored === "light" || stored === "dark") theme = stored;
      else if (matchMedia("(prefers-color-scheme: light)").matches) theme = "light";
    } catch {}
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "light" ? "#f3f0e9" : "#0b0d10");
  })();
</script>
```

- [ ] **Step 11: client.ts — 主题切换增强**

在 `scripts/client.ts` 添加（放在 `enhancePage` 附近，风格对齐现有增强函数）：

```ts
const THEME_COLORS = { dark: "#0b0d10", light: "#f3f0e9" } as const;

function enhanceThemeToggles(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]").forEach((button) => {
    if (button.dataset.enhanced === "true") return;
    button.dataset.enhanced = "true";

    const sync = () => {
      const isLight = document.documentElement.dataset.theme === "light";
      button.setAttribute("aria-pressed", String(isLight));
      button.setAttribute(
        "aria-label",
        isLight ? "Switch to dark theme" : "Switch to light theme",
      );
    };

    button.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("f1-theme", next);
      } catch {
        // 隐私模式等场景写不进，主题仍在当次会话生效
      }
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", THEME_COLORS[next]);
      sync();
    });

    sync();
  });
}
```

并在 `enhancePage()` 第一行调用 `enhanceThemeToggles();`。

- [ ] **Step 12: SiteHeader 重写（含切换按钮）**

整文件替换为（导航链接保留现有 `href`/`aria-current` 逻辑；`lg:` 对应旧桌面样式，基础为移动样式）：

```astro
---
interface Props {
  active?: "racing" | "results" | "circuits" | "drivers" | "teams";
  year?: number;
}

const { active = "racing", year } = Astro.props;

const links = [
  { key: "racing", label: "Racing", href: year ? `/racing/${year}` : "/" },
  { key: "results", label: "Results", href: year ? `/results/${year}/races` : "/results" },
  { key: "circuits", label: "Circuits", href: "/circuits" },
  { key: "drivers", label: "Drivers", href: "/drivers" },
  { key: "teams", label: "Teams", href: "/teams" },
] as const;
---

<header class="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur-sm">
  <div class="shell flex min-h-16 items-center justify-between gap-4 lg:min-h-18">
    <a
      class="flex min-h-11 shrink-0 items-center gap-1.5 font-display text-[1.35rem] font-semibold tracking-[0.02em] uppercase lg:text-[1.65rem]"
      href="/"
      aria-label="F1 Box home"
    >
      <span class="text-accent">F1</span> Box
    </a>
    <div class="flex min-w-0 items-center gap-3 lg:gap-6">
      <nav aria-label="Primary navigation" class="flex min-w-0 items-center gap-3 overflow-x-auto lg:gap-10">
        {links.map((link) => (
          <a
            href={link.href}
            aria-current={active === link.key ? "page" : undefined}
            class="relative inline-flex min-h-11 shrink-0 items-center text-[0.64rem] font-semibold tracking-[0.07em] uppercase text-ink-strong transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-200 hover:text-ink hover:after:scale-x-100 aria-[current=page]:text-ink aria-[current=page]:after:scale-x-100 lg:text-[0.78rem] lg:tracking-[0.11em]"
          >{link.label}</a>
        ))}
      </nav>
      <button
        type="button"
        data-theme-toggle
        aria-pressed="false"
        aria-label="Switch to light theme"
        class="grid size-10 shrink-0 place-items-center rounded-md border border-line text-ink-strong transition-colors hover:border-ink-muted hover:text-ink"
      >
        <svg class="icon-to-light size-4.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="8" cy="8" r="3.25" />
          <path d="M8 1.5v1.75M8 12.75v1.75M1.5 8h1.75M12.75 8h1.75M3.4 3.4l1.25 1.25M11.35 11.35l1.25 1.25M12.6 3.4l-1.25 1.25M4.65 11.35l-1.25 1.25" />
        </svg>
        <svg class="icon-to-dark size-4.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
        </svg>
      </button>
    </div>
  </div>
</header>
```

- [ ] **Step 13: SiteFooter / FreshnessBadge / StatusPage 重写**

SiteFooter（语义类换工具类，`.site-footer__inner` 布局用 flex）：

```astro
---
import FreshnessBadge from "./FreshnessBadge.astro";
import { formatUtcDateTime } from "../lib/time.js";

interface Props {
  season?: number;
  sourceName?: string;
  fetchedAt?: string;
  freshness?: "fresh" | "delayed" | "stale" | "unavailable";
}

const { season, sourceName, fetchedAt, freshness } = Astro.props;
---

<footer class="border-t border-line bg-surface-sunken py-12">
  <div class="shell flex flex-col items-start justify-between gap-8 text-[0.76rem] text-ink-strong md:flex-row">
    {season !== undefined ? (
      <p class="font-display text-2xl text-ink uppercase">{season} season data</p>
    ) : null}
    {sourceName && fetchedAt ? (
      <div class="grid justify-items-start gap-0.5 md:justify-items-end">
        {freshness && <FreshnessBadge freshness={freshness} />}
        <p>Source: <span>{sourceName}</span></p>
        <p>Fetched {formatUtcDateTime(fetchedAt)}</p>
      </div>
    ) : null}
  </div>
</footer>
```

FreshnessBadge：标记不变（`.freshness-badge` 类族已在 components.css 重建），无需改动。

StatusPage：

```astro
---
interface Props {
  code: string;
  title: string;
  message: string;
}

const { code, title, message } = Astro.props;
---

<main class="shell grid min-h-[calc(100svh-4rem)] grid-cols-1 content-center items-center gap-12 py-20 md:grid-cols-[5fr_7fr]">
  <p
    class="font-display text-[clamp(12rem,28vw,27rem)] leading-[0.7] font-bold text-transparent [-webkit-text-stroke:1px] [-webkit-text-stroke-color:var(--line)] max-md:text-[12rem]"
    aria-hidden="true"
  >{code}</p>
  <div>
    <h1 class="text-display-lg">{title}</h1>
    <p class="mt-6 mb-10 max-w-[35rem] text-ink-strong">{message}</p>
    <a class="button button--primary" href="/">Return home</a>
  </div>
</main>
```

- [ ] **Step 14: 运行全部验证**

Run: `cd /Users/hj/workspace/f1-box && pnpm check && pnpm test && pnpm -r build && pnpm --filter @f1-box/web test:e2e`
Expected: 全绿，theme.spec.ts 由红转绿；既有 6 个 spec 无回归。

- [ ] **Step 15: 截图审阅（自检）**

起 dev，对 `/racing/2026` 与 `/404 路径（访问 /racing/1900）` 做 桌面+375 × 深色+亮色 截图自查：头部/页脚布局、切换按钮可达、无水平滚动条、对比度正常。

- [ ] **Step 16: Commit**

```bash
git add pnpm-workspace.yaml apps/web/package.json pnpm-lock.yaml apps/web/astro.config.mjs apps/web/src/styles apps/web/src/layouts/BaseLayout.astro apps/web/src/components/SiteHeader.astro apps/web/src/components/SiteFooter.astro apps/web/src/components/StatusPage.astro apps/web/src/scripts/client.ts apps/web/tests/e2e/theme.spec.ts
git commit -m "feat: add tailwind design system with dual theme support"
```

**评审检查点：** 编排者派独立 review agent 做代码评审 + 截图审阅（范围：头部/页脚/404 × 双主题双视口），通过后才进入任务 2。

---

### Task 2: 首页区域 — racing 页、RaceCard、SeasonFilter

**Files:**
- Modify: `apps/web/src/pages/racing/[year].astro`
- Modify: `apps/web/src/components/RaceCard.astro`
- Modify: `apps/web/src/components/SeasonFilter.astro`
- Modify: `apps/web/src/styles/global.css`（删除已迁移区块）

**Interfaces:**
- Consumes: 任务 1 的全部令牌/工具类与 `.shell`、`.title-page`、`.status-label`。
- Produces: SeasonFilter 完成迁移（后续区域直接使用，不再动）。

- [ ] **Step 1: RaceCard 重写**

整文件替换为（保留 `race-card` e2e 钩子类；完成/未完的顶部色条用 `box-shadow inset`；切角三角保留）：

```astro
---
import type { RaceSummary } from "../lib/race-results-repository.js";
import { formatUtcDateTime } from "../lib/time.js";

interface Props {
  race: RaceSummary;
  href: string;
}

const { race, href } = Astro.props;
const round = String(race.round).padStart(2, "0");
const complete = race.winnerName !== null;
const startsAt = `${race.date}T${race.time ?? "00:00"}:00Z`;
---

<article
  class:list={[
    "race-card min-w-0 bg-surface scroll-snap-start",
    complete ? "[box-shadow:inset_0_3px_var(--highlight)]" : "[box-shadow:inset_0_3px_var(--ink-muted)]",
  ]}
>
  <a
    href={href}
    aria-label={`Round ${round}: ${race.raceName}`}
    class="group relative flex min-h-64 flex-col justify-between overflow-hidden rounded-md bg-surface-raised p-5 transition-[background-color,transform] duration-200 before:absolute before:top-0 before:right-0 before:size-6.5 before:bg-surface before:[clip-path:polygon(100%_0,100%_100%,0_0)] hover:-translate-y-1 hover:bg-surface-overlay hover:z-1 focus-visible:z-1 focus-visible:bg-surface-overlay md:min-h-68"
  >
    <div class="flex items-start justify-between">
      <span class="font-display text-[4.75rem] leading-[0.75] font-medium text-ink-muted" aria-hidden="true">{round}</span>
      <span class="status-label">{complete ? "COMPLETE" : "UPCOMING"}</span>
    </div>
    <div class="pr-6">
      <h3 class="mb-3 text-2xl">{race.raceName}</h3>
      <time class="text-[0.76rem] text-ink" datetime={startsAt}>{formatUtcDateTime(startsAt)}</time>
      <p class="mt-1.5 text-[0.78rem] text-ink-muted">{race.circuitPlace}, {race.countryName}</p>
      <p class="min-h-[2.4em] text-[0.78rem] text-ink-muted">{race.circuitName}</p>
      {complete && (
        <dl class="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4">
          <div>
            <dt class="text-[0.65rem] tracking-[0.08em] uppercase text-ink-muted">Pole</dt>
            <dd class="mt-1 text-[0.78rem]">{race.poleName ?? "—"}</dd>
          </div>
          <div>
            <dt class="text-[0.65rem] tracking-[0.08em] uppercase text-ink-muted">Winner</dt>
            <dd class="mt-1 text-[0.78rem]">{race.winnerName}</dd>
          </div>
        </dl>
      )}
    </div>
    <svg class="absolute right-5 bottom-6 w-7 text-accent" viewBox="0 0 28 16" fill="none" stroke="currentColor" stroke-linecap="square" stroke-width="1.5" aria-hidden="true">
      <path d="M1 8h24M18 1l7 7-7 7" />
    </svg>
  </a>
</article>
```

- [ ] **Step 2: racing/[year].astro 重写**

标记部分替换为（数据区不变）：

```astro
<BaseLayout title={`${year} Season`} year={year}>
  <main id="main-content" class="shell pt-12 pb-section md:pt-16">
    <h1 class="title-page">{year} Season</h1>
    <SeasonFilter
      years={availableYears}
      mode="link"
      current={year}
      hrefFor={(y) => `/racing/${y}`}
      sticky
      showAll={false}
    />
    <div class="grid grid-cols-1 gap-px rounded-md bg-line md:grid-cols-2">
      {races.map((race) => (
        <RaceCard race={race} href={`/results/${year}/races/${race.slug}/race-result`} />
      ))}
    </div>
  </main>
</BaseLayout>
```

- [ ] **Step 3: SeasonFilter 重写**

读 `components/SeasonFilter.astro` 现有 303 行（含 150 行 scoped style），按以下规则重写样式，标记结构与 props/事件钩子保持不变：

- 保留类名钩子：`season-filter`、`season-filter__summary`、`season-filter__panel`、`season-year`、`is-active`（client.ts 会切换）。
- 触发器（`[data-season-filter-trigger]`）：`inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface-raised px-4 text-[0.72rem] font-semibold tracking-[0.09em] uppercase text-ink-strong hover:border-ink-muted hover:text-ink transition-colors`；粘性模式保留原有 `sticky` 行为类。
- 面板：`absolute z-20 min-w-64 rounded-md border border-line bg-surface-raised p-3 shadow-panel`，向上展开的 `season-filter__panel--up` 定位逻辑保持（JS 会写 inline maxHeight，不要删）。
- 年份/年代按钮：基础 `rounded-sm px-2.5 py-1.5 text-[0.78rem] tabular-nums text-ink-muted transition-colors hover:bg-surface-overlay hover:text-ink`；`.is-active` 与 `[aria-pressed="true"]`：`bg-accent text-on-accent`（在组件 `<style>` 里写两条属性选择器规则即可，因为 `is-active` 由 JS 切换、无法用纯工具类表达）。
- "All" 按钮与计数行：同基础按钮样式 + `text-ink-strong`。
- scoped `<style>` 目标 ≤20 行，只留 `is-active`/`--up` 这类状态规则，其余全部工具类。

- [ ] **Step 4: 清理 global.css**

删除 `.race-card*`、`.race-grid` 区块及其媒体查询。确认 `.muted` 仍被 RaceHeader 使用后保留（任务 3 处理）。

- [ ] **Step 5: 验证**

Run: `pnpm check && pnpm test && pnpm -r build && pnpm --filter @f1-box/web test:e2e`
Expected: 全绿；`season.spec.ts` 中 `.race-card` 22 张、`.season-filter` 交互断言通过。

- [ ] **Step 6: 截图审阅（自检）+ Commit**

自查 `/racing/2026`（含切换亮色、375px 横滑卡片）后：

```bash
git add apps/web/src/pages/racing apps/web/src/components/RaceCard.astro apps/web/src/components/SeasonFilter.astro apps/web/src/styles/global.css
git commit -m "feat: migrate racing calendar to tailwind design system"
```

**评审检查点：** review agent 审阅 `/racing/2025`、`/racing/2026` × 双主题双视口（含 SeasonFilter 展开态截图），通过后进入任务 3。

---

### Task 3: results 区域 — 比赛详情、赛程表、成绩表、积分榜

**Files:**
- Modify: `apps/web/src/pages/results/[year]/drivers.astro`、`teams.astro`、`races/index.astro`、`races/[slug]/[tab].astro`、`index.astro`
- Modify: `apps/web/src/components/RaceHeader.astro`、`RaceTabsNav.astro`、`ResultsNav.astro`、`RaceTable.astro`、`StandingsTable.astro`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: 令牌体系、`.shell`、`.title-page`、`.table-scroll`、`.status-label`、`.vendor-cell*`、表格基础样式（均来自任务 1）。
- Produces: StandingsTable、ResultsNav 定型（任务 4/5 不再动）。

- [ ] **Step 1: RaceHeader 重写**

读现有 `RaceHeader.astro` 与 global.css 的 `.race-hero*`/`.giant-round`/`.weekend-schedule*`/`.session-index`/`.muted` 区块。改写规则：

- `<header>` 保留 `race-hero__map`、`race-hero__circuit-link` 钩子类；原 `page-shell` 换成 `.shell`；布局改相对定位容器：`relative min-h-[clamp(34rem,70vw,52rem)] overflow-hidden pb-20 pt-6 md:pt-8`。
- 地图链接：`absolute right-0 top-8 w-[clamp(14rem,24vw,22rem)] opacity-85 transition-opacity hover:opacity-100 max-md:static max-md:mx-auto max-md:mb-6 max-md:w-min(60%,13rem) max-md:opacity-100`。
- 巨型回合号（`.giant-round`）：`absolute -top-8 -left-[0.05em] font-display text-[clamp(13rem,29vw,17rem)] leading-[0.7] font-bold text-transparent [-webkit-text-stroke:1px] [-webkit-text-stroke-color:var(--line)] max-md:text-[17rem]`，用 `aria-hidden`。
- 标题区网格：`grid grid-cols-1 items-end gap-8 lg:grid-cols-[3fr_7fr]`；h1 `max-w-[10ch] text-display-xl`；`.muted` 段落改 `text-ink-muted`；`race-hero__circuit-link` 保留钩子类 + `underline decoration-line underline-offset-3 hover:decoration-current`。
- 赛程列表（`weekend-schedule` 钩子保留）：`list-none border-t border-line p-0`；每行 `grid min-h-28 grid-cols-[3rem_1fr] items-center gap-3 border-b border-line py-4 md:grid-cols-[6rem_1fr_auto] md:gap-6`；`.session-index`：`font-display text-2xl text-ink-muted md:text-[2.6rem]`；时间 `[data-local-time]`：`block text-[0.76rem] text-ink-muted`。
- `status-label--accent` 若此区域有用到保持组件类。

- [ ] **Step 2: RaceTabsNav / ResultsNav 重写**

两者各 30 行内，scoped style 只有 5 行：读现有标记，把样式换成工具类（标签导航：`flex gap-1 overflow-x-auto border-b border-line`，每个标签 `inline-flex min-h-11 items-center px-4 text-[0.72rem] font-semibold tracking-[0.1em] uppercase text-ink-muted transition-colors hover:text-ink aria-[current=page]:text-ink aria-[current=page]:[box-shadow:inset_0_-2px_var(--accent)]`）。scoped `<style>` 清零。

- [ ] **Step 3: RaceTable 重写**

读现有 277 行。规则：

- 外层容器加 `.table-scroll`；表格保留 `result-table` 语义（若无 e2e 依赖可省，检查后决定）与 `min-w-[52rem] md:min-w-[55rem]`。
- 移动端首列粘滞：在组件 `<style>` 保留一条媒体查询（工具类表达 `position:sticky` + 背景需要嵌套选择器，不值得硬凑）：

```css
@media (width < 40rem) {
  .result-table th:first-child,
  .result-table td:first-child {
    position: sticky;
    left: 0;
    z-index: 2;
    padding-left: 0.75rem;
    background: var(--surface);
  }
}
```

- `.position-cell` → 工具类：`w-14 font-display text-[1.35rem] text-ink-muted`；`.points-cell` → `font-semibold text-highlight`（旧为 `--acid`，语义即 highlight）。
- `.vendor-cell` 相关标记直接引用任务 1 的组件类，删掉本组件内的重复样式。
- `.sup-f`/`.sup-sprint`/`.tyre-*`/`.champion` 等 e2e 钩子类保留，样式用工具类重写（上标：`align-super text-[0.6em] text-ink-muted` 一类）。

- [ ] **Step 4: StandingsTable 重写**

66 行，读后按：外层 `.table-scroll`；`position-cell`/`points-cell` 同上；行内链接 `hover:text-accent transition-colors`。

- [ ] **Step 5: results 页面重写**

- `results/[year]/drivers.astro` 与 `teams.astro`：`<main class="shell pt-12 pb-section">` + `h1.title-page`（"2026 Drivers" 等）+ ResultsNav + SeasonFilter + `.table-scroll` 包 StandingsTable。
- `results/[year]/races/index.astro`：读现有 98 行，按卡片网格模式重写（`grid gap-px bg-line rounded-md md:grid-cols-2`），每站链接块参照 RaceCard 的视觉语言（表面色、悬停抬升），保留现有链接结构。
- `results/[year]/races/[slug]/[tab].astro`：`<main class="shell">` 内 RaceHeader + RaceTabsNav + RaceTable/StatusPage；页面级间距 `pt-6 pb-section`。
- `results/[year]/index.astro`、`results/index.astro`：重定向页不动逻辑，只确保不引用已删类。

- [ ] **Step 6: 清理 global.css**

删除 `.race-hero*`、`.giant-round`、`.weekend-schedule*`、`.session-index`、`.result-table`、`.position-cell`、`.points-cell`、`.status-label*`（已在 components.css）、`.muted` 及对应媒体查询。此时 global.css 应只剩目录/详情区域与 AskPanel 相关（若有）区块。

- [ ] **Step 7: 验证**

Run: `pnpm check && pnpm test && pnpm -r build && pnpm --filter @f1-box/web test:e2e`
Expected: 全绿，`results.spec.ts` 无回归。

- [ ] **Step 8: 截图审阅（自检）+ Commit**

自查 `/results/2026/races`、`/results/2026/races/australia/race-result`、`/results/2026/drivers` × 双主题双视口：

```bash
git add apps/web/src/pages/results apps/web/src/components/RaceHeader.astro apps/web/src/components/RaceTabsNav.astro apps/web/src/components/ResultsNav.astro apps/web/src/components/RaceTable.astro apps/web/src/components/StandingsTable.astro apps/web/src/styles/global.css
git commit -m "feat: migrate results pages to tailwind design system"
```

**评审检查点：** review agent 覆盖上述页面 + 移动端表格粘滞列 + 亮色主题对比度，通过后进入任务 4。

---

### Task 4: 目录与详情页 — drivers / teams / circuits

**Files:**
- Modify: `apps/web/src/pages/drivers/index.astro`、`drivers/[id].astro`、`teams/index.astro`、`teams/[slug].astro`、`circuits/index.astro`、`circuits/[id].astro`
- Modify: `apps/web/src/components/SeasonMatrix.astro`、`CurrentSeasonPanel.astro`、`HistoryEnd.astro`、`CircuitMap.astro`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: 令牌、`.shell`、`.title-page`、`.info-panels`/`.info-panel`、`.vendor-cell*`、SeasonFilter（任务 2 定型）。
- Produces: 全部目录/详情页定型。

- [ ] **Step 1: 三个目录页重写**

读 `drivers/index.astro`（155）、`teams/index.astro`（143）、`circuits/index.astro`（121）。共同规则：

- 骨架：`<main class="shell pt-12 pb-section">` + `h1.title-page` + SeasonFilter。
- 卡片网格：`grid grid-cols-1 gap-px rounded-md bg-line sm-无（只有 md）: md:grid-cols-2 lg:grid-cols-3`。
- 卡片（保留 `driver-card`/`team-card`/`circuit-card` 及 `card-*` 钩子类）：`group relative flex flex-col gap-3 rounded-md bg-surface-raised p-5 transition-[background-color,transform] duration-200 hover:-translate-y-1 hover:bg-surface-overlay hover:z-1`；`card-monogram`/`card-logo`/`card-flag` 保持现有尺寸语义，颜色一律令牌；`card-number` 用 `font-display text-ink-muted`；`champion`/`driver-champion` 徽标用 `text-highlight`。
- 亮色主题卡片加 `light:shadow-panel`（在网格容器层加，卡片本身不叠）。

- [ ] **Step 2: 详情页重写（drivers/[id]、teams/[slug]）**

读两页（333/337 行）。规则：

- 页头：`<main class="shell pt-12 pb-section">`；名字用 `text-display-lg uppercase`；副信息（国籍、号码、车队）用 `.vendor-cell` 组件类或简单 `text-ink-strong`。
- `.driver-bio` 钩子保留：`max-w-[46rem] text-[0.95rem] leading-relaxed text-ink-strong`。
- 统计区用 `.info-panels`/`.info-panel`（任务 1 已建，直接用，删页内重复样式）。
- HistoryEnd：`history-end__back`/`history-end__summary` 钩子保留，样式工具类（返回链接用 `.button--text` 语言：`border-b border-ink-muted text-[0.72rem] font-bold uppercase tracking-[0.08em] hover:text-highlight hover:border-highlight`）。

- [ ] **Step 3: SeasonMatrix 重写**

读 455 行（241 行 scoped）。这是最重的组件，规则：

- 钩子类全保留：`season-block`、`season-year`、`season-gap`、`result-podium`、`result-points`、`sup-f`、`sup-sprint`、`tyre-*`、`champion`。
- 表面：赛季块 `rounded-md border border-line bg-surface-raised p-5 light:shadow-panel`；块间距 `flex flex-col gap-6`。
- 领奖台行（`result-podium`）：`grid grid-cols-[3rem_1fr_auto] items-center gap-3 border-b border-line py-3 md:grid-cols-[4.5rem_1fr_auto]`；名次数字 `font-display text-[2rem] text-ink-muted md:text-[2.6rem]`；冠军行名次与积分 `text-accent`。
- 积分（`result-points`）：`font-semibold text-highlight tabular-nums`。
- scoped `<style>` 只保留无法工具类化的状态/伪元素规则，目标 ≤40 行。

- [ ] **Step 4: CurrentSeasonPanel / CircuitMap / circuits 详情**

- CurrentSeasonPanel（63 行）：面板用 `.info-panel` 语言；钩子若有（`result-podium` 等）保留。
- CircuitMap（97 行，39 行 scoped）：`circuit-map`/`circuit-map__corner`/`circuit-map__sector` 钩子保留；描边颜色改 `currentColor` + 外层 `text-ink-strong`，高亮扇区 `text-accent`；scoped 只留 SVG 结构必需的规则。
- `circuits/[id].astro`（158）：`circuit-hero__map`/`circuit-hero__length`/`circuit-stats` 钩子保留；布局参照 RaceHeader 的 hero 语言（大图右侧、标题左下、`text-display-lg`）；统计用 `.info-panels`。

- [ ] **Step 5: 清理 global.css + 验证**

删除 `.info-panels`/`.info-panel*`（若任务 1 未删干净）、目录/详情相关残留区块。

Run: `pnpm check && pnpm test && pnpm -r build && pnpm --filter @f1-box/web test:e2e`
Expected: 全绿，`drivers.spec.ts`、`team.spec.ts`、`circuits.spec.ts` 无回归。

- [ ] **Step 6: 截图审阅（自检）+ Commit**

自查 `/drivers`、`/drivers/{取 e2e 中一个 id}`、`/teams`、`/teams/{slug}`、`/circuits`、`/circuits/{id}` × 双主题双视口：

```bash
git add apps/web/src/pages/drivers apps/web/src/pages/teams apps/web/src/pages/circuits apps/web/src/components/SeasonMatrix.astro apps/web/src/components/CurrentSeasonPanel.astro apps/web/src/components/HistoryEnd.astro apps/web/src/components/CircuitMap.astro apps/web/src/styles/global.css
git commit -m "feat: migrate catalog and detail pages to tailwind design system"
```

**评审检查点：** review agent 全量覆盖上述页面，重点 SeasonMatrix 亮色下的可读性，通过后进入任务 5。

---

### Task 5: 收尾 — AskPanel、死代码、删旧文件、文档

**Files:**
- Modify: `apps/web/src/components/AskPanel.astro`
- Modify: `apps/web/src/scripts/client.ts`（删死函数）
- Delete: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/layouts/BaseLayout.astro`（删遗留 import）
- Modify: `apps/web/src/pages/ask-agent.test.ts` 相关不变；`docs/requirements/2026-08-23-css-modernization.md`（状态→预览验收）

**Interfaces:**
- Consumes: 全部既有令牌与组件类。
- Produces: 样式系统终态——仅存 `theme.css`、`base.css`、`components.css` 与组件内极少量状态样式。

- [ ] **Step 1: AskPanel 重写**

读 204 行（162 行 scoped）。规则：

- 钩子类全保留：`ask__panel`、`ask__trigger`、`ask__bubble`、`ask__bubble--assistant`、`ask__messages`、`ask__input`、`ask__send`、`ask__stop`、`ask__clear`、`ask__close`、`ask__error`、`ask__status`。
- 触发器按钮：`fixed right-4 bottom-4 z-40 grid size-12 place-items-center rounded-md border border-line bg-surface-raised text-ink-strong shadow-panel transition-colors hover:text-ink light:shadow-panel`。
- 面板：`fixed inset-x-4 bottom-20 z-40 mx-auto flex max-h-[70svh] w-full max-w-xl flex-col rounded-md border border-line bg-surface-raised shadow-panel md:inset-x-auto md:right-4 md:w-96 light:shadow-panel`。
- 气泡：用户 `self-end rounded-md bg-accent px-3 py-2 text-on-accent`；assistant（`ask__bubble--assistant`）`self-start rounded-md border border-line bg-surface px-3 py-2 text-ink`。
- 输入行：`border-t border-line p-3`，input `bg-surface rounded-sm border border-line px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-ink-muted`。
- scoped `<style>` 清零或 ≤10 行（仅留动画类状态）。

- [ ] **Step 2: 删除 client.ts 死代码**

删除 `enhanceCountdowns`、`enhanceRails` 两个函数及 `enhancePage` 中对它们的调用（`[data-countdown]` 与 `.season-rail` 标记已确认不存在）。

- [ ] **Step 3: 删除 global.css**

确认 `grep -rn "global.css" apps/web/src` 后，从 `BaseLayout.astro` 删除 `import "../styles/global.css";` 与其注释，`git rm apps/web/src/styles/global.css`。再跑 `grep -rn "var(--ink\|var(--paper\|var(--coral\|var(--acid\|var(--muted\|var(--line\|var(--display\|var(--body\|var(--shell\|var(--section-space" apps/web/src` 应只剩 theme.css/base.css/components.css 内的新变量（`--ink`/`--line` 等是新语义变量名，属正常）。

- [ ] **Step 4: 硬编码颜色扫描**

Run: `grep -rnE "#[0-9a-fA-F]{3,8}\b" apps/web/src --include="*.astro" --include="*.css" --include="*.ts" | grep -v theme.css | grep -v base.css`
Expected: 仅剩合理残留（BaseLayout 的 theme-color 元数据、`--monogram-bg` 默认值、SVG 内联属性）。其余全部改为令牌。

- [ ] **Step 5: 全量验证**

Run: `cd /Users/hj/workspace/f1-box && pnpm check && pnpm test && pnpm -r build && pnpm --filter @f1-box/web test:e2e`
Expected: 全绿。另确认构建产物 CSS 体积未异常膨胀（对比 `_astro/*.css` 总体积，预期 ≤ 现状）。

- [ ] **Step 6: 全量截图审阅（自检）+ Commit**

对全部页面类型 × 双主题 × 双视口过一遍（首页、比赛详情、积分、车手目录/详情、车队目录/详情、赛道目录/详情、404、AskPanel 开合态）：

```bash
git add apps/web/src/components/AskPanel.astro apps/web/src/scripts/client.ts apps/web/src/styles/global.css apps/web/src/layouts/BaseLayout.astro docs/requirements/2026-08-23-css-modernization.md
git commit -m "feat: finish tailwind migration and remove legacy styles"
```

**评审检查点：** 编排者派最终 review agent 做全量代码评审（对照需求文档验收标准逐条核对）+ 全量截图审阅；通过后进入 PR 提交（submit skill）。

---

## 收尾之后

- 按 `.claude/skills/submit/SKILL.md` 推分支、开 PR；PR 标题建议：`feat: modernize styling with tailwind v4, dual themes and visual refresh`；正文覆盖：动机、令牌架构、双主题行为、Astro 升级、死代码清理、验证结果、截图对比。
- 预览环境由 CI 自动部署，用户在预览页验收（桌面 + 375px 移动端、两种主题）。
