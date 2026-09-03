import { type RowReader, rowReader } from "./db-parse.js";
import type { RaceTabKey } from "./routing.js";
import { mapSeasonYearRows, seasonYearsSql } from "./season-years.js";

// 组件从本模块取全部 tab 类型；key 本体定义在 routing.ts
export type { RaceTabKey } from "./routing.js";

export interface RaceSummary {
  round: number;
  slug: string;
  name: string;
  raceName: string;
  alpha2Code: string;
  countryName: string;
  date: string;
  time: string | null;
  laps: number;
  circuitId: string;
  circuitLayoutId: string;
  circuitName: string;
  circuitPlace: string;
  sessions: RaceSession[];
  podium: PodiumEntry[];
  winnerName: string | null;
  winnerCode: string | null;
  winnerDriverId: string | null;
  winnerTeamId: string | null;
  winnerTeamName: string | null;
  winnerTime: string | null;
  poleName: string | null;
  poleCode: string | null;
}

export interface RaceSession {
  key: string;
  label: string;
  startsAtUtc: string;
}

interface PodiumEntry {
  driverCode: string | null;
  constructorId: string | null;
  // 第 1 名为完赛时间（如 1:23:06.801）；第 2/3 名为对第 1 名的秒差（如 +2.974）
  time: string | null;
}

export interface RaceMeta {
  year: number;
  round: number;
  slug: string;
  name: string;
  officialName: string;
  date: string;
  raceTime: string | null;
  laps: number;
  courseLength: number;
  distance: number;
  turns: number;
  direction: string;
  circuitId: string;
  circuitLayoutId: string;
  circuitFullName: string;
  circuitPlace: string;
  countryName: string;
  alpha2Code: string;
  totalRacesHeld: number;
  firstGrandPrix: number | null;
  recordLap: { time: string; driverName: string; year: number } | null;
  sessions: RaceSession[];
}

export interface RaceResultRow {
  position: number | null;
  positionText: string;
  driverNumber: string | null;
  driverId: string;
  driverName: string;
  driverCode: string;
  constructorId: string;
  constructorName: string;
  laps: number | null;
  time: string | null;
  retiredReason: string | null;
  gap: string | null;
  points: number | null;
}
export interface QualifyingRow {
  position: number | null;
  positionText: string;
  driverNumber: string | null;
  driverId: string;
  driverName: string;
  driverCode: string;
  constructorId: string;
  constructorName: string;
  q1: string | null;
  q2: string | null;
  q3: string | null;
  laps: number | null;
}
export interface GridRow {
  position: number | null;
  positionText: string;
  driverNumber: string | null;
  driverId: string;
  driverName: string;
  driverCode: string;
  constructorId: string;
  constructorName: string;
  time: string | null;
}
export interface FastestLapRow {
  position: number | null;
  positionText: string;
  driverNumber: string | null;
  driverId: string;
  driverName: string;
  driverCode: string;
  constructorId: string;
  constructorName: string;
  lap: number | null;
  time: string | null;
  avgSpeedKph: string | null;
}
export interface PitStopRow {
  driverNumber: string | null;
  driverId: string;
  driverName: string;
  driverCode: string;
  constructorId: string;
  constructorName: string;
  stops: number;
  totalSeconds: string | null;
}
export interface PracticeRow {
  position: number | null;
  positionText: string;
  driverNumber: string | null;
  driverId: string;
  driverName: string;
  driverCode: string;
  constructorId: string;
  constructorName: string;
  time: string | null;
  gap: string | null;
  laps: number | null;
}

export interface DriverStandingRow {
  position: number | null;
  positionText: string;
  driverId: string;
  driverName: string;
  driverCode: string;
  points: number;
  wins: number;
}
export interface TeamStandingRow {
  position: number | null;
  positionText: string;
  teamId: string;
  teamName: string;
  points: number;
  wins: number;
}

interface RacePage {
  meta: RaceMeta;
  tabs: {
    raceResult: RaceResultRow[];
    qualifying: QualifyingRow[];
    startingGrid: GridRow[];
    fastestLaps: FastestLapRow[];
    pitStops: PitStopRow[];
    practice1: PracticeRow[];
    practice2: PracticeRow[];
    practice3: PracticeRow[];
  };
}

