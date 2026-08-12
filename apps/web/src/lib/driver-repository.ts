import {
  buildCurrentSeason,
  buildRaceCell,
  type CurrentSeason,
  type RaceCell,
  type SeasonRound,
} from "./team-repository.js";

export interface DriverSummary {
  id: string;
  name: string;
  number: string | null;
  flagCode: string | null;
  teamId: string | null;
  teamName: string | null;
  isCurrent: boolean;
}

export interface DriverTotals {
  entries: number;
  starts: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  points: number;
  sprintWins: number;
  championships: number;
  bestChampionshipPosition: number | null;
}

export interface NumberStint {
  number: string;
  yearFrom: number;
  yearTo: number;
}

export interface TeamStint {
  id: string;
  name: string;
  yearFrom: number;
  yearTo: number;
}

export interface DriverSeasonTeam {
  id: string;
  name: string;
  results: (RaceCell | null)[];
}

export interface DriverSeason {
  year: number;
  rounds: SeasonRound[];
  teams: DriverSeasonTeam[];
  points: number | null;
  position: string | null;
  championshipWon: boolean;
}

export interface DriverPage {
  id: string;
  name: string;
  fullName: string;
  countryName: string;
  alpha2Code: string;
  dateOfBirth: string;
  dateOfDeath: string | null;
  placeOfBirth: string;
  permanentNumber: string | null;
  totals: DriverTotals;
  numberStints: NumberStint[];
  teamStints: TeamStint[];
  currentSeason: CurrentSeason | null;
  seasons: DriverSeason[];
  activeSeason: number | null;
}

export interface DriverRepository {
  getDrivers(): Promise<DriverSummary[]>;
  getDriver(slug: string): Promise<DriverPage | null>;
}

export interface DriverDatabase {
  batch(
    statements: { sql: string; values: readonly unknown[] }[],
  ): Promise<{ results: unknown[] }[]>;
}

// D1 batch 需要预编译语句，仓库层接口用 {sql, values} 以便测试替身
export function createD1DriverDatabase(d1: D1Database): DriverDatabase {
  return {
    batch: (statements) =>
      d1.batch(
        statements.map((statement) =>
          d1.prepare(statement.sql).bind(...statement.values),
        ),
      ),
  };
}

// 最后赛季多车队时取整行（constructor_id 与 team_name 同行，避免颜色错配）；
// 当前赛季车手优先，其余按生涯成就排序，与车队目录同一哲学。
// 注：收官年两队平局时以 c.name 字母序兜底（season_entrant_driver 无轮次信息），
// 是近似值；详情页 hero 末队以 race_result 真实轮次为准，两处口径略有差异
const driversSql = `
WITH latest_season AS (
  SELECT MAX(year) AS year FROM season
),
current_drivers AS (
  SELECT DISTINCT driver_id
  FROM season_entrant_driver
  WHERE year = (SELECT year FROM latest_season) AND test_driver = 0
),
last_team AS (
  SELECT driver_id, constructor_id, team_name
  FROM (
    SELECT sed.driver_id, sed.constructor_id, c.name AS team_name,
      ROW_NUMBER() OVER (
        PARTITION BY sed.driver_id ORDER BY sed.year DESC, c.name
      ) AS rn
    FROM season_entrant_driver sed
    JOIN constructor c ON c.id = sed.constructor_id
    WHERE sed.test_driver = 0
  )
  WHERE rn = 1
)
SELECT d.id, d.name, d.permanent_number, co.alpha2_code,
  lt.constructor_id AS team_id, lt.team_name,
  CASE WHEN cd.driver_id IS NULL THEN 0 ELSE 1 END AS is_current
FROM driver d
LEFT JOIN country co ON co.id = d.nationality_country_id
LEFT JOIN last_team lt ON lt.driver_id = d.id
LEFT JOIN current_drivers cd ON cd.driver_id = d.id
ORDER BY
  CASE WHEN cd.driver_id IS NULL THEN 1 ELSE 0 END,
  d.total_championship_wins DESC,
  d.total_race_wins DESC,
  d.total_race_entries DESC,
  d.name`;

const identitySql = `
SELECT d.id, d.name, d.full_name, co.name AS country_name, co.alpha2_code,
  d.date_of_birth, d.date_of_death, d.place_of_birth, d.permanent_number,
  d.total_race_entries AS entries, d.total_race_starts AS starts,
  d.total_race_wins AS wins, d.total_podiums AS podiums,
  d.total_pole_positions AS poles, d.total_fastest_laps AS fastest_laps,
  d.total_points AS points, d.total_sprint_race_wins AS sprint_wins,
  d.total_championship_wins AS championships,
  d.best_championship_position AS best_position
FROM driver d
JOIN country co ON co.id = d.nationality_country_id
WHERE d.id = ?1`;

