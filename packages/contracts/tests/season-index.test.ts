import { describe, expect, it } from "vitest";
import { parseSeasonIndex } from "../src/season-index.js";

describe("parseSeasonIndex", () => {
  it("accepts a valid index and sorts years", () => {
    const index = parseSeasonIndex({
      schemaVersion: 1,
      activeSeason: 2026,
      availableYears: [2026, 2025],
    });
    expect(index.availableYears).toEqual([2025, 2026]);
    expect(index.activeSeason).toBe(2026);
  });

  it("rejects when activeSeason not in availableYears", () => {
    expect(() =>
      parseSeasonIndex({ schemaVersion: 1, activeSeason: 2024, availableYears: [2026] }),
    ).toThrow(/activeSeason/);
  });

  it("rejects duplicate or empty years", () => {
    expect(() =>
      parseSeasonIndex({ schemaVersion: 1, activeSeason: 2026, availableYears: [2026, 2026] }),
    ).toThrow(/unique/);
    expect(() =>
      parseSeasonIndex({ schemaVersion: 1, activeSeason: 2026, availableYears: [] }),
    ).toThrow(/non-empty/);
  });
});
