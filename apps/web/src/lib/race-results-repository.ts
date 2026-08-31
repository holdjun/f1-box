import { asNumber, asRecord, asString } from "./db-parse.js";
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

export interface PodiumEntry {
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

export interface RacePage {
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
  const r = asRecord(row, "race summary");
  return {
    round: asNumber(r.round, "round"),
    slug: asString(r.slug, "slug"),
    name: asString(r.name, "grand prix name"),
    raceName: asString(r.race_name, "race name"),
    alpha2Code: asString(r.alpha2_code, "alpha2 code"),
    countryName: asString(r.country_name, "country name"),
    date: asString(r.date, "race date"),
    time: r.time === null ? null : asString(r.time, "race time"),
    laps: asNumber(r.laps, "laps"),
    circuitId: asString(r.circuit_id, "circuit id"),
    circuitLayoutId: asString(r.circuit_layout_id, "circuit layout id"),
    circuitName: asString(r.circuit_name, "circuit name"),
    circuitPlace: asString(r.circuit_place, "circuit place"),
    sessions: buildSessions(r),
    podium: [],
    winnerName:
      r.winner_name === null ? null : asString(r.winner_name, "winner name"),
    winnerCode:
      r.winner_code === null ? null : asString(r.winner_code, "winner code"),
    winnerDriverId:
      r.winner_driver_id === null
        ? null
        : asString(r.winner_driver_id, "winner driver id"),
    winnerTeamId:
      r.winner_team_id === null
        ? null
        : asString(r.winner_team_id, "winner team id"),
    winnerTeamName:
      r.winner_team_name === null
        ? null
        : asString(r.winner_team_name, "winner team name"),
    winnerTime:
      r.winner_time === null ? null : asString(r.winner_time, "winner time"),
    poleName: r.pole_name === null ? null : asString(r.pole_name, "pole name"),
    poleCode: r.pole_code === null ? null : asString(r.pole_code, "pole code"),
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
const circuitInfoSql = `SELECT c.total_races_held,
  (SELECT MIN(ra2.year) FROM race ra2 WHERE ra2.circuit_id = c.id) AS first_gp
FROM circuit c
WHERE c.id = (SELECT ra.circuit_id FROM race ra WHERE ra.year = ?1 AND ra.grand_prix_id = ?2)`;

// 该赛道全场次最快圈（口径同原 circuit-repository：全局最小 millis）
const recordLapSql = `SELECT fl.time, d.name AS driver_name, ra.year
FROM race ra
JOIN fastest_lap fl ON fl.race_id = ra.id
JOIN driver d ON d.id = fl.driver_id
WHERE ra.circuit_id = (SELECT ra2.circuit_id FROM race ra2 WHERE ra2.year = ?1 AND ra2.grand_prix_id = ?2)
  AND fl.time_millis IS NOT NULL
ORDER BY fl.time_millis
LIMIT 1`;

// 重定向用：赛道最近一站
const latestRaceByCircuitSql = `SELECT ra.year, ra.grand_prix_id AS slug
FROM race ra
WHERE ra.circuit_id = ?1
ORDER BY ra.year DESC, ra.round DESC
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
const driverStandingsSql = `SELECT sds.position_number, sds.position_text,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       sds.points,
       (SELECT COUNT(*) FROM race_result rr JOIN race ra ON ra.id = rr.race_id
        WHERE rr.driver_id = d.id AND rr.position_number = 1 AND ra.year = sds.year) AS wins
FROM season_driver_standing sds
JOIN driver d ON sds.driver_id = d.id
WHERE sds.year = ?1
ORDER BY sds.position_display_order`;

const constructorStandingsSql = `SELECT scs.position_number, scs.position_text,
       ct.id AS team_id, ct.name AS team_name, scs.points,
       (SELECT COUNT(*) FROM race_result rr JOIN race ra ON ra.id = rr.race_id
        WHERE rr.constructor_id = ct.id AND rr.position_number = 1 AND ra.year = scs.year) AS wins
FROM season_constructor_standing scs
JOIN constructor ct ON scs.constructor_id = ct.id
WHERE scs.year = ?1
ORDER BY scs.position_display_order`;

function mapDriverStandingRow(row: unknown): DriverStandingRow {
  const r = asRecord(row, "driver standing row");
  return {
    position:
      r.position_number === null
        ? null
        : asNumber(r.position_number, "standing position"),
    positionText: asString(r.position_text, "standing position text"),
    driverId: asString(r.driver_id, "driver id"),
    driverName: asString(r.driver_name, "driver name"),
    driverCode: asString(r.driver_code, "driver code"),
    points: asNumber(r.points, "standing points"),
    wins: asNumber(r.wins, "standing wins"),
  };
}

function mapTeamStandingRow(row: unknown): TeamStandingRow {
  const r = asRecord(row, "team standing row");
  return {
    position:
      r.position_number === null
        ? null
        : asNumber(r.position_number, "standing position"),
    positionText: asString(r.position_text, "standing position text"),
    teamId: asString(r.team_id, "team id"),
    teamName: asString(r.team_name, "team name"),
    points: asNumber(r.points, "standing points"),
    wins: asNumber(r.wins, "standing wins"),
  };
}

function buildSessions(r: Record<string, unknown>): RaceSession[] {
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
    const date = r[dateKey];
    if (date === null || date === undefined) continue;
    const time = r[timeKey] ?? "00:00";
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
  const r = asRecord(row, "race meta");
  return {
    year: asNumber(r.year, "race year"),
    round: asNumber(r.round, "race round"),
    slug: asString(r.slug, "race slug"),
    name: asString(r.name, "race name"),
    officialName: asString(r.official_name, "race official name"),
    date: asString(r.date, "race date"),
    raceTime: r.time === null ? null : asString(r.time, "race time"),
    laps: asNumber(r.laps, "race laps"),
    courseLength: asNumber(r.course_length, "course length"),
    distance: asNumber(r.distance, "race distance"),
    turns: asNumber(r.turns, "race turns"),
    direction: titleCase(asString(r.direction, "race direction")),
    circuitId: asString(r.circuit_id, "circuit id"),
    circuitLayoutId: asString(r.circuit_layout_id, "circuit layout"),
    circuitFullName: asString(r.circuit_full_name, "circuit full name"),
    circuitPlace: asString(r.circuit_place, "circuit place"),
    countryName: asString(r.country_name, "country name"),
    alpha2Code: asString(r.alpha2_code, "alpha2 code"),
    sessions: buildSessions(r),
  };
}

// 赛道维度静态字段（total_races_held/first_gp + 全场次最快圈）
function mapCircuitInfo(
  circuitRow: unknown,
  recordLapRow: unknown,
): Pick<RaceMeta, "totalRacesHeld" | "firstGrandPrix" | "recordLap"> {
  const r = asRecord(circuitRow, "circuit info row");
  return {
    totalRacesHeld: asNumber(r.total_races_held, "races held"),
    firstGrandPrix:
      r.first_gp == null ? null : asNumber(r.first_gp, "first grand prix"),
    recordLap: recordLapRow == null ? null : mapRecordLapRow(recordLapRow),
  };
}

function mapRecordLapRow(value: unknown): {
  time: string;
  driverName: string;
  year: number;
} {
  const record = asRecord(value, "record lap row");
  return {
    time: asString(record.time, "record lap time"),
    driverName: asString(record.driver_name, "record lap driver"),
    year: asNumber(record.year, "record lap year"),
  };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

// 各 tab 行共有的车手/车队字段
function mapDriverFields(r: Record<string, unknown>) {
  return {
    driverNumber:
      r.driver_number === null
        ? null
        : asString(r.driver_number, "driver number"),
    driverId: asString(r.driver_id, "driver id"),
    driverName: asString(r.driver_name, "driver name"),
    driverCode: asString(r.driver_code, "driver code"),
    constructorId: asString(r.constructor_id, "constructor id"),
    constructorName: asString(r.constructor_name, "constructor name"),
  };
}

function mapPositionFields(r: Record<string, unknown>) {
  return {
    position:
      r.position_number === null
        ? null
        : asNumber(r.position_number, "position"),
    positionText: asString(r.position_text, "position text"),
  };
}

function mapRaceResultRow(row: unknown): RaceResultRow {
  const r = asRecord(row, "race result row");
  return {
    ...mapPositionFields(r),
    ...mapDriverFields(r),
    laps: r.laps === null ? null : asNumber(r.laps, "laps"),
    time: r.time === null ? null : asString(r.time, "time"),
    retiredReason:
      r.reason_retired === null
        ? null
        : asString(r.reason_retired, "retired reason"),
    gap: r.gap === null ? null : asString(r.gap, "gap"),
    points: r.points === null ? null : asNumber(r.points, "points"),
  };
}

function mapQualifyingRow(row: unknown): QualifyingRow {
  const r = asRecord(row, "qualifying row");
  return {
    ...mapPositionFields(r),
    ...mapDriverFields(r),
    q1: r.q1 === null ? null : asString(r.q1, "q1"),
    q2: r.q2 === null ? null : asString(r.q2, "q2"),
    q3: r.q3 === null ? null : asString(r.q3, "q3"),
    laps: r.laps === null ? null : asNumber(r.laps, "laps"),
  };
}

function mapGridRow(row: unknown): GridRow {
  const r = asRecord(row, "starting grid row");
  return {
    ...mapPositionFields(r),
    ...mapDriverFields(r),
    time: r.time === null ? null : asString(r.time, "time"),
  };
}

function mapFastestLapRow(row: unknown, courseLength: number): FastestLapRow {
  const r = asRecord(row, "fastest lap row");
  return {
    ...mapPositionFields(r),
    ...mapDriverFields(r),
    lap: r.lap === null ? null : asNumber(r.lap, "lap"),
    time: r.time === null ? null : asString(r.time, "time"),
    avgSpeedKph: formatAvgSpeedKph(
      courseLength,
      r.time_millis === null ? null : asNumber(r.time_millis, "lap millis"),
    ),
  };
}

function mapPitStopRow(row: unknown): PitStopRow {
  const r = asRecord(row, "pit stop row");
  return {
    ...mapDriverFields(r),
    stops: asNumber(r.stops, "stops"),
    totalSeconds: formatSeconds(
      r.total_millis === null
        ? null
        : asNumber(r.total_millis, "pit stop millis"),
    ),
  };
}

function mapPracticeRow(row: unknown): PracticeRow {
  const r = asRecord(row, "practice row");
  return {
    ...mapPositionFields(r),
    ...mapDriverFields(r),
    time: r.time === null ? null : asString(r.time, "time"),
    gap: r.gap === null ? null : asString(r.gap, "gap"),
    laps: r.laps === null ? null : asNumber(r.laps, "laps"),
  };
}

export interface RaceResultsRepository {
  getSeasonCalendar(year: number): Promise<RaceSummary[]>;
  listRaces(year: number): Promise<RaceSummary[]>;
  getSeasonYears(): Promise<number[]>;
  getRacePage(year: number, slug: string): Promise<RacePage | null>;
  getDriverStandings(year: number): Promise<DriverStandingRow[]>;
  getConstructorStandings(year: number): Promise<TeamStandingRow[]>;
  getLatestRaceByCircuit(
    circuitId: string,
  ): Promise<{ year: number; slug: string } | null>;
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
      const r = asRecord(row, "podium row");
      const race = byRound.get(asNumber(r.round, "round"));
      if (!race) continue;
      const position = asNumber(r.position_number, "position");
      race.podium[position - 1] = {
        driverCode:
          r.driver_code === null
            ? null
            : asString(r.driver_code, "driver code"),
        constructorId:
          r.constructor_id === null
            ? null
            : asString(r.constructor_id, "constructor id"),
        time:
          r.display_time === null
            ? null
            : asString(r.display_time, "display time"),
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

    async getLatestRaceByCircuit(circuitId) {
      if (!db) {
        return circuitId === "melbourne"
          ? { year: 2026, slug: "australia" }
          : null;
      }
      const [rows] = await db.batch([
        { sql: latestRaceByCircuitSql, values: [circuitId] },
      ]);
      if (rows.results.length === 0) return null;
      const r = asRecord(rows.results[0], "latest race row");
      return {
        year: asNumber(r.year, "latest race year"),
        slug: asString(r.slug, "latest race slug"),
      };
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
