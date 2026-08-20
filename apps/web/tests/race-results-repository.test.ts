import { describe, expect, it } from "vitest";

import {
  createRaceResultsRepository,
  formatAvgSpeedKph,
  formatSeconds,
  type RaceResultsDatabase,
} from "../src/lib/race-results-repository.js";

// 按 SQL 片段分发结果；未登记的语句直接抛错，暴露意外的查询
function fakeDbBySql(rowsBySqlFragment: Record<string, unknown[]>): RaceResultsDatabase {
  return {
    batch(statements) {
      return Promise.resolve(
        statements.map(({ sql }) => {
          const match = Object.entries(rowsBySqlFragment).find(([fragment]) =>
            sql.includes(fragment),
          );
          if (!match) throw new Error(`Unexpected SQL: ${sql}`);
          return { results: match[1] };
        }),
      );
    },
  };
}

describe("createRaceResultsRepository getSeasonCalendar / listRaces", () => {
  it("maps a completed race with winner and pole", async () => {
    const db = fakeDbBySql({
      circuit_place: [{
        round: 1, slug: "australia", name: "Australia", race_name: "Australian Grand Prix",
        alpha2_code: "AU", country_name: "Australia", date: "2026-03-08", time: "04:00",
        laps: 58, circuit_name: "Melbourne", circuit_place: "Melbourne",
        winner_name: "George Russell", winner_code: "RUS",
        winner_team_id: "mercedes", winner_team_name: "Mercedes",
        winner_time: "1:23:06.801", pole_name: "George Russell", pole_code: "RUS",
      }],
    });
    const rows = await createRaceResultsRepository(db).getSeasonCalendar(2026);
    expect(rows).toEqual([{
      round: 1, slug: "australia", name: "Australia", raceName: "Australian Grand Prix",
      alpha2Code: "AU", countryName: "Australia", date: "2026-03-08", time: "04:00",
      laps: 58, circuitName: "Melbourne", circuitPlace: "Melbourne",
      winnerName: "George Russell", winnerCode: "RUS",
      winnerTeamId: "mercedes", winnerTeamName: "Mercedes",
      winnerTime: "1:23:06.801", poleName: "George Russell", poleCode: "RUS",
    }]);
  });

  it("maps an upcoming race without winner row", async () => {
    const db = fakeDbBySql({
      circuit_place: [{
        round: 12, slug: "netherlands", name: "Netherlands", race_name: "Dutch Grand Prix",
        alpha2_code: "NL", country_name: "Netherlands", date: "2026-08-23", time: "13:00",
        laps: 72, circuit_name: "Zandvoort", circuit_place: "Zandvoort",
        winner_name: null, winner_code: null, winner_team_id: null,
        winner_team_name: null, winner_time: null, pole_name: null, pole_code: null,
      }],
    });
    const [row] = await createRaceResultsRepository(db).getSeasonCalendar(2026);
    expect(row.winnerName).toBeNull();
    expect(row.poleName).toBeNull();
  });

  it("DEV fixture calendar has 22 rounds, list only completed", async () => {
    const repository = createRaceResultsRepository();
    expect(await repository.getSeasonCalendar(2026)).toHaveLength(22);
    const completed = await repository.listRaces(2026);
    expect(completed).toHaveLength(11);
    expect(completed.every((race) => race.winnerName !== null)).toBe(true);
    expect(await repository.getSeasonCalendar(2025)).toEqual([]);
  });
});

describe("createRaceResultsRepository getSeasonYears", () => {
  it("reads season years from the season table", async () => {
    const db = fakeDbBySql({ "FROM season": [{ year: 2026 }, { year: 1950 }] });
    expect(await createRaceResultsRepository(db).getSeasonYears()).toEqual([2026, 1950]);
  });

  it("DEV fixture years are [2026]", async () => {
    expect(await createRaceResultsRepository().getSeasonYears()).toEqual([2026]);
  });
});