// tab key → tabs 字段，RaceTabsNav 与 [tab].astro 共用
export const RACE_TAB_FIELDS: Record<RaceTabKey, keyof RacePage["tabs"]> = {
  "race-result": "raceResult",
  "fastest-laps": "fastestLaps",
  "pit-stop-summary": "pitStops",
  "starting-grid": "startingGrid",
  qualifying: "qualifying",
  "practice-1": "practice1",
  "practice-2": "practice2",
  "practice-3": "practice3",
};

// 前三名（正赛 1/2/3）：独立查询减轻 calendar SQL 的 join 负担，
// 返回后在 JS 侧按 (year, round) 并进 RaceSummary.podium；
// position_display_order 次级排序：共享冠军站（1951 法国等）有两条 P1 行，行序固定才不反复
const podiumSql = `SELECT ra.round,
       rr.position_number, d.abbreviation AS driver_code, ct.id AS constructor_id,
       CASE WHEN rr.position_number = 1 THEN rr.time ELSE rr.gap END AS display_time
FROM race_result rr
JOIN race ra ON rr.race_id = ra.id
JOIN driver d ON rr.driver_id = d.id
JOIN constructor ct ON rr.constructor_id = ct.id
WHERE ra.year = ?1 AND rr.position_number IN (1, 2, 3)
ORDER BY ra.round, rr.position_number, rr.position_display_order`;

export interface RaceResultsDatabase {
  batch(
    statements: { sql: string; values: readonly unknown[] }[],
  ): Promise<{ results: unknown[] }[]>;
}

// D1 batch 需要预编译语句，仓库层接口用 {sql, values} 以便测试替身
export function createD1RaceResultsDatabase(
  d1: D1Database,
): RaceResultsDatabase {
  return {
    batch: (statements) =>
      d1.batch(
        statements.map((statement) =>
          d1.prepare(statement.sql).bind(...statement.values),
        ),
      ),
  };
}

// 一条 SQL 出全年日历：冠军/完赛状态 = 正赛 P1 行，杆位 = 排位 P1 行；
// 车手名取显示名 d.name（与目录页同口径）。
// 历史上有三站共享冠军（1951 法国、1956 阿根廷、1957 英国，各两条 P1 行），
// 冠军 join 取 display_order 最小的一行，避免共享胜利的分站在列表里出现两次
const seasonCalendarSql = `SELECT ra.round, ra.grand_prix_id AS slug, gp.name,
       gp.full_name AS race_name, c.alpha2_code, c.name AS country_name,
       ra.date, ra.time, ra.laps,
       ra.circuit_layout_id, ci.id AS circuit_id, ci.name AS circuit_name, ci.place_name AS circuit_place,
       ra.free_practice_1_date, ra.free_practice_1_time,
       ra.free_practice_2_date, ra.free_practice_2_time,
       ra.free_practice_3_date, ra.free_practice_3_time,
       ra.qualifying_date, ra.qualifying_time,
       ra.sprint_qualifying_date, ra.sprint_qualifying_time,
       ra.sprint_race_date, ra.sprint_race_time,
       wd.id AS winner_driver_id, wd.name AS winner_name, wd.abbreviation AS winner_code,
       wct.id AS winner_team_id, wct.name AS winner_team_name, wrr.time AS winner_time,
       pd.name AS pole_name, pd.abbreviation AS pole_code
FROM race ra
JOIN grand_prix gp ON ra.grand_prix_id = gp.id
JOIN country c ON gp.country_id = c.id
JOIN circuit ci ON ra.circuit_id = ci.id
LEFT JOIN race_result wrr ON wrr.race_id = ra.id AND wrr.position_number = 1
  AND wrr.position_display_order = (
    SELECT MIN(x.position_display_order) FROM race_result x
    WHERE x.race_id = ra.id AND x.position_number = 1
  )
LEFT JOIN driver wd ON wrr.driver_id = wd.id
LEFT JOIN constructor wct ON wrr.constructor_id = wct.id
LEFT JOIN qualifying_result qr ON qr.race_id = ra.id AND qr.position_number = 1
LEFT JOIN driver pd ON qr.driver_id = pd.id
WHERE ra.year = ?1
ORDER BY ra.round`;

