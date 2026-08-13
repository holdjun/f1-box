export function splitYearPath(pathname: string): { year: number | null; rest: string } {
  const match = pathname.match(/^\/(\d{4})(\/.*)?$/);
  if (!match) return { year: null, rest: pathname };
  return { year: Number(match[1]), rest: match[2] || "" };
}

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
