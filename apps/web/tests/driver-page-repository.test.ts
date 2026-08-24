import { describe, expect, it } from "vitest";

import {
  createDriverRepository,
  type DriverDatabase,
  type DriverSeason,
  mergeNumberStints,
  mergeTeamStints,
} from "../src/lib/driver-repository.js";

// 键序即匹配优先级：与 driver-repository 的 11 条 SQL 特征子串对应
function fakeDb(responses: Record<string, unknown[]>): DriverDatabase {
  const find = (sql: string) => {
    const key = Object.keys(responses).find((marker) => sql.includes(marker));
    return { results: key ? responses[key] : [] };
  };
  return {
    batch(statements) {
      return Promise.resolve(statements.map((s) => find(s.sql)));
    },
  };
}

const IDENTITY = "co.id = d.nationality_country_id";
// 两个查询都含 rd.type = 'RACE_RESULT'，键序决定匹配优先级：LAST_NUMBER 在前
const LAST_NUMBER = "LIMIT 1";
const NUMBERS = "rd.type = 'RACE_RESULT'";
const ROUNDS = "gp.abbreviation AS code";
const TEAMS = "GROUP BY ra.year, rr.constructor_id";
const TEAMMATE_RESULTS = "rr.driver_id <> ?1";
const RESULTS = "ORDER BY rr.position_display_order";
const TEAMMATE_SPRINT = "srr.driver_id <> ?1";
const SPRINT_RANK = "srr.position_number IS NOT NULL";
const STANDINGS = "season_driver_standing";
const GP_STATS = "position_text = 'DNF'";
const SPRINT_STATS = "SUM(srr.points)";
const SPRINT_POLES = "sprint_starting_grid_position";
const MAX_SEASON = "MAX(year) AS year FROM season";

describe("mergeNumberStints", () => {
  it("merges consecutive same-number years into a range", () => {
    expect(
      mergeNumberStints([
        { year: 2015, driver_number: "33" },
        { year: 2016, driver_number: "33" },
        { year: 2017, driver_number: "33" },
      ]),
    ).toEqual([{ number: "33", yearFrom: 2015, yearTo: 2017 }]);
  });

  it("splits on a gap even with the same number", () => {
    expect(
      mergeNumberStints([
        { year: 2015, driver_number: "33" },
        { year: 2017, driver_number: "33" },
      ]),
    ).toEqual([
      { number: "33", yearFrom: 2015, yearTo: 2015 },
      { number: "33", yearFrom: 2017, yearTo: 2017 },
    ]);
  });

  it("keeps same-year multi numbers as separate single-year stints", () => {
    expect(
      mergeNumberStints([
        { year: 2005, driver_number: "17" },
        { year: 2005, driver_number: "18" },
      ]),
    ).toEqual([
      { number: "17", yearFrom: 2005, yearTo: 2005 },
      { number: "18", yearFrom: 2005, yearTo: 2005 },
    ]);
  });
});

describe("mergeTeamStints", () => {
  // teams 元组第三个元素可选：最后参赛轮次（缺省 1）
  const season = (
    year: number,
    teams: [string, string, number?][],
  ): DriverSeason => ({
    year,
    rounds: [],
    teams: teams.map(([id, name, lastRound = 1]) => ({
      id,
      name,
      lastRound,
      results: [],
      teammates: [],
    })),
    points: null,
    position: null,
    championshipWon: false,
  });

  it("merges consecutive same-team years into a range", () => {
    expect(
      mergeTeamStints([
        season(2013, [["mclaren", "McLaren"]]),
        season(2012, [["mclaren", "McLaren"]]),
        season(2011, [["mclaren", "McLaren"]]),
      ]),
    ).toEqual([
      { id: "mclaren", name: "McLaren", yearFrom: 2011, yearTo: 2013 },
    ]);
  });

  it("splits on a team change and on a return", () => {
    expect(
      mergeTeamStints([
        season(2026, [["ferrari", "Ferrari"]]),
        season(2025, [["ferrari", "Ferrari"]]),
        season(2013, [["mclaren", "McLaren"]]),
      ]),
    ).toEqual([
      { id: "mclaren", name: "McLaren", yearFrom: 2013, yearTo: 2013 },
      { id: "ferrari", name: "Ferrari", yearFrom: 2025, yearTo: 2026 },
    ]);
  });

  it("keeps both teams of a mid-season transfer", () => {
    expect(
      mergeTeamStints([
        season(2018, [["renault", "Renault", 21]]),
        // 矩阵序：换队后的 Renault 在上（lastRound 21 > 4）；stint 应还原时间序
        season(2017, [
          ["renault", "Renault", 21],
          ["toro-rosso", "Toro Rosso", 4],
        ]),
      ]),
    ).toEqual([
      { id: "toro-rosso", name: "Toro Rosso", yearFrom: 2017, yearTo: 2017 },
      { id: "renault", name: "Renault", yearFrom: 2017, yearTo: 2018 },
    ]);
  });
});

