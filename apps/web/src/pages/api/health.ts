import type { APIContext } from "astro";

export async function GET({ locals }: APIContext): Promise<Response> {
  const { raceResults } = locals.app.repositories;
  const years = await raceResults.getSeasonYears();
  return Response.json(
    {
      status: "ok",
      // D1 为唯一数据源后，health 报赛季覆盖范围而非 R2 manifest 存在性
      seasons: years.length > 0 ? `${years[0]}-${years.at(-1)}` : "missing",
    },
    // 卫生措施：启用缓存提供者后适配器本也会给未 opt-in 响应盖 CDN 层 no-store，
    // 显式声明语义自文档化，且回退提供者时不失守
    { headers: { "cache-control": "no-store" } },
  );
}
