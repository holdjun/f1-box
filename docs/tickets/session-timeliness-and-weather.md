# 工单：赛程时刻补全、天气与赛后时效

三条数据管线，形态相同——GitHub Action 定时脚本写入独立表，页面读到才渲染。主力数据源是 FastF1，天气缺口由 Open-Meteo 补。可分三次交付，顺序不可颠倒：天气要按 session 时刻取值，所以时刻补全排在最前。

不使用 Jolpica，指的是不在自己代码里直接请求它。经 FastF1 间接调用是可接受的——`Session.load()` 内部会自己拉 Jolpica 的结果数据，我们用 FastF1 的公开 API，不直接写 `api.jolpi.ca` 的 URL，Jolpica 的请求由 FastF1 管理。

## 背景

比赛页的三种形态（赛前 / 赛中 / 赛后）已上线，渲染由"库里有没有这场 session 的结果"驱动。剩下的短板都在数据侧，且都不能在访客请求里直连上游（AGENTS.md 约束），只能预取入库。

### f1db 的时间字段实际覆盖

`race` 表有完整的时间列（`time`、`free_practice_*_date/time`、`qualifying_date/time` 等），但值几乎全空。本地全量库统计（1171 场）：

| 年代 | 场次 | 正赛有时刻 | 练习/排位有日期 |
| --- | --- | --- | --- |
| 1950s–2010s | 1018 | 0 | 0 |
| 2020–2023 | 83 | 0 | 0 |
| 2024–2026 | 70 | 70 | 70 |

不是导入丢列，是上游没有：f1db 从 2024 赛季才开始记录时间。1171 场里 1101 场没有发车时刻。

这带来两个后果。一是 #30 之前的赛程条把 `buildSessions` 兜底的 `T00:00:00Z` 当真实时刻做时区换算，2023 阿布扎比显示成 Sun 04:00、拉斯维加斯连星期都退一天；#30 已改成这类场次只显示日期。二是任何"按 session 时刻取天气"的方案，在补全时刻之前只能覆盖 2024 起的 70 场。

### FastF1 各条数据的实测结果

用 socket 层记录域名跑了一遍，结论按能力分三档：

| 能力 | 调用 | 实际请求的域名 | 覆盖 |
| --- | --- | --- | --- |
| 赛程时刻 | `get_event_schedule(year, backend="fastf1")` | 只有 `raw.githubusercontent.com` | 2018 至今 |
| 赛道天气 | `api.weather_data(api_path)` | 只有 `livetiming.formula1.com` | 2018 至今 |
| 成绩与名次 | `Session.load()` → `session.results` | `livetiming.formula1.com` + `api.jolpi.ca` | 2018 至今 |

前两条干净可用，只打 F1 官方端点。第三条会引入 `api.jolpi.ca`，但这是 FastF1 内部自己处理的：`Session.load()` 结果里的 `session.results` 自带 `Abbreviation`（三字母码）、`DriverNumber`、`Position`（名次）、`ClassifiedPosition`，全部来自 Ergast/Jolpica。Jolpica 的请求不落在我们代码里，只经 FastF1，可接受。

顺带确认了边界安全：`get_event_schedule(2017, backend="fastf1")` 直接抛 `Failed to load any schedule data`，不会偷偷改用 ergast。所有调用都必须显式写 `backend="fastf1"`，不能依赖默认值。

### 补全后的时刻覆盖

| 分段 | 场次 | 时刻来源 |
| --- | --- | --- |
| ≤2017 | 976 | 无，只有日期 |
| 2018–2023 | 125 | FastF1 schedule（全部 session，精确到分钟） |
| 2024+ | 70 | f1db 自带 |

2018–2023 拿到的是完整周末（练习、排位、冲刺、正赛各自的 UTC 时刻），不是只有正赛。≤2017 的 976 场保持只显示日期，不插值、不猜测。

`circuit` 表的 `latitude` / `longitude` 是 NOT NULL，78 个赛道全有，天气取点不需要新数据。

