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
  circuitName: string;
  circuitPlace: string;
  winnerName: string | null;
  winnerCode: string | null;
  winnerTeamId: string | null;
  winnerTeamName: string | null;
  winnerTime: string | null;
  poleName: string | null;
  poleCode: string | null;
}

export interface RaceSession { key: string; label: string; startsAtUtc: string; }

export interface RaceMeta {
  year: number; round: number; slug: string; name: string; officialName: string;
  date: string; laps: number; courseLength: number;
  circuitName: string; circuitPlace: string; countryName: string; alpha2Code: string;
  sessions: RaceSession[];
}

export interface RaceResultRow {
  position: number | null; positionText: string;
  driverNumber: string | null; driverId: string; driverName: string; driverCode: string;
  constructorId: string; constructorName: string;
  laps: number | null; time: string | null; retiredReason: string | null; gap: string | null; points: number | null;
}
export interface QualifyingRow {
  position: number | null; positionText: string;
  driverNumber: string | null; driverId: string; driverName: string; driverCode: string;
  constructorId: string; constructorName: string;
  q1: string | null; q2: string | null; q3: string | null; laps: number | null;
}
export interface GridRow {
  position: number | null; positionText: string;
  driverNumber: string | null; driverId: string; driverName: string; driverCode: string;
  constructorId: string; constructorName: string;
  time: string | null;
}
export interface FastestLapRow {
  position: number | null; positionText: string;
  driverNumber: string | null; driverId: string; driverName: string; driverCode: string;
  constructorId: string; constructorName: string;
  lap: number | null; time: string | null; avgSpeedKph: string | null;
}
export interface PitStopRow {
  driverNumber: string | null; driverId: string; driverName: string; driverCode: string;
  constructorId: string; constructorName: string;
  stops: number; totalSeconds: string | null;
}
export interface PracticeRow {
  position: number | null; positionText: string;
  driverNumber: string | null; driverId: string; driverName: string; driverCode: string;
  constructorId: string; constructorName: string;
  time: string | null; gap: string | null; laps: number | null;
}

export interface RacePage {
  meta: RaceMeta;
  tabs: {
    raceResult: RaceResultRow[];
    qualifying: QualifyingRow[];
    startingGrid: GridRow[];
    fastestLaps: FastestLapRow[];
    pitStops: PitStopRow[];
    practice1: PracticeRow[]; practice2: PracticeRow[]; practice3: PracticeRow[];
  };
}

// tab key → tabs 字段，RaceTabsNav 与 [tab].astro 共用
export const RACE_TAB_FIELDS: Record<RaceTabKey, keyof RacePage["tabs"]> = {
  "race-result": "raceResult", "fastest-laps": "fastestLaps",
  "pit-stop-summary": "pitStops", "starting-grid": "startingGrid",
  "qualifying": "qualifying",
  "practice-1": "practice1", "practice-2": "practice2", "practice-3": "practice3",
};

export interface RaceResultsDatabase {
  batch(
    statements: { sql: string; values: readonly unknown[] }[],
  ): Promise<{ results: unknown[] }[]>;
}

