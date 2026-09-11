-- 站点自己的表：不属于 f1db 上游，不能进 f1db-d1-dump.sh 生成的夹具。
-- f1db 全量重导不会 DROP 这些表；preview 与生产共用同一份 D1。
-- 不建到 f1db 表的外键：00-drop.sql 会 DROP f1db 表，外键会挡住清库。

-- 用 (year, round) 而不是 race.id 关联：id 是上游代理键，补录一场早期比赛
-- 就可能整体平移，旧行会静默指向另一场比赛。(year, round) 是 f1db 的业务唯一键；
-- 写入前仍须核对比赛日期，防止赛历改期或重排导致串场。
CREATE TABLE IF NOT EXISTS session_time (
  year INTEGER NOT NULL,
  round INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  starts_at_utc TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (year, round, session_key)
);

-- FastF1 采集引用：api_path 在本地/GitHub Actions 解析并预先写入，
-- Cloudflare 运行时只按明确路径取数，不再做年度赛程发现。
CREATE TABLE IF NOT EXISTS session_source_ref (
  year INTEGER NOT NULL,
  round INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  api_path TEXT NOT NULL,
  race_date TEXT NOT NULL,
  starts_at_utc TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (year, round, session_key)
);

-- 赛道实测天气：仅保存 FastF1 能提供的字段。缺失保持 NULL，
-- 不用其他来源补值，也不从 Rainfall=false 推断晴天。
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

-- D1 是唯一任务状态源；empty 需要二次确认后才转为 no_data。
CREATE TABLE IF NOT EXISTS weather_sync_state (
  year INTEGER NOT NULL,
  round INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('success', 'empty', 'no_data', 'failed', 'exhausted', 'mismatch')
  ),
  attempts INTEGER NOT NULL,
  last_error TEXT,
  last_attempt_at TEXT NOT NULL,
  next_attempt_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (year, round, session_key)
);

CREATE INDEX IF NOT EXISTS weather_sync_state_status_idx
  ON weather_sync_state(status);

-- 缓存刷新独立于采集成功，失败时保留 outbox，下一次调度重试。
CREATE TABLE IF NOT EXISTS weather_cache_outbox (
  cache_tag TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS weather_cache_outbox_created_idx
  ON weather_cache_outbox(created_at, cache_tag);

CREATE INDEX IF NOT EXISTS session_source_ref_year_start_idx
  ON session_source_ref(year, starts_at_utc);

CREATE INDEX IF NOT EXISTS session_source_ref_start_idx
  ON session_source_ref(starts_at_utc, year, round, session_key);
