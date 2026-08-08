---
name: f1-data-sources
description: 可借鉴的 F1 数据源/参考仓库，供数据回填与页面增强使用
metadata: 
  node_type: memory
  type: reference
  originSessionId: b4b6b604-7c1a-43a9-ba18-30f7b3d52fd6
  modified: 2026-08-05T12:32:42.714Z
---

后续 F1 数据与功能开发可借鉴的开源仓库：

- https://github.com/theOehrly/Fast-F1 ：Python 库，提供圈级/遥测/分段计时等深度数据，适合做圈速、 sektor、轮胎等细粒度分析。
- https://github.com/slowlydev/f1-dash ：实时计时看板，适合做 live timing / 实时状态展示。
- https://github.com/jolpica/jolpica-f1 ：Ergast 继任 API，当前 ingest 的上游数据源（赛历/成绩/积分榜）。
- https://github.com/f1db/f1db ：静态 JSON 数据集，含赛道信息（长度、首办年份、圈数、最快圈、比赛距离）与历史数据，适合做赛道信息卡与历史回填。

注意：当前站点数据走 Jolpica → R2；圈速/赛道详情等可考虑 Fast-F1 或 f1db 作为补充源。相关增强见 [[race-weekend-enhancements]]。
