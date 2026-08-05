# drivers 列表与详情页完善设计文档

日期：2026-08-05
状态：设计定稿，待实施
关联：`docs/superpowers/specs/2026-08-05-multi-season-site-design.md`（drivers 路由与页面描述以本文档为准）、`docs/research/formula1-com-reference.md`、`docs/research/shots/drivers-grid.png`（官方列表截图）

## 背景与目标

多赛季骨架（PR #4）里的 drivers 板块仍是凑合形态：列表卡只有排位/姓名/车队/积分，详情页按年作用域且内容单薄。本轮参考 formula1.com 的 drivers 列表与详情页，把 drivers 板块补成完整形态：

- 列表卡对齐官方视觉语言：车队色块 + 名/姓分层 + 车队 + 大车号 + 国籍圆旗。
- 详情页改为全局生涯页 `/drivers/{slug}`：hero + 本赛季统计 + Career 聚合 + 赛季经历表 + Wikipedia 链接。
- 准备可复用的"车队色 + 车号"小徽章组件，供后续表格复用。
- 车手历史车队/车号随年份变化：列表卡的颜色与内容完全由该年数据驱动；详情页的 Career 部分跨年聚合。

视觉走"VLM 出审美方案、代码实现等效效果"：VLM 读官方截图输出可落地参数（已产出，见视觉规格节），组件用纯 CSS/SVG 实现，不引入位图与官方素材；实现后截图交 VLM 对照官方做一轮审校迭代。

## 用户可见行为

- `/{year}/drivers`：响应式卡片网格，顺序=该年车手积分榜。卡片为车队色渐变块：名（中等字重）/姓（超粗）两行、车队名、大号斜体车号、左下圆形国籍旗；右侧点阵纹理 + 低透明度车号水印。不再显示积分/排位（官方卡亦无）。
- 点击卡片跳 `/drivers/{slug}`（全局，无年份；slug 形如 `george-russell`）。
- `/drivers/{slug}`：
  - hero：车队色渐变 + 点阵；名（细斜体，签名感）+ 姓（超粗全大写）；meta 行=圆旗+国籍 | 车队 | 车号（半透明竖分隔线）；右侧超大车号水印溢出裁切；Wikipedia 外链。
  - 本赛季块：Season Position / Points / Races / Wins / Podiums / Poles / Top 10s / Fastest Laps / DNFs 双列统计格。
  - Career 块：聚合面板（GP entered / Career points / Wins / Podiums / Poles / Best finish）+ 每赛季表（年份/车队/排位/积分，即"待过的队伍"时间线）；≥2 个赛季数据时加逐年积分趋势图（复用 TrendChart）。
- "本赛季"取 activeSeason；车手不在 activeSeason 时回退其最近参赛赛季。
- 旧数据降级：payload 缺新字段时，卡隐藏车号/国旗、hero 隐藏 wiki 链接与 meta 车号、无法推导的统计行隐藏；不报错不空占位。
- 未知 slug 404。

## 路由

```text
/{year}/drivers       列表（不变）
/drivers/{slug}       详情（新增，全局）
```

删除 `/{year}/drivers/{slug}` 路由，不留重定向（站点尚新，无外链）。详情页头部年份选择器切年落 `/{year}/drivers`（rest="drivers"）。

## 数据模型变更

SeasonPayload schema 增加可选字段（schemaVersion 保持 1；R2 旧 payload 继续通过校验，重发布前优雅降级）：

DriverStanding 增：

- `slug: string`——name 的小写连字符形式（ingest `_slug`）。
- `givenName: string`、`familyName: string`。
- `number: integer`——permanentNumber。
- `nationality: string`——上游原文（如 "British"）。
- `wikipediaUrl: string`——Driver.url（本身即维基百科链接）。

RaceRow 增：

- `fastestLapRank: integer`——FastestLap.rank（最快圈统计需要，现只存时间无法判定）。

ingest（normalize.py）：

- `_driver_standings` 顺手读取上述 Driver 字段并产 slug；`_race_classification` 读 FastestLap.rank。
- 更新 `tests/fixtures/jolpica/*.json` 补字段，`test_normalize` 断言。
- 重新生成 `packages/contracts/fixtures/season-2026.json`（ingest 本地构建）。

contracts：JSON Schema 源加可选字段，重新生成 `season.generated.ts` 与 validator。

tokens.ts 重写旗标部分（现 `countryFlag`/`ALPHA3_TO_ALPHA2` 无调用点，删除）：

- `NATIONALITY_TO_ALPHA2: Record<string, string>`——国籍原文 → ISO alpha-2；首版覆盖 2026 全部车手国籍，历史回填时按需补。
- `flagForNationality(nationality: string | undefined): string`——未知/缺失回退白旗（沿用现有 emoji 计算与兜底）。