describe("createDriverRepository with database", () => {
  const base = {
    [IDENTITY]: [
      {
        id: "test-driver",
        name: "Test Driver",
        full_name: "Test A. Driver",
        country_name: "United Kingdom",
        alpha2_code: "GB",
        date_of_birth: "1990-01-01",
        date_of_death: null,
        place_of_birth: "London",
        permanent_number: "7",
        entries: 100,
        starts: 99,
        wins: 5,
        podiums: 20,
        poles: 6,
        fastest_laps: 7,
        points: 500,
        sprint_wins: 1,
        championships: 1,
        best_position: 1,
      },
    ],
    // 键序即匹配优先级：LAST_NUMBER 在 NUMBERS 之前，避免 lastNumberSql 被误匹配
    [LAST_NUMBER]: [{ driver_number: "7" }],
    [NUMBERS]: [{ year: 2017, driver_number: "7" }],
    [ROUNDS]: [
      {
        year: 2017,
        round: 1,
        code: "AUS",
        name: "Australia",
        circuit_id: "melbourne",
      },
      {
        year: 2017,
        round: 2,
        code: "CHN",
        name: "China",
        circuit_id: "shanghai",
      },
      {
        year: 2017,
        round: 3,
        code: "BHR",
        name: "Bahrain",
        circuit_id: "sakhir",
      },
      {
        year: 2017,
        round: 4,
        code: "RUS",
        name: "Russia",
        circuit_id: "sochi",
      },
    ],
    [TEAMS]: [
      // SQL 已按 last_round 降序返回：换队后的 Renault 在前
      { year: 2017, id: "renault", name: "Renault", last_round: 4 },
      { year: 2017, id: "toro-rosso", name: "Toro Rosso", last_round: 2 },
    ],
    [TEAMMATE_RESULTS]: [
      {
        year: 2017,
        round: 1,
        driver_id: "teammate-a",
        name: "Teammate A",
        alpha2_code: "FR",
        constructor_id: "toro-rosso",
        position_text: "5",
        pole_position: 0,
        fastest_lap: 0,
        reason_retired: null,
        position_number: 5,
      },
      {
        year: 2017,
        round: 2,
        driver_id: "teammate-a",
        name: "Teammate A",
        alpha2_code: "FR",
        constructor_id: "toro-rosso",
        position_text: "6",
        pole_position: 0,
        fastest_lap: 0,
        reason_retired: null,
        position_number: 6,
      },
      {
        year: 2017,
        round: 3,
        driver_id: "teammate-b",
        name: "Teammate B",
        alpha2_code: "DE",
        constructor_id: "renault",
        position_text: "8",
        pole_position: 0,
        fastest_lap: 0,
        reason_retired: null,
        position_number: 8,
      },
      {
        year: 2017,
        round: 4,
        driver_id: "teammate-b",
        name: "Teammate B",
        alpha2_code: "DE",
        constructor_id: "renault",
        position_text: "11",
        pole_position: 0,
        fastest_lap: 0,
        reason_retired: null,
        position_number: 11,
      },
    ],
    [RESULTS]: [
      {
        year: 2017,
        round: 1,
        constructor_id: "toro-rosso",
        position_text: "9",
        pole_position: 0,
        fastest_lap: 0,
        reason_retired: null,
        position_number: 9,
      },
      {
        year: 2017,
        round: 2,
        constructor_id: "toro-rosso",
        position_text: "10",
        pole_position: 0,
        fastest_lap: 0,
        reason_retired: null,
        position_number: 10,
      },
      {
        year: 2017,
        round: 3,
        constructor_id: "renault",
        position_text: "7",
        pole_position: 1,
        fastest_lap: 0,
        reason_retired: null,
        position_number: 7,
      },
      {
        year: 2017,
        round: 4,
        constructor_id: "renault",
        position_text: "DNF",
        pole_position: 0,
        fastest_lap: 1,
        reason_retired: "Engine",
        position_number: null,
      },
    ],
    [TEAMMATE_SPRINT]: [],
    [SPRINT_RANK]: [],
    [STANDINGS]: [
      { year: 2017, position_text: "10", points: 54, championship_won: 0 },
    ],
    [GP_STATS]: [],
    [SPRINT_STATS]: [],
    [SPRINT_POLES]: [],
    [MAX_SEASON]: [{ year: 2026 }],
  };

  it("maps identity, totals and bio fields", async () => {
    const driver = await createDriverRepository(fakeDb(base)).getDriver(
      "test-driver",
    );
    expect(driver).toMatchObject({
      id: "test-driver",
      fullName: "Test A. Driver",
      countryName: "United Kingdom",
      alpha2Code: "GB",
      dateOfBirth: "1990-01-01",
      dateOfDeath: null,
      placeOfBirth: "London",
      permanentNumber: "7",
      lastNumber: "7",
      activeSeason: 2026,
    });
    expect(driver?.totals).toMatchObject({
      entries: 100,
      wins: 5,
      championships: 1,
      bestChampionshipPosition: 1,
    });
  });

  it("falls back to the last race number when there is no permanent number", async () => {
    const driver = await createDriverRepository(
      fakeDb({
        ...base,
        [IDENTITY]: [{ ...base[IDENTITY][0], permanent_number: null }],
        [LAST_NUMBER]: [{ driver_number: "42" }],
      }),
    ).getDriver("test-driver");
    expect(driver).toMatchObject({ permanentNumber: null, lastNumber: "42" });
  });

  it("returns null lastNumber for a driver without race results", async () => {
    const driver = await createDriverRepository(
      fakeDb({ ...base, [LAST_NUMBER]: [] }),
    ).getDriver("test-driver");
    expect(driver).toMatchObject({ lastNumber: null });
  });

  it("orders team blocks by the team's last round descending", async () => {
    let sql = "";
    const db: DriverDatabase = {
      batch(statements) {
        sql = statements.find((s) => s.sql.includes(TEAMS))?.sql ?? "";
        return Promise.resolve(statements.map(() => ({ results: [] })));
      },
    };

    await createDriverRepository(db).getDriver("test-driver");
    expect(sql).toContain("MAX(ra.round) AS last_round");
    expect(sql).toContain("ORDER BY ra.year DESC, last_round DESC");
  });

  it("derives teammates from raced stints, not entrant rows", async () => {
    const captured: string[] = [];
    const db: DriverDatabase = {
      batch(statements) {
        captured.push(...statements.map((s) => s.sql));
        return Promise.resolve(statements.map(() => ({ results: [] })));
      },
    };

    await createDriverRepository(db).getDriver("test-driver");
    // 正式阵容行缺失的替补（如 Bearman 2024）也要有队友：门槛改用实际参赛 stint
    const teammates = captured.find((sql) =>
      sql.includes("rr.driver_id <> ?1"),
    );
    expect(teammates).not.toContain("season_entrant_driver");
    expect(teammates).toContain("WITH stint");
    const sprint = captured.find((sql) => sql.includes("srr.driver_id <> ?1"));
    expect(sprint).not.toContain("season_entrant_driver");
    expect(sprint).toContain("WITH stint");
  });

  it("splits a mid-season transfer into two team rows with aligned cells", async () => {
    const driver = await createDriverRepository(fakeDb(base)).getDriver(
      "test-driver",
    );
    const season = driver?.seasons[0];
    expect(season?.year).toBe(2017);
    // 车队块按最后参赛轮次降序：换队后的 Renault 在 Toro Rosso 之上
    expect(season?.teams.map((t) => t.name)).toEqual(["Renault", "Toro Rosso"]);
    expect(season?.teams[0].results.map((c) => c?.text ?? null)).toEqual([
      null,
      null,
      "7",
      "DNF",
    ]);
    expect(season?.teams[1].results.map((c) => c?.text ?? null)).toEqual([
      "9",
      "10",
      null,
      null,
    ]);
    // pole / fastest / classified（DNF 但有 position_number 才算）标记
    expect(season?.teams[0].results[2]?.pole).toBe(true);
    expect(season?.teams[0].results[3]?.fastest).toBe(true);
    expect(season?.teams[0].results[3]?.classified).toBe(false);
    // standings 落位
    expect(season?.position).toBe("10");
    expect(season?.points).toBe(54);
  });

  it("groups teammates under each team", async () => {
    const driver = await createDriverRepository(fakeDb(base)).getDriver(
      "test-driver",
    );
    const season = driver?.seasons[0];
    expect(season?.teams.map((t) => t.teammates.map((m) => m.name))).toEqual([
      ["Teammate B"],
      ["Teammate A"],
    ]);
    expect(season?.teams[0].teammates[0]).toMatchObject({
      id: "teammate-b",
      flagCode: "de",
    });
    // 队友只在自己参赛的站有结果，矩阵与 rounds 对齐
    expect(
      season?.teams[0].teammates[0].results.map((c) => c?.text ?? null),
    ).toEqual([null, null, "8", "11"]);
    expect(
      season?.teams[1].teammates[0].results.map((c) => c?.text ?? null),
    ).toEqual(["5", "6", null, null]);
  });

  it("exposes retired gating data (latest season older than active season)", async () => {
    const driver = await createDriverRepository(fakeDb(base)).getDriver(
      "test-driver",
    );
    expect(driver?.currentSeason?.year).toBe(2017);
    expect(driver?.activeSeason).toBe(2026);
  });

  it("returns null for an unknown driver", async () => {
    const db = fakeDb({ ...base, [IDENTITY]: [] });
    await expect(
      createDriverRepository(db).getDriver("nobody"),
    ).resolves.toBeNull();
  });

  it("rejects a malformed identity row", async () => {
    const db = fakeDb({ ...base, [IDENTITY]: [{ id: "x", name: 42 }] });
    await expect(createDriverRepository(db).getDriver("x")).rejects.toThrow(
      /Invalid row data/,
    );
  });

  it("derives number stints only from the fixed-number era, in round order", async () => {
    // 1974 前车号按站分配无身份意义；年内按最早轮次排序，换号续接才正确
    let captured: string[] = [];
    const db: DriverDatabase = {
      batch(statements) {
        captured = statements.map((s) => s.sql);
        return Promise.resolve(statements.map(() => ({ results: [] })));
      },
    };
    await createDriverRepository(db).getDriver("any");
    const numbers = captured.find((sql) =>
      sql.includes("GROUP BY ra.year, rd.driver_number"),
    );
    expect(numbers).toContain("ra.year >= 1974");
    expect(numbers).toContain("MIN(ra.round)");
  });
});

