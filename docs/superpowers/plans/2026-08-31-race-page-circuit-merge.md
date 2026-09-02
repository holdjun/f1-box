# 分站页合并赛道页实施计划

> Agent 执行要求：逐任务使用 `superpowers:subagent-driven-development`；行为代码遵循测试驱动开发（先写失败测试）。需求见 `docs/requirements/2026-08-31-race-page-circuit-merge.md`。

目标：把 `/circuits/:id` 的赛道内容并入分站详情页并重排区块，修正头部地点行重复城市名与 UTC 日期偏移问题，Weekend schedule 改为同时显示访客时区与赛道当地时区两个时间，`/circuits` 路由整块改为 301 重定向。

架构：数据全部来自 D1（DEV 走 fixture）。赛道信息卡所需字段并入 `race-results-repository.getRacePage` 的同一个 batch；赛道时区是新静态数据 `src/data/circuit-timezones.json`；`circuit-repository.ts` 整体删除（列表/详情消费者全部移除，重定向只需一条"赛道最近比赛"查询，放进 race-results-repository）。UI 只改 `RaceHeader.astro`（新增 `CircuitCard.astro` 组件）与 `WeekendSchedule.svelte`，页面路由 `[tab].astro` 的区块顺序由 RaceHeader 内部结构决定，页面文件本身基本不动。

技术栈：Astro 5（.astro 服务端渲染）、Svelte 5 island（仅 WeekendSchedule）、Vitest、Playwright e2e。Node.js >= 22.12.0，pnpm 11.9.0。

## 全局约束

- 分支：从 origin/main 切 `feat/race-page-circuit-merge`；Conventional Commits 英文标题；PR 标题正文英文。
- 样式只用 `src/styles/theme.css` 语义工具类，禁止硬编码颜色；深浅两主题同时验证。
- 框架边界：查库与展示一律服务端 .astro；WeekendSchedule 是既有 island，继续承担客户端时区换算，不新增 island。
- e2e 钩子：保留 `race-card`、`season-filter*` 等既有钩子；`data-time-toggle` 随切换按钮移除（同步删其测试），新增 `data-my-time`、`data-track-time` 两个 time 元素钩子。
- 注释只写"为什么"；删除的代码不留残骸（含 fixture、测试、文档引用）。
- 访客请求不得直接访问上游数据源；本计划所有数据均来自仓库内 D1 dump / fixture。

## 关键数据事实（已核对 `.data/d1/f1db.sql`）

- circuit.name 是短名（Melbourne / Americas / Las Vegas / Miami），full_name 才是赛道全名；地点行重复城市名的根因是 RaceHeader 用了短名。
- race 表 date/time 为 UTC；Las Vegas 2026 存储值 `2026-11-22 04:00` = 当地 11-21 周六 20:00，头部日期必须按赛道时区渲染才与当地比赛日一致。
- Australia 2026 本场口径：course_length 5.278、turns 14、laps 58、distance 306.124、direction CLOCKWISE；melbourne 赛道 total_races_held 29、首届 1996、纪录圈 1:19.813（Charles Leclerc，2024）。
- race.time 大面积为空：1171 场比赛中 1101 场无 time（波及 77 条赛道）。`raceMetaSql` 已 SELECT `ra.time` 但 `mapRaceMeta` 未暴露；`buildSessions` 对空 time 补 `"00:00"` 合成 startsAtUtc，race session 恒存在——本地日期换算必须以真实 time 字段为门槛，不能用 session 时间。
- 国家显示沿用 `country.name` 全名（ioc_code 全站零使用，不引入）。
- 赛道共 78 条，f1db 无时区字段。

## 任务 1：赛道时区映射与本地日期格式化

新行为先写失败测试。

1. 新建 `apps/web/src/data/circuit-timezones.json`，内容为全部 78 条赛道的 `circuitId → IANA 时区` 映射（下方给出完整内容，直接使用）。
2. 新建 `apps/web/src/lib/circuit-time.ts`：`circuitTimeZone(circuitId: string): string | null`，读取上述 JSON，未知 id 返回 null。
3. `apps/web/src/lib/time.ts` 新增两个函数：
   - `formatLocalDate(value, timeZone, locale = "en-GB")`：与 `formatUtcDate` 同格式（`08 Mar 2026`）但按指定时区渲染。
   - `formatRaceDate(date: string, time: string | null, timeZone: string | null)`：仅当 `time` 与 `timeZone` 均非空时返回 `formatLocalDate(`${date}T${time}:00Z`, timeZone)`，否则返回 `formatUtcDate(date)`。这是副行日期渲染的唯一入口：空 time 的历史赛必须回退 UTC，绝不能按合成 00:00 做时区换算（负偏移时区会退一天）。
