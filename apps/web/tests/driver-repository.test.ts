import { describe, expect, it } from "vitest";

import {
  createDriverRepository,
  type DriverDatabase,
} from "../src/lib/driver-repository.js";

function fakeDb(rows: unknown[]): DriverDatabase {
  return {
    batch(statements) {
      expect(statements).toHaveLength(1);
      const sql = statements[0].sql;
      // 最后车队以实际参赛末站为准，与详情页 hero 同口径
      expect(sql).toContain("ORDER BY ra2.year DESC, ra2.round DESC");
      expect(sql).toContain("test_driver = 0");
      expect(sql).toContain("total_points DESC");
      // 号码取最后参赛号码（现役即当前号码，如卫冕冠军的 1 号），永久车号兜底
      expect(sql).toContain("rd.driver_number AS last_number");
      expect(sql).toContain("COALESCE(lr.last_number, d.permanent_number)");
      return Promise.resolve([{ results: rows }]);
    },
  };
}

describe("createDriverRepository with database", () => {
  it("maps nullable number, team and flag fields", async () => {
    const db = fakeDb([
      {
        id: "george-russell",
        name: "George Russell",
        number: "63",
        alpha2_code: "GB",
        team_id: "mercedes",
        team_name: "Mercedes",
        is_current: 1,
      },
      {
        id: "ayrton-senna",
        name: "Ayrton Senna",
        number: "2",
        alpha2_code: "BR",
        team_id: "senna",
        team_name: "Senna",
        is_current: 0,
      },
      {
        id: "no-team-driver",
        name: "No Team Driver",
        number: null,
        alpha2_code: null,
        team_id: null,
        team_name: null,
        is_current: 0,
      },
    ]);

    const drivers = await createDriverRepository(db).getDrivers();
    expect(drivers).toEqual([
      {
        id: "george-russell",
        name: "George Russell",
        number: "63",
        flagCode: "gb",
        teamId: "mercedes",
        teamName: "Mercedes",
        isCurrent: true,
      },
      {
        id: "ayrton-senna",
        name: "Ayrton Senna",
        number: "2",
        flagCode: "br",
        teamId: "senna",
        teamName: "Senna",
        isCurrent: false,
      },
      {
        id: "no-team-driver",
        name: "No Team Driver",
        number: null,
        flagCode: null,
        teamId: null,
        teamName: null,
        isCurrent: false,
      },
    ]);
  });

  it("rejects malformed rows", async () => {
    const db = fakeDb([{ id: "x", name: 42 }]);
    await expect(createDriverRepository(db).getDrivers()).rejects.toThrow(
      /Invalid row data/,
    );
  });
});

describe("drivers fixture", () => {
  it("serves the curated catalog sorted by career points", async () => {
    const drivers = await createDriverRepository().getDrivers();
    expect(drivers.length).toBeGreaterThanOrEqual(30);

    const russell = drivers.find((d) => d.id === "george-russell");
    expect(russell).toMatchObject({
      number: "63",
      teamName: "Mercedes",
      flagCode: "gb",
      isCurrent: true,
    });

    // 号码=最后参赛号码（senna 1994 最后用 2 号）
    const senna = drivers.find((d) => d.id === "ayrton-senna");
    expect(senna).toMatchObject({ number: "2", isCurrent: false });

    // 1974 前的车手也显示最后一场号码（fangio 1958 用 34 号）
    const fangio = drivers.find((d) => d.id === "juan-manuel-fangio");
    expect(fangio).toMatchObject({ number: "34", isCurrent: false });

    // 同口径覆盖所有 1974 前退役车手（stewart 1973 用 5 号，clark 1968 用 4 号）
    const stewart = drivers.find((d) => d.id === "jackie-stewart");
    expect(stewart).toMatchObject({ number: "5" });
    const clark = drivers.find((d) => d.id === "jim-clark");
    expect(clark).toMatchObject({ number: "4" });

    // 现役车手显示当前号码而非永久车号（norris 2026 作为卫冕冠军用 1 号）
    const norris = drivers.find((d) => d.id === "lando-norris");
    expect(norris).toMatchObject({ number: "1", isCurrent: true });

    // 按生涯总积分降序：hamilton（5187.5）在 verstappen（3553.5）前
    const hamilton = drivers.findIndex((d) => d.id === "lewis-hamilton");
    expect(hamilton).toBeLessThan(
      drivers.findIndex((d) => d.id === "max-verstappen"),
    );
  });
});

