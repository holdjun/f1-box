# 天气同步执行环境

2026-09-08 决定：先验证 Cloudflare Containers 的 FastF1 取数，再调整 PR #32 的天气同步，完成数据和页面验收后合并。f1db 全量导入本轮继续使用现有 GitHub Actions；代码检查、镜像构建与部署也仍可使用 Actions。

## 已验证的事实

GitHub Actions 上的 FastF1 3.8.3 请求官方天气地址返回 HTTP 403，镜像返回 HTTP 404，最终被包装成 `SessionNotAvailableError`。这属于请求失败，不能标成源数据不存在。[诊断日志](https://github.com/holdjun/f1-box/actions/runs/34199997859)

同一天部署了独立的临时 Cloudflare Worker + Container。使用官方 Python 3.12 slim 镜像、FastF1 3.8.3、requests 2.34.2，单个 basic 实例，未绑定 D1、R2 或生产域名。入口要求认证，未知路径被拒绝；本地三个入口测试通过，云端未认证请求返回 401。

关闭 FastF1 缓存后的第一轮结果：

| 排位场次 | 官方 HTTP 状态 | 天气观测数 | 气温中位数 | 场次取数耗时 |
| --- | --- | --- | --- | --- |
| 2023 巴林 | 200 | 95 | 24 °C | 0.297 秒 |
| 2023 沙特 | 200 | 80 | 27 °C | 0.490 秒 |
| 2026 蒙扎 | 200 | 77 | 34 °C | 0.506 秒 |

容器内总耗时 144.347 秒，包含运行时安装 Python 依赖和初始化；三个场次取数合计 1.293 秒。临时验证采用运行时安装，是为了无需本地 Docker 即可验证出口；正式镜像必须预装并锁定依赖。

销毁该实例后重新启动，启动标识由 `a2416ca6-0b5b-45d4-87e8-8eaacc755083` 变为 `23f25ebc-d54f-4036-ae03-35723d4a2cc7`。第二轮同样关闭缓存，三个官方天气请求再次全部返回 200，样本数与温度均一致；场次取数合计 1.532 秒，含依赖安装和初始化总耗时 140.426 秒。两轮均在 Cloudflare 容器内执行，未向生产数据库写入数据。

本地到临时 Worker 的首次长请求曾出现连接中断。改成启动后台采集、立即返回、独立查询结果后取得了完整结果。该现象不等于上游取数失败。结果包含启动标识、依赖版本、HTTP 状态与实际样本数，不能只靠任务退出码判定成功。

这些样本验证的是当次 Cloudflare 容器出口可访问官方天气数据，尚不代表全部年代均有数据或未来不会出现网络失败。

## 已落地实现

- `apps/weather-sync` 是独立 Worker：生产配置每 30 分钟由 Cron 触发当季 Workflow；预览 Worker 不挂 Cron，只用于手动验收，避免重复写共享 D1。
- Workflow 按年拆成选择候选、容器采集、D1 写入、缓存刷新与覆盖率检查步骤。步骤结果由 Cloudflare Workflows 持久化，D1 状态不依赖容器临时磁盘。
- Container 镜像预装 FastF1 3.8.3 与 requests 2.34.2；Worker 与容器之间使用共享 secret 认证，容器入口只开放 health 与 collect。
- 采集在 requests 层记录实际主机与 HTTP 状态。触达 Jolpica/Ergast、HTTP 4xx/5xx、超时或异常记为请求失败；只有明确空结果才记为无数据。
- `weather_sync_state` 区分 `success`、`no_data`、`mismatch`、`failed`、`exhausted`。失败按 15 分钟、1 小时、6 小时、24 小时退避，最多 5 次；终态不每日重抓。
- `session_weather` 只保存 FastF1 可提供的气温、赛道温度与降雨证据。缺失字段保持 NULL，不用其他来源补值。
- 成功写入后按 `f1db` 缓存标签刷新页面。缓存刷新失败会让 Workflow 继续重试，不会静默丢弃。
- f1db 已有字段直接采用，FastF1 扩展表独立管理。访客请求不访问任何上游。
- GitHub Actions 只保留 f1db 导入、CI、镜像构建与部署；不再执行天气取数。

手动操作走认证 API：

- `POST /runs`，body 为 `{"mode":"current"}` 或 `{"mode":"backfill"}`；backfill 可传 `years` 数组，缺省处理 2018 起全部已有 `session_time` 的赛季。
- `GET /runs/<instanceId>` 查询 Workflow 状态。
- `GET /status` 查询状态计数、已写入天气行数与失败摘要。

部署需要的 Worker secrets 是 `WEATHER_SYNC_TOKEN`、`WEATHER_CONTAINER_TOKEN`、`CLOUDFLARE_API_TOKEN`；token 值只存在于 Cloudflare 与 GitHub secrets，不进入仓库。

Cloudflare Python Workers 的运行环境与普通 CPython 不同，同步 HTTP 依赖不能直接原样使用。Containers 提供完整运行环境；Workflows 负责持久步骤与重试，但数据库写入仍须自行保证重复执行安全。[Python 包限制](https://developers.cloudflare.com/workers/languages/python/packages/)、[Containers](https://developers.cloudflare.com/containers/)、[Workflows 规则](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)

## PR #32 合并门槛

1. 最小验证成功，并验证容器重启后重新取数。
2. 正式采集镜像与 Cloudflare 同步任务完成，失败状态、复查、重复执行的边界测试通过。
3. 完成历史天气批量回填；公开区分已成功、明确无数据、尚未完成与请求失败的统计。
4. 多站页面显示真实天气，数据写入后缓存能更新；桌面、375px 与双主题验收通过。
5. CI 全绿，用户在预览验收后亲自合并。

页面缺天气可以正常显示，但天气采集任务整体失效不能作为已完成的天气功能验收。
