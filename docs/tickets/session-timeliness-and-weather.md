# 工单：赛程时刻补全与可选天气

PR #32 交付历史 session 时刻补全和 FastF1 可提供的天气。快速赛后结果与数据库后续设计见 [数据源分工讨论稿](../data-sources.md)，不属于本 PR 的合并前提。

## 时刻补全

f1db 从 2024 赛季起记录场次时刻；2018–2023 由 `scripts/sync-session-times.py` 调用 `get_event_schedule(year, backend="fastf1", include_testing=False)` 补全。≤2017 仍仅显示已有日期，不推算时刻。

- 按 `(year, round)` 关联 f1db，日期也必须匹配。接受赛地比赛日或正赛 UTC 日期，避免拉斯维加斯夜赛跨日时被误判；真正不匹配的场次跳过并输出摘要。
- session 按名称映射，不按顺序猜；`Sprint Shootout` 与 `Sprint Qualifying` 都映射为 `sprint-qualifying`。
- `NaT`、无效日期不写入；有效时间规范化为 UTC。
- 数据写独立 `session_time` 表，不修改 f1db 上游表。
- 读取优先级是 f1db 真实时刻、补全时刻、已有日期占位。补全也会增加原本完全缺失的练习/排位场次。
- 比赛页与赛历查询都合并该表，ICS 复用同一结果；子查询走主键前缀，不增加逐站查询。

验收：2018–2023 可补全的比赛展示完整周末、正确日期范围与可订阅 ICS；≤2017 不显示伪造时刻；2024 起保留 f1db 优先。

## 天气

只使用 FastF1 `api.weather_data(session.api_path)` 返回的实测数据，有什么用什么。对应 session 无数据就不展示，不请求其他天气源，不展示预报。

- 气温与赛道温度分别取可用样本中位数；任一样本报告降雨就显示 `rain`。`Rainfall=false` 不等于晴天或无云。
- FastF1 返回的字段缺失或非有限数值保持空；本站不自行补零。但 FastF1 底层解析可能已将原始缺失字段转为 0，当前不能反推出其原始缺失状态。
- 距离计划开始至少四小时才抓取，降低把半场样本永久写入的概率；这不是异常长时间暂停场次已结束的证明。
- `session_weather` 以 `(year, round, session_key)` 为主键，保存来源和抓取时间；同样核对比赛日期，避免轮次变化导致串场。
- 定时任务只处理当季，`--have` 跳过已有成功行；历史回填必须手动触发。已存部分字段的行目前不会自动复查。
- 页面仅展示可用字段；整场无天气不渲染天气行，同一周末有部分天气时保留对齐占位。

`fastf1.api` 是上游标记未来可能私有化的低层接口。本 PR 保留它以只获取天气，不为天气加载成绩；后续统一采集时再评估 `Session.load()`。其底层可能访问官方计时域名及 FastF1 自有镜像，不保证只触达一个域名。

2026-09-08 诊断确认 GitHub Actions 收到官方 HTTP 403、镜像 HTTP 404；不能将 `SessionNotAvailableError` 当成源数据缺失。Cloudflare Containers 两轮真实取数（含销毁重启）均取得巴林、沙特、蒙扎的天气。决定先验证再迁移天气同步，完成后才合并 PR #32；具体证据与合并门槛见 [天气同步执行环境](../decisions/weather-sync-cloudflare.md)。

验收：可用字段单独展示，天气缺失不影响页面；fixture 覆盖气温、赛道温度、降雨、整场无数据与部分字段缺失；桌面/375px、双主题 axe 与截图通过。

## 部署与数据生命周期

- `scripts/site-tables.sql` 在 preview/production Worker 部署前执行，也在 f1db 全量重导后执行；它幂等建表，不能替代未来 schema 迁移。
- 两张站点表不进入 f1db dump/drop 列表，不建指向 f1db 的外键；重导后清理不存在的比赛关联。
- `(year, round)` 用于已核对的比赛关联，不宣称轮次永不变化。未来赛程改期应独立处理映射。
- `.github/workflows/site-data.yml` 负责写入；历史时刻一次性手动回填，天气每日更新当季空缺。
- 访客只查询本站 D1，不直连任何上游。
- preview 与 production 当前共享 D1，站点表数据写入前先核对产物；代码验收在预览完成。
- 代码边界测试限制直接 URL 和显式 backend，不能替代真实域名观察。手动探针在零成功样本、记录器失效或触达 Jolpica/Ergast 时失败。

新结果功能可经 FastF1 内部访问 Jolpica，但不能假定结果都来自它，更不能直接实现另一套 Jolpica 客户端。天气探针不能替代结果、圈速和遥测能力探针。
