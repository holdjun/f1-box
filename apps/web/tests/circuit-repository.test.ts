import { describe, expect, it } from "vitest";

import {
  type CircuitDatabase,
  createCircuitRepository,
} from "../src/lib/circuit-repository.js";

function fakeDbBySql(
  rowsBySqlFragment: Record<string, unknown[]>,
): CircuitDatabase {
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

describe("createCircuitRepository with database", () => {
  it("maps catalog rows with nullable layout and flag", async () => {
    const db = fakeDbBySql({
      "FROM circuit": [
        {
          id: "shanghai",
          name: "Shanghai",
          place_name: "Shanghai",
          country_name: "China",
          alpha2_code: "CN",
          length: 5.451,
          turns: 16,
          total_races_held: 20,
          layout_id: "shanghai-1",
        },
        {
          id: "never-used",
          name: "Never Used",
          place_name: "Nowhere",
          country_name: "Nowhereland",
          alpha2_code: null,
          length: 4.2,
          turns: 12,
          total_races_held: 0,
          layout_id: null,
        },
      ],
    });

    const circuits = await createCircuitRepository(db).getCircuits();
    expect(circuits).toEqual([
      {
        id: "shanghai",
        name: "Shanghai",
        placeName: "Shanghai",
        countryName: "China",
        alpha2Code: "cn",
        length: 5.451,
        turns: 16,
        totalRacesHeld: 20,
        layoutId: "shanghai-1",
      },
      {
        id: "never-used",
        name: "Never Used",
        placeName: "Nowhere",
        countryName: "Nowhereland",
        alpha2Code: null,
        length: 4.2,
        turns: 12,
        totalRacesHeld: 0,
        layoutId: null,
      },
    ]);
  });

  it("maps a circuit page with latest race and record lap", async () => {
    const db = fakeDbBySql({
      fastest_lap: [
        { time: "1:32.238", driver_name: "Michael Schumacher", year: 2004 },
      ],
      "FROM circuit": [
        {
          id: "shanghai",
          name: "Shanghai",
          full_name: "Shanghai International Circuit",
          place_name: "Shanghai",
          country_name: "China",
          alpha2_code: "CN",
          direction: "CLOCKWISE",
          turns: 16,
          total_races_held: 20,
          first_gp: 2004,
          length: 5.451,
          laps: 56,
          distance: 305.066,
          layout_id: "shanghai-1",
        },
      ],
    });

    const page = await createCircuitRepository(db).getCircuit("shanghai");
    expect(page).toEqual({
      id: "shanghai",
      name: "Shanghai",
      fullName: "Shanghai International Circuit",
      placeName: "Shanghai",
      countryName: "China",
      alpha2Code: "cn",
      direction: "Clockwise",
      turns: 16,
      totalRacesHeld: 20,
      firstGrandPrix: 2004,
      length: 5.451,
      laps: 56,
      distance: 305.066,
      layoutId: "shanghai-1",
      recordLap: {
        time: "1:32.238",
        driverName: "Michael Schumacher",
        year: 2004,
      },
    });
  });

  it("maps a circuit that never held a race", async () => {
    const db = fakeDbBySql({
      fastest_lap: [],
      "FROM circuit": [
        {
          id: "never-used",
          name: "Never Used",
          full_name: "Never Used Circuit",
          place_name: "Nowhere",
          country_name: "Nowhereland",
          alpha2_code: "NW",
          direction: "ANTICLOCKWISE",
          turns: 12,
          total_races_held: 0,
          first_gp: null,
          length: 4.2,
          laps: null,
          distance: null,
          layout_id: null,
        },
      ],
    });

    const page = await createCircuitRepository(db).getCircuit("never-used");
    expect(page).toEqual({
      id: "never-used",
      name: "Never Used",
      fullName: "Never Used Circuit",
      placeName: "Nowhere",
      countryName: "Nowhereland",
      alpha2Code: "nw",
      direction: "Anticlockwise",
      turns: 12,
      totalRacesHeld: 0,
      firstGrandPrix: null,
      length: 4.2,
      laps: null,
      distance: null,
      layoutId: null,
      recordLap: null,
    });
  });

  it("returns null for unknown circuit", async () => {
    const db = fakeDbBySql({ fastest_lap: [], "FROM circuit": [] });
    expect(await createCircuitRepository(db).getCircuit("nope")).toBeNull();
  });
});