describe("driver fixtures", () => {
  it("serves russell with a single number stint and a current season", async () => {
    const driver = await createDriverRepository().getDriver("george-russell");
    expect(driver?.permanentNumber).toBe("63");
    expect(driver?.dateOfBirth).toBe("1998-02-15");
    expect(driver?.numberStints).toEqual([
      { number: "63", yearFrom: 2019, yearTo: 2026 },
    ]);
    expect(driver?.teamStints).toEqual([
      { id: "williams", name: "Williams", yearFrom: 2019, yearTo: 2019 },
      // 2020 萨基尔代打一场 Mercedes，属真实参赛记录；时间序在 Williams 收尾站之前
      { id: "mercedes", name: "Mercedes", yearFrom: 2020, yearTo: 2020 },
      { id: "williams", name: "Williams", yearFrom: 2020, yearTo: 2021 },
      { id: "mercedes", name: "Mercedes", yearFrom: 2022, yearTo: 2026 },
    ]);
    expect(driver?.currentSeason?.year).toBe(driver?.activeSeason);
  });

  it("serves verstappen with three number stints and champion seasons", async () => {
    const driver = await createDriverRepository().getDriver("max-verstappen");
    expect(driver?.numberStints).toEqual([
      { number: "33", yearFrom: 2015, yearTo: 2021 },
      { number: "1", yearFrom: 2022, yearTo: 2025 },
      { number: "3", yearFrom: 2026, yearTo: 2026 },
    ]);
    expect(
      driver?.seasons.filter((s) => s.championshipWon).length,
    ).toBeGreaterThanOrEqual(4);
    // 2016 季中转队：chips 按时间序，先效力的 Toro Rosso 在前
    expect(driver?.teamStints).toEqual([
      { id: "toro-rosso", name: "Toro Rosso", yearFrom: 2015, yearTo: 2016 },
      { id: "red-bull", name: "Red Bull", yearFrom: 2016, yearTo: 2026 },
    ]);
  });

  it("returns null for slugs without a fixture", async () => {
    await expect(
      createDriverRepository().getDriver("lewis-hamilton"),
    ).resolves.toBeNull();
  });
});
