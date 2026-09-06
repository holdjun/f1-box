-- 站点自己的表：不属于 f1db 上游，不能进 f1db-d1-dump.sh 生成的夹具。
-- data-sync 全量重导 f1db 后执行本文件，preview 与生产同一份。
-- 幂等（CREATE TABLE IF NOT EXISTS），重复执行无害。
-- 不建到 f1db 表的外键：00-drop.sql 会 DROP f1db 表，外键会挡住清库。
-- 查询计划护栏同时加载本文件与 f1db 夹具。
--
-- 用 (year, round) 而不是 race.id 关联：id 是上游的代理键，补录一场早期比赛
-- 就可能整体平移，届时旧行会静默指向另一场比赛，页面显示错时刻且无人报警。
-- (year, round) 是 f1db 自己声明的业务唯一键（race_year_round_uk），
-- 也是 F1 赛历的自然标识，不会变。

-- 赛程发车时刻补全：2018-2023 由 sync-session-times.py 回填，2024 起 f1db 自带。
-- starts_at_utc 是完整 UTC 时间戳；source 记来源（fastf1-schedule 等），用于核对。
CREATE TABLE IF NOT EXISTS session_time (
  year INTEGER NOT NULL,
  round INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  starts_at_utc TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (year, round, session_key)
);

-- 赛道实测天气：仅写 FastF1 能提供的字段。AirTemp / TrackTemp / Rainfall
-- 任一缺失都保持 NULL，不从其他来源补值；weather_code 目前只存 Rainfall=true
-- 对应的 rain，不能从 Rainfall=false 推断晴天或云量。
CREATE TABLE IF NOT EXISTS session_weather (
  year INTEGER NOT NULL,
  round INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  temp_c REAL,
  track_temp_c REAL,
  weather_code TEXT,
  source TEXT NOT NULL CHECK (source = 'fastf1'),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (year, round, session_key)
);

-- 赛后临时结果的表等管线 3 真做时再建：它的列取决于探针确认的
-- session.results 实际字段，现在建出来只是一张没人读写、且大概率要改的表。
