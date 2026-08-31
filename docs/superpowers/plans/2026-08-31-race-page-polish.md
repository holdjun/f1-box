# 分站页视觉打磨与车手徽标改造实施计划

> Agent 执行要求：逐任务小步提交；行为变化先写失败测试再实现（纯删除任务以"删完全量验证仍绿"为测试）。基线为 `feat/race-page-circuit-merge` 分支顶端（PR #25 未合并，继续在该分支提交，push 后更新同一个 PR，不另开分支不另开 PR）。

目标：四件事——(1) /circuits 两个重定向存根彻底删除，不留 301；(2) 分站页头部赛道 SVG 与信息卡视觉协调；(3) 赛道图增加图例说明；(4) 车手圆形徽标从名字首字母（GR）改为官方三字码（RUS），全部使用点统一。

技术栈：Astro 5（.astro 服务端渲染）、Svelte 5 island、Vitest、Playwright e2e。Node.js >= 22.12.0，pnpm 11.9.0。

## 全局约束

- 样式只用 `src/styles/theme.css` 语义工具类与 `components.css` 既有类，禁止硬编码颜色；数据语义色（sector 三色、队色）例外且需注释。深浅两主题同时验证。
- e2e 钩子纪律：`race-card`、`season-filter*`、`data-my-time`、`data-track-time` 等既有钩子不动；本计划允许新增钩子类但需同步进测试。
- 注释只写"为什么"；删除的代码不留残骸。
- 框架边界：查库与展示一律服务端 .astro，不新增 island。

## 关键事实（已核对代码与数据）

- `driver` 表 `abbreviation VARCHAR(3) NOT NULL`，全部车手都有三字码，新增字段无需可空。
- `src/data/circuit-maps.json` 共 10 条注解赛道（key 为 `{circuitId}-{layout}`），字段：sectors（三段点数组）、corners（{x,y,n,letter}）、drs（当前全部为空数组）。无注解时 `CircuitMap.astro` 回落 `<img src=/vendor/circuits/{layoutId}.svg>`。
- sector 三色在 `src/components/CircuitMap.astro` 的 `SECTOR_COLORS`（#ec008c / #ffd400 / #00a3e0，数据语义色）。
- 图例范式现成：`src/components/SeasonMatrix.astro` 约 57-81 行的 `section.legend` + `span.key` + `i` 色块写法。
- 徽标核心：`src/lib/tokens.ts` 的 `monogram`（两字母回落）与 `monogramStyle`（--monogram-bg/fg，按亮度选黑白字）；圆形样式 `.vendor-cell__monogram` 在 `src/styles/components.css` 约 304-317 行（1.75rem、字号 0.6rem）。
- 车手徽标使用点与可用字段：
  - `src/components/RaceTable.astro` 六个 tab 各一处（`monogram(row.driverName)` + name + `<small>{row.driverCode}</small>` 三件套，首处约 63-67 行）——`row.driverCode` 已有。
  - `src/components/StandingsTable.astro` 约 42-44 行——`row.driverCode` 已有。
  - `src/pages/results/[year]/races/index.astro` 约 67-71 行冠军列——`race.winnerCode` 已有。
  - `src/pages/drivers/index.astro` 约 41-46 行与 `src/pages/drivers/[id].astro` 约 96-98 行是"无车号回落"位——`DriverSummary`（driver-repository.ts:15）与 `DriverPage`（:86）当前无 code 字段，需新增。
- `monogram()` 仍被车队卡回落使用（`tests/e2e/team.spec.ts:166` 覆盖），不得删除；`tests/tokens.test.ts` 不动。
- /circuits 删除面已核净：页面存根 2 文件、`latestRaceByCircuitSql` 与 `getLatestRaceByCircuit`（race-results-repository.ts 约 336-341 / 665-667 / 818-833，唯一调用方就是存根页）、`tests/e2e/redirects.spec.ts` 整文件、`tests/race-results-repository.test.ts` 的 `getLatestRaceByCircuit` describe 块（约 700-725）。路由/中间件/导航无其他引用；`/vendor/circuits/` 静态资产路径保留。

## 任务 1：删除 /circuits 存根

1. 删除 `apps/web/src/pages/circuits/` 整个目录。
2. `race-results-repository.ts`：删 `latestRaceByCircuitSql`、接口中 `getLatestRaceByCircuit` 声明、实现（含 fixture 分支 melbourne → {year:2026, slug:"australia"}）。
3. 删 `tests/e2e/redirects.spec.ts` 整文件；删 `tests/race-results-repository.test.ts` 的 `getLatestRaceByCircuit` describe 块。
4. 更新 `docs/requirements/2026-08-31-race-page-circuit-merge.md`："用户可见行为"与"验收标准"中 301 重定向的表述改为"页面移除，地址自然 404，不保留重定向"。`docs/superpowers/plans/2026-08-31-race-page-circuit-merge.md` 是已执行的历史产物，不动。
5. 全仓搜 `/circuits` 字面量确认只剩 `/vendor/circuits/` 资产引用。

验收：`pnpm check`、`pnpm test`、`pnpm -r build` 过。

## 任务 2：分站页头部视觉协调与赛道图图例

改 `src/components/RaceHeader.astro`、`src/components/CircuitMap.astro`、`src/styles/components.css`：