4. 测试：新建 `apps/web/tests/circuit-time.test.ts`（已知 id 返回时区、未知返回 null、映射里每个值都能构造 `Intl.DateTimeFormat`——即 IANA 时区有效性；不要写"覆盖全部赛道 id"类断言，测试环境没有赛道全集数据源）；`apps/web/tests/time.test.ts` 增加 `formatLocalDate` / `formatRaceDate` 用例：`formatRaceDate("2026-11-22", "04:00", "America/Los_Angeles")` → `21 Nov 2026`（跨日）；`formatRaceDate("1995-03-26", null, "America/New_York")` → `26 Mar 1995`（空 time + 负偏移时区不偏移）；`timeZone` 为 null → UTC 日期。

```json
{
  "adelaide": "Australia/Adelaide",
  "aida": "Asia/Tokyo",
  "ain-diab": "Africa/Casablanca",
  "aintree": "Europe/London",
  "anderstorp": "Europe/Stockholm",
  "austin": "America/Chicago",
  "avus": "Europe/Berlin",
  "bahrain": "Asia/Bahrain",
  "baku": "Asia/Baku",
  "brands-hatch": "Europe/London",
  "bremgarten": "Europe/Zurich",
  "buddh": "Asia/Kolkata",
  "buenos-aires": "America/Argentina/Buenos_Aires",
  "bugatti": "Europe/Paris",
  "caesars-palace": "America/Los_Angeles",
  "catalunya": "Europe/Madrid",
  "clermont-ferrand": "Europe/Paris",
  "dallas": "America/Chicago",
  "detroit": "America/Detroit",
  "dijon": "Europe/Paris",
  "donington": "Europe/London",
  "east-london": "Africa/Johannesburg",
  "estoril": "Europe/Lisbon",
  "fuji": "Asia/Tokyo",
  "hockenheimring": "Europe/Berlin",
  "hungaroring": "Europe/Budapest",
  "imola": "Europe/Rome",
  "indianapolis": "America/Indiana/Indianapolis",
  "interlagos": "America/Sao_Paulo",
  "istanbul": "Europe/Istanbul",
  "jacarepagua": "America/Sao_Paulo",
  "jarama": "Europe/Madrid",
  "jeddah": "Asia/Riyadh",
  "jerez": "Europe/Madrid",
  "kyalami": "Africa/Johannesburg",
  "las-vegas": "America/Los_Angeles",
  "long-beach": "America/Los_Angeles",
  "lusail": "Asia/Qatar",
  "madring": "Europe/Madrid",
  "magny-cours": "Europe/Paris",
  "marina-bay": "Asia/Singapore",
  "melbourne": "Australia/Melbourne",
  "mexico-city": "America/Mexico_City",
  "miami": "America/New_York",
  "monaco": "Europe/Monaco",
  "monsanto": "Europe/Lisbon",
  "mont-tremblant": "America/Toronto",
  "montjuic": "Europe/Madrid",
  "montreal": "America/Toronto",
  "monza": "Europe/Rome",
  "mosport": "America/Toronto",
  "mugello": "Europe/Rome",
  "nivelles": "Europe/Brussels",
  "nurburgring": "Europe/Berlin",
  "paul-ricard": "Europe/Paris",
  "pedralbes": "Europe/Madrid",
  "pescara": "Europe/Rome",
  "phoenix": "America/Phoenix",
  "portimao": "Europe/Lisbon",
  "porto": "Europe/Lisbon",
  "reims": "Europe/Paris",
  "riverside": "America/Los_Angeles",
  "rouen": "Europe/Paris",
  "sebring": "America/New_York",
  "sepang": "Asia/Kuala_Lumpur",
  "shanghai": "Asia/Shanghai",
  "silverstone": "Europe/London",
  "sochi": "Europe/Moscow",
  "spa-francorchamps": "Europe/Brussels",
  "spielberg": "Europe/Vienna",
  "suzuka": "Asia/Tokyo",
  "valencia": "Europe/Madrid",
  "watkins-glen": "America/New_York",
  "yas-marina": "Asia/Dubai",
  "yeongam": "Asia/Seoul",
  "zandvoort": "Europe/Amsterdam",
  "zeltweg": "Europe/Vienna",
  "zolder": "Europe/Brussels"
}
```

