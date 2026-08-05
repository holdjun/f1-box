# 多赛季站点重设计（参考 formula1.com）设计文档

日期：2026-08-05
状态：设计定稿，待实施
关联调研：`docs/research/formula1-com-reference.md`（formula1.com 信息架构与截图）

## 背景与目标

现有站点只有一个写死的 2026 赛季首页/赛季页，无法浏览历史赛季，也没有车手/车队目录与生涯数据。用户希望参考 formula1.com 的成熟设计，重做一个"年份为全局作用域、下分 racing / results / drivers / teams"的多赛季数据站：先把前端页面立起来（2026 先做好），之后只靠"加数据 + 加图片"就能自动适配更多年份；数据回填与 i18n 放在后面。

目标：

- 年份作为全站顶层作用域，同一时间语境下看赛历、结果、车手、车队。
- 页面结构与官方对齐但更适配多赛季（drivers/teams 也按年）。
- 数据模型按"年份可增"设计，加一年 = 加一组数据，不改代码。
- 补齐官方没有的两类图表：车手生涯、车队跨年。
- 视觉不依赖任何官方版权素材。

## 用户可见行为

- 打开站点根路径，跳转到数据索引标记的当前活跃赛季的 racing 页。
- 顶部有全局年份选择器，切换年份保留当前板块（在 results/drivers 里切年不回退）。
- 选 2025 就看到 2025 的赛历、结果、车手阵容、车队阵容。
- racing 页展示赛季进程：下一场 hero（倒计时）、已结束（带前三名）、未来赛历。
- results 下有三张表（races / drivers / teams）与单场 session 下钻。
- drivers/teams 有网格目录与详情页；详情页含当年统计、Career 统计与图表。
- 某车手/车队在所选年份不存在时，回退到该年目录页并提示，不出现空详情页。

## 路由（定稿）

```text
/ → /{activeSeason}/racing
/{year} → /{year}/racing

/{year}/racing
/{year}/racing/{event-slug}

/{year}/results/races
/{year}/results/races/{event-slug}/{session}

/{year}/results/drivers
/{year}/results/teams

/{year}/drivers
/{year}/drivers/{driver-slug}

/{year}/teams
/{year}/teams/{team-slug}
```

`{session}` 预留：`race`、`qualifying`、`sprint`、`sprint-qualifying`。

约定：

- 年份覆盖 racing / results / drivers / teams，全站一致。
- `activeSeason` 来自数据索引，不等于系统年份。
- `{event-slug}` 可含轮次用于展示（如 `02-china`），但数据层保留稳定 `eventId`（赛历可调、测试赛无 round）。
- 实体、年份、比赛、session 放 path；排序/筛选/显示偏好放 query string（如 `?sort=pts&order=desc`）。
- 切年保留路径；实体在该年不存在时回退该年目录页并提示。
- `/{year}/drivers/{slug}` 语义为"该车手在该赛季的资料页"：当年统计/当年车队受年份影响；Career Stats、生涯图表、车队时间线不受年份影响且明确标为 Career。车队页同理。

## 页面清单

racing/{year}：下一场 hero（倒计时、本地/赛道时间）、Previous/Next/Upcoming、赛历卡片流（已结束带 P1-P3、下一场高亮、未来带日期与赛道线稿）、赛季进度。

racing/{event-slug}：单站周末页，展示该站各 session 的时间与状态、赛道信息，并链接到 results 下对应 session 的成绩表。它管"赛程"，results 的 session 页管"成绩"，两者不混。

results/races：表列 GRAND PRIX / DATE / WINNER / TEAM / LAPS / TIME，行点击进单场。
results/races/{event}/{session}：单场该 session 完整成绩表（POS / NO / DRIVER / TEAM / LAPS / TIME-RETIRED / PTS）。
results/drivers：POS. / DRIVER / NATIONALITY / TEAM / PTS.。
results/teams：POS. / TEAM / PTS.。

drivers 网格：车手卡（姓名、车队、车号、国旗、队伍色、头像槽位）。
drivers/{slug}：hero + 当年统计 + Career 统计 + 生涯折线 + stints 时间线。
teams 网格：车队卡（队名、两名车手、队伍色、赛车轮廓槽位、logo 槽位）。
teams/{slug}：hero + 两名车手 + 当年统计 + 历史摘要 + 跨年折线。

## 数据模型（三层，年份可增）

第一层 赛季层（每年一份）：events（稳定 eventId、round、slug、raceName、circuit、dates、state）、sessions、各 session 成绩、车手积分榜、车队积分榜。喂 racing 与 results。由现有 SeasonPayload 扩展而来。

第二层 目录层（每年一份）：该年车手（slug、name、number、country、stints 列表）、该年车队（slug、name、color、drivers）。stints 为 `[{teamId, fromRound, toRound}]`，支持赛季中换队；积分榜仍一人一行。喂 drivers/teams 网格与详情页当年部分。

第三层 生涯层（跨年聚合）：每位车手/车队按赛季的记录（year、team、position、points、wins、podiums）。喂车手生涯图、车队跨年图、Career Stats。采集时由一二层跨年聚合生成，加一年自动多一个点。

全局索引：`{ availableYears: number[], activeSeason: number }`。前端据此画年份选择器与根跳转。

首版用 fixture 跑：2026 全量 + 1~2 个历史年（证明多年与生涯图）。采集/历史回填后续做，属范围外。

## 视觉与素材（不碰版权）

借鉴官方布局/IA，但全部使用自有数据驱动资产；组件预留图片槽位，先以兜底形态渲染，后续可补 AI 生成剪影/自制头像：

- 车手：姓名 + 车号（大字号排版）+ 国旗 + 自制头像/剪影槽位（兜底为车号+队伍色）。
- 车队：队名 + 自定义颜色 + 自制赛车轮廓槽位 + 可选 logo 槽位（兜底为 monogram 徽章）。
- 赛事：国家/城市 + 国旗 + 自制赛道线稿槽位。
- 详情页：数据卡、图表、时间线，不依赖官方照片。
- 国旗用公共领域 SVG；车队色为事实数据。

## 图表（读生涯层）

车手生涯：折线 X=赛季、Y 可切（积分/名次）；数据点按当年车队着色；tooltip 显示年+队+数值；下方 stints 时间线（每赛季一段横条，颜色=车队，含中途换队）。
车队历史：折线 X=年份、Y 可切（名次/积分/领奖台/胜）；车队详情页默认单队，提供对比模式叠加多队；点某年跳该车队该年页。
视觉细节（配色、明暗、可访问性）实现阶段按 dataviz 规范执行。

## 实施拆分（竖切，前端先行）

0 地基：路由壳 + 全局年份选择器 + 数据索引 + 2026 fixture + 视觉 token（车队色/国旗/版式）。
1 racing/{year} + results/races（含单场 session 下钻）。
2 results/drivers + results/teams。
3 drivers 网格 + 车手详情（生涯图表）。
4 teams 网格 + 车队详情（跨年图表）。
之后：采集/历史回填（数据），最后 i18n。

## 范围外

- 新闻、视频、商店、合作伙伴墙、Awards（URL/tab 可预留但不实现）。
- 官方图片/赛车渲染图/官方 logo。
- 采集服务扩展与历史数据回填（后续子项目）。
- i18n（后续子项目）。
