import { describe, expect, it, vi } from "vitest";
import {
  constructorChampionshipYearsSql,
  constructorIdentitySql,
  constructorRefSql,
  constructorSummary,
  driverChampionshipYearsSql,
  driverIdentitySql,
  driverRefSql,
  driverSummary,
  raceResults,
  resolveDriver,
  seasonConstructorStandings,
  seasonDriverStandings,
} from "../src/lib/ask/tools.js";
import { createStaticAskDatabase, type AskDatabase } from "../src/lib/ask/db.js";

// 查询词刻意避开 f1-aliases.json 的中文键（如"汉密尔顿"），单测不依赖种子别名
const hamiltonRows = [
  {
    id: "lewis-hamilton",
    name: "Lewis Hamilton",
    full_name: "Lewis Carl Davidson Hamilton",
    country_name: "United Kingdom",
    entries: 380,
    starts: 378,
    wins: 105,
    podiums: 202,
    poles: 104,
    fastest_laps: 68,
    points: 4900.5,
    sprint_wins: 1,
    championships: 7,
    best_position: 1,
  },
];

function driverDb(): AskDatabase {
  return createStaticAskDatabase({
    [driverRefSql]: [{ id: "lewis-hamilton", name: "Lewis Hamilton" }],
    [driverIdentitySql]: hamiltonRows,
    [driverChampionshipYearsSql]: [
      { year: 2008 },
      { year: 2014 },
      { year: 2015 },
    ],
  });
}

describe("resolveDriver", () => {
  it("binds the query as a single parameter and reports ambiguity", async () => {
    const run = vi.fn(
      async (_sql: string, _values: readonly unknown[]) =>
        [
          { id: "michael-schumacher", name: "Michael Schumacher" },
          { id: "mick-schumacher", name: "Mick Schumacher" },
        ] as unknown[],
    );
    const db: AskDatabase = { run };
    const result = await resolveDriver(db, "Schumacher");
    expect(result.status).toBe("ambiguous");
    expect(run).toHaveBeenCalledOnce();
    const [sql, values] = run.mock.calls[0];
    expect(sql).toContain("SELECT id, name FROM driver");
    expect(values).toEqual(["Schumacher"]);
  });

  it("returns miss on empty rows", async () => {
    const db = createStaticAskDatabase({});
    expect(await resolveDriver(db, "无名")).toEqual({ status: "miss" });
  });
});

describe("driverSummary", () => {
  it("returns identity, totals, championship years and page path", async () => {
    const result = await driverSummary(driverDb(), "Hamilton");
    expect(result).toEqual({
      found: true,
      driver: {
        id: "lewis-hamilton",
        name: "Lewis Hamilton",
        fullName: "Lewis Carl Davidson Hamilton",
        country: "United Kingdom",
        championshipYears: [2008, 2014, 2015],
        entries: 380,
        starts: 378,
        wins: 105,
        podiums: 202,
        poles: 104,
        fastestLaps: 68,
        points: 4900.5,
        bestChampionshipPosition: 1,
      },
      pagePath: "/drivers/lewis-hamilton",
    });
  });

  it("returns not-found message on miss", async () => {
    const result = await driverSummary(createStaticAskDatabase({}), "x");
    expect(result).toEqual({
      found: false,
      message: "未找到匹配车手，可尝试英文全名",
    });
  });

  it("returns candidates on ambiguity", async () => {
    const db = createStaticAskDatabase({
      [driverRefSql]: [
        { id: "michael-schumacher", name: "Michael Schumacher" },
        { id: "mick-schumacher", name: "Mick Schumacher" },
      ],
    });
    const result = await driverSummary(db, "Schumacher");
    expect(result).toEqual({
      found: false,
      candidates: [
        { id: "michael-schumacher", name: "Michael Schumacher" },
        { id: "mick-schumacher", name: "Mick Schumacher" },
      ],
      message: "匹配到多名车手，请用户确认是哪一位",
    });
  });
});