验收：`pnpm --filter @f1-box/web test` 相关用例通过。

## 任务 2：RaceMeta 扩展（race-results-repository）

1. `raceMetaSql` 增列：`ci.full_name AS circuit_full_name`、`ra.distance`、`ra.turns`、`ra.direction`（`ra.time` 已在 SELECT 里，无需增列）；移除不再使用的 `ci.name AS circuit_name`（RaceHeader 的 alt 改用 full_name；`RaceSummary.circuitName` 属日历口径，RaceCard 仍在用，不动）。不引入 `cc.ioc_code`：国家显示保持 countryName 口径。
2. 新增两条与既有 batch 同 values（`[year, slug]`）的语句，并入 `getRacePage` batch：
   - `circuitInfoSql`：赛道维度静态字段。`SELECT c.total_races_held, (SELECT MIN(ra2.year) FROM race ra2 WHERE ra2.circuit_id = c.id) AS first_gp FROM circuit c WHERE c.id = (SELECT ra.circuit_id FROM race ra WHERE ra.year = ?1 AND ra.grand_prix_id = ?2)`。
   - `recordLapSql`（沿用原 circuit-repository 的口径：全场次最快圈）：`SELECT fl.time, d.name AS driver_name, ra.year FROM race ra JOIN fastest_lap fl ON fl.race_id = ra.id JOIN driver d ON d.id = fl.driver_id WHERE ra.circuit_id = (SELECT ra2.circuit_id FROM race ra2 WHERE ra2.year = ?1 AND ra2.grand_prix_id = ?2) AND fl.time_millis IS NOT NULL ORDER BY fl.time_millis LIMIT 1`。
3. `RaceMeta` 接口：新增 `circuitFullName`、`raceTime: string | null`（mapRaceMeta 里 `r.time` 已取，null 保持 null；`RaceSummary.time` 已有同名可空字段先例）、`distance: number`、`turns: number`、`direction: string`（titleCase，复用原 circuit-repository 的写法）、`totalRacesHeld: number`、`firstGrandPrix: number | null`、`recordLap: { time: string; driverName: string; year: number } | null`；移除 `circuitName`。distance/turns/direction/laps 在 race 表均 NOT NULL，类型不得标可空；可空新增字段只有 `raceTime`、`firstGrandPrix`、`recordLap`。注意：`buildSessions` 对空 time 补 00:00，race session 恒存在，"是否可时区换算"只能看 `raceTime`，不得看 sessions。
4. 新增 `getLatestRaceByCircuit(circuitId): Promise<{ year: number; slug: string } | null>`：`SELECT ra.year, ra.grand_prix_id AS slug FROM race ra WHERE ra.circuit_id = ?1 ORDER BY ra.year DESC, ra.round DESC LIMIT 1`；无行返回 null。接口与实现同步加。fixture（无 db）路径与 `getRacePage` 的 fixture 口径保持一致：`melbourne` 返回 `{ year: 2026, slug: "australia" }`，其余返回 `null`（e2e 跑在 dev fixture 模式，重定向测试依赖这个返回值）。
5. 更新 `apps/web/src/lib/fixtures/race-australia-2026.json` meta：补新字段（full_name `Melbourne Grand Prix Circuit`、raceTime `04:00`、distance 306.124、turns 14、direction `Clockwise`、totalRacesHeld 29、firstGrandPrix 1996、recordLap `1:19.813 / Charles Leclerc / 2024`），删 `circuitName`。注意 totalRacesHeld 以当前 D1 为准（执行时用 `.data/d1/f1db.sql` 重查，勿照抄过期数字）。
6. 测试：`apps/web/tests/race-results-repository.test.ts` 补新字段断言（fixture 路径）；若仓库有 SQL 快照类测试同步更新。