## 一、赛程时刻补全（FastF1 schedule）

### 目标

把 2018–2023 的各 session 发车时刻补进库，让赛程条、ICS 和天气三处同时受益。

### 实现

- 脚本 `scripts/sync-session-times.py`，PEP 723 + `uv run`，与 `generate-circuit-maps.py` 同款。
- 源：`fastf1.get_event_schedule(year, backend="fastf1", include_testing=False)`，每赛季一次调用，2018–2023 共 6 次，一次性跑完就结束：2024 起 f1db 自带时刻，这条管线不需要常驻增量，除非 f1db 哪年又停了时间字段。数据来自 FastF1 维护在 GitHub 上的赛程文件，不碰任何 F1 私有端点。
- 对齐：`year` + `RoundNumber` 匹配 f1db `race`，并用日期双重校验；对不上的跳过并在 summary 里列出，绝不猜。`Session1..Session5` 的名称映射到现有 `session_key`（`practice-1`、`sprint-qualifying`、`qualifying`、`race` …），冲刺周末的场次顺序与常规周末不同，映射按名称而不是按序号。
- 表 `session_time`，`PRIMARY KEY (race_id, session_key)`，另有 `starts_at_utc`、`source` 两列。不写 f1db 导入的表——data-sync 全量重导会冲掉。
- 仓储：`session_time` 的行既覆盖已有 session 的时刻，也新增 f1db 根本没有的 session——这一点不能读成“只补时刻”。`buildSessions` 现在靠 `if (r.isNull(dateKey)) continue` 逐列建表，而 f1db 对 2018–2023 连 `free_practice_1_date` 都没有，那些赛季目前只会产出 `race` 一个 session。只做覆盖的话，补完仍然只有一格赛程条、ICS 仍然只有一个事件，验收全挂。
- 仓储：合并后的优先级是 f1db 时刻 > `session_time` > `<date>T00:00:00Z` 兜底值。这个兜底值不是要清除的脏数据，它是"只有日期"这个状态的载体：`time.ts` 的 `hasPublishedStart`、`calendar-ics.ts` 的过滤、`WeekendProgress` 的 `slice(0, 10)` 全靠它区分两种形态，而 ≤2017 的 976 场永远走这条分支。所以 `PLACEHOLDER_START` 判据必须保留，这一步要改的只是让更多场次拿到真实时刻，不是取消占位形态。（"不拿占位值做时区换算"这件事 #30 已经做完。）
- 仓储：`buildSessions` 被 `mapRaceSummary`（`seasonCalendarSql`）与 `mapRaceMeta`（`raceMetaSql`）共用，两条 SQL 都要带上 `session_time`，不分岔。用子查询一次带回，不要每站再发一轮：`(SELECT json_group_array(json_object('key', session_key, 'value', starts_at_utc)) FROM session_time st WHERE st.race_id = ra.id) AS session_times`。不用 `json_group_object`——D1 的 JSON 函数表只列了 `json_group_array`，没列 `json_group_object`，后者在本机 sqlite3 能跑、在 D1 可能直接抛 no such function，是测试绿生产红的坑。空输入返回 `[]`，`buildSessions` 解析成空 Map、回落 f1db；子查询走 `session_time` 主键索引（`SEARCH st USING INDEX ... race_id=?`），无读放大。本地 dev 无 D1 走 fixture 时该列为空，自然回落 f1db。

### 验收

- 2018–2023 的比赛页赛程条从一格变成整个周末，发车时刻与维基百科对得上
- 同期赛历页卡片的周末日期范围从单日变成真实区间（`12 MAY` → `10-12 MAY`），这是 `formatWeekendRange` 那句"老赛季无练习赛数据"注释对应的缺口被补上
- 冲刺周末的场次名称与时刻一一对应，不串位
- ≤2017 的比赛页仍只显示日期，无 00:00
- 2024+ 的页面完全不变（f1db 优先）
- 补全后的赛季 ICS 可订阅，事件时间正确
- 仓储回落逻辑有单元测试，覆盖"f1db 有""只有 FastF1""都没有"三种情况
- data-sync 全量重导后 `session_time` 不受影响
- 脚本请求的域名落在白名单内，不出现未申报的域名

