# 赛道页面与 racing 路由迁移

日期：2026-08-22
状态：开发中

## 背景与目标

racing 日历路由 `/:year/racing` 与 results 的 `/results/:year` 模式不一致，迁移到 `/racing/:year`。同时补全赛道目录与详情页：f1db 已提供 circuit 数据与赛道轮廓 SVG，站点此前没有任何赛道页面。详情页参照 f1.com 风格：左侧赛道轮廓图，右侧关键数据卡。

## 用户可见行为

- `/racing/:year` 为赛季日历新地址；旧地址 `/:year/racing` 301 到新地址，垃圾年份回首页。
- 主导航新增 Circuits 项（Racing / Results / Circuits / Drivers / Teams）。
- `/circuits` 目录页：赛季过滤器 + 卡片网格（轮廓缩略图、名称、地点、长度、办赛场数），按办赛场数降序。
- `/circuits/:id` 详情页：当前布局轮廓 SVG + Circuit Length / First Grand Prix / Number of Laps / Race Distance / Fastest Lap（含车手与年份）/ Races Held。
- 分站详情页 hero 的赛道名变为链接，指向该赛道详情页。
- 分站详情页 hero 右上空区显示该场赛事布局的轮廓图（移动端居中置于顶部），整图链接到赛道详情页。
- 布局口径：目录与详情均显示该赛道最近一场比赛所用的 layout（SVG 与 laps/distance 同口径）。

## 验收标准

- `pnpm check`、`pnpm test`、`pnpm -r build` 全绿。
- e2e：circuits.spec.ts 覆盖目录、按年过滤、详情数据、404、race hero 链接、375px 无溢出；season.spec.ts 覆盖新路由与旧路由 301。
- preview 桌面与 375px 目视检查目录与详情页。
- SVG 经 `scripts/f1db-circuit-svg-sync.sh` 从 f1db 仓库同步入库（160 个布局），缺失 SVG 的赛道页面优雅降级不显示图。

## 范围外

- 历史布局切换（?layout= / 按年查看旧布局图）。
- sector 配色、DRS 区、弯角编号等注解图（f1db 无此数据，SVG 为纯轮廓）。
- racing 日历卡片的赛道链接（卡片整体已是链接，嵌套 anchor 不合法）。
