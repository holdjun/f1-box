import type { SeasonPayload } from "@f1-box/contracts/season";
import type { SeasonIndex } from "@f1-box/contracts/season-index";
import type { AstroGlobal } from "astro";

import { getIndex, getSeason } from "./page-data.js";
import { splitYearPath } from "./routing.js";

export interface YearContext {
  year: number;
  index: SeasonIndex;
  season?: SeasonPayload;
  rest: string;
  status?: 404 | 503;
}

export async function resolveYearContext(Astro: AstroGlobal): Promise<YearContext> {
  const year = Number(Astro.params.year);
  const index = await getIndex();
  const rest = splitYearPath(Astro.url.pathname).rest;

  if (!index.availableYears.includes(year)) {
    return { year, index, rest, status: 404 };
  }

  try {
    const season = await getSeason(year);
    return { year, index, season, rest };
  } catch (error) {
    console.error("season load failed", error);
    return { year, index, rest, status: 503 };
  }
}