describe("constructorSummary", () => {
  it("returns totals with distinct championship years", async () => {
    const db = createStaticAskDatabase({
      [constructorRefSql]: [{ id: "ferrari", name: "Ferrari" }],
      [constructorIdentitySql]: [
        {
          id: "ferrari",
          name: "Ferrari",
          full_name: "Scuderia Ferrari",
          country_name: "Italy",
          entries: 1100,
          wins: 245,
          podiums: 800,
          poles: 250,
          fastest_laps: 260,
          points: 9000,
          championships: 16,
          best_position: 1,
        },
      ],
      [constructorChampionshipYearsSql]: [{ year: 2008 }],
    });
    const result = await constructorSummary(db, "ferrari");
    expect(result).toEqual({
      found: true,
      constructor: {
        id: "ferrari",
        name: "Ferrari",
        fullName: "Scuderia Ferrari",
        country: "Italy",
        championshipYears: [2008],
        entries: 1100,
        wins: 245,
        podiums: 800,
        poles: 250,
        fastestLaps: 260,
        points: 9000,
        bestChampionshipPosition: 1,
      },
      pagePath: "/teams/ferrari",
    });
  });
});

describe("seasonDriverStandings", () => {
  const yearCheckSql = "SELECT 1 AS ok FROM season WHERE year = ?1";
  const standingsSql = `
SELECT sds.position_number, sds.position_text, sds.points, sds.championship_won,
  d.id AS driver_id, d.name AS driver_name
FROM season_driver_standing sds
JOIN driver d ON d.id = sds.driver_id
WHERE sds.year = ?1
ORDER BY sds.position_display_order`;

  it("returns full standings with page paths", async () => {
    const db = createStaticAskDatabase({
      [yearCheckSql]: [{ ok: 1 }],
      [standingsSql]: [
        {
          position_number: 1,
          position_text: "1",
          points: 395.5,
          championship_won: 1,
          driver_id: "max-verstappen",
          driver_name: "Max Verstappen",
        },
        {
          position_number: 2,
          position_text: "2",
          points: 394.5,
          championship_won: 0,
          driver_id: "lewis-hamilton",
          driver_name: "Lewis Hamilton",
        },
      ],
    });
    expect(await seasonDriverStandings(db, 2021)).toEqual({
      year: 2021,
      standings: [
        {
          position: 1,
          driver: "Max Verstappen",
          driverId: "max-verstappen",
          points: 395.5,
          champion: true,
          pagePath: "/drivers/max-verstappen",
        },
        {
          position: 2,
          driver: "Lewis Hamilton",
          driverId: "lewis-hamilton",
          points: 394.5,
          champion: false,
          pagePath: "/drivers/lewis-hamilton",
        },
      ],
    });
  });

  it("returns miss for unknown year", async () => {
    const db = createStaticAskDatabase({});
    expect(await seasonDriverStandings(db, 1949)).toEqual({
      found: false,
      message: "没有该年份的赛季数据",
    });
  });
});

describe("seasonConstructorStandings", () => {
  const constructorStandingsSql = `
SELECT scs.position_text, scs.points, scs.championship_won,
  c.id AS constructor_id, c.name AS constructor_name
FROM season_constructor_standing scs
JOIN constructor c ON c.id = scs.constructor_id
WHERE scs.year = ?1
ORDER BY scs.position_display_order`;

  it("merges engine-variant rows of one constructor", async () => {
    const db = createStaticAskDatabase({
      "SELECT 1 AS ok FROM season WHERE year = ?1": [{ ok: 1 }],
      [constructorStandingsSql]: [
        {
          position_text: "1",
          points: 48,
          championship_won: 1,
          constructor_id: "vanwall",
          constructor_name: "Vanwall",
        },
        {
          position_text: "5",
          points: 8,
          championship_won: 0,
          constructor_id: "vanwall",
          constructor_name: "Vanwall",
        },
      ],
    });
    expect(await seasonConstructorStandings(db, 1958)).toEqual({
      year: 1958,
      standings: [
        {
          position: 1,
          team: "Vanwall",
          teamId: "vanwall",
          points: 56,
          champion: true,
          pagePath: "/teams/vanwall",
        },
      ],
    });
  });
});