## 二、天气

### 覆盖范围：只做 2018 起

≤2017 不做天气。老比赛（1950–2017）散落在近 976 场，fastf1 对它们没有计时流数据（`api.weather_data` 只覆盖 2018 起），Open-Meteo 的 archive 是按天回填的粗粒度，为一件几十年前的比赛显示当日气温价值很低，不引入。这条管线只管 2018+，含当前赛季的未来预报。

### 两个来源，按场次分工

| 场次 | 来源 | 拿到什么 |
| --- | --- | --- |
| 2018 至今、已结束 | FastF1 `api.weather_data` | 气温、赛道温度、湿度、气压、是否降雨、风速 |
| 未来 7 天内 | Open-Meteo `/v1/forecast` 按小时 | 气温、天气代码、降水概率 |
| 更远的未来 | 不取 | 预报本来不准，留空好过给假数字 |

赛道温度只有 F1 计时流有，ERA5 给不了，是这一行最有 F1 味道的字段，2018 起的场次都该显示。

一个必须知道的约束：`precipitation_probability` 是集合预报模型的产物，只有 Open-Meteo `forecast` 有；F1 计时流的 `api.weather_data` 只有"是否降雨"布尔。两条路给的是不同的东西，不能共用一个百分号。`api.weather_data` 是比赛实测，不受 ERA5 五天延迟的影响，直接可用。

### 表与脚本

- 脚本 `scripts/sync-weather.py`，PEP 723 + `uv run`
- 表 `session_weather`，`PRIMARY KEY (race_id, session_key)`，另有 `temp_c`、`track_temp_c`、`precipitation_mm`、`precipitation_probability`、`weather_code`、`source`、`fetched_at`。两种来源能填的列不同，读的时候按 `source` 判空，别指望列齐：

  | source | 有 | 没有 |
  | --- | --- | --- |
  | `trackside` | 气温、赛道温度、是否降雨（布尔） | 降水量、降水概率、`weather_code` |
  | `forecast` | 气温、降水概率、`weather_code` | 赛道温度、降水实测值 |

  优先级 `trackside` > `forecast`。降雨在两种来源里是两个不同的东西（布尔 / 百分比），不能往同一个列里塞。
- 回填：2018 至今已结束的场次——包括 2024+ 那 70 场——走 FastF1，按 session 取，用一次 `api.weather_data` 的中位数代表整场。未来 7 天内的当前赛季场次走 Open-Meteo forecast。
- 增量：每天一到两次，只处理未来 7 天内的场次；场次结束后由 FastF1 抓实测覆盖预报值，新赛季同理——`forecast` 只是一个会被替换的中间态
- 页面读不到就不渲染那一行

### 展示

赛程条每格现在是两行（My / Track）或"只有日期"的单行，天气加在它们下面。两种形态各有天气行：

| 场次形态 | 时间区 | 天气行 |
| --- | --- | --- |
| 2018+ 已结束（`trackside`） | `MY Sat 22:00` / `TRACK Sat 15:00` | `☁ 24° · 41° track` |
| 未来一周内（`forecast`） | `MY Sun 21:00` / `TRACK Sun 14:00` | `☁ 24° · 40% rain` |

≤2017 的场次只有日期单行，没有天气行。

- 天气行固定三段：图标、气温、第三项。第三项按来源取它能给的那个：`trackside` 给赛道温度，`forecast` 给降水概率
- 单位后缀不能省：`41° track` 与 `24°` 并列时，没后缀就是两个温度堆在一起
- 单位固定摄氏，不做切换开关
- 天气行是新增的第三行，赛程条格子高度会变；有无天气都要占位，避免同一页里格子参差

### 验收

