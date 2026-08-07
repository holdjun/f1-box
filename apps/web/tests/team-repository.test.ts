import { describe, expect, it } from "vitest";

import {
  createTeamRepository,
  type TeamDatabase,
} from "../src/lib/team-repository.js";

function fakeDb(responses: Record<string, unknown[]>): TeamDatabase {
  return {
    prepare(sql: string) {
      const key = Object.keys(responses).find((marker) => sql.includes(marker));
      return {
        bind() {
          return {
            async all() {
              if (!key) throw new Error(`Unexpected query: ${sql}`);
              return { results: responses[key] };
            },
          };
        },
      };
    },
  };
}

const identityRow = {
  id: "ferrari",
  name: "Ferrari",
  full_name: "Scuderia Ferrari",
  country_name: "Italy",
  alpha2_code: "IT",
  entries: 1135,
  wins: 250,
  podiums: 845,
  poles: 254,
  fastest_laps: 269,
  points: 11338,
  championships: 16,
  best_position: 1,
};

const db = fakeDb({
  "FROM constructor": [identityRow],
  "GROUP BY sec.year": [
    { year: 2026, chassis: "SF-26", engines: "067/6" },
    { year: 2025, chassis: "SF-25,SF-25B", engines: "066/12" },
    { year: 1950, chassis: null, engines: null },
  ],
  "test_driver = 0": [
    { year: 2026, name: "Charles Leclerc" },
    { year: 2026, name: "Lewis Hamilton" },
    { year: 2025, name: "Charles Leclerc" },
    { year: 1951, name: "Alberto Ascari" },
  ],
  "season_constructor_standing": [
    { year: 2026, position_text: "2", points: 307, championship_won: 0 },
    { year: 2025, position_text: "4", points: 398, championship_won: 0 },
    { year: 2000, position_text: "1", points: 170, championship_won: 1 },
    { year: 2000, position_text: "1", points: 180, championship_won: 1 },
  ],
});

describe("createTeamRepository with database", () => {
  it("merges identity, seasons, drivers and standings", async () => {
    const team = await createTeamRepository(db).getTeam("ferrari");
    expect(team).not.toBeNull();
    expect(team?.fullName).toBe("Scuderia Ferrari");
    expect(team?.alpha2Code).toBe("IT");
    expect(team?.totals.championships).toBe(16);
    expect(team?.totals.points).toBe(11338);
    expect(team?.seasons.map((s) => s.year)).toEqual([2026, 2025, 1950]);
  });

  it("splits chassis and engine lists and groups drivers by year", async () => {
    const team = await createTeamRepository(db).getTeam("ferrari");
    const byYear = Object.fromEntries(team!.seasons.map((s) => [s.year, s]));
    expect(byYear[2025].chassis).toEqual(["SF-25", "SF-25B"]);
    expect(byYear[2025].engines).toEqual(["066/12"]);
    expect(byYear[2026].drivers).toEqual(["Charles Leclerc", "Lewis Hamilton"]);
    expect(byYear[1950].chassis).toEqual([]);
    expect(byYear[1950].drivers).toEqual([]);
    expect(byYear[1950].points).toBeNull();
    expect(byYear[1950].position).toBeNull();
  });

  it("attaches standings and keeps the highest-points duplicate per year", async () => {
    const team = await createTeamRepository(db).getTeam("ferrari");
    const byYear = Object.fromEntries(team!.seasons.map((s) => [s.year, s]));
    expect(byYear[2026]).toMatchObject({
      points: 307,
      position: "2",
      championshipWon: false,
    });
    expect(byYear[2025].position).toBe("4");
    // 2000 有积分榜但没有参赛行（fake 数据），不应出现
    expect(byYear[2000]).toBeUndefined();
  });

  it("flags championship seasons", async () => {
    const championDb = fakeDb({
      "FROM constructor": [identityRow],
      "GROUP BY sec.year": [{ year: 2000, chassis: "F1-2000", engines: "049" }],
      "test_driver = 0": [],
      "season_constructor_standing": [
        { year: 2000, position_text: "1", points: 180, championship_won: 1 },
      ],
    });
    const team = await createTeamRepository(championDb).getTeam("ferrari");
    expect(team?.seasons[0].championshipWon).toBe(true);
  });

  it("returns null for an unknown constructor", async () => {
    const emptyDb = fakeDb({ "FROM constructor": [] });
    await expect(createTeamRepository(emptyDb).getTeam("nope")).resolves.toBeNull();
  });

  it("throws on a malformed identity row", async () => {
    const badDb = fakeDb({ "FROM constructor": [{ id: "ferrari" }] });
    await expect(createTeamRepository(badDb).getTeam("ferrari")).rejects.toThrow(
      /team/i,
    );
  });
});

describe("createTeamRepository without database (DEV fixture)", () => {
  it("serves the ferrari fixture", async () => {
    const team = await createTeamRepository().getTeam("ferrari");
    expect(team?.fullName).toBe("Scuderia Ferrari");
    expect(team?.seasons).toHaveLength(77);
    expect(team?.seasons.filter((s) => s.championshipWon)).toHaveLength(16);
    expect(team?.seasons[0].year).toBe(2026);
  });

  it("returns null for other teams", async () => {
    await expect(createTeamRepository().getTeam("mercedes")).resolves.toBeNull();
  });
});
