CREATE INDEX IF NOT EXISTS idx_rd_constructor_type ON race_data (constructor_id, type);
CREATE INDEX IF NOT EXISTS idx_rd_driver_type ON race_data (driver_id, type);
CREATE INDEX IF NOT EXISTS idx_rd_race_type ON race_data (race_id, type);
