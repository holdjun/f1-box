# Racing 页 F1 日历订阅（自建 ICS 端点）

日期：2026-08-26
状态：开发中

## 背景与目标

F1 官方在 racing 页提供 "Add F1 calendar"（calendar.formula1.com 订阅）：把全部 session 加进用户日历、自动转本地时区提醒。f1-box 的 D1 已有全部站次 session 时间（data-sync 自动随 f1db 更新），自建 ICS 端点是无状态、无独立数据的一次性投入，且能把每个日历事件回链到 f1-box 对应赛果页——这是官方日历不会给的。目标：racing 页提供日历订阅入口，数据与站点展示同源。

## 用户可见行为

- racing 页（/racing/2026）Next 面板内新增 "Add to calendar" 入口，点开后三个操作：
  - 订阅日历：`webcal://f1-box.com/api/calendar.ics?year=2026`（Apple Calendar 等原生唤起，订阅后赛程变更自动更新）
  - 下载 .ics：`https://f1-box.com/api/calendar.ics?year=2026`（静态快照，一次性导入）
  - 复制日历 URL：同 https 链接，给 Google Calendar 网页版用户"从网址添加"用
- ICS 内容：当年每站每个已排定的 session 一个事件（Practice 1/2/3、Qualifying、Sprint Qualifying、Sprint、Race），UTC 时间戳由日历应用自动转用户本地时区
- 事件命名如 "Practice 1 · Australia"；每个事件带 URL 字段回链对应赛果页（f1-box.com/results/2026/races/italy/race-result）
- 无 JS 可用（订阅/下载都是纯链接）

## 技术要点

- 开发前先用 D1 数据重新生成 fixture `season-races-2026.json`：当前 fixture 停留在 22 站版本，缺 Bahrain（Sepang 承办，round 16，2026-10-04）；生产 D1（f1db v2026.12.0）已是 23 站，不补齐则 DEV/e2e 与生产行为不一致
- 新增 API 路由 `GET /api/calendar.ics?year=<year>`：复用 `getSeasonCalendar(year)`，把 `sessions[]` 渲染为 ICS（RFC 5545：CRLF 行尾、75 octet 行折叠、文本字段转义、`Content-Type: text/calendar; charset=utf-8`）；VCALENDAR 必含 `VERSION`/`PRODID`，另带 `X-WR-CALNAME`（如 "F1 2026 · f1-box"）与 `REFRESH-INTERVAL;VALUE=DURATION:P1D` 提示订阅端刷新频率；响应加 `Content-Disposition: attachment; filename="f1-<year>.ics"` 让 https 链接直开即得正确文件名（不影响 Apple/Google 抓取解析）
- UID 用 `<sessionKey>-<slug>-<year>@f1-box.com`（如 `race-bahrain-2026@f1-box.com`），保证订阅刷新时同一事件不重复。不能用 round：2026 赛程已实际平移两次（Bahrain/Saudi 4 月站取消缩至 22 站，后又插入 Sepang 承办的 Bahrain 回到 23 站），round 平移会把老事件整体换 ID，订阅端成批重复。slug（grand_prix_id）若因 GP 改名/换地而变，表现为订阅端删旧事件+加新事件而非原地更新，可接受——2026 Bahrain 挪至 Sepang 时 grand_prix_id 未变，恰是 slug 稳于 round 的实证
- DTEND 用固定估算时长（f1db 无时长）：练习/排位/Sprint 排位 1h、Sprint/正赛 2h
- session 时间缺失分两类，都不报错：sprint 周末结构性无 Practice 2/3、老年份（2020-2022）整年无 session 时间——date 为 NULL 时 repository 本就跳过；date 已定而 time 未公布时 `buildSessions` 会兜底 `"00:00"`（f1db 惯例时间后补）。ICS 端点以 startsAtUtc 精确等于 `T00:00:00Z` 为过滤判据——这正是 buildSessions 的兜底字符串本身，属机制性匹配而非经验时间窗推断
- year 必填：参数缺失或非法一律 404；查询结果为空（未导入赛季）同样 404；有站次记录但无可渲染事件（如 2020-2022 整年无 session 时间）也返回 404——订阅一个永远为空的日历没有意义
- edge cache：#21 中间件策略显式排除 `/api/*`（middleware.ts），本端点在路由内显式 `context.cache.set()` opt-in，参数与全站一致（maxAge 300 + swr 600 + tags ["f1db"]）——f1db 标签为 data-sync 后按标签清缓存预留，当前仅靠 maxAge+SWR 也已远快于 data-sync 节奏

## 验收标准

- `GET /api/calendar.ics?year=2026` 返回合法 ICS：VCALENDAR 头、VEVENT 集合与 `getSeasonCalendar(year)` 经 `T00:00:00Z` 兜底过滤后的 session 集合一致（动态断言，不写死站数；参考值：当前 D1 23 站 × 每站 5 session = 115 个 VEVENT，随未来未公布时间的站次浮动）、UTC DTSTART/DTEND、UID 由 key+slug+year 构成且稳定
- 单测：ICS 生成器（事件数与字段完整性、CRLF、75 octet 行折叠、SUMMARY 等文本字段的 `,`/`;`/`\\` 转义、UID 稳定性、`T00:00:00Z` 兜底过滤、老年份无 session 退化、year 缺失/非法/空赛季/无可渲染事件返回 404）
- e2e：Next 面板日历入口存在、webcal 与 https 链接正确；ICS 端点 Content-Type 正确
- `pnpm check`、`pnpm test`、`pnpm -r build`、`pnpm --filter @f1-box/web test:e2e` 全绿
- 深亮双主题 + 375px 不回归（a11y axe 基线）

## 范围外

- Google Calendar 一键添加（OAuth/event link），仅提供"复制 URL"手动订阅路径
- session 时长精确值（f1db 无此数据，固定估算）
- 2026 之外年份的 UI 入口（端点支持 year 参数，但入口只做当前赛季）
- 提醒设置（REMINDER/VALARM），由用户日历应用自行管理
