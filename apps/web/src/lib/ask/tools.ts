import { asNumber, asRecord, asString } from "../db-parse.js";
import { resolveAlias } from "./aliases.js";
import { askAliases } from "./aliases.js";
import type { AskDatabase } from "./db.js";

export interface EntityRef {
  id: string;
  name: string;
}

export type Resolution =
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
  d.total_points AS points, d.total_championship_wins AS championships,
  d.best_championship_position AS best_position
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
  c.total_championship_wins AS championships,
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

  // 别名已解析到唯一 id：SQL 行即精确行；否则按名称全等判精确
  const exact = refs.filter(
    (ref) => aliasId !== null || ref.name.toLowerCase() === lookup.toLowerCase(),
  );
  if (exact.length === 1) return { status: "unique", ref: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact };
  if (refs.length === 1) return { status: "unique", ref: refs[0] };
  if (refs.length > 1) return { status: "ambiguous", candidates: refs };
  return { status: "miss" };
}

export function resolveDriver(db: AskDatabase, query: string): Promise<Resolution> {
  return resolveEntity(db, query, driverRefSql, askAliases.drivers);
}

export function resolveConstructor(db: AskDatabase, query: string): Promise<Resolution> {
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
    return { found: false, candidates: resolution.candidates, message: candidateMessage("车手") };
  }
  const identityRows = await db.run(driverIdentitySql, [resolution.ref.id]);
  if (identityRows.length === 0) return missDriver;
  const record = asRecord(identityRows[0], "driver identity row");
  const yearRows = await db.run(driverChampionshipYearsSql, [resolution.ref.id]);
  const championshipYears = yearRows.map((row) =>
    asNumber(asRecord(row, "driver championship row").year, "championship year"),
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
    return { found: false, candidates: resolution.candidates, message: candidateMessage("车队") };
  }
  const identityRows = await db.run(constructorIdentitySql, [resolution.ref.id]);
  if (identityRows.length === 0) return missConstructor;
  const record = asRecord(identityRows[0], "constructor identity row");
  const yearRows = await db.run(constructorChampionshipYearsSql, [resolution.ref.id]);
  const championshipYears = yearRows.map((row) =>
    asNumber(asRecord(row, "constructor championship row").year, "championship year"),
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
