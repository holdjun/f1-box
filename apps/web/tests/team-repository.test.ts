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
    { year: 2026, chassis: "SF-26", engines: "067/6", tyres: "Pirelli" },
    { year: 1979, chassis: "312T3,312T4", engines: "015", tyres: "Michelin" },
    { year: 1950, chassis: null, engines: null, tyres: null },
  ],
  "grand_prix gp": [
    { year: 2026, round: 1, code: "AUS", name: "Australian Grand Prix" },
    { year: 2026, round: 2, code: "CHN", name: "Chinese Grand Prix" },
    { year: 1979, round: 1, code: "ARG", name: "Argentine Grand Prix" },
    { year: 1950, round: 1, code: "GBR", name: "British Grand Prix" },
  ],
  "test_driver = 0": [
    { year: 2026, id: "charles-leclerc", name: "Charles Leclerc", alpha2_code: "MC" },
    { year: 2026, id: "lewis-hamilton", name: "Lewis Hamilton", alpha2_code: "GB" },
    { year: 1979, id: "jody-scheckter", name: "Jody Scheckter", alpha2_code: "ZA" },
    { year: 1951, id: "alberto-ascari", name: "Alberto Ascari", alpha2_code: "IT" },
  ],
  "race_result rr": [
    { year: 2026, round: 1, driver_id: "charles-leclerc", position_text: "1", pole_position: 1 },
    { year: 2026, round: 1, driver_id: "lewis-hamilton", position_text: "Ret", pole_position: 0 },
    { year: 2026, round: 2, driver_id: "charles-leclerc", position_text: "4", pole_position: 0 },
    { year: 1979, round: 1, driver_id: "jody-scheckter", position_text: "1", pole_position: 0 },
  ],
  "fastest_lap fl": [
    { year: 2026, round: 1, driver_id: "charles-leclerc" },
  ],
  "season_constructor_standing": [
    { year: 2026, position_text: "2", points: 307, championship_won: 0 },
    { year: 1979, position_text: "1", points: 113, championship_won: 1 },
    { year: 2000, position_text: "1", points: 180, championship_won: 1 },
  ],
});

describe("createTeamRepository with database", () => {
  it("merges identity and season meta", async () => {
    const team = await createTeamRepository(db).getTeam("ferrari");
    expect(team?.fullName).toBe("Scuderia Ferrari");
    expect(team?.alpha2Code).toBe("IT");
    expect(team?.totals.championships).toBe(16);
    expect(team?.seasons.map((s) => s.year)).toEqual([2026, 1979, 1950]);
  });

  it("builds the per-round result matrix per driver", async () => {
    const team = await createTeamRepository(db).getTeam("ferrari");
    const byYear = Object.fromEntries(team!.seasons.map((s) => [s.year, s]));

    const [leclerc, hamilton] = byYear[2026].drivers;
    expect(leclerc).toMatchObject({ name: "Charles Leclerc", flagCode: "MC" });
    expect(leclerc.results[0]).toEqual({ text: "1", pole: true, fastest: true });
    expect(leclerc.results[1]).toEqual({ text: "4", pole: false, fastest: false });
    expect(hamilton.results[0]).toEqual({ text: "Ret", pole: false, fastest: false });
    expect(hamilton.results[1]).toBeNull();

    expect(byYear[2026].rounds.map((r) => r.code)).toEqual(["AUS", "CHN"]);
    expect(byYear[2026].chassis).toEqual(["SF-26"]);
    expect(byYear[2026].tyres).toEqual(["P"]);
    expect(byYear[1979].chassis).toEqual(["312T3", "312T4"]);
    expect(byYear[1979].tyres).toEqual(["M"]);
    expect(byYear[1950].chassis).toEqual([]);
    expect(byYear[1950].drivers).toEqual([]);
  });

  it("attaches standings and flags championship seasons", async () => {
    const team = await createTeamRepository(db).getTeam("ferrari");
    const byYear = Object.fromEntries(team!.seasons.map((s) => [s.year, s]));
    expect(byYear[2026]).toMatchObject({
      points: 307,
      position: "2",
      championshipWon: false,
    });
    expect(byYear[1979]).toMatchObject({
      points: 113,
      position: "1",
      championshipWon: true,
    });
    expect(byYear[1950].points).toBeNull();
    // 2000 有积分榜但没有参赛行（fake 数据），不应出现
    expect(byYear[2000]).toBeUndefined();
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
    expect(team?.seasons.at(-1)?.year).toBe(1950);
    const current = team?.seasons[0];
    expect(current?.rounds).toHaveLength(22);
    expect(current?.drivers.map((d) => d.name)).toContain("Charles Leclerc");
  });

  it("returns null for other teams", async () => {
    await expect(createTeamRepository().getTeam("mercedes")).resolves.toBeNull();
  });
});
