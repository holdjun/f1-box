-- race_data 的 PRIMARY KEY 是 (race_id, type, position_display_order)，按 race+type 过滤
-- 已被主键自动索引覆盖，无需另建；constructor_id/driver_id 不是主键前缀，缺索引时
-- 车队页/车手页按 type 分区的查询会扫满 18 万行。
CREATE INDEX IF NOT EXISTS idx_rd_constructor_type ON race_data (constructor_id, type);
CREATE INDEX IF NOT EXISTS idx_rd_driver_type ON race_data (driver_id, type);
-- race 上游只有 PK(id) 与 UNIQUE(year, round)：比赛页的赛道纪录圈与首次举办年份按
-- circuit_id 过滤，缺索引时全扫 1171 行；带上 year 让两条查询都走覆盖索引，不再回表。
CREATE INDEX IF NOT EXISTS idx_race_circuit_year ON race (circuit_id, year);