// 号变更：按年分组比赛车号，repository 侧合并连续同年号区间
const numberStintsSql = `
SELECT ra.year, rd.driver_number
FROM race_data rd
JOIN race ra ON ra.id = rd.race_id
WHERE rd.driver_id = ?1 AND rd.type = 'RACE_RESULT'
GROUP BY ra.year, rd.driver_number
ORDER BY ra.year, CAST(rd.driver_number AS INTEGER)`;

// 年份取正式阵容与实际结果的并集：当前季未出赛也有空矩阵块，将来轮次保留空列
const roundsSql = `
SELECT ra.year, ra.round, gp.abbreviation AS code, gp.name, ra.circuit_id
FROM race ra
JOIN grand_prix gp ON gp.id = ra.grand_prix_id
WHERE ra.year IN (
  SELECT year FROM season_entrant_driver WHERE driver_id = ?1 AND test_driver = 0
  UNION
  SELECT ra2.year FROM race ra2
  JOIN race_result rr ON rr.race_id = ra2.id
  WHERE rr.driver_id = ?1
)
ORDER BY ra.year, ra.round`;

// 行=该年该车手的 constructor 条目；first_round 定行序（季中转会多行）
const teamsSql = `
SELECT ra.year, rr.constructor_id AS id, c.name, MIN(ra.round) AS first_round
FROM race ra
JOIN race_result rr ON rr.race_id = ra.id
JOIN constructor c ON c.id = rr.constructor_id
WHERE rr.driver_id = ?1
GROUP BY ra.year, rr.constructor_id, c.name
ORDER BY ra.year DESC, first_round`;

const resultsSql = `
SELECT ra.year, ra.round, rr.constructor_id, rr.position_text, rr.pole_position,
  rr.fastest_lap, rr.reason_retired, rr.position_number
FROM race ra
JOIN race_result rr ON rr.race_id = ra.id
WHERE rr.driver_id = ?1
ORDER BY rr.position_display_order`;

const sprintRankSql = `
SELECT ra.year, ra.round, srr.position_number
FROM race ra
JOIN sprint_race_result srr ON srr.race_id = ra.id
WHERE srr.driver_id = ?1 AND srr.position_number IS NOT NULL`;

// 逐年单行，无需变体合并
const standingsSql = `
SELECT year, position_text, points, championship_won
FROM season_driver_standing
WHERE driver_id = ?1`;

const gpStatsSql = `
SELECT ra.year,
  COUNT(DISTINCT rr.race_id) AS races,
  COALESCE(SUM(rr.points), 0) AS points,
  COALESCE(SUM(rr.position_number = 1), 0) AS wins,
  COALESCE(SUM(rr.position_number <= 3), 0) AS podiums,
  COALESCE(SUM(rr.pole_position = 1), 0) AS poles,
  COALESCE(SUM(rr.position_number <= 10), 0) AS top10s,
  COALESCE(SUM(rr.fastest_lap = 1), 0) AS fastest_laps,
  COALESCE(SUM(rr.position_text = 'DNF'), 0) AS dnfs
FROM race ra
JOIN race_result rr ON rr.race_id = ra.id
WHERE rr.driver_id = ?1
GROUP BY ra.year`;

const sprintStatsSql = `
SELECT ra.year,
  COUNT(DISTINCT srr.race_id) AS races,
  COALESCE(SUM(srr.points), 0) AS points,
  COALESCE(SUM(srr.position_number = 1), 0) AS wins,
  COALESCE(SUM(srr.position_number <= 3), 0) AS podiums,
  COALESCE(SUM(srr.position_number <= 10), 0) AS top10s
FROM race ra
JOIN sprint_race_result srr ON srr.race_id = ra.id
WHERE srr.driver_id = ?1
GROUP BY ra.year`;

const sprintPolesSql = `
SELECT ra.year, COUNT(*) AS poles
FROM race ra
JOIN sprint_starting_grid_position ssg ON ssg.race_id = ra.id
WHERE ssg.driver_id = ?1 AND ssg.position_number = 1
GROUP BY ra.year`;

const maxSeasonSql = `SELECT MAX(year) AS year FROM season`;

