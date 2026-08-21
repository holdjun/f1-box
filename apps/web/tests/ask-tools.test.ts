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
  resolveDriver,
  type AskDatabase,
} from "../src/lib/ask/tools.js";
import { createStaticAskDatabase } from "../src/lib/ask/db.js";

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
      async () =>
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
