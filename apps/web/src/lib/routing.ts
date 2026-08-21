// 解析 ?year=1997 或 ?year=1997,2007 → 年份数组；无效/缺失返回 null（= 全部）
export function parseYearParam(value: string | null): number[] | null {
  if (value === null || value.trim() === "") return null;
  const years = [
    ...new Set(
      value
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((year) => Number.isInteger(year) && year >= 1950 && year <= 2100),
    ),
  ];
  return years.length > 0 ? years.sort((a, b) => a - b) : null;
}

// 目录页：单年份参数，且必须在已知年份内（无效回落 null = 全部）
export function resolveCatalogYear(value: string | null, years: number[]): number | null {
  const param = parseYearParam(value);
  return param !== null && param.length === 1 && years.includes(param[0])
    ? param[0]
    : null;
}

// 详情页：多选年份参数，过滤到该实体实际参赛年份；无交集回落 null（= 全部）
export function resolveSeasonSelection(
  value: string | null,
  seasonYears: Set<number>,
): number[] | null {
  const param = parseYearParam(value);
  if (param === null) return null;
  const valid = param.filter((year) => seasonYears.has(year));
  return valid.length > 0 ? valid : null;
}

export const raceTabKeys = [
  "race-result", "fastest-laps", "pit-stop-summary", "starting-grid",
  "qualifying", "practice-1", "practice-2", "practice-3",
] as const;
export type RaceTabKey = (typeof raceTabKeys)[number];

// 顺序即分站子导航显示顺序（与 f1.com 一致）
export const RACE_TAB_LABELS: Record<RaceTabKey, string> = {
  "race-result": "Race Result",
  "fastest-laps": "Fastest Laps",
  "pit-stop-summary": "Pit Stop Summary",
  "starting-grid": "Starting Grid",
  qualifying: "Qualifying",
  "practice-1": "Practice 1",
  "practice-2": "Practice 2",
  "practice-3": "Practice 3",
};

export function resolveRaceTab(value: string): RaceTabKey | null {
  return (raceTabKeys as readonly string[]).includes(value) ? (value as RaceTabKey) : null;
}