export function createDriverRepository(db?: DriverDatabase): DriverRepository {
  return {
    async getDrivers() {
      if (!db) {
        // fixture 仅 DEV 用，动态导入避免打进生产 bundle
        const { default: fixture } = await import("./fixtures/drivers.json");
        return fixture as DriverSummary[];
      }

      const [rows] = await db.batch([{ sql: driversSql, values: [] }]);
      return rows.results.map((row) => {
        const record = asRecord(row, "driver row");
        return {
          id: asString(record.id, "driver id"),
          name: asString(record.name, "driver name"),
          number:
            record.permanent_number == null
              ? null
              : asString(record.permanent_number, "driver number"),
          // 国旗 SVG 以 alpha2 小写命名
          flagCode:
            record.alpha2_code == null
              ? null
              : asString(record.alpha2_code, "driver flag code").toLowerCase(),
          teamId:
            record.team_id == null
              ? null
              : asString(record.team_id, "driver team id"),
          teamName:
            record.team_name == null
              ? null
              : asString(record.team_name, "driver team name"),
          isCurrent: record.is_current === 1,
        };
      });
    },

    async getDriver(slug) {
      if (!db) {
        // DEV fixture 分流，见 fixtures/driver-*.json
        if (slug === "george-russell") {
          const { default: fixture } = await import(
            "./fixtures/driver-george-russell.json"
          );
          return withTeamStints(fixture as Omit<DriverPage, "teamStints">);
        }
        if (slug === "max-verstappen") {
          const { default: fixture } = await import(
            "./fixtures/driver-max-verstappen.json"
          );
          return withTeamStints(fixture as Omit<DriverPage, "teamStints">);
        }
        return null;
      }

      const [
        identityRows,
        numberRows,
        roundRows,
        teamRows,
        resultRows,
        sprintRankRows,
        standingRows,
        gpStatRows,
        sprintStatRows,
        sprintPoleRows,
        maxSeasonRows,
      ] = await db.batch([
        { sql: identitySql, values: [slug] },
        { sql: numberStintsSql, values: [slug] },
        { sql: roundsSql, values: [slug] },
        { sql: teamsSql, values: [slug] },
        { sql: resultsSql, values: [slug] },
        { sql: sprintRankSql, values: [slug] },
        { sql: standingsSql, values: [slug] },
        { sql: gpStatsSql, values: [slug] },
        { sql: sprintStatsSql, values: [slug] },
        { sql: sprintPolesSql, values: [slug] },
        { sql: maxSeasonSql, values: [] },
      ]);

      if (identityRows.results.length === 0) return null;
      const identity = parseIdentity(identityRows.results[0]);

      const seasons = mergeDriverSeasons(
        roundRows.results,
        teamRows.results,
        resultRows.results,
        sprintRankRows.results,
        standingRows.results,
      );

      return {
        ...identity,
        numberStints: mergeNumberStints(numberRows.results),
        teamStints: mergeTeamStints(seasons),
        currentSeason: buildCurrentSeason(
          seasons[0],
          gpStatRows.results,
          sprintStatRows.results,
          sprintPoleRows.results,
        ),
        seasons,
        activeSeason: (() => {
          // MAX() 恒返回一行；season 表为空时 year 为 NULL
          const year = asRecord(maxSeasonRows.results[0], "max season row").year;
          return year == null ? null : asNumber(year, "max season");
        })(),
      };
    },
  };
}

function parseIdentity(
  value: unknown,
): Omit<DriverPage, "numberStints" | "teamStints" | "currentSeason" | "seasons" | "activeSeason"> {
  const record = asRecord(value, "driver identity");
  return {
    id: asString(record.id, "driver id"),
    name: asString(record.name, "driver name"),
    fullName: asString(record.full_name, "driver full name"),
    countryName: asString(record.country_name, "driver country"),
    alpha2Code: asString(record.alpha2_code, "driver flag code"),
    dateOfBirth: asString(record.date_of_birth, "driver date of birth"),
    dateOfDeath:
      record.date_of_death == null
        ? null
        : asString(record.date_of_death, "driver date of death"),
    placeOfBirth: asString(record.place_of_birth, "driver place of birth"),
    permanentNumber:
      record.permanent_number == null
        ? null
        : asString(record.permanent_number, "driver number"),
    totals: {
      entries: asNumber(record.entries, "driver entries"),
      starts: asNumber(record.starts, "driver starts"),
      wins: asNumber(record.wins, "driver wins"),
      podiums: asNumber(record.podiums, "driver podiums"),
      poles: asNumber(record.poles, "driver poles"),
      fastestLaps: asNumber(record.fastest_laps, "driver fastest laps"),
      points: asNumber(record.points, "driver points"),
      sprintWins: asNumber(record.sprint_wins, "driver sprint wins"),
      championships: asNumber(record.championships, "driver championships"),
      bestChampionshipPosition:
        record.best_position == null
          ? null
          : asNumber(record.best_position, "driver best position"),
    },
  };
}

