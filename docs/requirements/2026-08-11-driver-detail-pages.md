# 车手详情页 /drivers/{id}

日期：2026-08-11
状态：开发中

## 背景与目标

全局车手目录（PR 10）上线后，目录卡与车队页的车手链接都指向 /drivers/{id}，尚无实现。本需求把车手详情页补全，数据全走 D1 f1db，页面形态对齐车队详情页 /teams/{slug}。

## 用户可见行为

- 在役车手：hero + "{year} Season" 面板（gating 同车队页：currentSeason.year === activeSeason）+ Career Stats 面板；退役车手只显示 Career Stats。
- hero：放大永久车号作标识（无号历史车手 monogram 回落）、全名、国籍旗与国名、Date of Birth / Place of Birth（f1db 有则显示），date_of_death 有则显示。
- 编号变更带年份：由每场赛果的车号按年推导，连续同年号合并为区间 chip（如 #33 2015–2021 → #1 2022–2025 → #3 2026）；单一号段不渲染（hero 已有大号）。只取 1974 年起——此前车号按站分配、无身份意义（1950–73 单人单季最多用过 12 个号），纯 1974 前车手不显示编号行。
- 下方 Season results：每年一个赛季块，表格借用车队页形态（轮次作列、结果格含胜负色/†/P/F/冲刺上标/断档分隔）；行=该年该车队的参赛条目，链 /teams/{id}，季中转会多行。
- 未知 slug 404。

## 验收标准

- driver-repository 单测：身份与 totals 映射、号区间合并（断档不合并、同年多号）、双队年行映射与共享车 keep-first、standings 落位、在役/退役 gating、404 与畸形行。
- e2e：russell 页（hero 63、gb 旗、DOB "15 February 1998" + King's Lynn、2026 面板、Career 面板）；verstappen 页（三枚号 chip、夺冠块高亮）；unknown 404；移动端不溢出。
- 车队页切换到共享赛季矩阵组件后 e2e 全绿（无回归）。
- race_data 增加 (driver_id, type) 索引（dump 脚本同步），详情页查询不走全表扫。
- pnpm check / pnpm test / e2e / build 通过；preview 目检在役、退役、无号三种形态。

## 范围外

- 车手照片/头像、维基百科链接。
- 目录分页与筛选。
- v1/seasons 退役（#38）。
