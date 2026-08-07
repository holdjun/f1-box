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

// 键的顺序即匹配优先级：统计查询的标记必须先于 resultsSql 的 "race_result rr"
const db = fakeDb({
  "FROM constructor": [identityRow],
  "GROUP BY sec.year": [
    { year: 2026, chassis: "SF-26", engines: "067/6", power_units: "Ferrari", tyres: "Pirelli" },
    { year: 1979, chassis: "312T3,312T4", engines: "015", power_units: "Ferrari", tyres: "Michelin" },
    { year: 1950, chassis: null, engines: null, power_units: "Ferrari", tyres: null },
  ],
  "grand_prix gp": [
    { year: 2026, round: 1, code: "AUS", name: "Australian Grand Prix", circuit_id: "albert-park" },
    { year: 2026, round: 2, code: "CHN", name: "Chinese Grand Prix", circuit_id: "shanghai" },
    { year: 1979, round: 1, code: "ARG", name: "Argentine Grand Prix", circuit_id: "buenos-aires" },
    { year: 1950, round: 1, code: "GBR", name: "British Grand Prix", circuit_id: "silverstone" },
    { year: 2026, round: 3, code: "JPN", name: "Japanese Grand Prix", circuit_id: "suzuka", date: "2099-01-01" },
  ],
  "MIN(year)": [{ first_entry: 1950 }],
  "position_text = 'Ret'": [
    { races: 2, points: 87, wins: 1, podiums: 2, poles: 0, top10s: 2, fastest_laps: 1, dnfs: 0 },
  ],
  "sprint_starting_grid_position": [
    { races: 1, points: 10, wins: 0, podiums: 1, poles: 1, top10s: 2 },
  ],
  "sprint_race_result srr": [
    { year: 2026, round: 1, driver_id: "lewis-hamilton", position_number: 3 },
  ],
  "UNION": [
    { year: 2026, id: "charles-leclerc", name: "Charles Leclerc", alpha2_code: "MC" },
    { year: 2026, id: "lewis-hamilton", name: "Lewis Hamilton", alpha2_code: "GB" },
    { year: 1979, id: "jody-scheckter", name: "Jody Scheckter", alpha2_code: "ZA" },
    { year: 1951, id: "alberto-ascari", name: "Alberto Ascari", alpha2_code: "IT" },
  ],
  "race_result rr": [
    { year: 2026, round: 1, driver_id: "charles-leclerc", position_text: "1", pole_position: 1, fastest_lap: 1, reason_retired: null, position_number: 1 },
    { year: 2026, round: 1, driver_id: "lewis-hamilton", position_text: "Ret", pole_position: 0, fastest_lap: 0, reason_retired: "Engine", position_number: null },
    { year: 2026, round: 2, driver_id: "charles-leclerc", position_text: "4", pole_position: 0, fastest_lap: 0, reason_retired: "Collision", position_number: 4 },
    { year: 1979, round: 1, driver_id: "jody-scheckter", position_text: "1", pole_position: 0, fastest_lap: 0, reason_retired: null, position_number: 1 },
  ],
  "season_constructor_standing": [
    { year: 2026, position_text: "2", points: 307, championship_won: 0 },
    { year: 1979, position_text: "1", points: 113, championship_won: 1 },
    { year: 2000, position_text: "1", points: 180, championship_won: 1 },
  ],
});

describe("createTeamRepository with database", () => {
  it("merges identity, first entry and season meta", async () => {
    const team = await createTeamRepository(db).getTeam("ferrari");
    expect(team?.fullName).toBe("Scuderia Ferrari");
    expect(team?.alpha2Code).toBe("IT");
    expect(team?.firstEntry).toBe(1950);
    expect(team?.totals.championships).toBe(16);
    expect(team?.seasons.map((s) => s.year)).toEqual([2026, 1979, 1950]);
  });

  it("builds the per-round result matrix with markers", async () => {
    const team = await createTeamRepository(db).getTeam("ferrari");
    const byYear = Object.fromEntries(team!.seasons.map((s) => [s.year, s]));

    const [leclerc, hamilton] = byYear[2026].drivers;
    expect(leclerc.results[0]).toEqual({
      text: "1",
      pole: true,
      fastest: true,
      classified: false,
      sprintRank: null,
    });
    // 未完赛但有排名 → †
    expect(leclerc.results[1]).toMatchObject({ text: "4", classified: true });
    // 退赛无排名不标 †；冲刺赛排名挂上标
    expect(hamilton.results[0]).toMatchObject({
      text: "Ret",
      classified: false,
      sprintRank: 3,
    });
    expect(hamilton.results[1]).toBeNull();

    expect(byYear[2026].powerUnits).toEqual(["Ferrari"]);
    expect(byYear[2026].tyres).toEqual(["P"]);
    expect(byYear[1979].chassis).toEqual(["312T3", "312T4"]);
    expect(byYear[1979].tyres).toEqual(["M"]);
    expect(byYear[1950].chassis).toEqual([]);
  });

  it("computes the current season stats blocks", async () => {
    const team = await createTeamRepository(db).getTeam("ferrari");
    expect(team?.currentSeason).toMatchObject({
      year: 2026,
      position: "2",
      points: 307,
      grandPrix: { races: 2, points: 87, wins: 1, podiums: 2, fastestLaps: 1, dnfs: 0 },
      sprint: { races: 1, points: 10, poles: 1 },
    });
  });

  it("attaches standings and flags championship seasons", async () => {
    const team = await createTeamRepository(db).getTeam("ferrari");
    const byYear = Object.fromEntries(team!.seasons.map((s) => [s.year, s]));
    expect(byYear[1979]).toMatchObject({ position: "1", championshipWon: true });
    expect(byYear[1950].points).toBeNull();
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
    expect(team?.firstEntry).toBe(1950);
    expect(team?.seasons).toHaveLength(77);
    expect(team?.seasons.filter((s) => s.championshipWon)).toHaveLength(16);
    expect(team?.seasons[0].year).toBe(2026);
    expect(team?.currentSeason?.grandPrix.points).toBe(268);
    expect(team?.currentSeason?.sprint.points).toBe(39);
    const current = team?.seasons[0];
    expect(current?.rounds).toHaveLength(11);
    expect(current?.drivers.map((d) => d.name)).toContain("Charles Leclerc");
  });

  it("returns null for other teams", async () => {
    await expect(createTeamRepository().getTeam("mercedes")).resolves.toBeNull();
  });
});
