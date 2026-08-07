import { describe, expect, it } from "vitest";
import { parseCountries, parseCircuits, parseCareer } from "../src/global.js";

const VALID_COUNTRIES: unknown[] = [
  {
    id: "NL",
    alpha2Code: "NL",
    alpha3Code: "NLD",
    iocCode: "NED",
    name: "Netherlands",
    demonym: "Dutch",
  },
];

const VALID_CIRCUITS: unknown[] = [
  {
    id: "albert-park",
    name: "Albert Park",
    fullName: "Albert Park Grand Prix Circuit",
    type: "RACE",
    direction: "CLOCKWISE",
    placeName: "Melbourne",
    countryId: "AU",
    latitude: -37.8497,
    longitude: 144.968,
    lengthMetres: 5278,
    turns: 14,
    totalRacesHeld: 29,
    svgKey: null,
  },
];

const VALID_CAREER: unknown = {
  schemaVersion: 1,
  generatedAt: "2026-08-06T00:00:00Z",
  sources: [{ name: "f1db", url: "https://github.com/f1db/f1db", license: "CC-BY-4.0" }],
  drivers: [
    {
      id: "max-verstappen",
      totals: {
        grandsPrix: 200,
        wins: 60,
        podiums: 110,
        poles: 40,
        fastestLaps: 30,
        points: 3000,
        championships: 4,
        bestChampionshipPosition: 1,
      },
      seasons: [{ season: 2024, constructorId: "red-bull", position: 1, points: 437 }],
    },
  ],
  constructors: [
    {
      id: "red-bull",
      totals: {
        grandsPrix: 350,
        wins: 120,
        podiums: 240,
        poles: 90,
        points: 12000,
        championships: 6,
      },
      chronology: [{ constructorId: "red-bull", yearFrom: 2005, yearTo: null }],
    },
  ],
};

describe("parseCountries", () => {
  it("accepts a valid array", () => {
    const result = parseCountries(VALID_COUNTRIES);
    expect(result).toHaveLength(1);
    expect(result[0]?.demonym).toBe("Dutch");
  });

  it("rejects non-array", () => {
    expect(() => parseCountries(null)).toThrow(TypeError);
    expect(() => parseCountries({})).toThrow(TypeError);
  });

  it("rejects entry missing required field", () => {
    expect(() => parseCountries([{ id: "NL", alpha2Code: "NL" }])).toThrow(/\/0\//);
  });

  it("rejects entry with wrong field type", () => {
    expect(() =>
      parseCountries([{ ...VALID_COUNTRIES[0], alpha2Code: 42 }]),
    ).toThrow(/\/0\/alpha2Code/);
  });
});

describe("parseCircuits", () => {
  it("accepts a valid array", () => {
    const result = parseCircuits(VALID_CIRCUITS);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("albert-park");
  });

  it("accepts null for nullable fields", () => {
    const withNulls = [
      {
        ...VALID_CIRCUITS[0],
        fullName: null,
        type: null,
        direction: null,
        placeName: null,
        countryId: null,
        latitude: null,
        longitude: null,
        lengthMetres: null,
        turns: null,
        totalRacesHeld: null,
        svgKey: null,
      },
    ];
    const result = parseCircuits(withNulls);
    expect(result[0]?.latitude).toBeNull();
  });

  it("rejects non-array", () => {
    expect(() => parseCircuits("bad")).toThrow(TypeError);
  });

  it("rejects entry missing id", () => {
    expect(() => parseCircuits([{ name: "no-id" }])).toThrow(/\/0\/id/);
  });

  it("rejects non-number latitude when not null", () => {
    expect(() =>
      parseCircuits([{ ...VALID_CIRCUITS[0], latitude: "bad" }]),
    ).toThrow(/\/0\/latitude/);
  });
});

describe("parseCareer", () => {
  it("accepts a valid career object", () => {
    const result = parseCareer(VALID_CAREER);
    expect(result.schemaVersion).toBe(1);
    expect(result.drivers).toHaveLength(1);
    expect(result.constructors[0]?.totals.championships).toBe(6);
  });

  it("accepts bestChampionshipPosition as null", () => {
    const withNull = structuredClone(VALID_CAREER) as Record<string, unknown>;
    const drivers = (withNull.drivers as Array<Record<string, unknown>>).map((d) => ({
      ...d,
      totals: { ...(d.totals as object), bestChampionshipPosition: null },
    }));
    withNull.drivers = drivers;
    const result = parseCareer(withNull);
    expect(result.drivers[0]?.totals.bestChampionshipPosition).toBeNull();
  });

  it("accepts constructorId as null in seasons", () => {
    const withNull = structuredClone(VALID_CAREER) as Record<string, unknown>;
    const drivers = (withNull.drivers as Array<Record<string, unknown>>).map((d) => ({
      ...d,
      seasons: [{ season: 2024, constructorId: null, position: null, points: 100 }],
    }));
    withNull.drivers = drivers;
    const result = parseCareer(withNull);
    expect(result.drivers[0]?.seasons[0]?.constructorId).toBeNull();
  });

  it("rejects non-object", () => {
    expect(() => parseCareer([])).toThrow(TypeError);
    expect(() => parseCareer(null)).toThrow(TypeError);
  });

  it("rejects wrong schemaVersion", () => {
    const bad = { ...(VALID_CAREER as object), schemaVersion: 2 };
    expect(() => parseCareer(bad)).toThrow(/schemaVersion/);
  });

  it("rejects missing drivers array", () => {
    const bad = { ...(VALID_CAREER as object) } as Record<string, unknown>;
    delete bad.drivers;
    expect(() => parseCareer(bad)).toThrow(/drivers/);
  });

  it("rejects driver totals with wrong type", () => {
    const bad = structuredClone(VALID_CAREER) as Record<string, unknown>;
    const drivers = (bad.drivers as Array<Record<string, unknown>>).map((d) => ({
      ...d,
      totals: { ...(d.totals as object), wins: "sixty" },
    }));
    bad.drivers = drivers;
    expect(() => parseCareer(bad)).toThrow(/\/drivers\/0\/totals\/wins/);
  });

  it("rejects constructor chronology with non-integer yearFrom", () => {
    const bad = structuredClone(VALID_CAREER) as Record<string, unknown>;
    const constructors = (bad.constructors as Array<Record<string, unknown>>).map((c) => ({
      ...c,
      chronology: [{ constructorId: "red-bull", yearFrom: "2005", yearTo: null }],
    }));
    bad.constructors = constructors;
    expect(() => parseCareer(bad)).toThrow(/\/constructors\/0\/chronology\/0\/yearFrom/);
  });
});