- 未来一周内的场次显示预报与降水概率，更远的场次不显示天气行
- 2018 起的已结束场次显示赛道温度，数据与 F1 官方转播口径一致
- ≤2017 的场次不显示天气行
- 重复运行脚本不下调已有的 `trackside` 行到 `forecast`
- 2018 起的场次回填完成，只有日期的场次不报错
- 页脚出现 Open-Meteo 署名
- 天气行缺失时赛程条布局不跳动

## 三、赛后临时结果（FastF1 计时流）

### 目标

把 session 结束到站点可见的延迟，从"一到两天"压到一小时内。不做实时跟随。

### 范围收窄到按圈速排序的场次

练习、排位、冲刺排位做，正赛不做。

理由是正赛的临时分类要处理退赛、被套圈、赛后处罚、107% 之类一堆边界，算错的代价比晚一天更新更大，而 f1db 对正赛的更新本来就最快；练习和排位的排序规则就是最佳圈速，`session.results` 直接给，判据单一、错不了。等前两条稳定后再单独评估。

这个取舍正好对上最初的动因：周六排位赛结束到 f1db 入库之间，页面只有赛程——那正是排位赛。

### 实现

- 脚本 `scripts/sync-session-results.py`，PEP 723 + `uv run`
- 取数：`session.load()` 后读 `session.results`。排位/冲刺/冲刺排位由 FastF1 从 Jolpica 取回官方名次（`Position`、`ClassifiedPosition`），直接用；练习（FP1/FP2/FP3）`session.results` 不提供 `Position`（FastF1 只对 Race/Qualifying/Sprint/Sprint Shootout/Sprint Qualifying 给名次），练习排名用 `session.laps` 里每车手的最佳圈速自己排。禁止自己从原始 `api.timing_data` 解码赛果——`session.results` 是 FastF1 做好的成品。不用 `Session.load(livedata=...)`，那是给实时流用的。
- 触发：GitHub Action 的 cron 是静态的，跟不了赛程。赛季周末窗口内每 15 分钟轮询，脚本自己判断"有没有刚结束、库里还没有的 session"；另留 `workflow_dispatch`。Actions 高峰期本身有十几分钟排队，验收按一小时写，不写 30 分钟。
- 表 `session_result_provisional`，`PRIMARY KEY (race_id, session_key, driver_id)`，其余字段对齐现有 tab 行结构。
- 读取：仓储层 f1db 优先、缺失回落该表。f1db 到货后自然接管，临时行按 race_id 清理。
- 展示：回落数据的表格上方加一行小字，Provisional timing, official classification follows FIA。

### 车手映射

`session.results` 自带 `Abbreviation`（三字母码），f1db `driver.abbreviation` 是 `VARCHAR(3) NOT NULL`、917/917 全覆盖，直接对齐：

- 用 `Abbreviation` JOIN f1db `driver.abbreviation` → `driver_id`。三字母码在 2018 至今同赛季内无重复；跨年代会重，所以按 season 圈定 `season_entrant_driver` 再对齐，避免跨年撞码。FP1 青训车手用的三字母码与其共用的车号不冲突。
- 不用车号：车号在赛季内不唯一，青训车手共用正式车手的号，而练习赛正是本条管线的主场景；且 `driver.permanent_number` 889/917 为空，是终身号、与某赛季实际用号未必一致。
- 兜底：`Abbreviation` 在当赛季映射里找不到（临时替补还没进 f1db）就跳过该行并在 summary 里列出，不猜。车号照常写进临时表，但只用于日志核对，不参与匹配。

脚本自己不连 D1。workflow 里用 `wrangler d1 execute f1db --remote --json --command "SELECT ..."` 查一次 `season_entrant_driver` + `driver.abbreviation` 的映射表（跟 data-sync.yml 读 `sync_state` 同一套做法），把 JSON 喂给脚本；本地测试喂一份固定 JSON 就能跑。

### 为什么不是实时

FastF1 的 `fastf1.livetiming.client` 只负责把 SignalR 原始流录成文件，文档原话是 It is not possible to use this data during a session，解析必须等 session 结束后 `Session.load(livedata=...)`。真正的秒级实时要自己解码 SignalR Core 帧，F1 已迁移端点且可能需要认证（FastF1 issue #753），加上 F1 数字产品条款明确禁止 data mining（FastF1 discussion #780）。投入与风险都远超收益，不做。

