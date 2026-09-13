-- 0002 在 PR preview 共用生产 D1 时提前把 outbox 改了名。恢复沿用既有表名，
-- 并保留新表作兼容，避免在旧、新 Worker 滚动切换期间删除任何待 purge 的 tag。
CREATE TABLE IF NOT EXISTS weather_cache_outbox (
  cache_tag TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO weather_cache_outbox (cache_tag, created_at)
SELECT cache_tag, created_at FROM session_cache_outbox;

CREATE INDEX IF NOT EXISTS weather_cache_outbox_created_idx
  ON weather_cache_outbox(created_at, cache_tag);

DROP TRIGGER IF EXISTS session_source_ref_changed;
DROP TRIGGER IF EXISTS session_source_ref_deleted;

CREATE TRIGGER session_source_ref_changed
AFTER UPDATE OF api_path, race_date, starts_at_utc ON session_source_ref
WHEN OLD.api_path IS NOT NEW.api_path
  OR OLD.race_date IS NOT NEW.race_date
  OR OLD.starts_at_utc IS NOT NEW.starts_at_utc
BEGIN
  INSERT OR IGNORE INTO weather_cache_outbox (cache_tag, created_at)
    SELECT 'weather:' || NEW.year, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE EXISTS (
      SELECT 1 FROM session_weather
      WHERE year = NEW.year AND round = NEW.round AND session_key = NEW.session_key
    );
  INSERT OR IGNORE INTO weather_cache_outbox (cache_tag, created_at)
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
  INSERT OR IGNORE INTO weather_cache_outbox (cache_tag, created_at)
    SELECT 'weather:' || OLD.year, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE EXISTS (
      SELECT 1 FROM session_weather
      WHERE year = OLD.year AND round = OLD.round AND session_key = OLD.session_key
    );
  INSERT OR IGNORE INTO weather_cache_outbox (cache_tag, created_at)
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
