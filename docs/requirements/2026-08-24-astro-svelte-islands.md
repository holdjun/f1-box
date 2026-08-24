# Astro 架构到位化：Svelte Islands + Astro 原生数据访问层

日期：2026-08-24
状态：开发中

## 实现偏差记录（与设计时的差异，均已验证）

- AskPanel 面板采用原生 Popover API（manual 模式）：水合前的点击不依赖 JS 时序（dev 冷启动下 island 水合可能晚于用户点击）、导航后状态可程序恢复。manual popover 无 light dismiss，行为与原实现一致（点链接不关面板）；Escape/焦点回 trigger 由组件显式处理。SeasonFilter 面板仍为 Svelte 状态 + hidden 控制（无 popover）。
- Popover API 将浏览器基线抬到 Chrome 114+ / Safari 17+ / Firefox 125+。
- SSE 累积器未抽独立文件：复用既有 lib/ask/sse.ts 的 createSseAccumulator（纯函数，已有 ask-sse.test.ts 覆盖）。
- 对话与面板开合状态用 sessionStorage 持久化（会话级、刷新清空，与原实现行为一致）：island 客户端模块在每次导航都会重新执行，模块级 $state 不跨导航；过渡期曾尝试 transition:persist + 模块 store，实测 Astro 只保留 persist 元素的 DOM，Svelte 实例与状态会被销毁。
- season-filter 的 class:list 语法在 Svelte 5 已废弃（解析为条件类名 "list"），改用 class 数组/对象原生支持；动态相关的 CSS 选择器需 :global 包裹（scoped 编译器报 unused）。
- ThemeToggle 初始化不能在 $state 里读 document（SSR 端无 document 会崩溃），用 onMount 同步。
- a11y.spec 的 axe 在重页面（teams/ferrari）耗时与环境负载强相关（低负载 3.7s，高负载 >50s，与代码无关），为 CI 稳健性给该 spec 单独放宽超时。
- middleware 单测需要 vi.mock cloudflare:workers 与 astro:middleware 两个虚拟模块；MiddlewareHandler 返回类型含 void，需断言。
- svelte-check 需并入 tsconfig include（src/**/*.svelte）才会扫描到组件；check 脚本 = wrangler types && astro check && svelte-check。
- dev 环境局限：island 模块按需 transform，全新 dev server 冷启动后立即点击 SeasonFilter 触发器可能落在水合前（窗口毫秒级）；生产预构建无此问题，CI 全量 e2e 顺序（circuits/drivers 等含该组件的 spec 先跑）天然预热后稳定，多轮全量验证均全绿。

（下方为设计原文，策略不变；组件层交互细节以上述偏差为准）

## 背景与目标

当前站点把 Astro 用成了"多页模板引擎 + 全局脚本"：全部交互（主题切换、赛季筛选、AI 问答面板）集中在一个全局脚本 client.ts（320 行）和一个数据面板脚本 ask-panel.ts（270 行），组件与脚本通过 data-* 属性字符串契约耦合；13 个渲染页与 api/health.ts 各自重复 `import.meta.env.DEV ? createXxxRepository() : createXxxRepository(createD1XxxDatabase(env.F1_DB))` 初始化样板（api/ask.ts 另有一处 AskDatabase 的 DEV/PROD 分支）；缓存靠每页手写 Cache-Control。

Astro 7 的原生能力（Islands 按需水合、middleware + Astro.locals 依赖注入、已稳定的 route caching）基本空置。本次落地其中两个（route caching 列二期）：交互层转为 Svelte 5 Islands（组件自洽、按需水合、TypeScript 类型安全），数据访问收敛到 Astro middleware / locals。纯展示组件保持 .astro 不变（零交互，转框架无收益，符合简洁原则）。

## 用户可见行为

- 全部现有页面的内容、路由、交互行为不变；只是主题切换、赛季筛选、AI 问答从全局脚本驱动改为组件驱动。
- 主题切换、赛季筛选、AskPanel 问答的行为与现在完全一致。
- 双主题 × 375px × 桌面下的表现与现在一致，无障碍基线不倒退。

