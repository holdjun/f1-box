import type { APIRoute } from "astro";
import { buildSeasonIcs, parseCalendarYear } from "../../lib/calendar-ics.js";

export const GET: APIRoute = async ({ url, locals, cache }) => {
  const year = parseCalendarYear(url.searchParams);
  if (year === null) return new Response(null, { status: 404 });
  const races =
    await locals.app.repositories.raceResults.getSeasonCalendar(year);
  const { ics, eventCount } = buildSeasonIcs(year, races, url.origin);
  // 未导入赛季、或有站次但整年无 session 时间：订阅空日历无意义
  if (eventCount === 0) return new Response(null, { status: 404 });
  // 中间件默认策略显式排除 /api/*，这里路由内 opt-in，参数与全站一致；
  // data-sync 导入后按 f1db 标签 purge。仅在 200 分支 opt-in，404 不进边缘缓存
  cache.set({ maxAge: 3600, swr: 86400, tags: ["f1db"] });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="f1-${year}.ics"`,
    },
  });
};