function mapRaceSummary(row: unknown): RaceSummary {
  const r = rowReader(row, "race summary");
  return {
    round: r.num("round"),
    slug: r.str("slug"),
    name: r.str("name"),
    raceName: r.str("race_name"),
    alpha2Code: r.str("alpha2_code"),
    countryName: r.str("country_name"),
    date: r.str("date"),
    time: r.strOrNull("time"),
    laps: r.num("laps"),
    circuitId: r.str("circuit_id"),
    circuitLayoutId: r.str("circuit_layout_id"),
    circuitName: r.str("circuit_name"),
    circuitPlace: r.str("circuit_place"),
    sessions: buildSessions(r),
    podium: [],
    winnerName: r.strOrNull("winner_name"),
    winnerCode: r.strOrNull("winner_code"),
    winnerDriverId: r.strOrNull("winner_driver_id"),
    winnerTeamId: r.strOrNull("winner_team_id"),
    winnerTeamName: r.strOrNull("winner_team_name"),
    winnerTime: r.strOrNull("winner_time"),
    poleName: r.strOrNull("pole_name"),
    poleCode: r.strOrNull("pole_code"),
  };
}

// 分站与所有 tab 行都用 (year, slug) 子查询定位，一次 batch 取齐
const raceIdSubquery = `(SELECT id FROM race WHERE year = ?1 AND grand_prix_id = ?2)`;

const raceMetaSql = `SELECT ra.year, ra.round, ra.grand_prix_id AS slug, gp.name,
       ra.official_name, ra.date, ra.time, ra.laps, ra.course_length,
       ra.circuit_id, ra.circuit_layout_id, ci.full_name AS circuit_full_name, ci.place_name AS circuit_place,
       ra.distance, ra.turns, ra.direction,
       cc.name AS country_name, cc.alpha2_code,
       ra.free_practice_1_date, ra.free_practice_1_time,
       ra.free_practice_2_date, ra.free_practice_2_time,
       ra.free_practice_3_date, ra.free_practice_3_time,
       ra.qualifying_date, ra.qualifying_time,
       ra.sprint_qualifying_date, ra.sprint_qualifying_time,
       ra.sprint_race_date, ra.sprint_race_time
FROM race ra
JOIN grand_prix gp ON ra.grand_prix_id = gp.id
JOIN circuit ci ON ra.circuit_id = ci.id
JOIN country cc ON gp.country_id = cc.id
WHERE ra.year = ?1 AND ra.grand_prix_id = ?2`;

// 赛道维度静态字段：total_races_held 为累计办赛场次，first_gp 为历史首办年
// export 供索引计划测试：相关子查询按 circuit_id 取首次举办年份
const circuitInfoSql = `SELECT c.total_races_held,
  (SELECT MIN(ra2.year) FROM race ra2 WHERE ra2.circuit_id = c.id) AS first_gp
FROM circuit c
WHERE c.id = (SELECT ra.circuit_id FROM race ra WHERE ra.year = ?1 AND ra.grand_prix_id = ?2)`;

// 该赛道全场次最快圈（口径同原 circuit-repository：全局最小 millis）；export 供索引计划测试。
// CROSS JOIN 不改语义，只禁止规划器重排连接顺序。上游 race_data 有 rcda_type_idx，
// 缺 ANALYZE 统计时规划器会误从 type 分区起步：拉出整个 FASTEST_LAP 分区（真实数据
// 17105 行）再逐行回表 race 与 driver，实测每次读 7.5 万行——2026-09-02 生产 D1 日读
// 配额被这一条查询烧掉 722 万行。固定成从 ra 走 idx_race_circuit_year 后，最多只读该
// 赛道场次数×每场最快圈行数（Monza 956 行）。
const recordLapSql = `SELECT fl.time, d.name AS driver_name, ra.year
FROM race ra
CROSS JOIN fastest_lap fl ON fl.race_id = ra.id
CROSS JOIN driver d ON d.id = fl.driver_id
WHERE ra.circuit_id = (SELECT ra2.circuit_id FROM race ra2 WHERE ra2.year = ?1 AND ra2.grand_prix_id = ?2)
  AND fl.time_millis IS NOT NULL
ORDER BY fl.time_millis
LIMIT 1`;

