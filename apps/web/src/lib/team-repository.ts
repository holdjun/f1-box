import ferrariFixture from "./fixtures/team-ferrari.json";

export interface TeamTotals {
  entries: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  points: number;
  championships: number;
  bestChampionshipPosition: number | null;
}

export interface TeamSeason {
  year: number;
  chassis: string[];
  engines: string[];
  drivers: string[];
  points: number | null;
  position: string | null;
  championshipWon: boolean;
}

export interface TeamPage {
  id: string;
  name: string;
  fullName: string;
  countryName: string;
  alpha2Code: string;
  totals: TeamTotals;
  seasons: TeamSeason[];
}

export interface TeamRepository {
  getTeam(slug: string): Promise<TeamPage | null>;
}

export interface TeamDatabase {
  prepare(sql: string): {
    bind(...values: readonly unknown[]): {
      all(): Promise<{ results: unknown[] }>;
    };
  };
}

const identitySql = `
SELECT c.id, c.name, c.full_name, co.name AS country_name, co.alpha2_code,
  c.total_race_entries AS entries, c.total_race_wins AS wins,
  c.total_podiums AS podiums, c.total_pole_positions AS poles,
  c.total_fastest_laps AS fastest_laps, c.total_points AS points,
  c.total_championship_wins AS championships,
  c.best_championship_position AS best_position
FROM constructor c
JOIN country co ON co.id = c.country_id
WHERE c.id = ?`;

const seasonsSql = `
SELECT sec.year,
  GROUP_CONCAT(DISTINCT ch.name) AS chassis,
  GROUP_CONCAT(DISTINCT en.name) AS engines
FROM season_entrant_constructor sec
LEFT JOIN season_entrant_chassis sech
  ON sech.year = sec.year AND sech.entrant_id = sec.entrant_id
  AND sech.constructor_id = sec.constructor_id
  AND sech.engine_manufacturer_id = sec.engine_manufacturer_id
LEFT JOIN chassis ch ON ch.id = sech.chassis_id
LEFT JOIN season_entrant_engine seen
  ON seen.year = sec.year AND seen.entrant_id = sec.entrant_id
  AND seen.constructor_id = sec.constructor_id
  AND seen.engine_manufacturer_id = sec.engine_manufacturer_id
LEFT JOIN engine en ON en.id = seen.engine_id
WHERE sec.constructor_id = ?
GROUP BY sec.year`;

const driversSql = `
SELECT sed.year, d.name
FROM season_entrant_driver sed
JOIN driver d ON d.id = sed.driver_id
WHERE sed.constructor_id = ? AND sed.test_driver = 0
ORDER BY sed.year`;

const standingsSql = `
SELECT year, position_text, points, championship_won
FROM season_constructor_standing
WHERE constructor_id = ?`;

export function createTeamRepository(db?: TeamDatabase): TeamRepository {
  return {
    async getTeam(slug) {
      if (!db) {
        return slug === "ferrari" ? assertTeamPage(ferrariFixture) : null;
      }

      const identity = await db.prepare(identitySql).bind(slug).all();
      if (identity.results.length === 0) return null;
      const base = parseIdentityRow(identity.results[0]);

      const [seasonRows, driverRows, standingRows] = await Promise.all([
        db.prepare(seasonsSql).bind(slug).all(),
        db.prepare(driversSql).bind(slug).all(),
        db.prepare(standingsSql).bind(slug).all(),
      ]);

      return {
        ...base,
        seasons: mergeSeasons(
          seasonRows.results,
          driverRows.results,
          standingRows.results,
        ),
      };
    },
  };
}

