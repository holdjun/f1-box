import { rowReader } from "./db-parse.js";
import {
  deriveSeasonYears,
  mapSeasonYearRows,
  seasonYearsSql,
} from "./season-years.js";
import {
  buildCurrentSeason,
  buildRaceCell,
  type CurrentSeason,
  maxSeasonSql,
  parseActiveSeason,
  type RaceCell,
  type SeasonRound,
} from "./team-repository.js";

export interface DriverSummary {
  id: string;
  name: string;
  code: string;
  number: string | null;
  flagCode: string | null;
  teamId: string | null;
  teamName: string | null;
  isCurrent: boolean;
}

// DEV 目录 fixture 附带积分与逐年号码数据；生产由 SQL 提供
interface DriverCatalogFixture extends DriverSummary {
  points: number;
  seasons: Record<
    string,
    | { points: number; number?: string; teamId?: string; teamName?: string }
    | undefined
  >;
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
  // 该队最后参赛轮次：矩阵块按此降序（换队后在上），stint 时间线按此升序
  lastRound: number;
  results: (RaceCell | null)[];
  teammates: DriverSeasonTeammate[];
}

export interface DriverSeasonTeammate {
  id: string;
  name: string;
  flagCode: string | null;
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
  code: string;
  fullName: string;
  countryName: string;
  alpha2Code: string;
  dateOfBirth: string;
  dateOfDeath: string | null;
  placeOfBirth: string;
  permanentNumber: string | null;
  // 最后参赛号码：目录卡与 hero 都优先显示它（现役即当前号码），永久车号兜底
  lastNumber: string | null;
  totals: DriverTotals;
  numberStints: NumberStint[];
  teamStints: TeamStint[];
  currentSeason: CurrentSeason | null;
  seasons: DriverSeason[];
  activeSeason: number | null;
}