验收：任务相关单测过；`pnpm check` 类型过（此任务完成后 RaceHeader 会因 meta 字段变化编译失败，属预期，任务 3 修复）。

## 任务 3：RaceHeader 重排与赛道信息卡

`apps/web/src/components/RaceHeader.astro`：

1. 区块顺序：标题块（巨型回合号描边装饰留在标题区背景）→ 赛道 SVG 与 `CircuitCard` 同一区块（桌面两列并排、375px 堆叠，对齐需求"相邻展示"）→ `WeekendSchedule`。SVG 从现 `.race-hero__map` 的 hero 右上 absolute 定位移出（连同其 `max-md:static` 一组响应式类一并重写），hero 的 `min-h-[clamp(34rem,70vw,52rem)]` 随之收紧——原值是为悬浮地图预留的空间，移走后不收紧会大片留白。
2. 副行改为 `{当地比赛日} · {meta.circuitPlace} · {meta.countryName}`：当地比赛日 = `formatRaceDate(meta.date, meta.raceTime, circuitTimeZone(meta.circuitId))`（回退门槛封装在函数内，见任务 1）。国家保持 countryName 全名。
3. 赛道图与赛道名链接全部移除（不再指向 /circuits）；SVG alt 用 `circuitFullName`。
4. 新建 `apps/web/src/components/CircuitCard.astro`：卡片标题为赛道全名；数据格沿用 `components.css` 现有 `.info-panel*` 视觉：Circuit Length（`courseLength.toFixed(3)` km）、Number of Laps、Race Distance（`distance.toFixed(3)` km）、Direction、Turns、First Grand Prix、Races Held、Fastest Lap（时间 + 车手 + 年份）。可空字段只有 `firstGrandPrix` 与 `recordLap`（race.distance/turns/direction/laps 在库中 NOT NULL），`—` 只会出现在这两处。不新增硬编码色；赛道页移除后零消费的 `circuit-hero*` 等样式类一并清理（被本卡复用的 `.info-panel*` 保留）。

验收：`pnpm check`、`pnpm test` 过；`pnpm --filter @f1-box/web build` 过。

## 任务 4：WeekendSchedule 双时间

`apps/web/src/components/WeekendSchedule.svelte`：

1. props 增加 `timeZone: string | null`；删除 UTC/Your time 切换按钮与 `data-time-toggle`、`useLocal` 状态。
2. 每个 session 行显示两个时间：My time（`data-my-time`）与 Track time（`data-track-time`）。Track time：`timeZone` 非空时 `formatLocalDateTime(startsAtUtc, timeZone)`，SSR 即正确；为 null 时显式走 `formatUtcDateTime`——不得把 undefined 传给 `formatLocalDateTime`，Intl 会落到宿主默认时区（Workers 是 UTC，Node 本地开发不是），输出随环境漂移。78 条赛道全有映射，此分支实际不可达，仍按显式 UTC 写。My time 保持现有渐进增强：SSR 渲染 UTC，客户端 `onMount`（或等价水合时机）后改为浏览器时区。
3. 标签文案用 `My time` / `Track time`，两个时间在桌面并排、移动端堆叠；行高与序号样式保持现状。
4. RaceHeader 传入 `timeZone={circuitTimeZone(meta.circuitId)}`。

测试：e2e 在任务 6 覆盖；如需组件级验证可用现有 e2e 手段，不新引入测试基建。

## 任务 5：重定向与 circuits 代码移除

