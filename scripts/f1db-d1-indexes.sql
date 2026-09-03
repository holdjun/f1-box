-- race_data 的 PRIMARY KEY 是 (race_id, type, position_display_order)，按 race+type 过滤
-- 已被主键自动索引覆盖，无需另建；constructor_id/driver_id 不是主键前缀，缺索引时
-- 车队页/车手页按 type 分区的查询会扫满 18 万行。
CREATE INDEX IF NOT EXISTS idx_rd_constructor_type ON race_data (constructor_id, type);
CREATE INDEX IF NOT EXISTS idx_rd_driver_type ON race_data (driver_id, type);
-- race 上游只有 PK(id) 与 UNIQUE(year, round)：比赛页的赛道纪录圈与首次举办年份按
-- circuit_id 过滤，缺索引时全扫 1171 行；带上 year 让两条查询都走覆盖索引，不再回表。
CREATE INDEX IF NOT EXISTS idx_race_circuit_year ON race (circuit_id, year);
-- 车手页队友对比按 (race_id, type, constructor_id) 探针取同场同队成绩；只有前两列时
-- 每场要读满 20 行成绩再过滤车队，20 个赛季的车手一次多读近万行。
CREATE INDEX IF NOT EXISTS idx_rd_race_type_constructor ON race_data (race_id, type, constructor_id);
-- season_* 四张表的主键都以 year 打头，车手页/车队页按 slug 过滤时没有可用索引，
-- 每条查询全扫整表（2026-09-03 实测积分榜 1681 行/次、参赛年份 4189 行/次，
-- 单个车手页十余条这类查询叠加到数千行）。带上后续列让年份查询覆盖不回表。
CREATE INDEX IF NOT EXISTS idx_sds_driver ON season_driver_standing (driver_id);
CREATE INDEX IF NOT EXISTS idx_scs_constructor ON season_constructor_standing (constructor_id);
CREATE INDEX IF NOT EXISTS idx_sed_driver ON season_entrant_driver (driver_id, test_driver, year);
CREATE INDEX IF NOT EXISTS idx_sed_constructor ON season_entrant_driver (constructor_id, test_driver, year);
CREATE INDEX IF NOT EXISTS idx_sec_constructor ON season_entrant_constructor (constructor_id, year);
