-- Existing D1 databases created session_weather before FastF1's extended
-- weather channels were persisted. Rebuild the table so the migration also
-- works after site-tables.sql has already created the final shape. D1 rejects
-- dropping a table that is still referenced by a trigger, so the triggers are
-- removed for the rebuild and restored immediately afterwards.
DROP TRIGGER IF EXISTS session_source_ref_changed;
DROP TRIGGER IF EXISTS session_source_ref_deleted;

CREATE TABLE session_weather_with_fields (
  year INTEGER NOT NULL,
  round INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  temp_c REAL,
  track_temp_c REAL,
  humidity_pct REAL,
  pressure_hpa REAL,
  wind_speed_kph REAL,
  wind_direction_deg REAL,
  rainfall INTEGER CHECK (rainfall IN (0, 1)),
  sample_count INTEGER CHECK (sample_count >= 0),
  observed_at_utc TEXT,
  weather_code TEXT,
  source TEXT NOT NULL CHECK (source = 'fastf1'),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (year, round, session_key)
);

INSERT INTO session_weather_with_fields
  (year, round, session_key, temp_c, track_temp_c, humidity_pct, pressure_hpa,
   wind_speed_kph, wind_direction_deg, rainfall, sample_count, observed_at_utc,
   weather_code, source, fetched_at)
SELECT year, round, session_key, temp_c, track_temp_c,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       weather_code, source, fetched_at
FROM session_weather;

DROP TABLE session_weather;
ALTER TABLE session_weather_with_fields RENAME TO session_weather;

CREATE TRIGGER IF NOT EXISTS session_source_ref_changed
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
  DELETE FROM session_weather
    WHERE year = NEW.year AND round = NEW.round AND session_key = NEW.session_key;
  DELETE FROM weather_sync_state
    WHERE year = NEW.year AND round = NEW.round AND session_key = NEW.session_key;
END;

CREATE TRIGGER IF NOT EXISTS session_source_ref_deleted
AFTER DELETE ON session_source_ref
BEGIN
  INSERT OR IGNORE INTO weather_cache_outbox (cache_tag, created_at)
    SELECT 'weather:' || OLD.year, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE EXISTS (
      SELECT 1 FROM session_weather
      WHERE year = OLD.year AND round = OLD.round AND session_key = OLD.session_key
    );
  DELETE FROM session_weather
    WHERE year = OLD.year AND round = OLD.round AND session_key = OLD.session_key;
  DELETE FROM weather_sync_state
    WHERE year = OLD.year AND round = OLD.round AND session_key = OLD.session_key;
END;