## 验收标准

- 新行为先有失败测试；交互组件迁完后 `pnpm check`、`pnpm test`、`pnpm -r build` 与全部 e2e（season / a11y / ask / drivers / themes 等 spec）全绿。
- e2e 钩子守恒：ask__*、season-filter（类名与面板结构）、data-theme、data-tab-anchor、data-tab-link、race-card、result-table、result-points、result-podium 这些被 spec 依赖的类名/属性一个不少（清单见下文）。
- 全局脚本收敛：ask-panel.ts、AskPanel.astro、SeasonFilter.astro 删除；client.ts 只保留无法组件化的纯增强（本地时间 data-local-time、比赛详情 tab 就地切换 enhanceRaceTabs，即 data-tab-* 的捕获阶段拦截与 aria-current / replaceState 同步）。
- 页面与 API 路由零 DEV/PROD 判定：`import.meta.env.DEV` 只出现在 createAppData 一处；13 个渲染页与 2 个 API 路由都从 Astro.locals.app 取数。
- 令牌单源与组件样式纪律不变：Svelte 组件继续只消费语义工具类（bg-surface、text-ink-muted、border-line、accent 等），不许硬编码颜色。
- 每个组件迁移后做双主题 × 双视口截图目检 + a11y.spec axe 基线，单主题不算完成。

## 范围外

- 不迁移纯展示组件（RaceCard、RaceTable、StandingsTable、RaceHeader、RaceTabsNav、CircuitMap、SeasonMatrix、StatusPage 等），它们保持 .astro。
- 不引入 Astro 7 声明式路由缓存（routeRules / Astro.cache）：本期只把页面零散的 Cache-Control 收敛到 middleware 统一管理，行为等价；Cloudflare 的 CDN cache provider（cacheCloudflare）尚为实验性，二期单独评估。
- 不引入 Astro Actions / Content Collections / Server Islands：二期评估，本期不做。
- 不改数据仓库层（lib/*-repository.ts 的接口与 SQL 不动）、不改路由、不改服务端 /api/ask 协议（delta / error 事件、请求体结构不变）。
- 不引入第三方 UI 组件库。
- 不重做视觉、不动令牌体系。

## 技术方案

### 阶段 0：Svelte 接入基建

- 安装依赖：`pnpm --filter @f1-box/web add @astrojs/svelte@9.0.1 svelte@5.56.10 --save-exact`，与仓库 runtime 依赖精确锁定惯例一致（astro、@astrojs/cloudflare 均为精确版本）。@astrojs/svelte 9.0.1 peer 要求 astro ^7.0.0（当前 7.2.4 满足）、svelte ^5.43.6（5.56.10 满足）。
- astro.config.mjs 增加 `integrations: [svelte()]`（与现有 vite 的 tailwind 插件共存，无冲突）。
- apps/web 根建 svelte.config.js：`import { vitePreprocess } from "@astrojs/svelte"; export default { preprocess: vitePreprocess() }`。
- 检查 pnpm-workspace.yaml：minimumReleaseAgeExclude 已存在（现有条目 @astrojs/cloudflare@14.2.3、astro@7.2.4），补充 @astrojs/svelte@9.0.1 与 svelte@5.56.10 两条，防 CI 卡年龄检查。
- 验证：先落一个最小 Svelte island（client:load）跑通构建与 hydration。类型检查分两层：astro check 不检查 .svelte 文件内部（@astrojs/check 明确跳过），Svelte 组件交给 svelte-check（devDependency，并入 check 脚本：`wrangler types && astro check && svelte-check --tsconfig ./tsconfig.json`）；tsconfig include 需显式追加 `src/**/*.svelte`（及 .svelte.ts，若新增），否则 svelte-check 可能扫不到组件；astro check 对 .astro 中 Svelte 组件的 props 类型检查由 svelte2tsx shim 提供，阶段 2 迁移时验证仍然生效。

### 阶段 1：数据访问层 middleware + Astro.locals

新增 src/lib/repositories.ts：应用级数据聚合，DEV/PROD 判定唯一收口点。

```ts
import type { Env } from "../../worker-configuration.d.ts";
import type { AskDatabase } from "./ask/db.js";

