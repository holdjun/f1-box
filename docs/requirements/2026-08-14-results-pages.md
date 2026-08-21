# Results 页面复刻 f1.com（数据源 f1db）

日期：2026-08-14
状态：预览验收

## 背景与目标

参照 <https://www.formula1.com/en/results/2026/races> 的结构复刻本站 Results 页面：赛季各站结果列表 + 每站多类型结果子页面。数据源从 R2（Jolpica 采集）切换到 D1 f1db，向退役 Jolpica 迈进一步——完成后 R2 访客路径只剩首页。

## 用户可见行为

- URL 重新设计为 `/results/[year]/races`：
  - `/results/[year]/races` 该赛季已完赛分站列表（Grand Prix 旗标与名称、Date、Winner 车队色 monogram 与姓名、Team logo 与队名、Laps、Time）
  - `/results/[year]/races/[slug]` 分站页，默认重定向 `race-result`
  - `/results/[year]/races/[slug]/[tab]` 子页面，tab 含 race-result、fastest-laps、pit-stop-summary、starting-grid、qualifying、practice-1/2/3（有数据才出现在子导航）
- 分站页顶部：轮次与大奖赛名、日期、赛道、各 session 时间行（客户端本地时区显示）
- `/results` 重定向到最新赛季 races；`/results/[year]` 重定向到该年 races
- 旧 URL 兼容：`/[year]/results/*` 301 到新位置；`/[year]/racing/[event]` 分站页删除，旧地址返回 404
- `/[year]/racing` 日历页保留，数据源一并切到 f1db（1950 起全历史赛历可浏览）；分站链接直接指向新分站页（未来分站页只显示轮次与 session 时间，无结果数据）
- 新页面上的年份切换（YearSelector）停留在 Results 分区内
- drivers / teams 两个积分榜 tab 跟随迁移到 `/results/[year]/drivers`、`/results/[year]/teams`，数据源一并切到 f1db（1950 起全历史积分榜；wins 由正赛 P1 结果聚合）
- 所有年份（1950 起）只要有 f1db 数据即可浏览

## 验收标准

- 列表页与分站页各 tab 的列结构与 f1.com 一致（差异见范围外）；Winner/Driver 单元格为车队色 monogram 圆底 + 姓名（小屏缩写），Team 单元格为 logo + 队名；pit-stop-summary 按车手聚合，列为 Pos, No., Driver, Team, Stops, Total Time（无单停 Lap/Time 列）
- 分站页 tab 子导航按数据存在与否显示；未知 tab、未知 slug 返回 404
- `/[year]/results/*` 301 到新路径（e2e 断言）；`/2026/results` → `/results/2026/races`；旧分站详情地址（如 `/2026/racing/10-belgian-grand-prix`）返回 404
- 日历页分站链接直接指向新分站页地址（e2e 断言）
- 积分榜与日历的年份覆盖与 races 一致（f1db season 表，1950 起）
- 数据源：生产走 D1（env.F1_DB）；本地 DEV 走 fixtures 真实数据快照
- `pnpm check`、`pnpm test`、`pnpm --dir apps/web build`、e2e 全绿；桌面与 375px 移动端视觉检查通过

## 验收反馈迭代（2026-08-20）

- 年份选择器重做：results 系列页面与日历页改用页面内容区的 SeasonFilter（年代分组面板，参考 f1.com 页面内选择器）；全局 header 内的年份 pill 列表（YearSelector）退役删除
- 车手/车队可点击：结果表、列表页、积分榜的车手链接 `/drivers/[id]`、车队链接 `/teams/[slug]`（复用已有详情页）
- 积分榜表格风格与 races 页对齐（result-table 样式、monogram/logo 单元格）

## 范围外

- 练习赛之外的历史 session 类型（practice-4、pre-qualifying、warming-up）不做子页面
- Sprint 结果不进入本页 tab（f1.com races 子导航同样没有；留待独立入口）
- f1.com 表格中的 Time of Day 列（f1db 无此数据，去掉该列）；Avg. Speed 由圈速与赛道长度计算补上
- 车手照片：不用上游头像，统一 monogram
- 首页数据源迁移（仍走 R2 getIndex，随 Jolpica 退役一并处理）
- 未来分站不在列表页显示（与 f1.com 一致，只列已完赛分站）
