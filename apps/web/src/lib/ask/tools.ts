import { rowReader } from "../db-parse.js";
import { mergeStanding, type StandingTotal } from "../standings-merge.js";
import { askAliases, resolveAlias } from "./aliases.js";
import type { AskDatabase } from "./db.js";

interface EntityRef {
  id: string;
  name: string;
}

type Resolution =
  | { status: "unique"; ref: EntityRef }
  | { status: "ambiguous"; candidates: EntityRef[] }
  | { status: "miss" };

// 精确（id/全名）优先，其次包含匹配（≥3 字符防误命中）；别名表先归一化
export const driverRefSql = `
SELECT id, name FROM driver
WHERE id = ?1 COLLATE NOCASE OR name = ?1 COLLATE NOCASE OR full_name = ?1 COLLATE NOCASE
   OR (instr(lower(name), lower(?1)) > 0 AND length(?1) >= 3)
ORDER BY (CASE WHEN name = ?1 COLLATE NOCASE THEN 0 ELSE 1 END), name
LIMIT 6`;

export const constructorRefSql = `
SELECT id, name FROM constructor
WHERE id = ?1 COLLATE NOCASE OR name = ?1 COLLATE NOCASE OR full_name = ?1 COLLATE NOCASE
   OR (instr(lower(name), lower(?1)) > 0 AND length(?1) >= 3)
ORDER BY (CASE WHEN name = ?1 COLLATE NOCASE THEN 0 ELSE 1 END), name
LIMIT 6`;

export const driverIdentitySql = `
SELECT d.id, d.name, d.full_name, co.name AS country_name,
  d.total_race_entries AS entries, d.total_race_starts AS starts,
  d.total_race_wins AS wins, d.total_podiums AS podiums,
  d.total_pole_positions AS poles, d.total_fastest_laps AS fastest_laps,
  d.total_points AS points, d.best_championship_position AS best_position
FROM driver d
JOIN country co ON co.id = d.nationality_country_id
WHERE d.id = ?1`;

export const driverChampionshipYearsSql = `
SELECT year FROM season_driver_standing
WHERE driver_id = ?1 AND championship_won = 1
ORDER BY year`;

export const constructorIdentitySql = `
SELECT c.id, c.name, c.full_name, co.name AS country_name,
  c.total_race_entries AS entries, c.total_race_wins AS wins,
  c.total_podiums AS podiums, c.total_pole_positions AS poles,
  c.total_fastest_laps AS fastest_laps, c.total_points AS points,
  c.best_championship_position AS best_position
FROM constructor c
JOIN country co ON co.id = c.country_id
WHERE c.id = ?1`;

export const constructorChampionshipYearsSql = `
SELECT DISTINCT year FROM season_constructor_standing
WHERE constructor_id = ?1 AND championship_won = 1
ORDER BY year`;

function mapRefs(rows: unknown[]): EntityRef[] {
  return rows.map((row) => {
    const record = rowReader(row, "entity ref row");
    return {
      id: record.str("id"),
      name: record.str("name"),
    };
  });
}

async function resolveEntity(
  db: AskDatabase,
  query: string,
  refSql: string,
  aliasTable: Record<string, string>,
): Promise<Resolution> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { status: "miss" };
  const aliasId = resolveAlias(trimmed, aliasTable);
  const lookup = aliasId ?? trimmed;
  const rows = await db.run(refSql, [lookup]);
  const refs = mapRefs(rows);

  // 别名解析到 id 时按 id 全等取（子串匹配会撞名，如 williams 撞三支车队）；
  // 未走别名时按名称全等判精确
  const exact = refs.filter((ref) =>
    aliasId !== null
      ? ref.id.toLowerCase() === aliasId.toLowerCase()
      : ref.name.toLowerCase() === lookup.toLowerCase(),
  );
  if (exact.length === 1) return { status: "unique", ref: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact };
  if (refs.length === 1) return { status: "unique", ref: refs[0] };
  if (refs.length > 1) return { status: "ambiguous", candidates: refs };
  return { status: "miss" };
}

export function resolveDriver(
  db: AskDatabase,
  query: string,
): Promise<Resolution> {
  return resolveEntity(db, query, driverRefSql, askAliases.drivers);
}

// 车手与车队的查询形状完全一致，只差词表与 SQL；加第三类实体时不应再拷一份
interface EntityKind {
  // 返回体里包裹统计的键（driver / constructor）
  key: string;
  noun: string;
  identitySql: string;
  championshipYearsSql: string;
  pagePrefix: string;
  aliases: Record<string, string>;
  refSql: string;
  missMessage: string;
  // 车手多一个 starts；f1db 车队表无此列
  extraColumns: string[];
}

