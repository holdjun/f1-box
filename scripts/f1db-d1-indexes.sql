-- D1 上的索引全集。
--
-- 前提：导入走逐表 `sqlite3 .dump <table>`，而单表 dump 只输出 CREATE TABLE 与
-- INSERT，不输出该表的索引（索引只随全库 dump 出现）。上游 f1db 的 164 条索引因此
-- 一条都没进 D1，库里除主键/唯一约束的自动索引外只有本文件建立的这些。
--
-- 这也是有意的选择：上游给几乎每一列都建了单列索引，照搬会让每周全量重导明显变慢，
-- 而站点的访问维度只有三个。索引按维度族设计，不按单条查询打补丁：
--
--   f1db 的事实表主键一律以时间维度打头（race_id 或 year），站点页面却一律从实体
--   入口进入（车手/车队/赛道 slug）。所以规则是——凡是被按实体 slug 过滤的表，都要
--   一条以该实体列打头的索引；复合列顺序取 [实体, 分区判别列, 输出列]，让最热的查询
--   覆盖不回表。新增查询照此规则推导，`pnpm test` 的查询计划护栏会兜住遗漏。

-- 维度族一：race_data 的实体入口。
-- 这一张表被 17 个视图按 type 分区共享（race_result、fastest_lap、pit_stop ……），
-- 主键 (race_id, type, position_display_order) 只服务"某场比赛的某类成绩"。
-- 车手页/车队页要的是反向切片——某个实体的全部比赛，缺索引时每条查询扫满 18 万行。
CREATE INDEX IF NOT EXISTS idx_rd_driver_type ON race_data (driver_id, type);
CREATE INDEX IF NOT EXISTS idx_rd_constructor_type ON race_data (constructor_id, type);
-- 队友对比是第三种切片：同场同队。前两列已由主键自动索引提供，补上 constructor_id
-- 才能精确探针，否则每场要读满 20 行成绩再过滤车队。
CREATE INDEX IF NOT EXISTS idx_rd_race_type_constructor ON race_data (race_id, type, constructor_id);

-- 维度族二：season_* 的实体入口。
-- 参赛登记与积分榜的主键都以 year 打头，车手页/车队页按 slug 过滤时无索引可用，
-- 每条查询全扫整表（实测积分榜 1681 行、参赛年份 4189 行，单个车手页十余条叠加）。
-- 带上 test_driver 与 year 让"该实体参加过哪些赛季"这类年份查询走覆盖索引。
CREATE INDEX IF NOT EXISTS idx_sds_driver ON season_driver_standing (driver_id);
CREATE INDEX IF NOT EXISTS idx_scs_constructor ON season_constructor_standing (constructor_id);
CREATE INDEX IF NOT EXISTS idx_sed_driver ON season_entrant_driver (driver_id, test_driver, year);
CREATE INDEX IF NOT EXISTS idx_sed_constructor ON season_entrant_driver (constructor_id, test_driver, year);
CREATE INDEX IF NOT EXISTS idx_sec_constructor ON season_entrant_constructor (constructor_id, year);
-- 历届车手冠军是全表里 76 行的稀疏子集，部分索引把它变成独立的小表。
CREATE INDEX IF NOT EXISTS idx_sds_champions ON season_driver_standing (year, driver_id)
  WHERE championship_won = 1;

-- 维度族三：race 的赛道入口。
-- race 上游只有 PK(id) 与 UNIQUE(year, round)。比赛页要按 circuit_id 取赛道纪录圈与
-- 首次举办年份，带上 year 让两条查询都走覆盖索引。
CREATE INDEX IF NOT EXISTS idx_race_circuit_year ON race (circuit_id, year);