export interface AppRepositories {
  raceResults: RaceResultsRepository;
  driver: DriverRepository;
  team: TeamRepository;
  circuit: CircuitRepository;
}

export interface AppData {
  repositories: AppRepositories;
  askDb: AskDatabase;
}

// DEV 夹具与 D1 分支都收敛在此处，页面与 API 路由零 import.meta.env 判定
export async function createAppData(env: Env): Promise<AppData> {
  if (import.meta.env.DEV) {
    const { createDevAskDatabase } = await import("./ask/fixtures/ask-dev.js");
    return {
      repositories: {
        raceResults: createRaceResultsRepository(),
        driver: createDriverRepository(),
        team: createTeamRepository(),
        circuit: createCircuitRepository(),
      },
      askDb: await createDevAskDatabase(),
    };
  }
  return {
    repositories: {
      raceResults: createRaceResultsRepository(createD1RaceResultsDatabase(env.F1_DB)),
      driver: createDriverRepository(createD1DriverDatabase(env.F1_DB)),
      team: createTeamRepository(createD1TeamDatabase(env.F1_DB)),
      circuit: createCircuitRepository(createD1CircuitDatabase(env.F1_DB)),
    },
    askDb: createD1AskDatabase(env.F1_DB),
  };
}

let cached: Promise<AppData> | undefined;