// D1 batch 需要预编译语句，仓库层接口用 {sql, values} 以便测试替身
export function createD1RaceResultsDatabase(d1: D1Database): RaceResultsDatabase {
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
// 车手名取显示名 d.name（与目录页同口径）
const seasonCalendarSql = `SELECT ra.round, ra.grand_prix_id AS slug, gp.name,
       gp.full_name AS race_name, c.alpha2_code, c.name AS country_name,
       ra.date, ra.time, ra.laps,
       ci.name AS circuit_name, ci.place_name AS circuit_place,
       wd.name AS winner_name, wd.abbreviation AS winner_code,
       wct.id AS winner_team_id, wct.name AS winner_team_name, wrr.time AS winner_time,
       pd.name AS pole_name, pd.abbreviation AS pole_code
FROM race ra
JOIN grand_prix gp ON ra.grand_prix_id = gp.id
JOIN country c ON gp.country_id = c.id
JOIN circuit ci ON ra.circuit_id = ci.id
LEFT JOIN race_result wrr ON wrr.race_id = ra.id AND wrr.position_number = 1
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
    circuitName: asString(r.circuit_name, "circuit name"),
    circuitPlace: asString(r.circuit_place, "circuit place"),
    winnerName: r.winner_name === null ? null : asString(r.winner_name, "winner name"),
    winnerCode: r.winner_code === null ? null : asString(r.winner_code, "winner code"),
    winnerTeamId: r.winner_team_id === null ? null : asString(r.winner_team_id, "winner team id"),
    winnerTeamName: r.winner_team_name === null ? null : asString(r.winner_team_name, "winner team name"),
    winnerTime: r.winner_time === null ? null : asString(r.winner_time, "winner time"),
    poleName: r.pole_name === null ? null : asString(r.pole_name, "pole name"),
    poleCode: r.pole_code === null ? null : asString(r.pole_code, "pole code"),
  };
}

// 分站与所有 tab 行都用 (year, slug) 子查询定位，一次 batch 取齐
const raceIdSubquery = `(SELECT id FROM race WHERE year = ?1 AND grand_prix_id = ?2)`;

const raceMetaSql = `SELECT ra.year, ra.round, ra.grand_prix_id AS slug, gp.name,
       ra.official_name, ra.date, ra.time, ra.laps, ra.course_length,
       ci.name AS circuit_name, ci.place_name AS circuit_place,
       cc.name AS country_name, cc.alpha2_code
FROM race ra
JOIN grand_prix gp ON ra.grand_prix_id = gp.id
JOIN circuit ci ON ra.circuit_id = ci.id
JOIN country cc ON gp.country_id = cc.id
WHERE ra.year = ?1 AND ra.grand_prix_id = ?2`;

const raceResultSql = `SELECT rr.position_number, rr.position_text, rr.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name,
       rr.laps, rr.time, rr.reason_retired, rr.gap, rr.points
FROM race_result rr
JOIN driver d ON rr.driver_id = d.id
JOIN constructor ct ON rr.constructor_id = ct.id
WHERE rr.race_id = ${raceIdSubquery}
ORDER BY rr.position_display_order`;

function buildSessions(r: Record<string, unknown>): RaceSession[] {
  const defs: [string, string, string, string][] = [
    ["practice-1", "Practice 1", "free_practice_1_date", "free_practice_1_time"],
    ["practice-2", "Practice 2", "free_practice_2_date", "free_practice_2_time"],
    ["practice-3", "Practice 3", "free_practice_3_date", "free_practice_3_time"],
    ["qualifying", "Qualifying", "qualifying_date", "qualifying_time"],
    ["sprint-qualifying", "Sprint Qualifying", "sprint_qualifying_date", "sprint_qualifying_time"],
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
  return sessions;
}

function mapRaceMeta(row: unknown): RaceMeta {
  const r = asRecord(row, "race meta");
  return {
    year: asNumber(r.year, "race year"),
    round: asNumber(r.round, "race round"),
    slug: asString(r.slug, "race slug"),
    name: asString(r.name, "race name"),
    officialName: asString(r.official_name, "race official name"),
    date: asString(r.date, "race date"),
    laps: asNumber(r.laps, "race laps"),
    courseLength: asNumber(r.course_length, "course length"),
    circuitName: asString(r.circuit_name, "circuit name"),
    circuitPlace: asString(r.circuit_place, "circuit place"),
    countryName: asString(r.country_name, "country name"),
    alpha2Code: asString(r.alpha2_code, "alpha2 code"),
    sessions: buildSessions(r),
  };
}

// 各 tab 行共有的车手/车队字段
function mapDriverFields(r: Record<string, unknown>) {
  return {
    driverNumber: r.driver_number === null ? null : asString(r.driver_number, "driver number"),
    driverId: asString(r.driver_id, "driver id"),
    driverName: asString(r.driver_name, "driver name"),
    driverCode: asString(r.driver_code, "driver code"),
    constructorId: asString(r.constructor_id, "constructor id"),
    constructorName: asString(r.constructor_name, "constructor name"),
  };
}

function mapPositionFields(r: Record<string, unknown>) {
  return {
    position: r.position_number === null ? null : asNumber(r.position_number, "position"),
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
    retiredReason: r.reason_retired === null ? null : asString(r.reason_retired, "retired reason"),
    gap: r.gap === null ? null : asString(r.gap, "gap"),
    points: r.points === null ? null : asNumber(r.points, "points"),
  };
}

export interface RaceResultsRepository {
  getSeasonCalendar(year: number): Promise<RaceSummary[]>;
  listRaces(year: number): Promise<RaceSummary[]>;
  getSeasonYears(): Promise<number[]>;
  getRacePage(year: number, slug: string): Promise<RacePage | null>;
}

export function createRaceResultsRepository(db?: RaceResultsDatabase): RaceResultsRepository {
  const calendar = async (year: number): Promise<RaceSummary[]> => {
    if (!db) {
      // fixture 含全部 22 站（DEV）；生产同一条 SQL
      if (year !== 2026) return [];
      const { default: fixture } = await import("./fixtures/season-races-2026.json");
      return (fixture as { races: RaceSummary[] }).races;
    }
    const [rows] = await db.batch([{ sql: seasonCalendarSql, values: [year] }]);
    return rows.results.map(mapRaceSummary);
  };

  return {
    getSeasonCalendar: calendar,

    // 列表页只展示已完赛（有冠军行），与日历共用一次查询口径
    async listRaces(year) {
      return (await calendar(year)).filter((race) => race.winnerName !== null);
    },

    async getSeasonYears() {
      if (!db) {
        const { default: fixture } = await import("./fixtures/season-races-2026.json");
        return (fixture as { years: number[] }).years;
      }
      const [rows] = await db.batch([{ sql: seasonYearsSql, values: [] }]);
      return mapSeasonYearRows(rows.results);
    },

    async getRacePage(year, slug) {
      if (!db) {
        if (year !== 2026 || slug !== "australia") return null;
        const { default: fixture } = await import("./fixtures/race-australia-2026.json");
        return fixture as RacePage;
      }
      const [metaRows, raceRows] = await db.batch([
        { sql: raceMetaSql, values: [year, slug] },
        { sql: raceResultSql, values: [year, slug] },
      ]);
      if (metaRows.results.length === 0) return null;
      const meta = mapRaceMeta(metaRows.results[0]);
      return {
        meta,
        tabs: {
          raceResult: raceRows.results.map(mapRaceResultRow),
          qualifying: [], startingGrid: [], fastestLaps: [], pitStops: [],
          practice1: [], practice2: [], practice3: [],
        },
      };
    },
  };
}

export function formatAvgSpeedKph(courseLengthKm: number, timeMillis: number | null): string | null {
  if (timeMillis === null || timeMillis <= 0) return null;
  return (courseLengthKm / (timeMillis / 3_600_000)).toFixed(3);
}

export function formatSeconds(totalMillis: number | null): string | null {
  if (totalMillis === null) return null;
  return (totalMillis / 1000).toFixed(3);
}