const DRIVER_KIND: EntityKind = {
  key: "driver",
  noun: "车手",
  identitySql: driverIdentitySql,
  championshipYearsSql: driverChampionshipYearsSql,
  pagePrefix: "/drivers",
  aliases: askAliases.drivers,
  refSql: driverRefSql,
  missMessage: "未找到匹配车手，可尝试英文全名",
  extraColumns: ["starts"],
};

const CONSTRUCTOR_KIND: EntityKind = {
  key: "constructor",
  noun: "车队",
  identitySql: constructorIdentitySql,
  championshipYearsSql: constructorChampionshipYearsSql,
  pagePrefix: "/teams",
  aliases: askAliases.constructors,
  refSql: constructorRefSql,
  missMessage: "未找到匹配车队，可尝试英文名",
  extraColumns: [],
};

async function entitySummary(
  db: AskDatabase,
  query: string,
  kind: EntityKind,
): Promise<Record<string, unknown>> {
  const miss = { found: false, message: kind.missMessage };
  const resolution = await resolveEntity(db, query, kind.refSql, kind.aliases);
  if (resolution.status === "miss") return miss;
  if (resolution.status === "ambiguous") {
    return {
      found: false,
      candidates: resolution.candidates,
      message: `匹配到多名${kind.noun}，请用户确认是哪一位`,
    };
  }
  const identityRows = await db.run(kind.identitySql, [resolution.ref.id]);
  if (identityRows.length === 0) return miss;
  const record = rowReader(identityRows[0], `${kind.key} identity row`);
  const yearRows = await db.run(kind.championshipYearsSql, [resolution.ref.id]);
  const id = record.str("id");
  return {
    found: true,
    [kind.key]: {
      id,
      name: record.str("name"),
      fullName: record.str("full_name"),
      country: record.str("country_name"),
      championshipYears: yearRows.map((row) =>
        rowReader(row, `${kind.key} championship row`).num("year"),
      ),
      entries: record.num("entries"),
      ...Object.fromEntries(
        kind.extraColumns.map((column) => [column, record.num(column)]),
      ),
      wins: record.num("wins"),
      podiums: record.num("podiums"),
      poles: record.num("poles"),
      fastestLaps: record.num("fastest_laps"),
      points: record.num("points"),
      bestChampionshipPosition: record.numOrNull("best_position"),
    },
    pagePath: `${kind.pagePrefix}/${id}`,
  };
}

export function driverSummary(
  db: AskDatabase,
  query: string,
): Promise<Record<string, unknown>> {
  return entitySummary(db, query, DRIVER_KIND);
}

export function constructorSummary(
  db: AskDatabase,
  query: string,
): Promise<Record<string, unknown>> {
  return entitySummary(db, query, CONSTRUCTOR_KIND);
}

export const seasonCheckSql = "SELECT 1 AS ok FROM season WHERE year = ?1";

export const driverStandingsSql = `
SELECT sds.position_number, sds.position_text, sds.points, sds.championship_won,
  d.id AS driver_id, d.name AS driver_name
FROM season_driver_standing sds
JOIN driver d ON d.id = sds.driver_id
WHERE sds.year = ?1
ORDER BY sds.position_display_order`;

export const constructorStandingsSql = `
SELECT scs.position_text, scs.points, scs.championship_won,
  c.id AS constructor_id, c.name AS constructor_name
FROM season_constructor_standing scs
JOIN constructor c ON c.id = scs.constructor_id
WHERE scs.year = ?1
ORDER BY scs.position_display_order`;

export const grandPrixRefSql = `
SELECT id, name FROM grand_prix
WHERE id = ?1 COLLATE NOCASE OR name = ?1 COLLATE NOCASE
   OR abbreviation = UPPER(?1) OR full_name = ?1 COLLATE NOCASE
   OR (instr(lower(name), lower(?1)) > 0 AND length(?1) >= 3)
ORDER BY (CASE WHEN name = ?1 COLLATE NOCASE THEN 0 ELSE 1 END), name
LIMIT 6`;

// meta 顺带返回 race_id，省一次独立的 id 查询
export const raceMetaSql = `
SELECT ra.id AS race_id, ra.year, ra.round, ra.date, gp.name AS grand_prix_name
FROM race ra
JOIN grand_prix gp ON gp.id = ra.grand_prix_id
WHERE ra.year = ?1 AND ra.grand_prix_id = ?2`;

export const raceResultRowsSql = `
SELECT rr.position_number, rr.position_text, rr.time, rr.reason_retired, rr.points,
  d.id AS driver_id, d.name AS driver_name, ct.id AS constructor_id, ct.name AS constructor_name
FROM race_result rr
JOIN driver d ON d.id = rr.driver_id
JOIN constructor ct ON ct.id = rr.constructor_id
WHERE rr.race_id = ?1
ORDER BY rr.position_display_order`;

