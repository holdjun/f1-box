# FastF1 Container 与 Worker 发布一致性方案

## 现状与故障

PR37 的 Worker 已经要求 Container 返回 `adapter` 与 `schemaVersion`。生产 D1 中西班牙站的 `session_source_ref` 完整，结果同步也被触发，但 Container 返回旧协议，Worker 因 `container response or results adapter version is invalid` 将场次标记为 failed，未写入 `session_result_snapshot`。

根因是 Worker 与 Container 分开发布，CI 只验证了 preview 的组合，生产没有证明两者使用同一版本。

## 目标

- Worker、Container、结果协议作为一个可验证的发布单元。
- 任何协议不兼容在部署前或 canary 阶段失败。
- 失败可观测、可重试，不需要手工猜测 D1 状态。
- 结果同步入口、引用表和快照状态都有明确排查命令。

## 版本契约

在 `apps/weather-sync/container/contract-version.json` 维护单一版本文件：

```json
{
  "containerApiVersion": 1,
  "resultsAdapterVersion": "session-results-v1",
  "resultsSchemaVersion": 1
}
```

Worker 与 Container 都从该文件生成/读取版本常量。Container 的 `/health` 返回版本，`collect` 返回 `adapter`、`schemaVersion` 和 `containerApiVersion`。Worker 在处理结果前校验全部字段；版本不符写入结构化错误并保持旧快照。

协议变更必须先增加兼容读取，再升级版本；禁止只改 Worker 或只改 Container。

## 发布流程

CI 识别 `apps/weather-sync/src`、`apps/weather-sync/container`、契约文件或依赖变化时，必须按以下顺序执行：

1. 构建并部署 Container 固定镜像版本。
2. 等待 Container rollout 完成，调用 `/health` 校验契约版本。
3. 部署 Worker，并使用同一个 git SHA/契约版本。
4. 在 preview 执行真实 result canary，检查 snapshot 行数和同步状态。
5. 生产部署后执行 container 契约 health gate 和只读 result canary；失败则 CI 标红并进入回滚排查。

Worker 和 Container 的部署步骤应位于同一 workflow job，禁止两个独立 workflow 无依赖并行发布。`--containers-rollout immediate` 只能作为 rollout 策略，不能替代版本检查。

## CI 门禁

必须新增以下检查：

- 单元测试：契约版本一致、旧响应被拒绝、正确响应被接受。
- Container 转换测试：用 FastF1 数据形状的 fixture 验证 Practice 与 Qualifying payload。
- 部署后 health check：比较 Worker 构建版本与 Container 返回版本。
- 结果 canary：preview 验证 `session_result_snapshot` 与 `session_result_sync_state`；生产验证公开结果 adapter 与行数。
- 失败状态检查：canary 不允许留下 `failed` 且没有 `last_error` 的状态。

生产 canary 不写 D1。它使用稳定的历史 qualifying reference 实际调用一次 Container，并断言公开结果成功；这样验证协议和数据采集，又不污染用户快照。

## D1 数据维护

`session_source_ref` 必须由部署初始化和定期同步共同维护。每次当前年份赛程变更后运行 `scripts/sync-session-refs.py`，生成 SQL 并幂等写入生产库。

结果失败时只重置状态，不删除成功快照：

```sql
UPDATE session_result_sync_state
SET status = 'empty', attempts = 0, next_attempt_at = NULL,
    last_error = NULL, updated_at = datetime('now')
WHERE year = ? AND round = ? AND session_key IN (...);
```

排查顺序：

```sql
SELECT * FROM session_source_ref WHERE year = ? AND round = ?;
SELECT * FROM session_result_sync_state WHERE year = ? AND round = ?;
SELECT session_key, COUNT(*) FROM session_result_snapshot
WHERE year = ? AND round = ? GROUP BY session_key;
```

## 可观测性

`/status` 返回聚合状态、总数、最近错误和 Worker 契约版本；生产 Container 契约由授权的 `/container-health` 校验。错误必须携带可定位字段，禁止只返回泛化字符串。

## 落地顺序

1. 提取共享契约版本文件。
2. 给 Container health/collect 增加版本字段。
3. 合并 Worker 与 Container 的部署 job，并加入 rollout health gate。
4. 增加真实结果 fixture smoke test 和生产后 canary。
5. 为 session reference 增加定期幂等同步。
6. 重置当前西班牙站失败状态并重新采集，确认四个 session 写入快照。
