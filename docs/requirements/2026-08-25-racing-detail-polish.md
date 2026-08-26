# Racing 页面细节优化（倒计时、时间切换、赛道图、年份按钮）

日期：2026-08-25
状态：已完成（PR #22）

## 背景与目标

赛车页与比赛详情页存在四处细节问题：年份筛选面板向上展开时被顶部导航遮住；Next · Round 只有正赛时间没有倒计时；比赛详情页时间只有 UTC 一种显示；日历卡片信息密度低（无赛道图、时间只有单场）。本轮集中优化，并为后续小需求预留迭代空间。

## 用户可见行为

- 年份筛选面板向上展开时，顶部的 2025/2026 等最高年份不再被导航栏遮住，可以正常点击。
- Racing 页 Next · Round 面板显示倒计时，自动指向下一场未开始的 session（练习赛 → 排位赛 → 正赛逐个推进）；某站周末已全部开始但结果未发布时显示 in progress。
- 比赛详情页（如 results/2026/races/australia/race-result）的 Weekend schedule 列出全部 session 时间（练习赛/排位/正赛），并可通过按钮在 UTC 与用户本地时间之间切换。
- Racing 页每张比赛卡片：标题去掉 Grand Prix 后缀（如 Australian Grand Prix → Australia）；时间改为周末范围（如 🏁 06-08 MAR）；卡片最右侧显示赛道 SVG。
- Next 面板的下一站选择：当某未完赛站的周末已全部过去（结果滞后发布）时，面板自动指向还有未开始 session 的下一站。

## 验收标准

- `pnpm check`、`pnpm test`、`pnpm -r build`、`pnpm --filter @f1-box/web test:e2e` 全绿。
- e2e：racing 卡片标题无 Grand Prix、周末范围文本、赛道图加载；Next 倒计时每秒跳变（或 in progress 分支）；race-result 时间按钮切换 UTC/本地。
- 单测：日历数据含全部 session 时间与赛道布局 id（含 sprint 周末顺序）；formatWeekendRange 同月/跨月格式。
- 深/亮双主题与 375px 移动端不回归（a11y axe 基线）。

## 范围外

- 生产 D1 数据重新导入（fixture 与 D1 同一条 SQL 路径，无需单独迁移）。
- race-result 页 session 列表加倒计时（当前只有 racing 页 Next 面板倒计时）。