const raceResultSql = `SELECT rr.position_number, rr.position_text, rr.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name,
       rr.laps, rr.time, rr.reason_retired, rr.gap, rr.points
FROM race_result rr
JOIN driver d ON rr.driver_id = d.id
JOIN constructor ct ON rr.constructor_id = ct.id
WHERE rr.race_id = ${raceIdSubquery}
ORDER BY rr.position_display_order`;

const qualifyingSql = `SELECT qr.position_number, qr.position_text, qr.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name,
       qr.q1, qr.q2, qr.q3, qr.laps
FROM qualifying_result qr
JOIN driver d ON qr.driver_id = d.id
JOIN constructor ct ON qr.constructor_id = ct.id
WHERE qr.race_id = ${raceIdSubquery}
ORDER BY qr.position_display_order`;

const startingGridSql = `SELECT sg.position_number, sg.position_text, sg.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name, sg.time
FROM starting_grid_position sg
JOIN driver d ON sg.driver_id = d.id
JOIN constructor ct ON sg.constructor_id = ct.id
WHERE sg.race_id = ${raceIdSubquery}
ORDER BY sg.position_display_order`;

const fastestLapsSql = `SELECT fl.position_number, fl.position_text, fl.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name,
       fl.lap, fl.time, fl.time_millis
FROM fastest_lap fl
JOIN driver d ON fl.driver_id = d.id
JOIN constructor ct ON fl.constructor_id = ct.id
WHERE fl.race_id = ${raceIdSubquery}
ORDER BY fl.position_display_order`;

// f1.com pit-stop-summary 口径：按车手聚合单停
const pitStopsSql = `SELECT ps.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name,
       COUNT(*) AS stops, SUM(ps.time_millis) AS total_millis
FROM pit_stop ps
JOIN driver d ON ps.driver_id = d.id
JOIN constructor ct ON ps.constructor_id = ct.id
WHERE ps.race_id = ${raceIdSubquery}
GROUP BY ps.driver_id, ps.driver_number, d.name, d.abbreviation, ct.id, ct.name
ORDER BY stops ASC, total_millis ASC`;

const practiceSql = (
  n: 1 | 2 | 3,
) => `SELECT p.position_number, p.position_text, p.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name,
       p.time, p.gap, p.laps
FROM free_practice_${n}_result p
JOIN driver d ON p.driver_id = d.id
JOIN constructor ct ON p.constructor_id = ct.id
WHERE p.race_id = ${raceIdSubquery}
ORDER BY p.position_display_order`;

// wins：f1db 积分榜表无该列，从正赛 P1 行按年聚合（race_data (driver_id, type) 索引可用）
// 胜场数写成相关子查询时，积分榜每行都从车手分区起步：idx_rd_driver_type 里没有 year，
// 只能先拉出该车手全生涯的成绩再回 race 表过滤（2026-09-03 实测 4166 行/次）。
// 改成按赛季一次算完物化，读量只与该赛季的场次有关（同条件实测 389 行）
const driverStandingsSql = `WITH season_wins AS (
  SELECT rr.driver_id, COUNT(*) AS wins
  FROM race ra
  CROSS JOIN race_result rr ON rr.race_id = ra.id
  WHERE ra.year = ?1 AND rr.position_number = 1
  GROUP BY rr.driver_id
)
SELECT sds.position_number, sds.position_text,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       sds.points, COALESCE(w.wins, 0) AS wins
FROM season_driver_standing sds
JOIN driver d ON sds.driver_id = d.id
LEFT JOIN season_wins w ON w.driver_id = d.id
WHERE sds.year = ?1
ORDER BY sds.position_display_order`;

const constructorStandingsSql = `WITH season_wins AS (
  SELECT rr.constructor_id, COUNT(*) AS wins
  FROM race ra
  CROSS JOIN race_result rr ON rr.race_id = ra.id
  WHERE ra.year = ?1 AND rr.position_number = 1
  GROUP BY rr.constructor_id
)
SELECT scs.position_number, scs.position_text,
       ct.id AS team_id, ct.name AS team_name, scs.points,
       COALESCE(w.wins, 0) AS wins
FROM season_constructor_standing scs
JOIN constructor ct ON scs.constructor_id = ct.id
LEFT JOIN season_wins w ON w.constructor_id = ct.id
WHERE scs.year = ?1
ORDER BY scs.position_display_order`;

