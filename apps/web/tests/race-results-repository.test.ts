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