// 连续同年号合并为区间；断档或换号开新段（同 withEarlyStint 模式）
export function mergeNumberStints(rows: unknown[]): NumberStint[] {
  const stints: NumberStint[] = [];
  for (const row of rows) {
    const record = asRecord(row, "number stint row");
    const year = asNumber(record.year, "number stint year");
    const number = asString(record.driver_number, "number stint number");
    const last = stints.at(-1);
    if (last && last.number === number && last.yearTo === year - 1) {
      last.yearTo = year;
    } else {
      stints.push({ number, yearFrom: year, yearTo: year });
    }
  }
  return stints;
}

// 连续同队年合并为区间；换队或断档开新段（同 mergeNumberStints 模式）。
// seasons 降序，先翻成升序；季中转会一年两队时各自成段
export function mergeTeamStints(seasons: DriverSeason[]): TeamStint[] {
  const stints: TeamStint[] = [];
  for (const season of [...seasons].reverse()) {
    for (const team of season.teams) {
      const last = stints.at(-1);
      if (last && last.id === team.id && last.yearTo === season.year - 1) {
        last.yearTo = season.year;
      } else {
        stints.push({
          id: team.id,
          name: team.name,
          yearFrom: season.year,
          yearTo: season.year,
        });
      }
    }
  }
  return stints;
}

// fixture 不存 teamStints，运行期从 seasons 补齐，保证 DEV 与 D1 同构
function withTeamStints(page: Omit<DriverPage, "teamStints">): DriverPage {
  return { ...page, teamStints: mergeTeamStints(page.seasons) };
}

function mergeDriverSeasons(
  roundRows: unknown[],
  teamRows: unknown[],
  resultRows: unknown[],
  sprintRankRows: unknown[],
  standingRows: unknown[],
): DriverSeason[] {
  const seasons = new Map<number, DriverSeason>();
  const rawRounds = new Map<number, { round: number; code: string; name: string; circuitId: string }[]>();
  for (const row of roundRows) {
    const record = asRecord(row, "round row");
    const year = asNumber(record.year, "round row year");
    const list = rawRounds.get(year) ?? [];
    list.push({
      round: asNumber(record.round, "round row round"),
      code: asString(record.code, "round code"),
      name: asString(record.name, "round name"),
      circuitId: asString(record.circuit_id, "round circuit"),
    });
    rawRounds.set(year, list);
    if (!seasons.has(year)) {
      seasons.set(year, {
        year,
        rounds: [],
        teams: [],
        points: null,
        position: null,
        championshipWon: false,
      });
    }
  }
  for (const [year, season] of seasons) {
    season.rounds = rawRounds.get(year)!.map(({ round, ...display }) => display);
  }

  const sprintRanks = new Map<string, number>();
  for (const row of sprintRankRows) {
    const record = asRecord(row, "sprint rank row");
    sprintRanks.set(
      `${asNumber(record.year, "sprint year")}:${asNumber(record.round, "sprint round")}`,
      asNumber(record.position_number, "sprint rank"),
    );
  }

  // 共享赛车同 (year, constructor, round) 多行；SQL 按排名序，首条即最佳成绩
  const cells = new Map<string, Map<number, RaceCell>>();
  for (const row of resultRows) {
    const record = asRecord(row, "result row");
    const year = asNumber(record.year, "result row year");
    const round = asNumber(record.round, "result row round");
    const constructorId = asString(record.constructor_id, "result row constructor");
    let byRound = cells.get(`${year}:${constructorId}`);
    if (!byRound) {
      byRound = new Map();
      cells.set(`${year}:${constructorId}`, byRound);
    }
    if (byRound.has(round)) continue;
    byRound.set(
      round,
      buildRaceCell(record, sprintRanks.get(`${year}:${round}`) ?? null),
    );
  }

  for (const row of teamRows) {
    const record = asRecord(row, "driver team row");
    const year = asNumber(record.year, "driver team year");
    // team 年份必然在 roundsSql 并集里，season 必存在
    const season = seasons.get(year)!;
    const constructorId = asString(record.id, "driver team id");
    const byRound = cells.get(`${year}:${constructorId}`);
    season.teams.push({
      id: constructorId,
      name: asString(record.name, "driver team name"),
      results: rawRounds.get(year)!.map((r) => byRound?.get(r.round) ?? null),
    });
  }

  for (const row of standingRows) {
    const record = asRecord(row, "driver standing row");
    const season = seasons.get(asNumber(record.year, "driver standing year"));
    if (!season) continue;
    season.points = asNumber(record.points, "driver standing points");
    season.position = asString(record.position_text, "driver standing position");
    season.championshipWon = season.championshipWon || record.championship_won === 1;
  }

  return [...seasons.values()].sort((a, b) => b.year - a.year);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid driver data: expected ${label} to be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid driver data: expected ${label} to be a string`);
  }
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid driver data: expected ${label} to be a number`);
  }
  return value;
}
