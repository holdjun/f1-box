-- 0001 后的生产库只有 weather_cache_outbox；迁移为共享 session cache outbox。
-- 新库会先执行 site-tables.sql，因此这里要同时兼容“旧表已存在”和“新表已存在”。
DROP TRIGGER IF EXISTS session_source_ref_changed;
DROP TRIGGER IF EXISTS session_source_ref_deleted;

CREATE TABLE IF NOT EXISTS session_cache_outbox (
  cache_tag TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS weather_cache_outbox (
  cache_tag TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO session_cache_outbox (cache_tag, created_at)
SELECT cache_tag, created_at FROM weather_cache_outbox;
DROP TABLE weather_cache_outbox;

CREATE INDEX IF NOT EXISTS session_cache_outbox_created_idx
  ON session_cache_outbox(created_at, cache_tag);

CREATE TABLE IF NOT EXISTS session_result_snapshot (
  year INTEGER NOT NULL,
  round INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  driver_number TEXT NOT NULL,
  position_number INTEGER,
  position_text TEXT NOT NULL,
  driver_source_id TEXT,
  driver_name TEXT NOT NULL,
  driver_code TEXT NOT NULL,
  constructor_source_id TEXT,
  constructor_name TEXT NOT NULL,
  best_lap_ms INTEGER,
  q1_ms INTEGER,
  q2_ms INTEGER,
  q3_ms INTEGER,
  total_time_ms INTEGER,
  gap_ms INTEGER,
  gap_text TEXT,
  laps INTEGER,
  status TEXT,
  points REAL,
  source_revision TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (year, round, session_key, driver_number)
);

CREATE TABLE IF NOT EXISTS session_result_sync_state (
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

CREATE INDEX IF NOT EXISTS session_result_sync_state_status_idx
  ON session_result_sync_state(status);

CREATE TRIGGER session_source_ref_changed
AFTER UPDATE OF api_path, race_date, starts_at_utc ON session_source_ref
WHEN OLD.api_path IS NOT NEW.api_path
  OR OLD.race_date IS NOT NEW.race_date
  OR OLD.starts_at_utc IS NOT NEW.starts_at_utc
BEGIN
  INSERT OR IGNORE INTO session_cache_outbox (cache_tag, created_at)
    SELECT 'weather:' || NEW.year, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE EXISTS (
      SELECT 1 FROM session_weather
      WHERE year = NEW.year AND round = NEW.round AND session_key = NEW.session_key
    );
  INSERT OR IGNORE INTO session_cache_outbox (cache_tag, created_at)
    SELECT 'results:' || NEW.year, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE EXISTS (
      SELECT 1 FROM session_result_snapshot
      WHERE year = NEW.year AND round = NEW.round AND session_key = NEW.session_key
    );
  DELETE FROM session_weather
    WHERE year = NEW.year AND round = NEW.round AND session_key = NEW.session_key;
  DELETE FROM weather_sync_state
    WHERE year = NEW.year AND round = NEW.round AND session_key = NEW.session_key;
  DELETE FROM session_result_snapshot
    WHERE year = NEW.year AND round = NEW.round AND session_key = NEW.session_key;
  DELETE FROM session_result_sync_state
    WHERE year = NEW.year AND round = NEW.round AND session_key = NEW.session_key;
END;

CREATE TRIGGER session_source_ref_deleted
AFTER DELETE ON session_source_ref
BEGIN
  INSERT OR IGNORE INTO session_cache_outbox (cache_tag, created_at)
    SELECT 'weather:' || OLD.year, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE EXISTS (
      SELECT 1 FROM session_weather
      WHERE year = OLD.year AND round = OLD.round AND session_key = OLD.session_key
    );
  INSERT OR IGNORE INTO session_cache_outbox (cache_tag, created_at)
    SELECT 'results:' || OLD.year, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE EXISTS (
      SELECT 1 FROM session_result_snapshot
      WHERE year = OLD.year AND round = OLD.round AND session_key = OLD.session_key
    );
  DELETE FROM session_weather
    WHERE year = OLD.year AND round = OLD.round AND session_key = OLD.session_key;
  DELETE FROM weather_sync_state
    WHERE year = OLD.year AND round = OLD.round AND session_key = OLD.session_key;
  DELETE FROM session_result_snapshot
    WHERE year = OLD.year AND round = OLD.round AND session_key = OLD.session_key;
  DELETE FROM session_result_sync_state
    WHERE year = OLD.year AND round = OLD.round AND session_key = OLD.session_key;
END;
