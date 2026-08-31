# 分站页合并赛道页

日期：2026-08-31
状态：开发中

## 背景与目标

赛道详情目前是独立的 `/circuits/:id` 页面，内容与分站详情页高度关联却需要二次跳转；分站页头部还存在两处数据展示问题：赛道短名导致"Melbourne, Melbourne"式的重复城市名（奥斯汀显示为"Americas, Austin"，拉斯维加斯显示为"Las Vegas, Las Vegas"），以及日期按 UTC 渲染导致拉斯维加斯这类跨日夜赛比当地比赛日晚一天。本次把赛道内容并入分站页，让一场比赛的所有信息聚合在一个页面，并修正上述文案问题。

## 用户可见行为

- 分站详情页（`/results/:year/races/:slug/:tab`，所有年份所有分站）区块顺序为：标题块 → 赛道 SVG + 赛道信息卡 → Weekend schedule → 各结果 tab。巨型回合号装饰、SeasonFilter 位置保持不变。
- 标题块：h1 保持大奖赛名（如 Australia）；副行改为 `{当地比赛日} · {城市} · {国家}`，如 `08 Mar 2026 · Melbourne · Australia`、`21 Nov 2026 · Las Vegas · United States of America`。国家沿用 country.name 全名（与现状口径一致，不引入缩写）。原有指向赛道页的赛道名链接移除。官方全名行（如 Formula 1 Qatar Airways Australian Grand Prix 2026）保持不变。
- 当地比赛日：仅当 `ra.time` 非空且赛道时区映射存在时，用正赛发车时刻（race date+time，UTC）按赛道时区渲染日期。无 time 的比赛（实测 1101/1171 场，历史赛绝大多数）或无时区映射的赛道保持现状 UTC 日期——不得用合成的 00:00 时刻做时区换算，否则美洲等负偏移时区会往前退一天。
- 赛道信息卡内容（数据缺失显示 "—"）：赛道全名（full_name，作卡片标题）、Circuit Length（本场 course_length，km 三位小数）、Number of Laps（本场 laps）、Race Distance（本场 distance，km）、方向与弯数（本场 direction/turns）、First Grand Prix（该赛道最早办赛年份）、Races Held（该赛道累计办赛场次）、Fastest Lap（该赛道历史最快圈：时间 + 车手 + 年份，口径同原赛道详情页）。
- 赛道 SVG 保持现状（优先注解版地图，无注解回落 f1db 轮廓），不再是链接；与赛道信息卡相邻展示（桌面并排、移动端堆叠）。
- Weekend schedule：每个 session 同时显示两个时间——My time（访客本地时区）与 Track time（赛道当地时区），不再提供 UTC/Your time 切换按钮。无 JS 时 My time 显示 UTC 时间（保留现有渐进增强方式，客户端水合后转为访客时区），Track time 由服务端直接渲染、无需 JS 即正确。无 session 的老比赛整块隐藏（同现状）。
- `/circuits` 与 `/circuits/:id` 页面移除：`/circuits/:id` 301 到该赛道最近一场比赛的分站详情页（`/results/{year}/races/{slug}/race-result`），未知赛道 404；`/circuits` 301 到最新赛季比赛列表 `/results/:year/races`。
- 原指向 `/circuits/:id` 的站内链接全部改为分站页链接：车手/车队页赛季矩阵的回合代号链接指向该年份对应分站（`/results/{year}/races/{slug}/race-result`）；分站页自身的赛道图与赛道名不再外链。

## 验收标准

- `pnpm check`、`pnpm test`、`pnpm -r build` 全绿；`pnpm --filter @f1-box/web test:e2e` 全绿（桌面 / 375px / reduced-motion / 双主题 axe）。
- 抽查分站页：Australia 2026（副行 `08 Mar 2026 · Melbourne · Australia`）、Las Vegas 2026（副行日期为 `21 Nov 2026`，Track time 为当地 20:00 口径）、一场历史老赛（如 1995 Adelaide）区块齐全、缺数据显示 "—" 不报错。
- 无 time 的历史比赛（如 1995 Adelaide）副行日期保持 UTC 日期，不因时区换算偏移。
- `/circuits/melbourne` 301 到 `/results/2026/races/australia/race-result`；`/circuits/nope` 404；`/circuits` 301 到最新赛季比赛列表。
- 车手页与车队页赛季矩阵回合代号链接指向对应年份分站页。
- Weekend schedule 每个 session 同时渲染 My time 与 Track time；切换浏览器时区（或 Playwright timezoneId）后 My time 随之变化，Track time 不变。
- 新增赛道时区映射覆盖 f1db 全部赛道（当前 78 条），无遗漏。
- preview 桌面与 375px、深浅两主题目视检查分站页新布局无溢出、无错位。

## 范围外

- 历史布局切换（按年查看旧布局图）。
- 赛道时区的历史沿革考据（IANA 时区库自带的历史 DST 规则直接用，不单独核对早期年份）。
- 结果 tab 表格内容与 tab 切换逻辑。
- 导航栏改动（本来就没有 Circuits 入口）。
- 国家名缩写（IOC 三字码等短码展示），保持 country.name 全名。
