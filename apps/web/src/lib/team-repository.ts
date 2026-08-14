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
  // 未完成比赛但完成足够赛程、仍有排名（†）
  classified: boolean;
  sprintRank: number | null;
}

export interface TeamSeasonDriver {
  id: string;
  name: string;
  flagCode: string | null;
  champion: boolean;
  results: (RaceCell | null)[];
}

export interface SeasonRound {
  code: string;
  name: string;
  circuitId: string;
}

export interface TeamSeason {
  year: number;
  chassis: string[];
  engines: string[];
  powerUnits: string[];
  tyres: string[];
  rounds: SeasonRound[];
  drivers: TeamSeasonDriver[];
  points: number | null;
  position: string | null;
  championshipWon: boolean;
}

export interface StatsBlock {
  races: number;
  points: number;
  wins: number;
  podiums: number;
  poles: number;
  top10s: number;
}

export interface CurrentSeason {
  year: number;
  position: string | null;
  points: number | null;
  grandPrix: StatsBlock & { fastestLaps: number; dnfs: number };
  sprint: StatsBlock;
}

export interface LineageEntry {
  id: string;
  name: string;
  yearFrom: number;
  yearTo: number | null;
  segment: "standalone" | "continuity";
}

export interface TeamPage {
  id: string;
  name: string;
  fullName: string;
  countryName: string;
  alpha2Code: string;
  firstEntry: number | null;
  activeSeason: number | null;
  lineage: LineageEntry[];
  totals: TeamTotals;
  currentSeason: CurrentSeason | null;
  seasons: TeamSeason[];
}

export interface TeamRepository {
  getTeam(slug: string): Promise<TeamPage | null>;
  getConstructors(): Promise<ConstructorRef[]>;
  getConstructorsByYear(year: number): Promise<ConstructorRef[]>;
  getSeasonYears(): Promise<number[]>;
}

export interface ConstructorRef {
  id: string;
  name: string;
}

// DEV 目录 fixture 附带积分数据；生产由 SQL 提供
interface ConstructorCatalogFixture extends ConstructorRef {
  points: number;
  seasons: Record<string, { points: number } | undefined>;
}

export interface TeamDatabase {
  batch(
    statements: { sql: string; values: readonly unknown[] }[],
  ): Promise<{ results: unknown[] }[]>;
}