function mapDriverStandingRow(row: unknown): DriverStandingRow {
  const r = rowReader(row, "driver standing row");
  return {
    position: r.numOrNull("position_number"),
    positionText: r.str("position_text"),
    driverId: r.str("driver_id"),
    driverName: r.str("driver_name"),
    driverCode: r.str("driver_code"),
    points: r.num("points"),
    wins: r.num("wins"),
  };
}

function mapTeamStandingRow(row: unknown): TeamStandingRow {
  const r = rowReader(row, "team standing row");
  return {
    position: r.numOrNull("position_number"),
    positionText: r.str("position_text"),
    teamId: r.str("team_id"),
    teamName: r.str("team_name"),
    points: r.num("points"),
    wins: r.num("wins"),
  };
}

function buildSessions(r: RowReader): RaceSession[] {
  const defs: [string, string, string, string][] = [
    [
      "practice-1",
      "Practice 1",
      "free_practice_1_date",
      "free_practice_1_time",
    ],
    [
      "practice-2",
      "Practice 2",
      "free_practice_2_date",
      "free_practice_2_time",
    ],
    [
      "practice-3",
      "Practice 3",
      "free_practice_3_date",
      "free_practice_3_time",
    ],
    ["qualifying", "Qualifying", "qualifying_date", "qualifying_time"],
    [
      "sprint-qualifying",
      "Sprint Qualifying",
      "sprint_qualifying_date",
      "sprint_qualifying_time",
    ],
    ["sprint", "Sprint", "sprint_race_date", "sprint_race_time"],
    ["race", "Race", "date", "time"],
  ];
  const sessions: RaceSession[] = [];
  for (const [key, label, dateKey, timeKey] of defs) {
    if (r.isNull(dateKey)) continue;
    const date = r.str(dateKey);
    const time = r.strOrNull(timeKey) ?? "00:00";
    sessions.push({ key, label, startsAtUtc: `${date}T${time}:00Z` });
  }
  // defs 顺序是字段映射序；sprint 周末 Quali 在 Sprint 之后，按开始时间排回真实顺序
  return sessions.sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc));
}

// 不含赛道维度派生字段（totalRacesHeld/firstGrandPrix/recordLap 来自第二条 batch），
// 由 getRacePage 合并成完整 RaceMeta
function mapRaceMeta(
  row: unknown,
): Omit<RaceMeta, "totalRacesHeld" | "firstGrandPrix" | "recordLap"> {
  const r = rowReader(row, "race meta");
  return {
    year: r.num("year"),
    round: r.num("round"),
    slug: r.str("slug"),
    name: r.str("name"),
    officialName: r.str("official_name"),
    date: r.str("date"),
    raceTime: r.strOrNull("time"),
    laps: r.num("laps"),
    courseLength: r.num("course_length"),
    distance: r.num("distance"),
    turns: r.num("turns"),
    direction: titleCase(r.str("direction")),
    circuitId: r.str("circuit_id"),
    circuitLayoutId: r.str("circuit_layout_id"),
    circuitFullName: r.str("circuit_full_name"),
    circuitPlace: r.str("circuit_place"),
    countryName: r.str("country_name"),
    alpha2Code: r.str("alpha2_code"),
    sessions: buildSessions(r),
  };
}

// 赛道维度静态字段（total_races_held/first_gp + 全场次最快圈）
function mapCircuitInfo(
  circuitRow: unknown,
  recordLapRow: unknown,
): Pick<RaceMeta, "totalRacesHeld" | "firstGrandPrix" | "recordLap"> {
  const r = rowReader(circuitRow, "circuit info row");
  return {
    totalRacesHeld: r.num("total_races_held"),
    firstGrandPrix: r.numOrNull("first_gp"),
    recordLap: recordLapRow == null ? null : mapRecordLapRow(recordLapRow),
  };
}

function mapRecordLapRow(value: unknown): {
  time: string;
  driverName: string;
  year: number;
} {
  const record = rowReader(value, "record lap row");
  return {
    time: record.str("time"),
    driverName: record.str("driver_name"),
    year: record.num("year"),
  };
}

