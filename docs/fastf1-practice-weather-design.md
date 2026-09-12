# FastF1 练习赛与天气数据设计

## 结论

FastF1 可以提供西班牙大奖赛的 Practice 1/2/3（冲刺周末按实际存在的 session 返回）。`SESSION_KEYS` 已覆盖这三场，现有 `sync-session-refs.py` 与 `session_source_ref` 无需特殊分支。

f1db 继续作为比赛、车手、车队和正式成绩的主数据源；FastF1 补充 session 时刻、天气和后续可选的练习赛数据。统一用 `(year, round, session_key)` 关联，并以日期与 `api_path` 校验写入。

## 西班牙站执行顺序

1. 用 FastF1 schedule 找到 Spanish Grand Prix，以 `RoundNumber` 对齐 f1db。
2. 运行 `scripts/sync-session-refs.py`，确认生成 `practice-1/2/3`；冲刺周末不要假设一定有三场练习。
3. 仅在 session 结束且数据可用时按预生成 `api_path` 调用 FastF1 weather 数据；Container 不做 `get_session` 赛程发现。
4. 空结果先写 `empty` 并重试，二次确认后才写 `no_data`；缺失天气不得推断为晴天。
5. 成功后刷新 `weather:<year>` 缓存并在比赛详情页显示。

## 数据范围

### 第一阶段

扩展 `session_weather`，新增可空字段：`humidity_pct`、`pressure_hpa`、`wind_speed_kph`、`wind_direction_deg`、`rainfall`、`sample_count`、`observed_at_utc`。保留现有 `temp_c`、`track_temp_c`、`weather_code`。

从 FastF1 weather 数据聚合：温度、湿度、气压、风速取中位数；风向取圆周均值；降雨仅依据 FastF1 原始 `Rainfall`，不能用缺失值推断晴天。原始 `WindSpeed` 单位是 m/s，入库前转换为 km/h；`observed_at_utc` 由 session 开始时间与最后一个样本偏移计算。首阶段不保存逐秒序列，避免放大 D1/R2 与页面载荷。

### 第二阶段

需要练习赛排行榜时另建 `session_results` 摘要表（`position`、`driver_id`、`team_id`、`best_lap_ms`、`lap_count`、`source`）。FastF1 练习结果与 f1db 正式结果分开，页面明确标注 Practice / FastF1，不写回 f1db 表。

## UI 方案

现有 Weekend schedule 的 session 天气行升级为紧凑摘要：

- `🌡 24°C · 🛣 38°C · 💧 48%`
- 有可靠降雨时追加 `🌧 Rain`
- 风况可用时追加 `💨 14 km/h`
- 无数据显示 `Weather unavailable` 或留空

桌面端保留时间线五列，移动端每个 session 一行。emoji 只能辅助表达，必须有文本或 `aria-label`，不能依赖颜色。建议使用 `🌡` 空气、`🛣` 赛道、`💧` 湿度、`💨` 风、`🌧` 降雨，控制数量避免噪声。沿用语义色工具类，亮/暗主题同时适配。

详情页可提供键盘可达的轻量 popover，展示聚合值、数据来源和更新时间；摘要仍由 Astro SSR 输出，无 JS 时照常可读。

## 实施与验收

- 更新站点表与 D1 migration、weather-sync 类型、FastF1 容器序列化、D1 upsert、仓储解析和 WeekendProgress。
- 先写失败测试：字段解析、空样本、降雨阈值、圆周风向平均、缺少练习 session 不造数据。
- 运行 `pnpm check`、相关 `pnpm test`、`pnpm --filter @f1-box/web test:e2e`，检查桌面、375px、reduced-motion、双主题和 axe。
- 西班牙站应正确对齐练习 session；已结束练习赛显示天气；未结束或 FastF1 无数据不误报；Race/Qualifying 无回归。
