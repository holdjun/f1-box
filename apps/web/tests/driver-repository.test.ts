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
      expect(sql).toContain("total_championship_wins DESC");
      expect(sql).toContain("total_race_wins DESC");
      expect(sql).toContain("total_race_entries DESC");
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
        permanent_number: "63",
        alpha2_code: "GB",
        team_id: "mercedes",
        team_name: "Mercedes",
        is_current: 1,
      },
      {
        id: "ayrton-senna",
        name: "Ayrton Senna",
        permanent_number: null,
        alpha2_code: "BR",
        team_id: "senna",
        team_name: "Senna",
        is_current: 0,
      },
      {
        id: "no-team-driver",
        name: "No Team Driver",
        permanent_number: null,
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
        number: null,
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
      /driver/i,
    );
  });
});

describe("drivers fixture", () => {
  it("serves the curated catalog in DEV order", async () => {
    const drivers = await createDriverRepository().getDrivers();
    expect(drivers.length).toBeGreaterThanOrEqual(30);

    const russell = drivers.find((d) => d.id === "george-russell");
    expect(russell).toMatchObject({
      number: "63",
      teamName: "Mercedes",
      flagCode: "gb",
      isCurrent: true,
    });

    const senna = drivers.find((d) => d.id === "ayrton-senna");
    expect(senna).toMatchObject({ number: null, isCurrent: false });

    // 当前车手全部排在历史车手之前
    const firstHistorical = drivers.findIndex((d) => !d.isCurrent);
    expect(
      drivers.slice(firstHistorical).every((d) => !d.isCurrent),
    ).toBe(true);

    // 历史段内按生涯成就：prost（4 冠）在 senna（3 冠）前
    const prost = drivers.findIndex((d) => d.id === "alain-prost");
    expect(prost).toBeLessThan(drivers.findIndex((d) => d.id === "ayrton-senna"));
  });
});