### 验收

- 排位赛结束一小时内，比赛页出现 Qualifying tab，顺序与官方一致
- 车手映射按三字母码解析正确，FP1 青训车手不因共用车号而串人
- f1db 导入后同一页面切换到权威数据，临时标记消失
- data-sync 全量重导后临时表不受影响
- 仓储回落逻辑有单元测试，覆盖"只有临时数据""两者都有""都没有"三种情况
- 脚本请求的域名落在白名单内；Jolpica 只经 FastF1 触达，未直接请求

## 动手前必须先验证的一件事

本地开发机请求 `livetiming.formula1.com` 返回 403，FastF1 的镜像返回 404，所以天气与计时流在本地拿不到数据（赛程走 GitHub，不受影响）。这是地区性访问限制，不是路径问题——`api_path` 本身构造正确。

第一步先在 GitHub Actions 上跑一个最小探针（已落成 `.github/workflows/f1-probe.yml`，`workflow_dispatch` 手动触发）：取一场 2023 的排位赛，`session.load()` 后打印 `session.results` 的列与行数（重点 `Abbreviation`、`Position`）、`session.weather_data` 的行数与字段名。三件事要一起看清楚：

- `session.results` 为空或 `Abbreviation` 缺列：车手映射失去输入，第三条直接不做，不要换回车号硬凑——车号在赛季内不唯一
- `weather_data` 字段与文档不符（特别是 `TrackTemp`）：天气行的第三项要改回降水口径
- 数据都取不到：第二条 2018+ 部分和第三条整条都要重新设计

## 三条管线共用的工程前提

- 新表的 schema 没有归属。导入链路是逐表 `sqlite3 .dump` + `00-drop.sql` 反序清库，索引单独放 `scripts/f1db-d1-indexes.sql`，仓库没有 migration 机制。新增 `scripts/site-tables.sql`（幂等 `CREATE TABLE IF NOT EXISTS`），data-sync 导入后执行，preview 与生产同一份。
- 不建到 `race` 的外键。`00-drop.sql` 会 DROP f1db 表，外键会挡住清库。用裸 `race_id` + 导入后清理孤儿行。
- 查询计划护栏跑在 `apps/web/tests/fixtures/d1-schema.sql` 上，那份夹具由 dump 脚本产出、只含 f1db 表。新表的查询会因为表不存在直接让 `pnpm test` 变红，夹具生成流程要一并扩展，新索引进 `f1db-d1-indexes.sql`。
- D1 读放大。两张表的消费面不同：`session_weather` 只在比赛页用（天气只渲染在赛程条里），赛历页不查；`session_time` 两条路径都要，因为赛历卡片的周末日期范围就是从 `sessions[0]` 算的，不带它赛历页自己就是错的。代价是一整页 23 站多读百来行（每站最多 5 行，走 `race_id` 主键前缀），与 `seasonCalendarSql` 现有的 join 同一量级——配额约束防的是无索引全表扫那种几十万行，不是这个。
- 本地 dev 无 D1 走 fixture，三条管线的形态都要有对应 fixture，否则 e2e 打不到。
- 三个脚本都要在 CI 里断言请求域名白名单，把"未申报域名"变成会红的测试，而不是靠人记住。

## 交付顺序

1. 赛程时刻补全：无 UI 改动，直接让赛程条、ICS 受益，也是天气按小时取值的前提，且是唯一完全不依赖 livetiming 的一条
2. 天气：先做 2018 起已结束场次的 FastF1 实测（不依赖 livetiming 之外的东西），再接未来 7 天的 Open-Meteo 预报
3. 临时结果：依赖 livetiming 探针结果，改动触及仓储回落与车手映射，风险最高

前两条不改页面结构，第三条只加一行提示。天气行是唯一的结构改动，在第二条里一次做完。
