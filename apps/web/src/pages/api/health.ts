import { env } from "cloudflare:workers";

import {
  createD1RaceResultsDatabase,
  createRaceResultsRepository,
} from "../../lib/race-results-repository.js";

export async function GET(): Promise<Response> {
  const repository = import.meta.env.DEV
    ? createRaceResultsRepository()
    : createRaceResultsRepository(createD1RaceResultsDatabase(env.F1_DB));
  const years = await repository.getSeasonYears();
  return Response.json({
    status: "ok",
    // D1 为唯一数据源后，health 报赛季覆盖范围而非 R2 manifest 存在性
    seasons: years.length > 0 ? `${years[0]}-${years.at(-1)}` : "missing",
  });
}