// D1 batch 需要预编译语句，仓库层接口用 {sql, values} 以便测试替身
export function createD1TeamDatabase(d1: D1Database): TeamDatabase {
  return {
    batch: (statements) =>
      d1.batch(
        statements.map((statement) =>
          d1.prepare(statement.sql).bind(...statement.values),
        ),
      ),
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
WHERE c.id = ?1`;

const seasonsSql = `
SELECT sec.year,
  GROUP_CONCAT(DISTINCT ch.name) AS chassis,
  GROUP_CONCAT(DISTINCT en.name) AS engines,
  GROUP_CONCAT(DISTINCT em.name) AS power_units,
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
LEFT JOIN engine_manufacturer em ON em.id = sec.engine_manufacturer_id
LEFT JOIN season_entrant_tyre_manufacturer setm
  ON setm.year = sec.year AND setm.entrant_id = sec.entrant_id
  AND setm.constructor_id = sec.constructor_id
  AND setm.engine_manufacturer_id = sec.engine_manufacturer_id
LEFT JOIN tyre_manufacturer tm ON tm.id = setm.tyre_manufacturer_id
WHERE sec.constructor_id = ?1
GROUP BY sec.year`;

const roundsSql = `
SELECT ra.year, ra.round, gp.abbreviation AS code, gp.name, ra.circuit_id
FROM race ra
JOIN grand_prix gp ON gp.id = ra.grand_prix_id
WHERE ra.year IN (
  SELECT year FROM season_entrant_constructor WHERE constructor_id = ?1
)
ORDER BY ra.year, ra.round`;

// 替补/共享车手可能只出现在比赛结果而不在正式阵容（test_driver=0）里，用并集补齐
const driversSql = `
SELECT sed.year, d.id, d.name, cn.alpha2_code
FROM season_entrant_driver sed
JOIN driver d ON d.id = sed.driver_id
LEFT JOIN country cn ON cn.id = d.nationality_country_id
WHERE sed.constructor_id = ?1 AND sed.test_driver = 0
UNION
SELECT ra.year, d.id, d.name, cn.alpha2_code
FROM race ra
JOIN race_result rr ON rr.race_id = ra.id
JOIN driver d ON d.id = rr.driver_id
LEFT JOIN country cn ON cn.id = d.nationality_country_id
WHERE rr.constructor_id = ?1
ORDER BY 1, 3`;

const resultsSql = `
SELECT ra.year, ra.round, rr.driver_id, rr.position_text, rr.pole_position,
  rr.fastest_lap, rr.reason_retired, rr.position_number
FROM race ra
JOIN race_result rr ON rr.race_id = ra.id
WHERE rr.constructor_id = ?1
ORDER BY rr.position_display_order`;

const sprintRankSql = `
SELECT ra.year, ra.round, srr.driver_id, srr.position_number
FROM race ra
JOIN sprint_race_result srr ON srr.race_id = ra.id
WHERE srr.constructor_id = ?1 AND srr.position_number IS NOT NULL`;

// 积分榜按 车队×引擎供应商 分行（60 年代多引擎车队一年有多行），这里逐年取回，合并见 mergeStandings
const standingsSql = `
SELECT year, position_text, points, championship_won
FROM season_constructor_standing
WHERE constructor_id = ?1`;

// 零匹配行时 SUM 返回 NULL，必须 COALESCE（非现役车队的默认路径）
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
WHERE rr.constructor_id = ?1
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
WHERE srr.constructor_id = ?1
GROUP BY ra.year`;

const sprintPolesSql = `
SELECT ra.year, COUNT(*) AS poles
FROM race ra
JOIN sprint_starting_grid_position ssg ON ssg.race_id = ra.id
WHERE ssg.constructor_id = ?1 AND ssg.position_number = 1
GROUP BY ra.year`;

const championsSql = `
SELECT year, driver_id
FROM season_driver_standing
WHERE championship_won = 1`;

const lineageSql = `
SELECT cc.other_constructor_id AS id, oc.name, cc.year_from, cc.year_to
FROM constructor_chronology cc
JOIN constructor oc ON oc.id = cc.other_constructor_id
WHERE cc.constructor_id = ?1
ORDER BY cc.position_display_order`;

const maxSeasonSql = `SELECT MAX(year) AS year FROM season`;

const constructorsSql = `
SELECT c.id, c.name
FROM constructor c
ORDER BY c.total_points DESC, c.name`;

// 年份目录按该年积分榜降序；积分榜按车队×引擎供应商分行（60 年代多引擎），
// 先 SUM 合并。无积分榜的垫底按名字排。
const constructorsByYearSql = `
SELECT c.id, c.name, COALESCE(SUM(scs.points), 0) AS points
FROM season_entrant_constructor sec
JOIN constructor c ON c.id = sec.constructor_id
LEFT JOIN season_constructor_standing scs ON scs.constructor_id = c.id AND scs.year = ?1
WHERE sec.year = ?1
GROUP BY c.id, c.name
ORDER BY points DESC, c.name`;

const seasonYearsSql = `SELECT year FROM season ORDER BY year DESC`;

export function createTeamRepository(db?: TeamDatabase): TeamRepository {
  return {
    async getTeam(slug) {
      if (!db) {
        // fixture 仅 DEV 用，动态导入避免打进生产 bundle
        const { default: fixture } = await import(
          "./fixtures/team-ferrari.json"
        );
        return slug === "ferrari" ? (fixture as TeamPage) : null;
      }

      const [
        identityRows,
        seasonRows,
        roundRows,
        driverRows,
        resultRows,
        sprintRankRows,
        standingRows,
        gpStatRows,
        sprintStatRows,
        sprintPoleRows,
        championRows,
        lineageRows,
        maxSeasonRows,
      ] = await db.batch([
        { sql: identitySql, values: [slug] },
        { sql: seasonsSql, values: [slug] },
        { sql: roundsSql, values: [slug] },
        { sql: driversSql, values: [slug] },
        { sql: resultsSql, values: [slug] },
        { sql: sprintRankSql, values: [slug] },
        { sql: standingsSql, values: [slug] },
        { sql: gpStatsSql, values: [slug] },
        { sql: sprintStatsSql, values: [slug] },
        { sql: sprintPolesSql, values: [slug] },
        { sql: championsSql, values: [] },
        { sql: lineageSql, values: [slug] },
        { sql: maxSeasonSql, values: [] },
      ]);
      if (identityRows.results.length === 0) return null;
      const base = parseIdentityRow(identityRows.results[0]);

      const seasons = mergeSeasons(
        seasonRows.results,
        roundRows.results,
        driverRows.results,
        resultRows.results,
        sprintRankRows.results,
        standingRows.results,
        championRows.results,
      );

      return {
        ...base,
        firstEntry: seasons.at(-1)?.year ?? null,
        activeSeason:
          maxSeasonRows.results.length > 0
            ? asNumber(asRecord(maxSeasonRows.results[0], "max season row").year, "max season")
            : null,
        lineage: withEarlyStint(
          base,
          seasons,
          lineageRows.results.map((row) => {
            const record = asRecord(row, "lineage row");
            return {
              id: asString(record.id, "lineage id"),
              name: asString(record.name, "lineage name"),
              yearFrom: asNumber(record.year_from, "lineage year from"),
              yearTo:
                record.year_to == null ? null : asNumber(record.year_to, "lineage year to"),
              segment: "continuity" as const,
            };
          }),
        ),
        currentSeason: buildCurrentSeason(
          seasons[0],
          gpStatRows.results,
          sprintStatRows.results,
          sprintPoleRows.results,
        ),
        seasons,
      };
    },

    async getConstructors() {
      if (!db) {
        const { default: fixture } = await import("./fixtures/constructors.json");
        return (fixture as ConstructorCatalogFixture[]).map(
          ({ points, seasons, ...ref }) => ref,
        );
      }
      const rows = await db.batch([{ sql: constructorsSql, values: [] }]);
      return rows[0].results.map(mapConstructorRef);
    },

    async getConstructorsByYear(year) {
      if (!db) {
        const { default: fixture } = await import("./fixtures/constructors.json");
        const rows: (ConstructorRef & { points: number })[] = [];
        for (const { seasons, ...ref } of fixture as ConstructorCatalogFixture[]) {
          const entry = seasons[String(year)];
          if (entry) rows.push({ ...ref, points: entry.points });
        }
        return rows
          .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
          .map(({ points, ...row }) => row);
      }
      const rows = await db.batch([{ sql: constructorsByYearSql, values: [year] }]);
      return rows[0].results.map(mapConstructorRef);
    },

    async getSeasonYears() {
      if (!db) {
        // DEV 从 fixture 参赛年份推导；生产读 season 表
        const { default: fixture } = await import("./fixtures/constructors.json");
        const years = new Set<number>();
        for (const team of fixture as ConstructorCatalogFixture[]) {
          for (const key of Object.keys(team.seasons)) years.add(Number(key));
        }
        return [...years].sort((a, b) => b - a);
      }
      const rows = await db.batch([{ sql: seasonYearsSql, values: [] }]);
      return rows[0].results.map((row) =>
        asNumber(asRecord(row, "season year").year, "season year"),
      );
    },
  };
}

function mapConstructorRef(row: unknown): ConstructorRef {
  const record = asRecord(row, "constructor row");
  return {
    id: asString(record.id, "constructor id"),
    name: asString(record.name, "constructor name"),
  };
}

export interface SeasonGap {
  from: number;
  to: number;
  seasons: number;
}

// 相邻两个赛季年份不连续时，给出中间缺失的区间（seasons 按降序展示，newer 在上）
export function seasonGap(newerYear: number, olderYear: number): SeasonGap | null {
  if (newerYear - olderYear <= 1) return null;
  return { from: olderYear + 1, to: newerYear - 1, seasons: newerYear - olderYear - 1 };
}

// 传承链只覆盖近代入口（如 mercedes 从 1970 Tyrrell 起）；
// 若车队在链起点之前有多个不连续的参赛段，按实际赛季拆成多个"早期自身"徽章
function withEarlyStint(
  base: { id: string; name: string },
  seasons: TeamSeason[],
  lineage: LineageEntry[],
): LineageEntry[] {
  const first = lineage[0];
  if (!first) return lineage;
  const earlyYears = [...new Set(
    seasons
      .filter((season) => season.year < first.yearFrom)
      .map((season) => season.year),
  )].sort((a, b) => a - b);
  if (earlyYears.length === 0) return lineage;

  const earlyStints: LineageEntry[] = [];
  for (const year of earlyYears) {
    const previous = earlyStints.at(-1);
    if (previous && previous.yearTo === year - 1) {
      previous.yearTo = year;
    } else {
      earlyStints.push({
        id: base.id,
        name: base.name,
        yearFrom: year,
        yearTo: year,
        segment: "standalone",
      });
    }
  }
  return [...earlyStints, ...lineage];
}

// 结果格判定唯一来源：车队页与车手页共用（text/†/P/F/冲刺上标）
export function buildRaceCell(
  record: Record<string, unknown>,
  sprintRank: number | null,
): RaceCell {
  return {
    text: asString(record.position_text, "result position"),
    pole: Boolean(record.pole_position),
    fastest: Boolean(record.fastest_lap),
    classified:
      record.reason_retired !== null && record.position_number !== null,
    sprintRank,
  };
}

export function buildCurrentSeason(
  latest: { year: number; position: string | null; points: number | null } | undefined,
  gpStatRows: unknown[],
  sprintStatRows: unknown[],
  sprintPoleRows: unknown[],
): CurrentSeason | null {
  if (!latest) return null;

  const gp = asRecord(
    gpStatRows.find((row) => asRecord(row, "gp stats row").year === latest.year) ??
      emptyStats(),
    "gp stats row",
  );
  const sprint = asRecord(
    sprintStatRows.find(
      (row) => asRecord(row, "sprint stats row").year === latest.year,
    ) ?? emptyStats(),
    "sprint stats row",
  );
  const sprintPoles = sprintPoleRows.find(
    (row) => asRecord(row, "sprint poles row").year === latest.year,
  );

  return {
    year: latest.year,
    position: latest.position,
    points: latest.points,
    grandPrix: {
      races: asNumber(gp.races, "gp races"),
      points: asNumber(gp.points, "gp points"),
      wins: asNumber(gp.wins, "gp wins"),
      podiums: asNumber(gp.podiums, "gp podiums"),
      poles: asNumber(gp.poles, "gp poles"),
      top10s: asNumber(gp.top10s, "gp top 10s"),
      fastestLaps: asNumber(gp.fastest_laps, "gp fastest laps"),
      dnfs: asNumber(gp.dnfs, "gp dnfs"),
    },
    sprint: {
      races: asNumber(sprint.races, "sprint races"),
      points: asNumber(sprint.points, "sprint points"),
      wins: asNumber(sprint.wins, "sprint wins"),
      podiums: asNumber(sprint.podiums, "sprint podiums"),
      poles:
        sprintPoles === undefined
          ? 0
          : asNumber(asRecord(sprintPoles, "sprint poles row").poles, "sprint poles"),
      top10s: asNumber(sprint.top10s, "sprint top 10s"),
    },
  };
}

function emptyStats(): Record<string, unknown> {
  return { races: 0, points: 0, wins: 0, podiums: 0, poles: 0, top10s: 0, fastest_laps: 0, dnfs: 0 };
}

function mergeSeasons(
  seasonRows: unknown[],
  roundRows: unknown[],
  driverRows: unknown[],
  resultRows: unknown[],
  sprintRankRows: unknown[],
  standingRows: unknown[],
  championRows: unknown[],
): TeamSeason[] {
  const seasons = new Map<number, TeamSeason>();

  for (const row of seasonRows) {
    const record = asRecord(row, "season row");
    const year = asNumber(record.year, "season row year");
    seasons.set(year, {
      year,
      chassis: splitNames(record.chassis),
      engines: splitNames(record.engines),
      powerUnits: splitNames(record.power_units),
      tyres: [
        ...new Set(splitNames(record.tyres).map((name) => name.charAt(0).toUpperCase())),
      ].sort(),
      rounds: [],
      drivers: [],
      points: null,
      position: null,
      championshipWon: false,
    });
  }

  const rawRounds = new Map<
    number,
    { round: number; code: string; name: string; circuitId: string }[]
  >();
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
  }

  const sprintRanks = new Map<string, number>();
  for (const row of sprintRankRows) {
    const record = asRecord(row, "sprint rank row");
    sprintRanks.set(
      `${asNumber(record.year, "sprint year")}:${asNumber(record.round, "sprint round")}:${asString(record.driver_id, "sprint driver")}`,
      asNumber(record.position_number, "sprint rank"),
    );
  }

  const results = new Map<string, Map<number, RaceCell>>();
  for (const row of resultRows) {
    const record = asRecord(row, "result row");
    const year = asNumber(record.year, "result row year");
    const round = asNumber(record.round, "result row round");
    const driverId = asString(record.driver_id, "result row driver");
    let byRound = results.get(`${year}:${driverId}`);
    if (!byRound) {
      byRound = new Map();
      results.set(`${year}:${driverId}`, byRound);
    }
    // 共享赛车一名车手有多行；SQL 按排名序，首条即最佳成绩
    if (byRound.has(round)) continue;
    byRound.set(
      round,
      buildRaceCell(record, sprintRanks.get(`${year}:${round}:${driverId}`) ?? null),
    );
  }

  // 赛季未结束时将来轮次保留为空列，与 wiki 一致
  const retainedRounds = new Map<number, number[]>();
  for (const [year, season] of seasons) {
    const rounds = rawRounds.get(year) ?? [];
    retainedRounds.set(year, rounds.map((r) => r.round));
    season.rounds = rounds.map(({ code, name, circuitId }) => ({
      code,
      name,
      circuitId,
    }));
  }

  // 全部赛季块一次渲染前，先标记车手冠军（名字金色）
  const champions = new Set<string>();
  for (const row of championRows) {
    const record = asRecord(row, "champion row");
    champions.add(
      `${asNumber(record.year, "champion year")}:${asString(record.driver_id, "champion driver")}`,
    );
  }

  for (const row of driverRows) {
    const record = asRecord(row, "driver row");
    const year = asNumber(record.year, "driver row year");
    // 车手行年份必来自 entrants/结果表，与 seasons 同源，无缺口
    const season = seasons.get(year)!;
    const driverId = asString(record.id, "driver id");
    const byRound = results.get(`${year}:${driverId}`);
    season.drivers.push({
      id: driverId,
      name: asString(record.name, "driver name"),
      flagCode:
        record.alpha2_code === null ? null : asString(record.alpha2_code, "driver flag"),
      champion: champions.has(`${year}:${driverId}`),
      results: retainedRounds.get(year)!.map(
        (round) => byRound?.get(round) ?? null,
      ),
    });
  }
  mergeStandings(seasons, standingRows);

  return [...seasons.values()].sort((a, b) => b.year - a.year);
}

// 同一年多个引擎供应商变体行：积分累加、名次取最好、任一夺冠即夺冠
function mergeStandings(
  seasons: Map<number, TeamSeason>,
  standingRows: unknown[],
): void {
  for (const row of standingRows) {
    const record = asRecord(row, "standing row");
    const season = seasons.get(asNumber(record.year, "standing row year"));
    if (!season) continue;
    season.points = (season.points ?? 0) + asNumber(record.points, "standing points");
    const position = asString(record.position_text, "standing position");
    if (
      season.position === null ||
      (Number.isInteger(Number(position)) &&
        (!Number.isInteger(Number(season.position)) ||
          Number(position) < Number(season.position)))
    ) {
      season.position = position;
    }
    season.championshipWon = season.championshipWon || Boolean(record.championship_won);
  }
}

function parseIdentityRow(row: unknown): Omit<TeamPage, "seasons" | "firstEntry" | "currentSeason" | "lineage" | "activeSeason"> {
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
