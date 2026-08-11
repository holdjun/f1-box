# 车队目录排序与继承链展示

## 背景

`/teams` 当前按车队名称字母排序，重要车队和当前参赛车队被历史小车队分散。车队详情页还把独立早期参赛段和 constructor chronology 连续链混合成一条箭头，容易让人误以为 Alfa Romeo 1950 年的记录属于 Sauber 的直接前身。

## 用户可见行为

- `/teams` 不显示年份或统计文字，但排序按当前参赛状态、冠军数、胜场、参赛场次、积分和名称稳定排序。
- 车队详情页将 chronology 连续链与当前身份在连续链之前的独立早期参赛段分开显示。
- 统计数据仍只属于当前 constructor 身份，不因展示继承链而合并到其他身份。

## 验收标准

- 当前赛季车队出现在历史车队之前。
- Ferrari、McLaren、Williams、Mercedes、Red Bull 等高成就车队出现在目录前部。
- Alfa Romeo 页面能区分 1950–1951、1979–1985 独立参赛段与 1993 年开始的 Sauber 连续链。
- Sauber 页面不会因为浏览继承链而显示 Alfa Romeo 1950/1979 的统计赛季。
- 旧路由和无数据库 fixture 仍能正常工作。

## 范围外

- 不修改 D1 中的原始 constructor chronology 关系。
- 不在本需求中批量制作低可信度历史 logo。
