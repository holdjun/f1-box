import seasonIndexFixture from "@f1-box/contracts/fixtures/season-index.json";
import { parseSeasonIndex, type SeasonIndex } from "@f1-box/contracts/season-index";

export interface SeasonRepository {
  getIndex(): Promise<SeasonIndex>;
}

export interface SeasonObjectStore {
  list(options?: {
    prefix?: string;
    delimiter?: string;
  }): Promise<{ delimitedPrefixes?: string[] }>;
}

export function createSeasonRepository(
  store?: SeasonObjectStore,
): SeasonRepository {
  return {
    async getIndex() {
      if (store) {
        const years = await listSeasonYears(store);
        if (years.length === 0) {
          throw new Error("No seasons available in the object store");
        }
        return parseSeasonIndex({
          schemaVersion: 1,
          activeSeason: years[years.length - 1],
          availableYears: years,
        });
      }
      return parseSeasonIndex(seasonIndexFixture);
    },
  };
}

async function listSeasonYears(store: SeasonObjectStore): Promise<number[]> {
  const listing = await store.list({
    prefix: "v1/seasons/",
    delimiter: "/",
  });
  const prefixes = listing.delimitedPrefixes ?? [];

  return prefixes
    .map((prefix) => prefix.replace(/^v1\/seasons\//, "").replace(/\/$/, ""))
    .filter((year) => /^\d{4}$/.test(year))
    .map(Number)
    .sort((a, b) => a - b);
}
