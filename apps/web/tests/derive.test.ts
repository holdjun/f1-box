import { describe, expect, test } from "vitest";

import seasonFixture from "@f1-box/contracts/fixtures/season-2026.json";

import { parseSeasonPayload } from "@f1-box/contracts/season";

import {
  driverGrid,
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
});

describe("driverSeries", () => {
  test("returns a finishing position per completed round", () => {
    const code = season.driverStandings[0].code;
    const series = driverSeries(season, code);
    expect(series).toHaveLength(completedCount);
    expect(series.every((point) => point.value >= 1)).toBe(true);
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
