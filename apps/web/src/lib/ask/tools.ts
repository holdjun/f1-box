import { asNumber, asRecord, asString } from "../db-parse.js";
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
    const record = asRecord(row, "entity ref row");
    return {
      id: asString(record.id, "entity ref id"),
      name: asString(record.name, "entity ref name"),
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

function resolveConstructor(
  db: AskDatabase,
  query: string,
): Promise<Resolution> {
  return resolveEntity(db, query, constructorRefSql, askAliases.constructors);
}

const missDriver = {
  found: false,
  message: "未找到匹配车手，可尝试英文全名",
} as const;

const missConstructor = {
  found: false,
  message: "未找到匹配车队，可尝试英文名",
} as const;

function candidateMessage(kind: string) {
  return `匹配到多名${kind}，请用户确认是哪一位`;
}

export async function driverSummary(
  db: AskDatabase,
  query: string,
): Promise<Record<string, unknown>> {
  const resolution = await resolveDriver(db, query);
  if (resolution.status === "miss") return missDriver;
  if (resolution.status === "ambiguous") {
    return {
      found: false,
      candidates: resolution.candidates,
      message: candidateMessage("车手"),
    };
  }
  const identityRows = await db.run(driverIdentitySql, [resolution.ref.id]);
  if (identityRows.length === 0) return missDriver;
  const record = asRecord(identityRows[0], "driver identity row");
  const yearRows = await db.run(driverChampionshipYearsSql, [
    resolution.ref.id,
  ]);
  const championshipYears = yearRows.map((row) =>
    asNumber(
      asRecord(row, "driver championship row").year,
      "championship year",
    ),
  );
  const id = asString(record.id, "driver id");
  return {
    found: true,
    driver: {
      id,
      name: asString(record.name, "driver name"),
      fullName: asString(record.full_name, "driver full name"),
      country: asString(record.country_name, "driver country"),
      championshipYears,
      entries: asNumber(record.entries, "driver entries"),
      starts: asNumber(record.starts, "driver starts"),
      wins: asNumber(record.wins, "driver wins"),
      podiums: asNumber(record.podiums, "driver podiums"),
      poles: asNumber(record.poles, "driver poles"),
      fastestLaps: asNumber(record.fastest_laps, "driver fastest laps"),
      points: asNumber(record.points, "driver points"),
      bestChampionshipPosition:
        record.best_position === null
          ? null
          : asNumber(record.best_position, "driver best position"),
    },
    pagePath: `/drivers/${id}`,
  };
}

export async function constructorSummary(
  db: AskDatabase,
  query: string,
): Promise<Record<string, unknown>> {
  const resolution = await resolveConstructor(db, query);
  if (resolution.status === "miss") return missConstructor;
  if (resolution.status === "ambiguous") {
    return {
      found: false,
      candidates: resolution.candidates,
      message: candidateMessage("车队"),
    };
  }
  const identityRows = await db.run(constructorIdentitySql, [
    resolution.ref.id,
  ]);
  if (identityRows.length === 0) return missConstructor;
  const record = asRecord(identityRows[0], "constructor identity row");
  const yearRows = await db.run(constructorChampionshipYearsSql, [
    resolution.ref.id,
  ]);
  const championshipYears = yearRows.map((row) =>
    asNumber(
      asRecord(row, "constructor championship row").year,
      "championship year",
    ),
  );
  const id = asString(record.id, "constructor id");
  return {
    found: true,
    constructor: {
      id,
      name: asString(record.name, "constructor name"),
      fullName: asString(record.full_name, "constructor full name"),
      country: asString(record.country_name, "constructor country"),
      championshipYears,
      entries: asNumber(record.entries, "constructor entries"),
      wins: asNumber(record.wins, "constructor wins"),
      podiums: asNumber(record.podiums, "constructor podiums"),
      poles: asNumber(record.poles, "constructor poles"),
      fastestLaps: asNumber(record.fastest_laps, "constructor fastest laps"),
      points: asNumber(record.points, "constructor points"),
      bestChampionshipPosition:
        record.best_position === null
          ? null
          : asNumber(record.best_position, "constructor best position"),
    },
    pagePath: `/teams/${id}`,
  };
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
      const record = asRecord(row, "driver standing row");
      const driverId = asString(record.driver_id, "standing driver id");
      return {
        position:
          record.position_number === null
            ? null
            : asNumber(record.position_number, "standing position"),
        driver: asString(record.driver_name, "standing driver name"),
        driverId,
        points: asNumber(record.points, "standing points"),
        champion: Boolean(record.championship_won),
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
    const record = asRecord(row, "constructor standing row");
    const teamId = asString(record.constructor_id, "standing constructor id");
    const total = mergeStanding(merged.get(teamId), {
      points: asNumber(record.points, "standing points"),
      positionText: asString(record.position_text, "standing position text"),
      championshipWon: Boolean(record.championship_won),
    });
    merged.set(teamId, {
      ...total,
      team: asString(record.constructor_name, "standing constructor name"),
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
  const meta = asRecord(metaRows[0], "race meta row");
  const rows = await db.run(raceResultRowsSql, [
    asNumber(meta.race_id, "race id"),
  ]);

  return {
    year,
    round: asNumber(meta.round, "race round"),
    grandPrix: asString(meta.grand_prix_name, "race grand prix name"),
    date: asString(meta.date, "race date"),
    results: rows.map((row) => {
      const record = asRecord(row, "race result row");
      const driverId = asString(record.driver_id, "result driver id");
      const status =
        record.time !== null
          ? asString(record.time, "result time")
          : `${asString(record.position_text, "result position text")}${record.reason_retired ? `（${asString(record.reason_retired, "result reason")}）` : ""}`;
      return {
        position:
          record.position_number === null
            ? null
            : asNumber(record.position_number, "result position"),
        driver: asString(record.driver_name, "result driver name"),
        driverId,
        team: asString(record.constructor_name, "result constructor name"),
        // f1db 未得分行的 points 为 NULL（实测 1.9 万行），语义上即 0 分
        points:
          record.points === null ? 0 : asNumber(record.points, "result points"),
        status,
        pagePath: `/drivers/${driverId}`,
      };
    }),
  };
}