describe("raceResults", () => {
  const gpRefSql = `
SELECT id, name FROM grand_prix
WHERE id = ?1 COLLATE NOCASE OR name = ?1 COLLATE NOCASE
   OR abbreviation = UPPER(?1) OR full_name = ?1 COLLATE NOCASE
   OR (instr(lower(name), lower(?1)) > 0 AND length(?1) >= 3)
ORDER BY (CASE WHEN name = ?1 COLLATE NOCASE THEN 0 ELSE 1 END), name
LIMIT 6`;
  const raceMetaSql = `
SELECT ra.year, ra.round, ra.date, gp.name AS grand_prix_name
FROM race ra
JOIN grand_prix gp ON gp.id = ra.grand_prix_id
WHERE ra.year = ?1 AND ra.grand_prix_id = ?2`;
  const resultRowsSql = `
SELECT rr.position_number, rr.position_text, rr.time, rr.reason_retired, rr.points,
  d.id AS driver_id, d.name AS driver_name, ct.id AS constructor_id, ct.name AS constructor_name
FROM race_result rr
JOIN driver d ON d.id = rr.driver_id
JOIN constructor ct ON ct.id = rr.constructor_id
WHERE rr.race_id = ?1
ORDER BY rr.position_display_order`;

  it("returns race meta and full result rows", async () => {
    const db = createStaticAskDatabase({
      [gpRefSql]: [{ id: "monaco", name: "Monaco" }],
      [raceMetaSql]: [
        { year: 2024, round: 8, date: "2024-05-26", grand_prix_name: "Monaco" },
      ],
      "SELECT id FROM race WHERE year = ?1 AND grand_prix_id = ?2": [
        { id: 1108 },
      ],
      [resultRowsSql]: [
        {
          position_number: 1,
          position_text: "1",
          time: "1:44:01.014",
          reason_retired: null,
          points: 25,
          driver_id: "charles-leclerc",
          driver_name: "Charles Leclerc",
          constructor_id: "ferrari",
          constructor_name: "Ferrari",
        },
        {
          position_number: null,
          position_text: "DNF",
          time: null,
          reason_retired: "Collision",
          points: null,
          driver_id: "sergio-perez",
          driver_name: "Sergio Pérez",
          constructor_id: "red-bull",
          constructor_name: "Red Bull",
        },
      ],
    });
    expect(await raceResults(db, 2024, "摩纳哥")).toEqual({
      year: 2024,
      round: 8,
      grandPrix: "Monaco",
      date: "2024-05-26",
      results: [
        {
          position: 1,
          driver: "Charles Leclerc",
          driverId: "charles-leclerc",
          team: "Ferrari",
          points: 25,
          status: "1:44:01.014",
          pagePath: "/drivers/charles-leclerc",
        },
        {
          position: null,
          driver: "Sergio Pérez",
          driverId: "sergio-perez",
          team: "Red Bull",
          points: 0,
          status: "DNF（Collision）",
          pagePath: "/drivers/sergio-perez",
        },
      ],
    });
  });

  it("returns miss when gp unknown", async () => {
    const db = createStaticAskDatabase({});
    expect(await raceResults(db, 2024, "无名站")).toEqual({
      found: false,
      message: "未找到匹配的大奖赛，可尝试英文名",
    });
  });

  it("returns miss when gp not held that year", async () => {
    const db = createStaticAskDatabase({
      [gpRefSql]: [{ id: "monaco", name: "Monaco" }],
    });
    expect(await raceResults(db, 1958, "monaco")).toEqual({
      found: false,
      message: "该年份未举办此大奖赛",
    });
  });
});