function titleCase(value: string): string {
  // f1db 的枚举是 SCREAMING_SNAKE（CLOCKWISE / ANTI_CLOCKWISE），下划线要还原成连字符
  const words = value.toLowerCase().split("_");
  return [
    words[0].charAt(0).toUpperCase() + words[0].slice(1),
    ...words.slice(1),
  ].join("-");
}

// 各 tab 行共有的车手/车队字段
function mapDriverFields(r: RowReader) {
  return {
    driverNumber: r.strOrNull("driver_number"),
    driverId: r.str("driver_id"),
    driverName: r.str("driver_name"),
    driverCode: r.str("driver_code"),
    constructorId: r.str("constructor_id"),
    constructorName: r.str("constructor_name"),
  };
}

function mapPositionFields(r: RowReader) {
  return {
    position: r.numOrNull("position_number"),
    positionText: r.str("position_text"),
  };
}

function mapRaceResultRow(row: unknown): RaceResultRow {
  const r = rowReader(row, "race result row");
  return {
    ...mapPositionFields(r),
    ...mapDriverFields(r),
    laps: r.numOrNull("laps"),
    time: r.strOrNull("time"),
    retiredReason: r.strOrNull("reason_retired"),
    gap: r.strOrNull("gap"),
    points: r.numOrNull("points"),
  };
}

function mapQualifyingRow(row: unknown): QualifyingRow {
  const r = rowReader(row, "qualifying row");
  return {
    ...mapPositionFields(r),
    ...mapDriverFields(r),
    q1: r.strOrNull("q1"),
    q2: r.strOrNull("q2"),
    q3: r.strOrNull("q3"),
    laps: r.numOrNull("laps"),
  };
}

function mapGridRow(row: unknown): GridRow {
  const r = rowReader(row, "starting grid row");
  return {
    ...mapPositionFields(r),
    ...mapDriverFields(r),
    time: r.strOrNull("time"),
  };
}

function mapFastestLapRow(row: unknown, courseLength: number): FastestLapRow {
  const r = rowReader(row, "fastest lap row");
  return {
    ...mapPositionFields(r),
    ...mapDriverFields(r),
    lap: r.numOrNull("lap"),
    time: r.strOrNull("time"),
    avgSpeedKph: formatAvgSpeedKph(courseLength, r.numOrNull("time_millis")),
  };
}

function mapPitStopRow(row: unknown): PitStopRow {
  const r = rowReader(row, "pit stop row");
  return {
    ...mapDriverFields(r),
    stops: r.num("stops"),
    totalSeconds: formatSeconds(r.numOrNull("total_millis")),
  };
}

function mapPracticeRow(row: unknown): PracticeRow {
  const r = rowReader(row, "practice row");
  return {
    ...mapPositionFields(r),
    ...mapDriverFields(r),
    time: r.strOrNull("time"),
    gap: r.strOrNull("gap"),
    laps: r.numOrNull("laps"),
  };
}

export interface RaceResultsRepository {
  getSeasonCalendar(year: number): Promise<RaceSummary[]>;
  listRaces(year: number): Promise<RaceSummary[]>;
  getSeasonYears(): Promise<number[]>;
  getRacePage(year: number, slug: string): Promise<RacePage | null>;
  getDriverStandings(year: number): Promise<DriverStandingRow[]>;
  getConstructorStandings(year: number): Promise<TeamStandingRow[]>;
}