const metaRow = {
  year: 2026, round: 1, slug: "australia", name: "Australia",
  official_name: "Formula 1 Qatar Airways Australian Grand Prix 2026",
  date: "2026-03-08", time: "04:00", laps: 58, course_length: 5.278,
  circuit_name: "Melbourne", circuit_place: "Melbourne",
  country_name: "Australia", alpha2_code: "AU",
  free_practice_1_date: "2026-03-06", free_practice_1_time: "01:30",
  free_practice_2_date: "2026-03-06", free_practice_2_time: "05:00",
  free_practice_3_date: "2026-03-07", free_practice_3_time: "01:30",
  qualifying_date: "2026-03-07", qualifying_time: "05:00",
  sprint_qualifying_date: null, sprint_qualifying_time: null,
  sprint_race_date: null, sprint_race_time: null,
};

describe("createRaceResultsRepository getRacePage", () => {
  it("maps race meta, sessions and race result rows", async () => {
    const db = fakeDbBySql({
      circuit_name: [metaRow],
      "FROM race_result rr": [
        { position_number: 1, position_text: "1", driver_number: "63",
          driver_id: "george-russell", driver_name: "George Russell", driver_code: "RUS",
          constructor_id: "mercedes", constructor_name: "Mercedes", laps: 58,
          time: "1:23:06.801", reason_retired: null, gap: null, points: 25 },
        { position_number: null, position_text: "DNF", driver_number: "44",
          driver_id: "lewis-hamilton", driver_name: "Lewis Hamilton", driver_code: "HAM",
          constructor_id: "ferrari", constructor_name: "Ferrari", laps: 30,
          time: null, reason_retired: "Collision", gap: null, points: 0 },
      ],
    });
    const page = await createRaceResultsRepository(db).getRacePage(2026, "australia");
    expect(page?.meta.round).toBe(1);
    expect(page?.meta.sessions).toEqual([
      { key: "practice-1", label: "Practice 1", startsAtUtc: "2026-03-06T01:30:00Z" },
      { key: "practice-2", label: "Practice 2", startsAtUtc: "2026-03-06T05:00:00Z" },
      { key: "practice-3", label: "Practice 3", startsAtUtc: "2026-03-07T01:30:00Z" },
      { key: "qualifying", label: "Qualifying", startsAtUtc: "2026-03-07T05:00:00Z" },
      { key: "race", label: "Race", startsAtUtc: "2026-03-08T04:00:00Z" },
    ]);
    expect(page?.tabs.raceResult[0].driverName).toBe("George Russell");
    expect(page?.tabs.raceResult[1].time).toBeNull();
    expect(page?.tabs.raceResult[1].retiredReason).toBe("Collision");
  });

  it("returns null for unknown slug", async () => {
    const db = fakeDbBySql({ circuit_name: [], "FROM race_result rr": [] });
    expect(await createRaceResultsRepository(db).getRacePage(2026, "nope")).toBeNull();
  });

  it("DEV fixture serves only australia 2026", async () => {
    const repository = createRaceResultsRepository();
    expect(await repository.getRacePage(2026, "monaco")).toBeNull();
    const page = await repository.getRacePage(2026, "australia");
    expect(page?.meta.name).toBe("Australia");
    expect(page?.tabs.raceResult.length).toBeGreaterThan(0);
  });
});

describe("formatAvgSpeedKph", () => {
  it("computes km/h from course length and millis", () => {
    expect(formatAvgSpeedKph(5.278, 82091)).toBe("231.460");
    expect(formatAvgSpeedKph(5.278, null)).toBeNull();
    expect(formatAvgSpeedKph(5.278, 0)).toBeNull();
  });
});

describe("formatSeconds", () => {
  it("formats milliseconds as seconds with 3 decimals", () => {
    expect(formatSeconds(27733)).toBe("27.733");
    expect(formatSeconds(null)).toBeNull();
  });
});
