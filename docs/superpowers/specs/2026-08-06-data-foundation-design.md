# 数据地基设计文档（结构化数据管理）

日期：2026-08-06
状态：设计定稿，待实施
关联：docs/data-contracts.md（前端契约，本文档的实施产物）、docs/superpowers/specs/2026-08-05-multi-season-site-design.md、2026-08-05-drivers-pages-design.md

## 背景与目标

前端骨架与页面模型已定（参照 formula1.com），短板是数据丰富度：车队颜色/logo、结构化国籍、生涯统计、历史赛季都缺，且 drivers 页迭代暴露了"颜色手写进代码"的反模式。本轮把展示元数据建成我们自己的结构化数据库：schema 对齐参考项目里最成熟的 f1db，多源合并、ingest 生成、R2 存储；前端（下一个切片）纯读表渲染。

原则：

- 我们维护的是 schema 与管道，不是人肉数据。上游可替换，前端零感知。
- 访客请求只读 R2（沿用现有原则）；上游只在 ingest 时访问。
- 小且稳定的静态资产（logo/国旗/赛道 SVG）放仓库，随前端切片消费；R2 只存管道生成的数据产物。
- 大体量数据（圈速/轮胎/遥测）将来在 ingest 内用 Fast-F1 库按需取、落地发布包，本轮不做。

## 基底选型

f1db（CC-BY-4.0）为规范 schema 基底与主元数据源：唯一把 drivers/constructors/circuits/countries/entrants/seasons 当完整数据库管理的项目，YAML 源 + CI 多格式发布包（JSON split 5.6MB 含 1950–2026 全量），实体 ID 稳定（max-verstappen / red-bull / netherlands）。不抄其人工 YAML 仓库——f1db 发布包只是我们的上游之一。

来源分工：

| 数据 | 源 | 许可 | 说明 |
|---|---|---|---|
| 当季赛历/成绩/积分榜 | jolpica API | CC BY-NC-SA 4.0 | 现有管道，赛季进行中保鲜 |
| 车手身份（车号/国家ID/生日/维基）、阵容 entrants、生涯聚合、车队传承、电路元数据、国家表 | f1db release（json-splitted） | CC-BY-4.0 | 下载一次缓存，历史稳定 |
| 车队颜色 hex（2018–2026 按赛季） | Fast-F1 plotting/constants.json | MIT（事实数据） | ingest 时拉 raw 文件缓存；2018 前留空回退中性色 |
| 车队 logo | 官方 CDN 白色版（已下载，自托管仓库资产） | 商标，标识性使用 | 按 constructor id 映射 |
| 国旗/轮胎 SVG | f1-dash public/（前端切片引入） | AGPL 仓库内的公共领域图形 | 本轮只记录来源，不实施 |

许可混合后果：我们的发布包同时含 CC-BY 与 NC-SA 派生数据，整体按 NC-SA 对待（非商用、署名）。每个产物 sources 数组署名各上游；商用化时需换掉 jolpica 派生部分，schema 抽象保证可换源。

## R2 数据布局

沿用现有：

- v1/seasons/{year}/latest.json（manifest）与 {checksum}.json（SeasonPayload，jolpica）。manifest schema 不动（前端已校验，破坏会 503）。

新增：

- v1/seasons/{year}/directory.json——该季展示目录（见契约文档）。
- v1/global/countries.json、v1/global/circuits.json、v1/global/career.json。

年份发现不变：getIndex 列 v1/seasons/ 前缀；回填即自动出现新年份。

## directory.json 合并规则

- teams：该季 f1db entrants 出现的 constructors（id/name/fullName/countryId）；color 用 Fast-F1 常量按"赛季+队名"匹配（队名与 f1db constructor name 归一化比对，含 Red Bull/RB 等已知别名表，放 ingest 数据文件）；logoKey 按 constructor id 映射仓库资产（映射表放 ingest 数据文件）。
- drivers：entrants 与积分榜引用的 f1db drivers（id/code/name/firstName/lastName/number/countryId/dateOfBirth/wikipediaUrl）。
- entrants：f1db seasons/{year}/entrants（constructorId + drivers[{driverId, rounds, testDriver}]）。
- 当季校正：有 jolpica payload 的赛季，standings 中不在 entrants 的车手补一条 drivers 记录（身份回退 jolpica 字段）与 entrants 兜底行（rounds=null），保证中途换队/新队不丢人。

## global 产物

- countries：f1db countries 全量（id/alpha2Code/alpha3Code/iocCode/name/demonym）。
- circuits：f1db circuits（id/name/countryId/locality/lat/long/lengthMetres/firstGrandPrix/numberOfLaps/lapRecord），svgKey 预留（资产前端切片下载）。
- career：drivers[{id, totals{grandsPrix, wins, podiums, poles, fastestLaps, points, championships, bestChampionshipPosition}, seasons[{season, constructorId, position, points}]}]；constructors[{id, totals{...}, chronology[{constructorId, yearFrom, yearTo}]}]。totals 取 f1db 预算字段，seasons 行由 f1db 各季 standings 派生。

## ingest 变更

- f1db 客户端：取 GitHub Releases 最新 f1db-json-splitted.zip，缓存 .data/raw/f1db/，按需解包。
- colors 客户端：raw.githubusercontent 拉 constants.json，缓存。
- CLI：season 子命令附带生成 directory.json；新增 global 子命令生成三个 global 产物；release.py 扩展新键，支持本地与 --remote。
- contracts：新增 directory/countries/circuits/career 的 TS 类型与手写边界解析器（仿 season-index 模式）。

## 验证与回填

- 单测：导入器映射、directory 合并与当季校正、global 构建、contracts 解析器（f1db 片段做 fixture）。
- 全量：pnpm check/test、ingest pytest/ruff。
- 回填：2024/2025/2026 的 payload+directory 与 global 产物发布 --remote；验证 R2 键存在、生产站点 /2024/racing 与 /2025/racing 自动可用（现有前端通用渲染）。

## 范围外

前端适配（读目录层、删 TEAM_COLORS、网格重设计）——feat/drivers-pages 分支与 PR #5 承载；国旗/轮胎/赛道 SVG 资产下载；圈速/遥测；2018 前车队颜色；i18n。
