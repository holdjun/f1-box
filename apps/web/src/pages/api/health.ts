import type { APIContext } from "astro";

export async function GET({ locals }: APIContext): Promise<Response> {
  const { raceResults } = locals.app.repositories;
  const years = await raceResults.getSeasonYears();
  return Response.json({
    status: "ok",
    // D1 为唯一数据源后，health 报赛季覆盖范围而非 R2 manifest 存在性
    seasons: years.length > 0 ? `${years[0]}-${years.at(-1)}` : "missing",
  });
}