## 组件与派生

新组件：

- `DriverCard.astro`——props：`{ slug, name, givenName?, familyName?, team, number?, nationality? }`。替代 index.astro 内联卡。
- `DriverTag.astro`——props：`number, color`（可选 size）。胶囊徽章，hero meta 使用，后续表格复用。

derive.ts 增：

```ts
interface DriverSeasonStats {
  position: number; points: number; wins: number;
  races: number; podiums: number; poles: number;
  top10s: number; fastestLaps: number | null; dnfs: number;
}
driverSeasonStats(season, code): DriverSeasonStats | undefined

interface CareerSeasonRow { year: number; team: string; position: number; points: number }
interface DriverCareer {
  races: number; points: number; wins: number; podiums: number;
  poles: number; bestFinish: number | null; seasons: CareerSeasonRow[];
}
driverCareer(seasons: SeasonPayload[], code): DriverCareer
```

推导规则：

- podiums = race position ≤ 3；top10s = ≤ 10；poles = qualifying position = 1；dnfs = status 不匹配 `/^(Finished|\+\d+ Lap)/`；races = 出赛行数；fastestLaps = fastestLapRank = 1 的行数，payload 无 rank 字段时为 null（UI 隐藏该行）。
- 赛季行 team = 该年最后一场已完成比赛该车手行的 constructorName（同 driverGrid 规则）。
- bestFinish = 所有 race position 的最小值。

详情页数据加载：页面遍历 `index.availableYears` 逐个 `getSeason`（当前 1 年；年数增长后的缓存问题将来再说，现在不做）。"本赛季"选择与 Career 聚合在 frontmatter 用上述函数完成，不新增 lib 文件。

## 视觉规格（VLM 审美方案定稿参数）

- 渐变：水平左暗右亮；左端=车队色混 30% 黑，右端=车队色提亮约 20%；深色页面右端亮度降 10%。
- 点阵：CSS radial-gradient 重复白点（约 1.5px 点、3px 间距、不透明度 12%，深色 10%），右→左蒙版于 60% 宽度处淡出，避让文字区。
- 卡片：宽高比 7:5，圆角 8px；名 weight 500、字号约为姓的 85%；姓 weight 900 大写；车号 condensed heavy 斜约 10°、纯白、字高约为卡高 18-20%；国籍旗圆形、直径约卡宽 7%、左下。
- 水印：纯白 8-10% 不透明度；卡 70% 高 / hero 90% 高；右缘溢出容器 15-20%、上下各溢 5%，overflow hidden 裁切；左缘不越过容器中线。
- hero：圆角 12px，宽高比约 2.5:1；名细斜体 12°（weight 300，签名感）、字号约为姓 60%；姓 900 全大写、hero 内最大字；meta 行 weight 500、1px 40% 白竖分隔线、高为行高 60%。
- DriverTag：胶囊（圆角=高 50%），高约为行高 1.2 倍，车号字高为徽章高 65%、斜 8°、weight 700，底色=车队色、字白。
- 字体：系统字体栈，weight 900 + 负字距 + skewX 逼近 condensed racing 字体，不引 web font。
- 深色适配：次级文字 #9ca3af；分隔线 15% 透明浅灰；彩色卡可加 16px 模糊 10% 黑柔影。

实现后审校：Playwright 截 列表/详情 × 桌面/375px，连同官方截图交 VLM 对照，按反馈迭代一轮。

## 测试与验证

- tokens.test.ts 重写：nationality → 旗标、未知回退白旗。
- derive.test.ts 增：driverSeasonStats 各规则点断言（podiums/poles/dnfs/fastestLaps/null-rank 隐藏）、driverCareer 聚合与赛季行。
- repository.test.ts 增：schema 接受无新字段的旧 payload。
- ingest：test_normalize 断言新字段；`uv run pytest -q`、`uv run ruff check`。
- e2e：列表卡含车号与旗、点击跳 `/drivers/{slug}`；详情含 meta 行、wiki 链接、本赛季与 Career 块；`/drivers/NOTREAL` 404；375px 无溢出。旧 `/2026/drivers/NOTREAL` 断言改址。
- 全量：`pnpm check`、`pnpm test`、`pnpm --filter @f1-box/web test:e2e`。
- 合并后触发 ingest 重发布数据，生产卡片车号/国旗补全（重发布前后分别验证降级与完整形态）。

## 范围外

teams 页视觉升级；历史赛季回填；i18n；sprint 统计（未采集）；web font；旧路由重定向；VLM 脚本入库（本轮用 /tmp 临时脚本）。

顺带：`.env.example` 的 VLM 模型名大小写修正为 `Doubao-Seed-2.1-Pro`（网关大小写敏感，小写被拒）；旧多赛季设计文档 drivers 路由两行加指针注明以本文档为准。
