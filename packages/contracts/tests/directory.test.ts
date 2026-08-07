import { describe, expect, it } from "vitest";
import { parseSeasonDirectory } from "../src/directory.js";

const VALID: unknown = {
  schemaVersion: 1,
  season: 2026,
  generatedAt: "2026-08-06T00:00:00Z",
  sources: [{ name: "f1db", url: "https://github.com/f1db/f1db", license: "CC-BY-4.0" }],
  teams: [
    {
      id: "red-bull",
      name: "Red Bull Racing",
      fullName: "Oracle Red Bull Racing",
      countryId: "AT",
      color: "#3671c6",
      logoKey: "red-bull",
    },
  ],
  drivers: [
    {
      id: "max-verstappen",
      code: "VER",
      name: "Max Verstappen",
      firstName: "Max",
      lastName: "Verstappen",
      number: 1,
      countryId: "NL",
      dateOfBirth: "1997-09-30",
      wikipediaUrl: "https://en.wikipedia.org/wiki/Max_Verstappen",
    },
  ],
  entrants: [
    {
      constructorId: "red-bull",
      name: "Red Bull Racing",
      drivers: [{ driverId: "max-verstappen", rounds: null, testDriver: false }],
    },
  ],
};

describe("parseSeasonDirectory", () => {
  it("accepts a valid minimal sample and returns the same shape", () => {
    const result = parseSeasonDirectory(VALID);
    expect(result.schemaVersion).toBe(1);
    expect(result.season).toBe(2026);
    expect(result.teams[0]?.id).toBe("red-bull");
    expect(result.drivers[0]?.code).toBe("VER");
    expect(result.entrants[0]?.drivers[0]?.testDriver).toBe(false);
  });

  it("accepts null-able fields as null", () => {
    const withNulls = structuredClone(VALID) as Record<string, unknown>;
    const teams = (withNulls.teams as unknown[]).slice(0) as Array<Record<string, unknown>>;
    teams[0] = { ...teams[0], fullName: null, countryId: null, color: null, logoKey: null };
    withNulls.teams = teams;
    const result = parseSeasonDirectory(withNulls);
    expect(result.teams[0]?.color).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(() => parseSeasonDirectory(null)).toThrow(TypeError);
    expect(() => parseSeasonDirectory([])).toThrow(TypeError);
  });

  it("rejects wrong schemaVersion", () => {
    const bad = { ...(VALID as object), schemaVersion: 2 };
    expect(() => parseSeasonDirectory(bad)).toThrow(/schemaVersion/);
  });

  it("rejects missing top-level field", () => {
    const bad = { ...(VALID as object) } as Record<string, unknown>;
    delete bad.season;
    expect(() => parseSeasonDirectory(bad)).toThrow(/season/);
  });

  it("rejects wrong type for season", () => {
    const bad = { ...(VALID as object), season: "2026" };
    expect(() => parseSeasonDirectory(bad)).toThrow(/\/season/);
  });

  it("rejects non-array teams", () => {
    const bad = { ...(VALID as object), teams: {} };
    expect(() => parseSeasonDirectory(bad)).toThrow(/\/teams/);
  });

  it("rejects team entry missing required field", () => {
    const bad = {
      ...(VALID as object),
      teams: [{ id: "red-bull" }],
    };
    expect(() => parseSeasonDirectory(bad)).toThrow(/\/teams\/0/);
  });

  it("rejects driver entry with wrong number type", () => {
    const bad = structuredClone(VALID) as Record<string, unknown>;
    const drivers = (bad.drivers as Array<Record<string, unknown>>).map((d) => ({
      ...d,
      number: "1",
    }));
    bad.drivers = drivers;
    expect(() => parseSeasonDirectory(bad)).toThrow(/\/drivers\/0\/number/);
  });

  it("rejects entrant driver entry missing testDriver", () => {
    const bad = structuredClone(VALID) as Record<string, unknown>;
    const entrants = (bad.entrants as Array<Record<string, unknown>>).map((e) => ({
      ...e,
      drivers: [{ driverId: "max-verstappen", rounds: null }],
    }));
    bad.entrants = entrants;
    expect(() => parseSeasonDirectory(bad)).toThrow(/\/entrants\/0\/drivers\/0/);
  });
});
