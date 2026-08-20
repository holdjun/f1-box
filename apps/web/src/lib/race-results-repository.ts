import { asNumber, asRecord, asString } from "./db-parse.js";
import { mapSeasonYearRows, seasonYearsSql } from "./season-years.js";

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

export interface RaceResultsRepository {
  getSeasonCalendar(year: number): Promise<RaceSummary[]>;
  listRaces(year: number): Promise<RaceSummary[]>;
  getSeasonYears(): Promise<number[]>;
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
