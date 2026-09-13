# f1db 与 FastF1 协作同步架构

## 目标

比赛周末需要“先看到实时结果，赛后自动切换到 f1db 正式结果”。FastF1 适合赛后数分钟提供 Practice、Qualifying、Race 的 session 结果；f1db 适合作为稳定、完整、可长期查询的正式数据源，通常在比赛结束后数小时到数天发布 release。

## 数据职责

- f1db：比赛元数据、赛历、车手/车队实体、正式排位与正赛结果、历史数据。
- FastF1：近期周末的 session 结果、天气和可选遥测摘要。
- 站点自有表：保存 FastF1 临时/补充数据，不修改 f1db 表。

所有 FastF1 行使用 `(year, round, session_key)` 作为业务键，并保存 `source`、`fetched_at`、`source_revision/api_path`。不要依赖 f1db 的代理 id，也不要把 FastF1 结果伪装成 f1db 正式结果。

结果采集优先走 FastF1 公开的 `Session.results`，容器响应记录 adapter 与 schema 版本；只有公开结果缺少可用信号时才降级到 timing fallback。Q1/Q2/Q3 优先取官方分段时间；fallback 分段无法确定时保留 NULL。

## 结果优先级

读取单场结果时按以下策略：

1. f1db 有该 session 的结果：使用 f1db，并将来源标记为 `f1db`。
2. f1db 没有结果，且 FastF1 已成功采集：使用 FastF1，标记为 `fastf1`、`provisional`。
3. 两者都没有：显示空状态，并保留 session 时间/天气。

当 f1db 新 release 导入后，下一次请求自然优先返回 f1db；旧 FastF1 provisional 行可以保留用于审计，或在确认正式结果覆盖后清理。不要在请求路径实时访问 FastF1。

站点表 `session_result_snapshot` 保存 `year`、`round`、`session_key`、外部 driver/team key、`position`、`position_text`、`best_lap_ms`、`lap_count`、`status`、`fetched_at`、`source_revision`。缺失车手实体时保留 FastF1 的 driver number/code/name，读取侧按 source id → 车号 + 赛季 → 缩写映射。

## 同步时序

### FastF1 周末同步

由现有 weather-sync Worker/Container 扩展为 session-sync，按 `session_source_ref` 处理已结束 session。天气与结果可共用引用、锁、重试和 outbox，但建议逻辑上分开状态表，避免结果失败阻塞天气成功。

- 采集窗口：session 结束后延迟 10–20 分钟首次尝试。
- 失败退避：15 分钟、1 小时、6 小时、24 小时，最多 5 次。
- 只有 `results` 非空且至少有有效 driver/position 或 best lap 才写 success。
- FastF1 无结果写 `empty`，二次确认后才写 `no_data`。
- 结果写入后刷新 `results:<year>` 或 `results:<year>:<round>` 缓存。
- 快照替换先删除同一 session 的旧批次，再写入新行；瞬时失败不删除上一版成功快照。

### f1db release 同步

继续以官方 release tag 为门禁，导入成功后记录 tag 并刷新 `f1db` 与当年 `results:<year>` 缓存。导入必须是可重试、幂等、可回滚的整库流程；导入期间避免让半成品数据对请求可见。

## Cloudflare 与 GitHub Actions 的边界

不建议把当前 f1db 全量 dump/import 直接搬到 Cloudflare Worker：Worker/Workers Container 的运行时、临时磁盘、执行时长、D1 写入吞吐和 GitHub release 大文件下载都不适合数百张表的 SQLite 拆分导入。全量导入失败还会放大生产 D1 风险。

推荐的现代化方案是“Cloudflare 负责触发与状态，专用执行环境负责重活”：

- Cloudflare Cron/Worker：定期检查 GitHub release API，写入 `sync_job` 状态，触发一次同步任务，并阻止重复执行。
- GitHub Actions 或 Cloudflare Container Job：下载 release、生成 SQL、分批导入 D1、执行 `ANALYZE`、做行数/关键查询校验。
- 成功后由 Worker/脚本原子更新 `sync_state`，刷新缓存；失败保留旧 tag 与错误信息。

如果必须完全移除 GitHub Actions，可使用长期运行的 Cloudflare Container/外部 CI 执行器，但应先做小规模 shadow D1 演练、测量导入时长与 D1 写入配额，再切生产。不要让在线 Worker 直接执行整库导入。

## 原子性与回滚

最佳方案是双 D1：导入到 staging 数据库，完成校验后切换 Worker binding 或数据版本路由。若暂时只有一个 D1，则至少：

- 保留 `sync_state.active_tag` 与 `pending_tag`；
- 导入前记录旧 tag；
- 导入失败绝不写 active tag；
- 导入后执行 schema、表计数、关键页面查询和索引计划校验；
- 缓存只在 active tag 更新后刷新。

## UI 行为

结果表顶部显示来源徽标：`FastF1 · provisional · 采集时间` 或 `f1db · official`。FastF1 数据允许显示 Practice、Qualifying、Race；f1db 覆盖后徽标自动变为 official。数据不完整时显示具体空状态，例如“等待 FastF1 数据”或“等待 f1db release”，不要显示误导性的“暂无比赛”。

## 实施顺序

1. 新增 FastF1 session results 容器解析、规范化和失败测试。
2. 新增 `session_result_snapshot` 表、状态表、upsert 与缓存失效。
3. repository 实现 f1db 优先、FastF1 fallback，并保留来源字段。
4. RaceTable 展示来源与 provisional 状态，覆盖 Practice/Qualifying/Race。
5. 增加西班牙站验收：练习与排位先显示 FastF1，f1db release 到达后自动切换。
6. 将 f1db 同步改为“Cloudflare 调度 + Actions/Container 执行”，先 shadow 验证再考虑完全迁移。

## 必须讨论的决策

- 是否接受 FastF1 结果作为排位/正赛的 provisional 展示？建议接受，但必须明显标注来源。
- 是否采用双 D1 staging 切换？生产稳定性要求高时建议采用；否则先保留现有单 D1 流程。
- FastF1 车手身份映射是否允许 name/code fallback？建议允许 fallback，并在 f1db 更新后回填稳定 id。