const missYear = { found: false, message: "没有该年份的赛季数据" } as const;

export async function seasonDriverStandings(
  db: AskDatabase,
  year: number,
): Promise<Record<string, unknown>> {
  const check = await db.run(seasonCheckSql, [year]);
  if (check.length === 0) return missYear;
  const rows = await db.run(driverStandingsSql, [year]);
  return {
    year,
    standings: rows.map((row) => {
      const record = rowReader(row, "driver standing row");
      const driverId = record.str("driver_id");
      return {
        position: record.numOrNull("position_number"),
        driver: record.str("driver_name"),
        driverId,
        points: record.num("points"),
        champion: record.bool("championship_won"),
        pagePath: `/drivers/${driverId}`,
      };
    }),
  };
}

// 车队×引擎分行（60 年代）的合并规则与站内车队页共用 standings-merge.ts，口径单一出处
export async function seasonConstructorStandings(
  db: AskDatabase,
  year: number,
): Promise<Record<string, unknown>> {
  const check = await db.run(seasonCheckSql, [year]);
  if (check.length === 0) return missYear;
  const rows = await db.run(constructorStandingsSql, [year]);

  const merged = new Map<string, StandingTotal & { team: string }>();
  for (const row of rows) {
    const record = rowReader(row, "constructor standing row");
    const teamId = record.str("constructor_id");
    const total = mergeStanding(merged.get(teamId), {
      points: record.num("points"),
      positionText: record.str("position_text"),
      championshipWon: record.bool("championship_won"),
    });
    merged.set(teamId, {
      ...total,
      team: record.str("constructor_name"),
    });
  }
  return {
    year,
    standings: [...merged.entries()]
      .map(([teamId, entry]) => {
        const positionNumber = Number(entry.positionText);
        return {
          position: Number.isInteger(positionNumber) ? positionNumber : null,
          team: entry.team,
          teamId,
          points: entry.points,
          champion: entry.championshipWon,
          pagePath: `/teams/${teamId}`,
        };
      })
      .sort(
        (a, b) =>
          (a.position ?? 999) - (b.position ?? 999) || b.points - a.points,
      ),
  };
}

export async function raceResults(
  db: AskDatabase,
  year: number,
  race: string,
): Promise<Record<string, unknown>> {
  const trimmed = race.trim();
  if (trimmed.length === 0) {
    return { found: false, message: "未找到匹配的大奖赛，可尝试英文名" };
  }
  const aliasId = resolveAlias(trimmed, askAliases.grandPrix);
  const lookup = aliasId ?? trimmed;
  const gpRows = await db.run(grandPrixRefSql, [lookup]);
  let gpRefs = mapRefs(gpRows);
  // 别名解析到 id 后按 id 全等过滤，防止子串匹配撞名误报歧义（与 resolveEntity 同规则）
  if (aliasId !== null) {
    const exact = gpRefs.filter(
      (ref) => ref.id.toLowerCase() === aliasId.toLowerCase(),
    );
    if (exact.length > 0) gpRefs = exact;
  }
  if (gpRefs.length === 0) {
    return { found: false, message: "未找到匹配的大奖赛，可尝试英文名" };
  }
  if (gpRefs.length > 1) {
    return {
      found: false,
      candidates: gpRefs,
      message: "匹配到多场大奖赛，请用户确认是哪一场",
    };
  }
  const gp = gpRefs[0];

  const metaRows = await db.run(raceMetaSql, [year, gp.id]);
  if (metaRows.length === 0) {
    return { found: false, message: "该年份未举办此大奖赛" };
  }
  const meta = rowReader(metaRows[0], "race meta row");
  const rows = await db.run(raceResultRowsSql, [meta.num("race_id")]);

  return {
    year,
    round: meta.num("round"),
    grandPrix: meta.str("grand_prix_name"),
    date: meta.str("date"),
    results: rows.map((row) => {
      const record = rowReader(row, "race result row");
      const driverId = record.str("driver_id");
      const time = record.strOrNull("time");
      const retired = record.strOrNull("reason_retired");
      const status =
        time ??
        `${record.str("position_text")}${retired ? `（${retired}）` : ""}`;
      return {
        position: record.numOrNull("position_number"),
        driver: record.str("driver_name"),
        driverId,
        team: record.str("constructor_name"),
        // f1db 未得分行的 points 为 NULL（实测 1.9 万行），语义上即 0 分
        points: record.numOrNull("points") ?? 0,
        status,
        pagePath: `/drivers/${driverId}`,
      };
    }),
  };
}
