---
name: race-weekend-enhancements
description: 已记录待开发的 race 周末页增强（赛道图/赛道信息/前3名/session 选择器）
metadata: 
  node_type: memory
  type: project
  originSessionId: b4b6b604-7c1a-43a9-ba18-30f7b3d52fd6
  modified: 2026-08-05T12:33:12.085Z
---

用户（2026-08-05）提出的后续增强想法，尚未开发，属于下一个需求（数据/增强 slice）：

- racing 单站页绘制赛道图（线稿/轮廓），并加地点信息；赛道信息卡（长度、首办年份、圈数、最快圈、比赛距离），数据可来自 f1db（见 [[f1-data-sources]]）。参考用户提供的 CIRCUIT 卡片截图样式。
- racing 页/单站页展示正赛前 3 名及各自时间；排位也展示前 3 名。
- racing/{event} 详情页加 session 选择器（Race/Qualifying/Sprint 等），切换查看各 session 的排名表。

多赛季站点 slice 0–4 已完成（PR #4，2026-08-05）。跨年图表需先做数据回填（多年历史），同属后续需求。