describe("getDriversByYear", () => {
  it("filters to the given year and excludes test drivers", async () => {
    let sql = "";
    let values: readonly unknown[] = [];
    const db: DriverDatabase = {
      batch(statements) {
        sql = statements[0].sql;
        values = statements[0].values;
        return Promise.resolve([{ results: [] }]);
      },
    };

    await createDriverRepository(db).getDriversByYear(1997);
    expect(sql).toContain("test_driver = 0");
    expect(sql).toContain("ra2.year = ?1");
    expect(sql).toContain("ORDER BY points DESC");
    // 年份视图号码优先该年实际号码
    expect(sql).toContain("COALESCE(lr.last_number, d.permanent_number)");
    // 最后参赛探测只对该年参赛者跑，不全表逐人扫描
    expect(sql).toContain("FROM year_drivers yd");
    expect(sql).toContain("rd2.driver_id = yd.driver_id");
    expect(values).toEqual([1997]);
  });

  it("maps rows with the year's team, flag lowercased", async () => {
    const db: DriverDatabase = {
      batch() {
        return Promise.resolve([
          {
            results: [
              {
                id: "michael-schumacher",
                name: "Michael Schumacher",
                number: "5",
                alpha2_code: "DE",
                team_id: "ferrari",
                team_name: "Ferrari",
              },
              {
                id: "no-team",
                name: "No Team",
                number: null,
                alpha2_code: null,
                team_id: null,
                team_name: null,
              },
            ],
          },
        ]);
      },
    };

    const drivers = await createDriverRepository(db).getDriversByYear(1997);
    expect(drivers).toEqual([
      {
        id: "michael-schumacher",
        name: "Michael Schumacher",
        number: "5",
        flagCode: "de",
        teamId: "ferrari",
        teamName: "Ferrari",
        isCurrent: false,
      },
      {
        id: "no-team",
        name: "No Team",
        number: null,
        flagCode: null,
        teamId: null,
        teamName: null,
        isCurrent: false,
      },
    ]);
  });

  it("orders the DEV year view by that year's points", async () => {
    const drivers = await createDriverRepository().getDriversByYear(1997);
    // schumacher 78 分在 hakkinen 27 分前；hakkinen 该年用 9 号
    expect(drivers.map((d) => d.name)).toEqual([
      "Michael Schumacher",
      "Mika Häkkinen",
    ]);
    expect(drivers[1]).toMatchObject({ number: "9" });
    // 车队取该年最后参赛车队（schumacher 生涯最后车队是 Mercedes，1997 在 Ferrari）
    expect(drivers[0]).toMatchObject({ teamId: "ferrari", teamName: "Ferrari" });
  });

  it("shows that year's race number over the permanent one", async () => {
    // verstappen 永久 3 号，但 2023 作为卫冕冠军用 1 号
    const drivers = await createDriverRepository().getDriversByYear(2023);
    expect(drivers.find((d) => d.id === "max-verstappen")).toMatchObject({
      number: "1",
    });
  });

  it("shows the last race number of that year before the fixed-number era", async () => {
    // fangio 1958 最后一场用 34 号
    const drivers = await createDriverRepository().getDriversByYear(1958);
    expect(drivers).toEqual([
      expect.objectContaining({ id: "juan-manuel-fangio", number: "34" }),
    ]);
  });
});

describe("getSeasonYears", () => {
  it("returns years in descending order", async () => {
    const db: DriverDatabase = {
      batch() {
        return Promise.resolve([{ results: [{ year: 2026 }, { year: 1950 }] }]);
      },
    };

    const years = await createDriverRepository(db).getSeasonYears();
    expect(years).toEqual([2026, 1950]);
  });
});
