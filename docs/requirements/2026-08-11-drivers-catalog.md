# 全局车手目录 /drivers

日期：2026-08-11
状态：开发中

## 背景与目标

车手板块仍困在年份作用域：/{year}/drivers 网格与 /{year}/drivers/{code} 详情消费 jolpica R2 payload（#38 待退役），全局 /drivers 不存在，车队页的车手链接（/drivers/{id}）落 404。teams 目录已全球化并切到 D1，车手目录对齐同一形态。PR 5 曾在 jolpica 架构上尝试车手页，架构过时已关闭，本需求在 D1 上从头做。

## 用户可见行为

- /drivers 为唯一的全部车手目录：卡片网格，每卡显示放大的永久车号（无车号的历史车手用两字母 monogram 回落）、车手名、最新赛季车队、国籍旗。
- 收录全部车手（917 人）；当前赛季车手排前，其余按冠军数、胜场、参赛数、名字排序（同 /teams 哲学）。
- 卡片链接 /drivers/{id}（详情页本次不做，暂 404，与车队页车手链接现状一致）。
- 主导航 Drivers 恒指向 /drivers；/{year}/drivers 与 /{year}/drivers/{code} 删除，访问 404，不留重定向。

## 验收标准

- driver-repository 单测：SQL 含去重窗口与排序列；行映射 number/team/flag 的 null 透传；fixture 断言 russell=63/Mercedes、senna 无号 monogram、current 全在历史前。
- e2e：/drivers 渲染 fixture 全量卡片；russell 卡含 63、Mercedes、gb 旗；senna 卡 monogram 且无车号；/{year}/drivers 404；racing 页导航 Drivers href=/drivers。
- 917 卡页面加 content-visibility 控制渲染成本。
- pnpm check / pnpm test / e2e / build 通过；preview 目检桌面与 375px。

## 范围外

- /drivers/{id} 详情页（链接预留）。
- 分页、车手照片/logo、卡上积分或排名文案。
- v1/seasons 退役（#38）。