export interface DriverRepository {
  getDrivers(): Promise<DriverSummary[]>;
  getDriversByYear(year: number): Promise<DriverSummary[]>;
  getSeasonYears(): Promise<number[]>;
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

// 最后车队取自实际参赛的末站（与详情页 hero 同一口径）；相关子查询走
// (driver_id, type) 索引逐人定位，避免全表开窗。号码与目录卡、hero 同口径：
// 取最后参赛号码（现役即当前号码，如卫冕冠军的 1 号），永久车号仅作兜底。
// 目录按生涯总积分降序。
const driversSql = `
WITH latest_season AS (
  SELECT MAX(year) AS year FROM season
),
current_drivers AS (
  SELECT DISTINCT driver_id
  FROM season_entrant_driver
  WHERE year = (SELECT year FROM latest_season) AND test_driver = 0
),
last_race AS (
  SELECT rd.driver_id, rd.constructor_id, c.name AS team_name,
    rd.driver_number AS last_number
  FROM driver d
  JOIN race_data rd ON rd.rowid = (
    SELECT rd2.rowid
    FROM race_data rd2
    JOIN race ra2 ON ra2.id = rd2.race_id
    WHERE rd2.driver_id = d.id AND rd2.type = 'RACE_RESULT'
    ORDER BY ra2.year DESC, ra2.round DESC
    LIMIT 1
  )
  JOIN constructor c ON c.id = rd.constructor_id
)
SELECT d.id, d.name, d.abbreviation AS code, COALESCE(lr.last_number, d.permanent_number) AS number,
  co.alpha2_code, lr.constructor_id AS team_id, lr.team_name,
  CASE WHEN cd.driver_id IS NULL THEN 0 ELSE 1 END AS is_current
FROM driver d
LEFT JOIN country co ON co.id = d.nationality_country_id
LEFT JOIN last_race lr ON lr.driver_id = d.id
LEFT JOIN current_drivers cd ON cd.driver_id = d.id
ORDER BY d.total_points DESC, d.name`;

// 年份目录：卡片显示该年车队与号码（季中转会取该年最后参赛车队），按该年
// 积分榜降序；无积分榜的（如替补）垫底按名字排。号码取该年最后一场实际号码
// （如卫冕冠军 1 号），无该年号码才回落永久车号。last_race 只对该年参赛者
// （year_drivers）跑相关子查询，避免全量表逐人探测
const driversByYearSql = `
WITH year_drivers AS (
  SELECT DISTINCT driver_id
  FROM season_entrant_driver
  WHERE year = ?1 AND test_driver = 0
),
last_race AS (
  SELECT rd.driver_id, rd.constructor_id, c.name AS team_name,
    rd.driver_number AS last_number
  FROM year_drivers yd
  JOIN race_data rd ON rd.rowid = (
    SELECT rd2.rowid
    FROM race_data rd2
    JOIN race ra2 ON ra2.id = rd2.race_id
    WHERE rd2.driver_id = yd.driver_id AND rd2.type = 'RACE_RESULT' AND ra2.year = ?1
    ORDER BY ra2.round DESC
    LIMIT 1
  )
  JOIN constructor c ON c.id = rd.constructor_id
)
SELECT d.id, d.name, d.abbreviation AS code, COALESCE(lr.last_number, d.permanent_number) AS number,
  co.alpha2_code, lr.constructor_id AS team_id, lr.team_name,
  COALESCE(sds.points, 0) AS points
FROM year_drivers yd
JOIN driver d ON d.id = yd.driver_id
LEFT JOIN country co ON co.id = d.nationality_country_id
LEFT JOIN last_race lr ON lr.driver_id = d.id
LEFT JOIN season_driver_standing sds ON sds.driver_id = d.id AND sds.year = ?1
ORDER BY points DESC, d.name`;

const identitySql = `
SELECT d.id, d.name, d.abbreviation AS code, d.full_name, co.name AS country_name, co.alpha2_code,
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

// 最后参赛号码（不限年份）：目录卡与 hero 的号码首选，永久车号兜底
const lastNumberSql = `
SELECT rd.driver_number
FROM race_data rd
JOIN race ra ON ra.id = rd.race_id
WHERE rd.driver_id = ?1 AND rd.type = 'RACE_RESULT'
ORDER BY ra.year DESC, ra.round DESC
LIMIT 1`;

// 号变更：仅取 1974 起——此前车号按站分配，无身份意义；1974 起 FIA 固定
// 车队整季编号。年内按最早轮次排序，repository 侧合并连续同年号区间
const numberStintsSql = `
SELECT ra.year, rd.driver_number
FROM race_data rd
JOIN race ra ON ra.id = rd.race_id
WHERE rd.driver_id = ?1 AND rd.type = 'RACE_RESULT' AND ra.year >= 1974
GROUP BY ra.year, rd.driver_number
ORDER BY ra.year, MIN(ra.round)`;

// 年份取正式阵容与实际结果的并集：当前季未出赛也有空矩阵块，将来轮次保留空列
const roundsSql = `
SELECT ra.year, ra.round, gp.abbreviation AS code, gp.name, gp.id AS slug, ra.circuit_id
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

// 行=该年该车手的 constructor 条目；车队块按该队最后参赛轮次降序，换队后
// 的车队在上，临时替补（如只跑一场）也遵循同一口径
const teamsSql = `
SELECT ra.year, rr.constructor_id AS id, c.name, MAX(ra.round) AS last_round
FROM race ra
JOIN race_result rr ON rr.race_id = ra.id
JOIN constructor c ON c.id = rr.constructor_id
WHERE rr.driver_id = ?1
GROUP BY ra.year, rr.constructor_id, c.name
ORDER BY ra.year DESC, last_round DESC`;

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

// 队友：与该车手同年同队实际参赛的其他车手。门槛用实际比赛结果推导的 stint，
// 而非 season_entrant_driver——替补登场常无正式阵容行（如 Bearman 2024 代打），
// 按阵容过滤会丢掉这些队友。结果按站取最佳。
// CROSS JOIN 固定连接顺序（stint → 该年的 race → 该场该队的成绩）。规划器自己排时，
// 只有跑过 ANALYZE 才排得对；没有统计信息就会先按 constructor_id 拉出该车队史上
// 全部成绩再用年份过滤，Hamilton 一次要读 5 万行。export 供查询计划测试
const teammateResultsSql = `
WITH stints AS (
  SELECT DISTINCT ra.year, rr.constructor_id
  FROM race ra
  JOIN race_result rr ON rr.race_id = ra.id
  WHERE rr.driver_id = ?1
)
SELECT ra.year, ra.round, rr.driver_id, d.name, cn.alpha2_code,
  rr.constructor_id,
  rr.position_text, rr.pole_position, rr.fastest_lap, rr.reason_retired,
  rr.position_number
FROM stints s
CROSS JOIN race ra ON ra.year = s.year
CROSS JOIN race_result rr
  ON rr.race_id = ra.id AND rr.constructor_id = s.constructor_id
JOIN driver d ON d.id = rr.driver_id
LEFT JOIN country cn ON cn.id = d.nationality_country_id
WHERE rr.driver_id <> ?1
ORDER BY rr.position_display_order`;

const teammateSprintRankSql = `
WITH stints AS (
  SELECT DISTINCT ra.year, rr.constructor_id
  FROM race ra
  JOIN race_result rr ON rr.race_id = ra.id
  WHERE rr.driver_id = ?1
)
SELECT ra.year, ra.round, srr.driver_id, srr.position_number
FROM stints s
CROSS JOIN race ra ON ra.year = s.year
CROSS JOIN sprint_race_result srr
  ON srr.race_id = ra.id AND srr.constructor_id = s.constructor_id
WHERE srr.driver_id <> ?1 AND srr.position_number IS NOT NULL`;

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

export function createDriverRepository(db?: DriverDatabase): DriverRepository {
  return {
    async getDrivers() {
      if (!db) {
        // fixture 仅 DEV 用，动态导入避免打进生产 bundle
        const { default: fixture } = await import("./fixtures/drivers.json");
        return (fixture as DriverCatalogFixture[]).map(
          ({ points, seasons, ...summary }) => summary,
        );
      }

      const [rows] = await db.batch([{ sql: driversSql, values: [] }]);
      return rows.results.map(mapDriverRow);
    },

    async getDriversByYear(year) {
      if (!db) {
        const { default: fixture } = await import("./fixtures/drivers.json");
        const rows: (DriverSummary & { points: number })[] = [];
        for (const {
          seasons,
          ...summary
        } of fixture as DriverCatalogFixture[]) {
          const entry = seasons[String(year)];
          if (entry) {
            rows.push({
              ...summary,
              // 年份视图优先该年号码与车队，无才回落生涯值（与生产 SQL 同口径）
              number: entry.number ?? summary.number,
              teamId: entry.teamId ?? summary.teamId,
              teamName: entry.teamName ?? summary.teamName,
              points: entry.points,
            });
          }
        }
        return rows
          .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
          .map(({ points, ...row }) => row);
      }

      const [rows] = await db.batch([
        { sql: driversByYearSql, values: [year] },
      ]);
      return rows.results.map(mapDriverRow);
    },

    async getSeasonYears() {
      if (!db) {
        // DEV 从 fixture 参赛年份推导；生产读 season 表
        const { default: fixture } = await import("./fixtures/drivers.json");
        return deriveSeasonYears(fixture as DriverCatalogFixture[]);
      }

      const [rows] = await db.batch([{ sql: seasonYearsSql, values: [] }]);
      return mapSeasonYearRows(rows.results);
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
        lastNumberRows,
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
        teammateResultRows,
        teammateSprintRankRows,
      ] = await db.batch([
        { sql: identitySql, values: [slug] },
        { sql: lastNumberSql, values: [slug] },
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
        { sql: teammateResultsSql, values: [slug] },
        { sql: teammateSprintRankSql, values: [slug] },
      ]);

      if (identityRows.results.length === 0) return null;
      const identity = parseIdentity(identityRows.results[0]);
      const lastNumberRow = lastNumberRows.results[0];

      const seasons = mergeDriverSeasons({
        rounds: roundRows.results,
        teams: teamRows.results,
        results: resultRows.results,
        sprintRanks: sprintRankRows.results,
        standings: standingRows.results,
        teammateResults: teammateResultRows.results,
        teammateSprintRanks: teammateSprintRankRows.results,
      });

      return {
        ...identity,
        lastNumber:
          lastNumberRow === undefined
            ? null
            : rowReader(lastNumberRow, "last number row").str("driver_number"),
        numberStints: mergeNumberStints(numberRows.results),
        teamStints: mergeTeamStints(seasons),
        currentSeason: buildCurrentSeason(
          seasons[0],
          gpStatRows.results,
          sprintStatRows.results,
          sprintPoleRows.results,
        ),
        seasons,
        activeSeason: parseActiveSeason(maxSeasonRows.results),
      };
    },
  };
}