// 模块级 memo：D1 wrapper 与 DEV 夹具均无状态，worker 实例内跨请求复用安全；
// DEV 夹具只在首次请求构建一次，不随每次页面渲染重复 await
export function getAppData(env: Env): Promise<AppData> {
  cached ??= createAppData(env);
  return cached;
}
```

（各 repository 的无参 DEV 行为与现有页面 DEV 分支一致；Env 类型来自 wrangler types 生成的 worker-configuration.d.ts。getAppData 是页面与 API 路由的唯一入口，避免现状"每请求新建 wrapper"之外再引入"每请求重建 DEV 夹具"的回归——现状 DEV 夹具只在 /api/ask 动态 import，memo 后整个实例生命周期只构建一次。）

新增 src/middleware.ts：注入数据 + 默认缓存 header。

- 数据注入：`context.locals.app = await getAppData(env)`；env 与现有 13 个页面、2 个 API 路由同款 `import { env } from "cloudflare:workers"`，与现状保持一致，不引入新的 env 获取路径。
- 默认缓存：`await next()` 后，仅当 GET、路径非 /api/*、2xx、且响应未显式设置 Cache-Control 时，设 `public, s-maxage=300, stale-while-revalidate=600`。3xx（重定向页）、404/500、API 响应都不设，与原逐页行为一致。
- 语义信号：racing/[year] 与 results 三个列表页原语义是"数据非空才缓存"（避免 data-sync 更新被边缘缓存延迟），middleware 无法感知页面数据，改为这 4 页在数据为空时显式设 `Cache-Control: no-store`；其余页面删除手写 header，404 status 判定保留在页面。

env.d.ts 增加类型注入：

```ts
declare namespace App {
  interface Locals {
    app: import("./lib/repositories").AppData;
  }
}
```

页面改造（13 个渲染页 + api/health.ts + api/ask.ts）：

- 渲染页与 api/health.ts：删除各自 `import.meta.env.DEV ? ... : ...` 初始化块与 Cache-Control 手写，改为 `const { raceResults } = Astro.locals.app.repositories`（按页面需要取用）；保持各页 Promise.all 并行查询结构与 404 判定；上述 4 个列表页保留空数据 no-store 信号。
- api/ask.ts：`const { askDb } = Astro.locals.app;`，DEV 动态 import 随之消失。

### 阶段 2：交互组件转 Svelte Islands

三个交互组件转为 Svelte 5，client:load 水合；纯展示组件不动。

2.1 AskPanel.svelte（替换 AskPanel.astro + scripts/ask-panel.ts）

- 保留 transition:persist="ask-panel"：persist 放在 island 上时，旧页面 island 连同组件实例与内部状态保留、新页面同名 island 不替换不重新 hydration（Astro 官方语义），组件内 $state 即天然跨导航存活；流式进行中导航的 fetch 与 DOM 引用不受影响。
- 状态用 Svelte 5 runes：`let open = $state(false)`、`let messages = $state<AskMessage[]>([])`、`let streaming = $state(false)`、`let error = $state<null | string>(null)`；对话裁剪沿用 lib/ask/history 的 windowForSend / capStoredAnswer。
- SSE 逻辑由客户端事件累积器抽取到 src/lib/ask/sse-client.ts（基于现有 createSseAccumulator 与 delta/error 协议），AskPanel 消费 stream，供单测覆盖。
- 交互行为与 ask-panel.ts 等价：trigger 开合、关闭按钮、Enter 发送（textarea）、send/stop（AbortController abort）、清空、aria-live/aria-busy、错误回滚（失败时回滚本轮 user 消息、输入框回填问题）、流式文本追加与 keep-bottom 滚动、Escape 关闭面板与 Tab 焦点陷阱（现 ask-panel.ts 的 trapFocus，属既有 a11y 行为，必须等价保留）。
- 钩子保留：ask__trigger、ask__panel、ask__messages、ask__input、ask__send、ask__stop、ask__clear、ask__close、ask__status、ask__error、ask__bubble、ask__bubble--user、ask__bubble--assistant。
- 气泡样式从原 is:global 块迁入 Svelte（继续用 Tailwind 工具类 + 令牌），不再需要 is:global 逃生门。
- 取舍说明：AskPanel 挂在 BaseLayout、client:load 意味着每页都加载并水合 Svelte runtime 与面板代码，与现状全局脚本每页加载等价（无回归，但 islands 的按需水合收益在此为零）；面板惰性化列入二期候选。

2.2 SeasonFilter.svelte（替换 SeasonFilter.astro + client.ts 中 enhanceSeasonFilters）

- props 全部可序列化（island 硬约束，函数不可传）：years、mode（"link" | "toggle"）、baseHref、current、label、sticky、initialSelected、showAll；hrefFor 函数改为 hrefPattern 字符串（含 {year} 占位符，组件内替换拼 year），5 个调用点把箭头函数改成 pattern 字面量。
- 内部逻辑迁自 enhanceSeasonFilters：trigger 展开/收起、panel 向上/向下定位与 maxHeight、年代按钮全选反选、URL ?year= 同步（replaceState）、aria-expanded / aria-pressed、is-active 状态。
- toggle 模式的 data-season-block 显隐跨组件边界（元素在 SeasonMatrix.astro 内，纯展示组件不动），组件保留 document 级全局查询作为自洽例外；其余逻辑全部组件内化，不再需要 client.ts 的全局单例监听。
- 被 spec 依赖的钩子保留：.season-filter、.season-filter__summary、.season-filter__panel、面板内按钮可访问名（Filter by season / 各年份 / 各年代 / All）与 a[href] 链接结构；组件内部 data-* 查询属性不受约束，可按 Svelte 习惯改为变量引用。
- link 模式本质是"点击即导航"的纯链接，仍是组件输出 HTML + 由 Svelte 管理展开/定位；客户端导航后 Svelte island 由 Astro 自动重新 hydration，不再依赖 astro:page-load 手动 re-enhance。

2.3 ThemeToggle.svelte（替换 SiteHeader.astro 内 data-theme-toggle 按钮 + client.ts 中 enhanceThemeToggles）

- 读 document.documentElement.dataset.theme，点击翻转并写 localStorage("f1-theme") 与 meta theme-color；aria-label / aria-pressed 同步保留。
- 图标切换（icon-to-light/icon-to-dark）由 base.css 按 html[data-theme] 纯 CSS 驱动（base.css 103-112 行），组件不碰图标显隐。
- 主题色保持两处字面量：meta theme-color 是 browser chrome 常量，读不了 CSS 变量，getComputedStyle 在 head 内联脚本执行时存在样式表未就绪的时序风险，而备选的单源方案（data-theme-colors 属性）反而新增一份契约。两个静态字面量（#0b0d10 / #f3f0e9）重复成本极低，按简洁原则保留现状：BaseLayout 内联脚本一处、ThemeToggle 组件一处（原 client.ts 的 THEME_COLORS 常量随 enhanceThemeToggles 一并删除，不算新增重复）。
- 跨页状态仍由 BaseLayout 内联脚本 + astro:after-swap 主导（保持不变），Svelte 只负责交互与同步，避免与主题初始化脚本双写冲突。
- 钩子保留：data-theme-toggle（属性与 aria-label / aria-pressed 断言不变）。

2.4 全局脚本收敛

- 删除 scripts/ask-panel.ts 与 components/AskPanel.astro。
- client.ts 移除 enhanceSeasonFilters / enhanceThemeToggles 两段（THEME_COLORS 常量随之删除），保留 enhanceLocalTimes（data-local-time）与 enhanceRaceTabs（data-tab-anchor / data-tab-link：比赛详情 tab 就地切换，捕获阶段拦截 ClientRouter、同步 aria-current 与 replaceState）。不组件化的理由：tab 面板是服务端渲染在多个 .astro 里的 RaceTable，零交互收益；该逻辑是剩余脚本中与 ClientRouter 耦合最深的部分，迁移时不得改动其行为。文件显著变短，BaseLayout 的 script import 保留，仅依赖剩余增强的页面不受影响。

### 阶段 3：测试与验证

- 单测：sse-client 累积器（新增）补单测；SeasonFilter 的窗口化分组/URL 序列化等纯逻辑若抽成 lib 纯函数则补单测；既有 repository/routing/time 单测不得改动（接口不变）。
- 类型：pnpm check 含 astro check + svelte-check，两侧类型全绿。
- e2e：现有 season / a11y / ask / drivers / themes spec 全绿为强制门槛；a11y.spec 双主题 axe 基线无新增违规。
- 验收：pnpm check、pnpm test、pnpm -r build；每个 Svelte 组件迁移后桌面/375px × 深/亮主题截图目检。

## 文件清单

新增

- apps/web/src/middleware.ts
- apps/web/src/lib/repositories.ts（AppRepositories + AppData + createAppData + getAppData 模块级 memo，DEV/PROD 判定唯一收口点）
- apps/web/src/lib/ask/sse-client.ts（SSE 客户端事件累积器）
- apps/web/src/components/AskPanel.svelte
- apps/web/src/components/SeasonFilter.svelte
- apps/web/src/components/ThemeToggle.svelte
- apps/web/svelte.config.js

修改

- apps/web/astro.config.mjs（integrations: [svelte()]）
- apps/web/package.json（+ @astrojs/svelte、+ svelte、devDependencies + svelte-check）；pnpm-lock.yaml
- pnpm-workspace.yaml（仓库根）的 minimumReleaseAgeExclude（+ @astrojs/svelte、+ svelte）
- apps/web/src/env.d.ts（App.Locals.app 类型）
- apps/web/src/layouts/BaseLayout.astro（AskPanel 改为 client island；保留 transition:persist）
- apps/web/src/components/SiteHeader.astro（接入 ThemeToggle.svelte）
- 13 个渲染页 + api/health.ts + api/ask.ts（改从 Astro.locals.app 取数，删样板与手写 header；4 个列表页保留空数据 no-store 信号）
- apps/web/src/scripts/client.ts（瘦身：删 enhanceSeasonFilters / enhanceThemeToggles / THEME_COLORS，保留 enhanceLocalTimes / enhanceRaceTabs）

删除

- apps/web/src/components/AskPanel.astro
- apps/web/src/components/SeasonFilter.astro
- apps/web/src/scripts/ask-panel.ts

不动

- lib/*-repository.ts（含 SQL）、lib/ask/*（服务端）、styles/*、tests/* 既有、routing.ts、vendor、data/*.json

## e2e 钩子守恒清单

以下类名/属性被 tests/e2e 依赖，迁移只能改实现、不得改名或删除：
ask__trigger、ask__panel、ask__messages、ask__input、ask__send、ask__stop、ask__clear、ask__close、ask__status、ask__error、ask__bubble、ask__bubble--user、ask__bubble--assistant、season-filter、season-filter__summary、season-filter__panel、data-theme、race-card、result-table、result-points、result-podium。

补充说明：data-tab-anchor / data-tab-link 不被任何 spec 依赖，但随 enhanceRaceTabs 保留，不在守恒约束内；data-race-tab-panel 被 results.spec 依赖（RaceTable 服务端渲染的属性，随 enhanceRaceTabs 与 RaceTable 天然保留，此处仅记录）；season-filter 面板内还依赖按钮可访问名（Filter by season、年份、年代、All）与 a[href] 链接结构；data-season-block 属于 SeasonMatrix（纯展示，不迁移），天然保留。data-season-* 内部查询属性不被任何 spec 依赖，Svelte 化后可自由调整。

## 风险与对策

- Svelte island 与 View Transitions：transition:persist 保住 island（组件实例与状态跨导航存活，官方语义）；导航后无 persist 的新页面 island 自动 hydration；流式进行中导航的边界行为与现状保持一致（旧行为同等处理）。改前先跑一次 ask.spec 基线。
- e2e 稳态依赖钩子类名：改实现不改类名，迁移顺序按"基建 → ThemeToggle → SeasonFilter → AskPanel"逐步推进，每步跑相关 spec。
- svelte.config.js / @astrojs/svelte 与 @tailwindcss/vite 共存无冲突（Astro 官方确认）；若 dev 二次依赖优化报错，参考现有 vite ssr.optimizeDeps 注释处理。
- 双主题令牌是 CSS 层，Svelte 组件照常消费工具类，无主题冲突；aria 断言（aria-expanded / aria-pressed / aria-label）由组件内部同步，不依赖全局脚本。
- 缓存收敛行为等价：middleware 默认规则（GET、非 /api/*、2xx、未显式设置）+ 4 个列表页空数据 no-store 信号复刻原语义；通过 e2e + 目测核对。阶段 1 开始前先写一个探针验证"页面设的 Cache-Control 在 next() 返回的 response.headers 可读"这一前提（Astro 7 里 Astro.response.headers.set 需能反映到 middleware 视野内）；若不可见，4 页 no-store 覆盖机制改为约定头名（如页面设私有信号头、middleware 翻译）或 middleware 按 URL 模式白名单处理。
- minimumReleaseAgeExclude 已存在且未包含新包，需补充 @astrojs/svelte@9.0.1、svelte@5.56.10 两条，否则 CI 拦截。

## 二期候选（本期明确不做，设计预留接缝）

- Astro 7 route caching（routeRules / Astro.cache，已稳定）+ Cloudflare CDN cache provider（cacheCloudflare，实验性）：替换 middleware 手写 header，与 data-sync 的 tag 失效打通。
- AskPanel island 惰性化（client:only 或 Server Islands）：降低非问答页的 Svelte runtime 加载与水合开销，一期迁移稳定后评估。
- Static JSON（data/circuit-maps、logos、team-colors 等）收编 Content Collections，获得 schema 校验与类型导出。
- 其他工程请求类接口评估 Astro Actions（SSE 流式仍走 /api/ask，Actions 只覆盖非流式）。

## 实施顺序（转入 writing-plans 细化）

1. 基建：astro add svelte、svelte.config.js、svelte-check 并入 check 脚本、最小 island 跑通。
2. 数据层：repositories + middleware + env.d.ts + 13 页与 2 个 API 路由改造（纯重构，e2e 回归）。
3. 组件迁移：ThemeToggle → SeasonFilter → AskPanel（每步 e2e + 视觉 + axe）。
4. 全局脚本收敛：删 ask-panel.ts / AskPanel.astro / SeasonFilter.astro、精简 client.ts。
5. 全量验证：check / test / build / e2e + 双主题双视口目检。
