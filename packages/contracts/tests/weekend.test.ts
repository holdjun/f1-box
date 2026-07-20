import { describe, expect, test } from "vitest";

import { parseWeekendPayload } from "../src/weekend.js";

const validWeekend = {
  schemaVersion: 1,
  generatedAt: "2024-07-28T16:00:00Z",
  freshness: "fresh",
  event: {
    season: 2024,
    round: 14,
    slug: "belgian-grand-prix",
    raceName: "Belgian Grand Prix",
    startsAt: "2024-07-28T13:00:00Z",
    circuit: {
      id: "spa",
      name: "Circuit de Spa-Francorchamps",
      locality: "Spa",
      country: "Belgium",
      latitude: 50.4372,
      longitude: 5.9714,
    },
  },
  sessions: [
    {
      key: "qualifying",
      name: "Qualifying",
      startsAt: "2024-07-27T14:00:00Z",
      state: "complete",
    },
    {
      key: "race",
      name: "Race",
      startsAt: "2024-07-28T13:00:00Z",
      state: "complete",
    },
  ],
  classifications: [
    {
      sessionKey: "qualifying",
      rows: [
        {
          position: 1,
          driverCode: "LEC",
          driverName: "Charles Leclerc",
          constructorName: "Ferrari",
          q1: "1:41.114",
          q2: "1:40.955",
          q3: "1:52.518",
        },
      ],
    },
    {
      sessionKey: "race",
      rows: [
        {
          position: 1,
          driverCode: "HAM",
          driverName: "Lewis Hamilton",
          constructorName: "Mercedes",
          laps: 44,
          status: "Finished",
          points: 25.5,
          time: "1:19:10.503",
          fastestLap: null,
        },
      ],
    },
  ],
  driverStandings: [
    { position: 1, name: "Max Verstappen", code: "VER", points: 277, wins: 7 },
  ],
  constructorStandings: [{ position: 1, name: "Red Bull Racing", points: 408, wins: 7 }],
  history: [
    {
      season: 2023,
      round: 12,
      raceName: "Belgian Grand Prix",
      winnerName: "Max Verstappen",
      winnerConstructor: "Red Bull Racing",
    },
  ],
  seasonSchedule: [
    {
      round: 14,
      raceName: "Belgian Grand Prix",
      slug: "belgian-grand-prix",
      startsAt: "2024-07-28T13:00:00Z",
      circuitName: "Circuit de Spa-Francorchamps",
      country: "Belgium",
    },
  ],
  sources: [
    {
      name: "Jolpica F1 API",
      url: "https://api.jolpi.ca/ergast/f1/2024/14/results.json",
      fetchedAt: "2024-07-28T16:00:00Z",
    },
  ],
};

describe("parseWeekendPayload", () => {
  test("returns the same valid weekend payload object", () => {
    expect(parseWeekendPayload(validWeekend)).toBe(validWeekend);
  });

  test("rejects an unsupported schema version", () => {
    const invalid = { ...validWeekend, schemaVersion: 2 };

    expectInvalidPayload(invalid, "/schemaVersion");
  });

  test("rejects a payload without sources", () => {
    const { sources: _sources, ...invalid } = validWeekend;

    expectInvalidPayload(invalid, "/sources");
  });

  test("rejects a payload with no sources", () => {
    const invalid = { ...validWeekend, sources: [] };

    expectInvalidPayload(invalid, "/sources");
  });

  test("rejects an unknown session state", () => {
    const invalid = {
      ...validWeekend,
      sessions: [{ ...validWeekend.sessions[0], state: "running" }],
    };

    expectInvalidPayload(invalid, "/sessions/0/state");
  });

  test("rejects a qualifying classification without q3", () => {
    const qualifying = validWeekend.classifications[0];
    const { q3: _q3, ...rowWithoutQ3 } = qualifying.rows[0];
    const invalid = {
      ...validWeekend,
      classifications: [{ ...qualifying, rows: [rowWithoutQ3] }],
    };

    expectInvalidPayload(invalid, "/classifications/0/rows/0/q3");
  });
});

function expectInvalidPayload(value: unknown, errorPath: string): void {
  expect(() => parseWeekendPayload(value)).toThrow(TypeError);
  expect(() => parseWeekendPayload(value)).toThrow(errorPath);
}
