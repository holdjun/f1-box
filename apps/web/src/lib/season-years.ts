import { rowReader } from "./db-parse.js";

// driver/team 目录的年份列表共享：生产读 season 表；DEV 从 fixture 参赛年份推导
export const seasonYearsSql = `SELECT year FROM season ORDER BY year DESC`;

export function deriveSeasonYears(
  entries: { seasons: Record<string, unknown> }[],
): number[] {
  const years = new Set<number>();
  for (const entry of entries) {
    for (const key of Object.keys(entry.seasons)) years.add(Number(key));
  }
  return [...years].sort((a, b) => b - a);
}

export function mapSeasonYearRows(rows: unknown[]): number[] {
  return rows.map((row) => rowReader(row, "season year").num("year"));
}
