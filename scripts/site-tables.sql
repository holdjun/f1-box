-- 站点自己的表：不属于 f1db 上游，不能进 f1db-d1-dump.sh 生成的夹具。
-- data-sync 全量重导 f1db 后执行本文件，preview 与生产同一份。
-- 幂等（CREATE TABLE IF NOT EXISTS），重复执行无害。
-- 不建到 f1db 表的外键：00-drop.sql 会 DROP f1db 表，外键会挡住清库，
-- 用裸 race_id + 导入后清理孤儿行。查询计划护栏同时加载本文件与 f1db 夹具。

-- 赛程发车时刻补全：2018-2023 由 sync-session-times.py 回填，2024 起 f1db 自带。
-- starts_at_utc 是完整 UTC 时间戳；source 记来源（fastf1-schedule 等），用于核对。
CREATE TABLE IF NOT EXISTS session_time (
  race_id INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  starts_at_utc TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (race_id, session_key)
);

-- 赛道天气：2018 起由 sync-weather.py 回填。source ∈ trackside / forecast，
-- 能填的列不同，读的时候按 source 判空，别指望列齐。
-- weather_code 存语义词（clear/cloud/fog/rain/snow/thunder）而不是上游原值：
-- 两个来源（Open-Meteo 的 WMO 数字、trackside 的 Rainfall 布尔）必须落在同一套词上，
-- 前端才能用一套关键词分图标。
CREATE TABLE IF NOT EXISTS session_weather (
  race_id INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  temp_c REAL,
  track_temp_c REAL,
  precipitation_probability REAL,
  weather_code TEXT,
  -- 取值在建表层约束，仓储层就不用再归一化一遍
  source TEXT NOT NULL CHECK (source IN ('trackside', 'forecast')),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (race_id, session_key)
);

-- 赛后临时结果：sync-session-results.py 写入，f1db 到货后按 race_id 清理。
CREATE TABLE IF NOT EXISTS session_result_provisional (
  race_id INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  position INTEGER,
  position_text TEXT,
  driver_number TEXT,
  time TEXT,
  gap TEXT,
  laps INTEGER,
  PRIMARY KEY (race_id, session_key, driver_id)
);
