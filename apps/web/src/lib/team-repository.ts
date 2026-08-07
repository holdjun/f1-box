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

export interface RaceCell {
  text: string;
  pole: boolean;
  fastest: boolean;
}

export interface TeamSeasonDriver {
  id: string;
  name: string;
  flagCode: string | null;
  results: (RaceCell | null)[];
}

export interface SeasonRound {
  code: string;
  name: string;
}

export interface TeamSeason {
  year: number;
  chassis: string[];
  engines: string[];
  tyres: string[];
  rounds: SeasonRound[];
  drivers: TeamSeasonDriver[];
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
  GROUP_CONCAT(DISTINCT en.name) AS engines,
  GROUP_CONCAT(DISTINCT tm.name) AS tyres
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
LEFT JOIN season_entrant_tyre_manufacturer setm
  ON setm.year = sec.year AND setm.entrant_id = sec.entrant_id
  AND setm.constructor_id = sec.constructor_id
  AND setm.engine_manufacturer_id = sec.engine_manufacturer_id
LEFT JOIN tyre_manufacturer tm ON tm.id = setm.tyre_manufacturer_id
WHERE sec.constructor_id = ?
GROUP BY sec.year`;

const roundsSql = `
SELECT ra.year, ra.round, gp.abbreviation AS code, gp.name
FROM race ra
JOIN grand_prix gp ON gp.id = ra.grand_prix_id
WHERE ra.year IN (
  SELECT year FROM season_entrant_constructor WHERE constructor_id = ?
)
ORDER BY ra.year, ra.round`;

const driversSql = `
SELECT sed.year, d.id, d.name, cn.alpha2_code
FROM season_entrant_driver sed
JOIN driver d ON d.id = sed.driver_id
LEFT JOIN country cn ON cn.id = d.nationality_country_id
WHERE sed.constructor_id = ? AND sed.test_driver = 0
ORDER BY sed.year`;

const resultsSql = `
SELECT ra.year, ra.round, rr.driver_id, rr.position_text, rr.pole_position
FROM race ra
JOIN race_result rr ON rr.race_id = ra.id
WHERE rr.constructor_id = ?`;

const fastestSql = `
SELECT ra.year, ra.round, fl.driver_id
FROM race ra
JOIN fastest_lap fl ON fl.race_id = ra.id
WHERE fl.constructor_id = ?`;

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

      const [seasonRows, roundRows, driverRows, resultRows, fastestRows, standingRows] =
        await Promise.all([
          db.prepare(seasonsSql).bind(slug).all(),
          db.prepare(roundsSql).bind(slug).all(),
          db.prepare(driversSql).bind(slug).all(),
          db.prepare(resultsSql).bind(slug).all(),
          db.prepare(fastestSql).bind(slug).all(),
          db.prepare(standingsSql).bind(slug).all(),
        ]);

      return {
        ...base,
        seasons: mergeSeasons(
          seasonRows.results,
          roundRows.results,
          driverRows.results,
          resultRows.results,
          fastestRows.results,
          standingRows.results,
        ),
      };
    },
  };
}

interface FastestSet {
  add(year: number, round: number, driverId: string): void;
  has(year: number, round: number, driverId: string): boolean;
}

function mergeSeasons(
  seasonRows: unknown[],
  roundRows: unknown[],
  driverRows: unknown[],
  resultRows: unknown[],
  fastestRows: unknown[],
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
      tyres: [...new Set(splitNames(record.tyres).map((name) => name.charAt(0).toUpperCase()))].sort(),
      rounds: [],
      drivers: [],
      points: null,
      position: null,
      championshipWon: false,
    });
  }

  for (const row of roundRows) {
    const record = asRecord(row, "round row");
    const season = seasons.get(asNumber(record.year, "round row year"));
    season?.rounds.push({
      code: asString(record.code, "round code"),
      name: asString(record.name, "round name"),
    });
  }

  const fastest: FastestSet = createFastestSet();
  for (const row of fastestRows) {
    const record = asRecord(row, "fastest lap row");
    fastest.add(
      asNumber(record.year, "fastest lap year"),
      asNumber(record.round, "fastest lap round"),
      asString(record.driver_id, "fastest lap driver"),
    );
  }

  for (const row of driverRows) {
    const record = asRecord(row, "driver row");
    const season = seasons.get(asNumber(record.year, "driver row year"));
    if (!season) continue;
    season.drivers.push({
      id: asString(record.id, "driver id"),
      name: asString(record.name, "driver name"),
      flagCode:
        record.alpha2_code === null ? null : asString(record.alpha2_code, "driver flag"),
      results: season.rounds.map(() => null),
    });
  }

  for (const row of resultRows) {
    const record = asRecord(row, "result row");
    const year = asNumber(record.year, "result row year");
    const round = asNumber(record.round, "result row round");
    const driverId = asString(record.driver_id, "result row driver");
    const season = seasons.get(year);
    const driver = season?.drivers.find((entry) => entry.id === driverId);
    if (!season || !driver) continue;
    driver.results[round - 1] = {
      text: asString(record.position_text, "result position"),
      pole: Boolean(record.pole_position),
      fastest: fastest.has(year, round, driverId),
    };
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

  return [...seasons.values()].sort((a, b) => a.year - b.year);
}

function createFastestSet(): FastestSet {
  const keys = new Set<string>();
  return {
    add(year, round, driverId) {
      keys.add(`${year}:${round}:${driverId}`);
    },
    has(year, round, driverId) {
      return keys.has(`${year}:${round}:${driverId}`);
    },
  };
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
      const roundsRaw = season.rounds;
      if (!Array.isArray(roundsRaw)) {
        throw new Error("Invalid team season: rounds must be an array");
      }
      return {
        year: asNumber(season.year, "season year"),
        chassis: asStringArray(season.chassis, "season chassis"),
        engines: asStringArray(season.engines, "season engines"),
        tyres: asStringArray(season.tyres, "season tyres"),
        rounds: roundsRaw.map((round) => {
          const roundRecord = asRecord(round, "season round");
          return {
            code: asString(roundRecord.code, "round code"),
            name: asString(roundRecord.name, "round name"),
          };
        }),
        drivers: asArray(season.drivers, "season drivers").map((driver) => {
          const driverRecord = asRecord(driver, "season driver");
          const resultsRaw = driverRecord.results;
          if (!Array.isArray(resultsRaw)) {
            throw new Error("Invalid season driver: results must be an array");
          }
          return {
            id: asString(driverRecord.id, "driver id"),
            name: asString(driverRecord.name, "driver name"),
            flagCode:
              driverRecord.flagCode === null
                ? null
                : asString(driverRecord.flagCode, "driver flag"),
            results: resultsRaw.map((cell, index) => {
              if (cell === null) return null;
              const cellRecord = asRecord(cell, `result cell ${index + 1}`);
              return {
                text: asString(cellRecord.text, "result position"),
                pole: Boolean(cellRecord.pole),
                fastest: Boolean(cellRecord.fastest),
              };
            }),
          };
        }),
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

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid team data: expected ${label} to be an array`);
  }
  return value;
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