function mergeSeasons(
  seasonRows: unknown[],
  driverRows: unknown[],
  standingRows: unknown[],
): TeamSeason[] {
  const seasons = new Map<number, TeamSeason>();

  for (const row of seasonRows) {
    const record = asRecord(row, "season row");
    const year = asNumber(record.year, "season row year");
    seasons.set(year, {
      year,
      chassis: splitNames(record.chassis),
      engines: splitNames(record.engines),
      drivers: [],
      points: null,
      position: null,
      championshipWon: false,
    });
  }

  for (const row of driverRows) {
    const record = asRecord(row, "driver row");
    const season = seasons.get(asNumber(record.year, "driver row year"));
    season?.drivers.push(asString(record.name, "driver name"));
  }

  for (const row of standingRows) {
    const record = asRecord(row, "standing row");
    const season = seasons.get(asNumber(record.year, "standing row year"));
    if (!season) continue;
    const points = asNumber(record.points, "standing points");
    // 同一赛季可能出现多条积分榜行（不同引擎供应商组合），取积分最高的一条
    if (season.points === null || points > season.points) {
      season.points = points;
      season.position = asString(record.position_text, "standing position");
      season.championshipWon = Boolean(record.championship_won);
    }
  }

  return [...seasons.values()].sort((a, b) => b.year - a.year);
}

function parseIdentityRow(row: unknown): Omit<TeamPage, "seasons"> {
  const record = asRecord(row, "team identity row");
  return {
    id: asString(record.id, "team id"),
    name: asString(record.name, "team name"),
    fullName: asString(record.full_name, "team full name"),
    countryName: asString(record.country_name, "team country name"),
    alpha2Code: asString(record.alpha2_code, "team country alpha2 code"),
    totals: {
      entries: asNumber(record.entries, "team entries"),
      wins: asNumber(record.wins, "team wins"),
      podiums: asNumber(record.podiums, "team podiums"),
      poles: asNumber(record.poles, "team pole positions"),
      fastestLaps: asNumber(record.fastest_laps, "team fastest laps"),
      points: asNumber(record.points, "team points"),
      championships: asNumber(record.championships, "team championships"),
      bestChampionshipPosition:
        record.best_position === null
          ? null
          : asNumber(record.best_position, "team best championship position"),
    },
  };
}

function assertTeamPage(value: unknown): TeamPage {
  const record = asRecord(value, "team page");
  const totalsRecord = asRecord(record.totals, "team totals");
  const seasonsRaw = record.seasons;
  if (!Array.isArray(seasonsRaw)) {
    throw new Error("Invalid team page: seasons must be an array");
  }

  return {
    id: asString(record.id, "team id"),
    name: asString(record.name, "team name"),
    fullName: asString(record.fullName, "team full name"),
    countryName: asString(record.countryName, "team country name"),
    alpha2Code: asString(record.alpha2Code, "team country alpha2 code"),
    totals: {
      entries: asNumber(totalsRecord.entries, "team entries"),
      wins: asNumber(totalsRecord.wins, "team wins"),
      podiums: asNumber(totalsRecord.podiums, "team podiums"),
      poles: asNumber(totalsRecord.poles, "team pole positions"),
      fastestLaps: asNumber(totalsRecord.fastestLaps, "team fastest laps"),
      points: asNumber(totalsRecord.points, "team points"),
      championships: asNumber(totalsRecord.championships, "team championships"),
      bestChampionshipPosition:
        totalsRecord.bestChampionshipPosition === null
          ? null
          : asNumber(
              totalsRecord.bestChampionshipPosition,
              "team best championship position",
            ),
    },
    seasons: seasonsRaw.map((entry) => {
      const season = asRecord(entry, "team season");
      return {
        year: asNumber(season.year, "season year"),
        chassis: asStringArray(season.chassis, "season chassis"),
        engines: asStringArray(season.engines, "season engines"),
        drivers: asStringArray(season.drivers, "season drivers"),
        points:
          season.points === null ? null : asNumber(season.points, "season points"),
        position:
          season.position === null
            ? null
            : asString(season.position, "season position"),
        championshipWon: Boolean(season.championshipWon),
      };
    }),
  };
}

function splitNames(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid team data: expected ${label} to be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid team data: expected ${label} to be a string`);
  }
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid team data: expected ${label} to be a number`);
  }
  return value;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Invalid team data: expected ${label} to be a string array`);
  }
  return value as string[];
}
