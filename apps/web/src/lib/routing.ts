export function splitYearPath(pathname: string): { year: number | null; rest: string } {
  const match = pathname.match(/^\/(\d{4})(\/.*)?$/);
  if (!match) return { year: null, rest: pathname };
  return { year: Number(match[1]), rest: match[2] || "" };
}