export function createRaceResultsRepository(
  db?: RaceResultsDatabase,
): RaceResultsRepository {
  const calendar = async (year: number): Promise<RaceSummary[]> => {
    if (!db) {
      // fixture 含全部 23 站（DEV）；生产同一条 SQL
      if (year !== 2026) return [];
      const { default: fixture } = await import(
        "./fixtures/season-races-2026.json"
      );
      return (fixture as { races: RaceSummary[] }).races;
    }
    const [rows, podiumRows] = await db.batch([
      { sql: seasonCalendarSql, values: [year] },
      { sql: podiumSql, values: [year] },
    ]);
    // SQL 已挑定并列 P1 中的一行；这里按 round 去重兜底，共享冠军只出一条
    const byRound = new Map<number, RaceSummary>();
    for (const row of rows.results) {
      const race = mapRaceSummary(row);
      if (!byRound.has(race.round)) byRound.set(race.round, race);
    }
    for (const row of podiumRows.results) {
      const r = rowReader(row, "podium row");
      const race = byRound.get(r.num("round"));
      if (!race) continue;
      const position = r.num("position_number");
      race.podium[position - 1] = {
        driverCode: r.strOrNull("driver_code"),
        constructorId: r.strOrNull("constructor_id"),
        time: r.strOrNull("display_time"),
      };
    }
    return [...byRound.values()];
  };

  return {
    getSeasonCalendar: calendar,

    // 列表页只展示已完赛（有冠军行），与日历共用一次查询口径
    async listRaces(year) {
      return (await calendar(year)).filter((race) => race.winnerName !== null);
    },

    async getSeasonYears() {
      if (!db) {
        const { default: fixture } = await import(
          "./fixtures/season-races-2026.json"
        );
        return (fixture as { years: number[] }).years;
      }
      const [rows] = await db.batch([{ sql: seasonYearsSql, values: [] }]);
      return mapSeasonYearRows(rows.results);
    },

    async getRacePage(year, slug) {
      if (!db) {
        if (year !== 2026 || slug !== "australia") return null;
        const { default: fixture } = await import(
          "./fixtures/race-australia-2026.json"
        );
        return fixture as RacePage;
      }
      const values = [year, slug];
      const [
        metaRows,
        raceRows,
        qualifyingRows,
        gridRows,
        fastestLapRows,
        pitStopRows,
        practice1Rows,
        practice2Rows,
        practice3Rows,
        circuitInfoRows,
        recordLapRows,
      ] = await db.batch([
        { sql: raceMetaSql, values },
        { sql: raceResultSql, values },
        { sql: qualifyingSql, values },
        { sql: startingGridSql, values },
        { sql: fastestLapsSql, values },
        { sql: pitStopsSql, values },
        { sql: practiceSql(1), values },
        { sql: practiceSql(2), values },
        { sql: practiceSql(3), values },
        { sql: circuitInfoSql, values },
        { sql: recordLapSql, values },
      ]);
      if (metaRows.results.length === 0) return null;
      const meta: RaceMeta = {
        ...mapRaceMeta(metaRows.results[0]),
        ...mapCircuitInfo(circuitInfoRows.results[0], recordLapRows.results[0]),
      };
      return {
        meta,
        tabs: {
          raceResult: raceRows.results.map(mapRaceResultRow),
          qualifying: qualifyingRows.results.map(mapQualifyingRow),
          startingGrid: gridRows.results.map(mapGridRow),
          fastestLaps: fastestLapRows.results.map((row) =>
            mapFastestLapRow(row, meta.courseLength),
          ),
          pitStops: pitStopRows.results.map(mapPitStopRow),
          practice1: practice1Rows.results.map(mapPracticeRow),
          practice2: practice2Rows.results.map(mapPracticeRow),
          practice3: practice3Rows.results.map(mapPracticeRow),
        },
      };
    },

    async getDriverStandings(year) {
      if (!db) {
        if (year !== 2026) return [];
        const { default: fixture } = await import(
          "./fixtures/standings-2026.json"
        );
        return (fixture as { drivers: DriverStandingRow[] }).drivers;
      }
      const [rows] = await db.batch([
        { sql: driverStandingsSql, values: [year] },
      ]);
      return rows.results.map(mapDriverStandingRow);
    },

    async getConstructorStandings(year) {
      if (!db) {
        if (year !== 2026) return [];
        const { default: fixture } = await import(
          "./fixtures/standings-2026.json"
        );
        return (fixture as { teams: TeamStandingRow[] }).teams;
      }
      const [rows] = await db.batch([
        { sql: constructorStandingsSql, values: [year] },
      ]);
      return rows.results.map(mapTeamStandingRow);
    },
  };
}

export function formatAvgSpeedKph(
  courseLengthKm: number,
  timeMillis: number | null,
): string | null {
  if (timeMillis === null || timeMillis <= 0) return null;
  return (courseLengthKm / (timeMillis / 3_600_000)).toFixed(3);
}

export function formatSeconds(totalMillis: number | null): string | null {
  if (totalMillis === null) return null;
  return (totalMillis / 1000).toFixed(3);
}