// 目录行映射：按年查询的行没有 is_current，isCurrent 自然为 false
function mapDriverRow(row: unknown): DriverSummary {
  const record = rowReader(row, "driver row");
  return {
    id: record.str("id"),
    name: record.str("name"),
    code: record.str("code"),
    number: record.strOrNull("number"),
    // 国旗 SVG 以 alpha2 小写命名
    flagCode: record.strOrNull("alpha2_code")?.toLowerCase() ?? null,
    teamId: record.strOrNull("team_id"),
    teamName: record.strOrNull("team_name"),
    isCurrent: record.bool("is_current"),
  };
}

function parseIdentity(
  value: unknown,
): Omit<
  DriverPage,
  | "lastNumber"
  | "numberStints"
  | "teamStints"
  | "currentSeason"
  | "seasons"
  | "activeSeason"
> {
  const record = rowReader(value, "driver identity");
  return {
    id: record.str("id"),
    name: record.str("name"),
    code: record.str("code"),
    fullName: record.str("full_name"),
    countryName: record.str("country_name"),
    alpha2Code: record.str("alpha2_code"),
    dateOfBirth: record.str("date_of_birth"),
    dateOfDeath: record.strOrNull("date_of_death"),
    placeOfBirth: record.str("place_of_birth"),
    permanentNumber: record.strOrNull("permanent_number"),
    totals: {
      entries: record.num("entries"),
      starts: record.num("starts"),
      wins: record.num("wins"),
      podiums: record.num("podiums"),
      poles: record.num("poles"),
      fastestLaps: record.num("fastest_laps"),
      points: record.num("points"),
      sprintWins: record.num("sprint_wins"),
      championships: record.num("championships"),
      bestChampionshipPosition: record.numOrNull("best_position"),
    },
  };
}