1. `apps/web/src/pages/circuits/[id].astro` 改为 301 重定向存根：`getLatestRaceByCircuit(id)` 有值则 `Astro.redirect(`/results/${year}/races/${slug}/race-result`, 301)`，否则 404（沿用 StatusPage）。
2. `apps/web/src/pages/circuits/index.astro` 改为 301 到 `/results/${latestYear}/races`（latestYear 取 `raceResults.getSeasonYears()[0]`；无年份时回首页）。
3. 删除 `apps/web/src/lib/circuit-repository.ts`、`apps/web/src/lib/fixtures/circuits.json`、`apps/web/tests/circuit-repository.test.ts`；`apps/web/src/lib/repositories.ts` 移除 circuit 装配（AppRepositories 类型同步）。
4. 赛季矩阵链接改造：`driver-repository.ts` 与 `team-repository.ts` 的两处 `roundsSql` 增加 `gp.id AS slug`，`SeasonRound` 接口与 row mapper 增加 `slug`；`SeasonMatrix.astro` 的回合代号链接改为 `/results/{seasonYear}/races/{round.slug}/race-result`（year 取所属 season 的 year，注意该组件内 season 变量已带年份）。同步给三个 DEV fixture 的每个 round 补 `slug`（grand_prix id，取值以 `.data/d1/f1db.sql` 的 grand_prix 表为准，如 SAU 站为 `saudi-arabia`）：`fixtures/team-ferrari.json`、`fixtures/driver-george-russell.json`、`fixtures/driver-max-verstappen.json`——DEV 路径直接把 JSON 当页面数据返回，不补则类型检查与矩阵链接同时坏。
5. 全站搜索残留 `/circuits/` 字面量（排除本页两个重定向存根与 `/vendor/circuits/` 静态资产路径），确认为零。

验收：`pnpm check`、`pnpm test`、`pnpm -r build` 全过。

## 任务 6：e2e 更新

1. `tests/e2e/circuits.spec.ts` 重写为重定向规格（可更名 `redirects.spec.ts`）：`/circuits/melbourne` → 301 至 `/results/2026/races/australia/race-result`；`/circuits/nope` → 404；`/circuits` → 301 至最新赛季比赛列表。注意 fixture 模式下 `getLatestRaceByCircuit` 只有 melbourne 一条数据，其余赛道 id（含原用例的 shanghai）都走 404 分支，不要为它们写 301 断言。
2. `tests/e2e/results.spec.ts`：赛道图 `href` 断言改为"非链接且图可见"；新增头部副行文案断言（Australia 2026 为 `08 Mar 2026 · Melbourne · Australia`，与 countryName 口径一致）与赛道信息卡关键字段断言；时间区删除 `data-time-toggle` 用例，改为断言 `data-my-time` / `data-track-time` 同时存在；用 `timezoneId`（如 America/New_York 与 Asia/Tokyo 各跑一次）验证 My time 变化而 Track time 不变。注意水合时序：My time 在 SSR 阶段输出 UTC，水合后才转浏览器时区，断言必须用 `toHaveText(换算后的期望文本)` 这类自动重试断言等水合完成，不得在 goto 后立即快照比较。无 time 回退路径 fixture 模式只有 Australia 2026 一场，e2e 覆盖不到，由任务 1 的 `formatRaceDate` 单测兜底。
3. `tests/e2e/team.spec.ts`："round headers link to future circuit pages" 用例改写：`a[href="/circuits/jeddah"]` 改为 `a[href="/results/2024/races/saudi-arabia/race-result"]` 的可见性断言；删除随后的 `page.goto` 状态码断言（原测试是赛道页未实现时的临时 404 断言；现在目标页在 fixture 模式下无数据必然 404，导航验证无意义，链接正确性由 href 断言保证）。
4. `tests/e2e/a11y.spec.ts`：扫描路径列表移除 `/circuits`（其余路径不动）。
5. 全量跑 `pnpm --filter @f1-box/web test:e2e`（桌面 / 375px / reduced-motion / 双主题 axe）。

## 任务 7：文档同步

1. `docs/requirements/2026-08-22-circuit-pages.md`：文首加一行说明"赛道详情页与目录页已于 2026-08-31 并入分站页（见 2026-08-31-race-page-circuit-merge.md）"，状态字段不改（历史需求保留原状态）。
2. 检查 `docs/context/`、`docs/research/` 有无引用 `/circuits` 页面行为的描述，有则同步改写。

## 最终验证

- `pnpm check`、`pnpm test`、`pnpm -r build`、`pnpm --filter @f1-box/web test:e2e` 全绿。
- 提 PR 前在 preview 目视检查（桌面 + 375px，深浅两主题）：Australia 2026 分站页区块顺序与卡片内容；Las Vegas 2026 副行日期 `21 Nov 2026` 且 Track time 为当地口径；一场历史老赛（如 `/results/1995/races/adelaide/race-result`）缺数据处显示 `—`；车手页（如 george-russell）赛季矩阵回合链接跳转正确。
- 按 `submit` 流程提 PR：标题英文简述合并赛道页与时间展示调整，正文含 Summary 与 Test plan。
