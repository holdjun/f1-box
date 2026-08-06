import { describe, expect, test } from "vitest";

import seasonFixture from "@f1-box/contracts/fixtures/season-2026.json";

import { parseSeasonPayload } from "@f1-box/contracts/season";

import {
  driverCareer,
  driverGrid,
  driverSeasonStats,
  driverSeries,
  teamGrid,
  teamSeries,
} from "../src/lib/derive.js";

const season = parseSeasonPayload(seasonFixture);
const completedCount = season.events.filter(
  (event) => event.raceClassification !== null,
).length;

describe("driverGrid", () => {
  test("maps every standing to a card with a team", () => {
    const grid = driverGrid(season);
    expect(grid).toHaveLength(season.driverStandings.length);
    expect(grid[0].name).toBe(season.driverStandings[0].name);
    expect(grid.every((card) => typeof card.team === "string")).toBe(true);
  });

  test("team comes from the latest completed race classification", () => {
    const grid = driverGrid(season);
    const latest = season.events
      .filter((event) => event.raceClassification !== null)
      .at(-1);
    const expectedTeam = latest?.raceClassification?.rows.find(
      (row) => row.driverCode === grid[0].code,
    )?.constructorName;
    expect(grid[0].team).toBe(expectedTeam);
  });
});

describe("driverSeries", () => {
  test("returns a finishing position per completed round", () => {
    const code = season.driverStandings[0].code;
    const series = driverSeries(season, code);
    expect(series).toHaveLength(completedCount);
    expect(series.every((point) => point.value >= 1)).toBe(true);
  });

  test("each point is the driver's finishing position in that round", () => {
    const code = season.driverStandings[0].code;
    const series = driverSeries(season, code);
    const first = season.events[0];
    const expected = first.raceClassification?.rows.find(
      (row) => row.driverCode === code,
    )?.position;
    expect(series[0].value).toBe(expected);
  });
});

describe("teamGrid", () => {
  test("maps every constructor standing with its drivers", () => {
    const grid = teamGrid(season);
    expect(grid).toHaveLength(season.constructorStandings.length);
    expect(grid[0].drivers.length).toBeGreaterThan(0);
  });
});

describe("teamSeries", () => {
  test("sums team points per completed round", () => {
    const series = teamSeries(season, "Mercedes");
    expect(series).toHaveLength(completedCount);
    expect(series.every((point) => Number.isFinite(point.value))).toBe(true);
  });
});

describe("driverSeasonStats", () => {
  test("aggregates the standings leader's season from classifications", () => {
    const code = season.driverStandings[0].code;
    const stats = driverSeasonStats(season, code);

    expect(stats).toMatchObject({
      position: season.driverStandings[0].position,
      points: season.driverStandings[0].points,
      wins: season.driverStandings[0].wins,
      races: completedCount,
    });

    const rows = season.events.flatMap(
      (event) =>
        event.raceClassification?.rows.filter((row) => row.driverCode === code) ?? [],
    );
    expect(stats?.podiums).toBe(rows.filter((row) => row.position <= 3).length);
    expect(stats?.top10s).toBe(rows.filter((row) => row.position <= 10).length);
    // BEA has 3 Retired rows and 5 Lapped rows in the fixture; Lapped must NOT count as DNF.
    const beaStats = driverSeasonStats(season, "BEA");
    expect(beaStats?.dnfs).toBe(3);
    // Semantic: Lapped rows are classified finishes, not DNFs.
    const beaRows = season.events.flatMap(
      (event) =>
        event.raceClassification?.rows.filter((row) => row.driverCode === "BEA") ?? [],
    );
    expect(beaRows.filter((row) => row.status === "Lapped").length).toBeGreaterThan(0);
    expect(beaStats?.dnfs).toBe(beaRows.filter((row) => row.status === "Retired" || row.status === "Did not start").length);
    expect(stats?.poles).toBe(
      season.events.filter(
        (event) =>
          event.qualifyingClassification?.rows.find(
            (row) => row.driverCode === code,
          )?.position === 1,
      ).length,
    );
  });

  test("counts fastest laps only when rank data exists", () => {
    const code = season.driverStandings[0].code;
    const stripped = parseSeasonPayload({
      ...seasonFixture,
      events: seasonFixture.events.map((event) =>
        event.raceClassification
          ? {
              ...event,
              raceClassification: {
                ...event.raceClassification,
                rows: event.raceClassification.rows.map(({ fastestLapRank, ...row }) => row),
              },
            }
          : event,
      ),
    });
    expect(driverSeasonStats(stripped, code)?.fastestLaps).toBeNull();
    expect(driverSeasonStats(season, code)?.fastestLaps).toBe(
      season.events.flatMap(
        (event) =>
          event.raceClassification?.rows.filter(
            (row) => row.driverCode === code && row.fastestLapRank === 1,
          ) ?? [],
      ).length,
    );
  });

  test("returns undefined for an unknown code", () => {
    expect(driverSeasonStats(season, "NOPE")).toBeUndefined();
  });
});

describe("driverCareer", () => {
  test("sums seasons and records one row per participated season", () => {
    const code = season.driverStandings[0].code;
    const career = driverCareer([season], code);
    const stats = driverSeasonStats(season, code);

    expect(career.seasons).toHaveLength(1);
    expect(career.seasons[0]).toMatchObject({
      year: 2026,
      position: stats?.position,
      points: stats?.points,
    });
    expect(career.points).toBe(stats?.points);
    expect(career.bestFinish).toBeGreaterThanOrEqual(1);
    expect(typeof career.seasons[0].team).toBe("string");
  });
});