1. 图表面板：把 `RaceHeader.astro` 里赛道图的裸容器（约 37 行 `mx-auto w-[min(100%,24rem)]`）升级为与信息卡同语言的面板——同样的边框（--line）、底色（--surface-raised）、圆角，内部留 padding。可以给 `.info-panel` 加无 h2 的变体类，或新增 `.circuit-map-panel` 类（样式写进 components.css，语义令牌复用，不硬编码色）。目的：左图右卡成为一对同风格姊妹卡，消除"哑图贴着一个盒子"的割裂感。
2. 图例：仅注解地图（有 map 数据）时在面板内、SVG 下方渲染一行 legend，复用 SeasonMatrix 的 legend 模式：
   - Sector 1 / Sector 2 / Sector 3：三段短色线样，颜色取 `SECTOR_COLORS`（数据语义色，注释说明）。
   - 弯号角标：一个小圆 + 数字的样例，说明图上圆形徽标含义。
   - DRS：仅当 `map.drs.length > 0` 渲染（当前数据全空，代码路径保留但不显示）。
   - 无注解回落（img 分支）不渲染图例。
3. 区块顺序不变：标题块 → 面板对（左图右卡）→ Weekend schedule。信息卡字段顺序维持现状，不重排。
4. 375px：现有两列 grid 自动堆叠；确认面板与图例在窄屏无溢出（`@mobile results pages have no page overflow` 用例兜底）。
5. 疑点核查：预览截图疑似出现"Direction 显示 —"，而 fixture 明确有 `direction: "Clockwise"`。实现时先在 `pnpm dev` 目视确认；若确为渲染缺陷一并修复并补断言，若是截图误读则忽略。

验收：`pnpm check`、`pnpm -r build` 过；本地目视桌面 + 375、深浅两主题无溢出无错位。

## 任务 3：车手徽标改三字码

1. 三处现成数据的使用点：`RaceTable.astro` 六 tab、`StandingsTable.astro`、`results/[year]/races/index.astro` 冠军列——徽标文本由 `monogram(name)` 改为 `driverCode` / `winnerCode`，同时删除徽标后冗余的 `<small>{code}</small>`（徽标本身已是码）。
2. 车手页两处回落位：`DriverSummary` 与 `DriverPage` 新增 `code: string`（SQL 增 `d.abbreviation`，`mapDriverRow` 与 `parseIdentity` 同步）；目录卡与详情 hero 的 `monogram(name)` 回落改为 `code`。三个 DEV fixture 补 `code` 字段：`fixtures/drivers.json`（32 条，建议脚本批量补，取值与 f1db `driver.abbreviation` 一致）、`fixtures/driver-george-russell.json`、`fixtures/driver-max-verstappen.json`。
3. 字号适配三字符：`.vendor-cell__monogram` 0.6rem 起步按渲染效果微调（可能 0.55rem 或收紧 letter-spacing）；目录卡 `card-monogram`（1.2rem）与详情 `driver-monogram`（1.6rem）的字号相应缩小到三字符可读且不溢盒（约 1rem / 1.15rem 起步，目视定）。深浅两主题都要看（--monogram-fg 黑白字逻辑不动）。
4. `monogram()` 保留（车队卡回落仍在用），`tokens.test.ts` 不动。

验收：`pnpm check`、`pnpm test` 过；目视各使用点徽标清晰可读。

## 任务 4：测试更新

1. 单测：
   - `tests/race-results-repository.test.ts` 删 `getLatestRaceByCircuit` 块（任务 1）。
   - `tests/driver-page-repository.test.ts` 等 driver 仓库用例补 `code` 字段断言。
2. e2e：
   - `tests/e2e/results.spec.ts`：正赛表格补徽标三字码断言（如 `.vendor-cell__monogram` 文本含 RUS）与图例断言（Sector 1/2/3 可见）；既有副行、信息卡、双时间断言保持。
   - `tests/e2e/drivers.spec.ts`：`.card-monogram` 计数断言类名不变应仍过，按需补三字码文本断言。
   - `redirects.spec.ts` 已随任务 1 删除。
3. 全量：`pnpm check`、`pnpm test`、`pnpm -r build`、`pnpm --filter @f1-box/web test:e2e`（桌面 / 375px / reduced-motion / 双主题 axe）。
4. 已知 flake：`/teams/ferrari` 两条 axe 用例在满负载并行下会 90s 超时（a11y.spec.ts 注释已记录），单独重跑通过即可，不要为此改超时或跳过。

## 任务 5：目视验收与提交

1. `pnpm dev` 起本地，目视检查（桌面 + 375，深浅两主题）：
   - 分站页 `/results/2026/races/australia/race-result`：面板对协调、图例可读、Direction 正确显示。
   - 徽标改造点抽查：分站页正赛表格、`/results/2026/drivers` 积分榜、`/results/2026/races` 冠军列、`/drivers` 目录卡、`/drivers/george-russell` hero。
   - 一处无注解地图的分站（fallback 轮廓图）确认不渲染图例、面板不破。
2. 提交：Conventional Commits 英文标题，按逻辑拆（删存根、头部视觉+图例、徽标改造各一个，或合并为不超过三个）。
3. `git push` 更新 PR #25（不新开 PR），并在 PR 正文追加本轮改动说明。不自己合并。

## 最终验证

- `pnpm check`、`pnpm test`、`pnpm -r build`、`pnpm --filter @f1-box/web test:e2e` 全绿（ferrari axe 超时 flake 单跑通过即可）。
- `/circuits/任意路径` 返回 404（Astro 默认，非 301）。
- 分站页目视：面板对、图例、双主题、375 无溢出。
- 全站车手徽标均为三字码，不再出现名字首字母组合。