// 连续同年号合并为区间；断档或换号开新段（同 withEarlyStint 模式）
export function mergeNumberStints(rows: unknown[]): NumberStint[] {
  const stints: NumberStint[] = [];
  for (const row of rows) {
    const record = rowReader(row, "number stint row");
    const year = record.num("year");
    const number = record.str("driver_number");
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
// seasons 降序，先翻成升序；同年多队按最后参赛轮次升序还原时间线
// （矩阵里换队后的队在上，chips 里先效力的队在前）
export function mergeTeamStints(seasons: DriverSeason[]): TeamStint[] {
  const stints: TeamStint[] = [];
  for (const season of [...seasons].reverse()) {
    for (const team of [...season.teams].sort(
      (a, b) => a.lastRound - b.lastRound,
    )) {
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

// fixture 与 D1 结果同构，仅 teamStints 需运行期从 seasons 推导
function withTeamStints(page: Omit<DriverPage, "teamStints">): DriverPage {
  return { ...page, teamStints: mergeTeamStints(page.seasons) };
}

// 七组行全是 unknown[]，位置参数错位时类型系统沉默；具名入参把对齐交给编译器
interface DriverSeasonRows {
  rounds: unknown[];
  teams: unknown[];
  results: unknown[];
  sprintRanks: unknown[];
  standings: unknown[];
  teammateResults: unknown[];
  teammateSprintRanks: unknown[];
}

function mergeDriverSeasons(rows: DriverSeasonRows): DriverSeason[] {
  const seasons = new Map<number, DriverSeason>();
  const rawRounds = new Map<
    number,
    {
      round: number;
      code: string;
      name: string;
      slug: string;
      circuitId: string;
    }[]
  >();
  for (const row of rows.rounds) {
    const record = rowReader(row, "round row");
    const year = record.num("year");
    const list = rawRounds.get(year) ?? [];
    list.push({
      round: record.num("round"),
      code: record.str("code"),
      name: record.str("name"),
      slug: record.str("slug"),
      circuitId: record.str("circuit_id"),
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
    season.rounds = (rawRounds.get(year) ?? []).map(
      ({ round, ...display }) => display,
    );
  }

  const sprintRanks = new Map<string, number>();
  for (const row of rows.sprintRanks) {
    const record = rowReader(row, "sprint rank row");
    sprintRanks.set(
      `${record.num("year")}:${record.num("round")}`,
      record.num("position_number"),
    );
  }

  // 共享赛车同 (year, constructor, round) 多行；SQL 按排名序，首条即最佳成绩
  const cells = new Map<string, Map<number, RaceCell>>();
  for (const row of rows.results) {
    const record = rowReader(row, "result row");
    const year = record.num("year");
    const round = record.num("round");
    const constructorId = record.str("constructor_id");
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

  // 队友结果与冲刺排名：按 (year, constructor) 分组，矩阵对齐 rounds
  const teammateSprintRanks = new Map<string, number>();
  for (const row of rows.teammateSprintRanks) {
    const record = rowReader(row, "teammate sprint rank row");
    teammateSprintRanks.set(
      `${record.num("year")}:${record.num("round")}:${record.str("driver_id")}`,
      record.num("position_number"),
    );
  }

  const teammateCells = new Map<
    string,
    Map<
      string,
      {
        id: string;
        name: string;
        flagCode: string | null;
        byRound: Map<number, RaceCell>;
      }
    >
  >();
  for (const row of rows.teammateResults) {
    const record = rowReader(row, "teammate result row");
    const year = record.num("year");
    const round = record.num("round");
    const driverId = record.str("driver_id");
    const constructorId = record.str("constructor_id");
    const groupKey = `${year}:${constructorId}`;
    let group = teammateCells.get(groupKey);
    if (!group) {
      group = new Map();
      teammateCells.set(groupKey, group);
    }
    let entry = group.get(driverId);
    if (!entry) {
      entry = {
        id: driverId,
        name: record.str("name"),
        flagCode: record.strOrNull("alpha2_code")?.toLowerCase() ?? null,
        byRound: new Map(),
      };
      group.set(driverId, entry);
    }
    // 共享赛车多行，SQL 按排名序，首条即最佳成绩
    if (entry.byRound.has(round)) continue;
    entry.byRound.set(
      round,
      buildRaceCell(
        record,
        teammateSprintRanks.get(`${year}:${round}:${driverId}`) ?? null,
      ),
    );
  }

  for (const row of rows.teams) {
    const record = rowReader(row, "driver team row");
    const year = record.num("year");
    // team 年份必然在 roundsSql 并集里，season 必存在
    const season = seasons.get(year);
    if (!season) continue;
    const constructorId = record.str("id");
    const byRound = cells.get(`${year}:${constructorId}`);
    const teammates = [
      ...(teammateCells.get(`${year}:${constructorId}`)?.values() ?? []),
    ]
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        flagCode: entry.flagCode,
        results: (rawRounds.get(year) ?? []).map(
          (r) => entry.byRound.get(r.round) ?? null,
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    season.teams.push({
      id: constructorId,
      name: record.str("name"),
      lastRound: record.num("last_round"),
      results: (rawRounds.get(year) ?? []).map(
        (r) => byRound?.get(r.round) ?? null,
      ),
      teammates,
    });
  }

  for (const row of rows.standings) {
    const record = rowReader(row, "driver standing row");
    const season = seasons.get(record.num("year"));
    if (!season) continue;
    season.points = record.num("points");
    season.position = record.str("position_text");
    season.championshipWon =
      season.championshipWon || record.bool("championship_won");
  }

  return [...seasons.values()].sort((a, b) => b.year - a.year);
}
