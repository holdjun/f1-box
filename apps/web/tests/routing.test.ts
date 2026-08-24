import { describe, expect, it } from "vitest";
import {
  parseYearParam,
  raceTabKeys,
  resolveCatalogYear,
  resolveRaceTab,
  resolveSeasonSelection,
} from "../src/lib/routing.js";

describe("parseYearParam", () => {
  it("parses a single year and comma-separated years", () => {
    expect(parseYearParam("1997")).toEqual([1997]);
    expect(parseYearParam("1997,2007")).toEqual([1997, 2007]);
    expect(parseYearParam("2007,1997")).toEqual([1997, 2007]);
  });

  it("returns null for missing, empty or invalid input", () => {
    expect(parseYearParam(null)).toBeNull();
    expect(parseYearParam("")).toBeNull();
    expect(parseYearParam("abc")).toBeNull();
    expect(parseYearParam("1900,2020")).toEqual([2020]);
  });
});

describe("resolveCatalogYear", () => {
  const years = [2026, 2025, 1997];

  it("resolves a year present in the catalog", () => {
    expect(resolveCatalogYear("1997", years)).toBe(1997);
  });

  it("returns null for missing, non-numeric or unknown years", () => {
    expect(resolveCatalogYear(null, years)).toBeNull();
    expect(resolveCatalogYear("abc", years)).toBeNull();
    expect(resolveCatalogYear("1998", years)).toBeNull();
    expect(resolveCatalogYear("1997,2007", years)).toBeNull();
  });

  it("shares parseYearParam semantics for trailing separators", () => {
    expect(resolveCatalogYear("1997,", years)).toBe(1997);
  });
});

describe("resolveSeasonSelection", () => {
  const seasonYears = new Set([2026, 2021, 2020, 2019]);

  it("keeps only years the entity raced in", () => {
    expect(resolveSeasonSelection("2020,1997", seasonYears)).toEqual([2020]);
    expect(resolveSeasonSelection("2021", seasonYears)).toEqual([2021]);
  });

  it("returns null when nothing matches or the param is invalid", () => {
    expect(resolveSeasonSelection(null, seasonYears)).toBeNull();
    expect(resolveSeasonSelection("1997,1998", seasonYears)).toBeNull();
    expect(resolveSeasonSelection("abc", seasonYears)).toBeNull();
  });
});

describe("resolveRaceTab", () => {
  it("exposes the eight supported tabs in display order", () => {
    expect(raceTabKeys).toEqual([
      "race-result",
      "fastest-laps",
      "pit-stop-summary",
      "starting-grid",
      "qualifying",
      "practice-1",
      "practice-2",
      "practice-3",
    ]);
  });

  it("accepts known tabs and rejects unknown", () => {
    expect(resolveRaceTab("race-result")).toBe("race-result");
    expect(resolveRaceTab("practice-3")).toBe("practice-3");
    expect(resolveRaceTab("sprint")).toBeNull();
    expect(resolveRaceTab("")).toBeNull();
  });
});
