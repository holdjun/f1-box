import { describe, expect, test } from "vitest";

import {
  createSeasonRepository,
  type SeasonObjectStore,
} from "../src/lib/season-repository.js";

describe("getIndex", () => {
  test("exposes the season index from the local fixture", async () => {
    const repository = createSeasonRepository();
    const index = await repository.getIndex();
    expect(index.activeSeason).toBe(2026);
    expect(index.availableYears).toContain(2026);
  });

  test("derives available years and active season from the store listing", async () => {
    const store: SeasonObjectStore = {
      async list() {
        return {
          delimitedPrefixes: ["v1/seasons/2026/", "v1/seasons/2024/", "v1/seasons/2025/"],
        };
      },
    };
    const repository = createSeasonRepository(store);

    const index = await repository.getIndex();

    expect(index.activeSeason).toBe(2026);
    expect(index.availableYears).toEqual([2024, 2025, 2026]);
  });

  test("rejects when the store lists no seasons", async () => {
    const store: SeasonObjectStore = {
      async list() {
        return { delimitedPrefixes: [] };
      },
    };
    const repository = createSeasonRepository(store);

    await expect(repository.getIndex()).rejects.toThrow(/No seasons/);
  });
});
