import { describe, expect, it } from "vitest";

import {
  createRaceResultsRepository,
  formatAvgSpeedKph,
  formatSeconds,
  type RaceResultsDatabase,
} from "../src/lib/race-results-repository.js";

// 按 SQL 片段分发结果；未登记的语句直接抛错，暴露意外的查询
function fakeDbBySql(
  rowsBySqlFragment: Record<string, unknown[]>,
): RaceResultsDatabase {
  return {
    batch(statements) {
      return Promise.resolve(
        statements.map(({ sql }) => {
          const match = Object.entries(rowsBySqlFragment).find(([fragment]) =>
            sql.includes(fragment),
          );
          // Sprint 两张表随 getRacePage 一起下发；用例不关心时按空结果处理
          if (!match) {
            if (/FROM sprint_(race|qualifying)_result/.test(sql)) {
              return { results: [] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
          }
          return { results: match[1] };
        }),
      );
    },
  };
}

describe("createRaceResultsRepository getSeasonCalendar / listRaces", () => {
  it("maps a completed race with winner, pole, layout, sessions and podium", async () => {
    const db = fakeDbBySql({
      circuit_place: [
        {
          round: 1,
          slug: "australia",
          name: "Australia",
          race_name: "Australian Grand Prix",
          alpha2_code: "AU",
          country_name: "Australia",
          date: "2026-03-08",
          time: "04:00",
          laps: 58,
          circuit_id: "melbourne",
          circuit_layout_id: "melbourne-2",
          circuit_name: "Melbourne",
          circuit_place: "Melbourne",
          free_practice_1_date: "2026-03-06",
          free_practice_1_time: "01:30",
          free_practice_2_date: "2026-03-06",
          free_practice_2_time: "05:00",
          free_practice_3_date: "2026-03-07",
          free_practice_3_time: "01:30",
          qualifying_date: "2026-03-07",
          qualifying_time: "05:00",
          sprint_qualifying_date: null,
          sprint_qualifying_time: null,
          sprint_race_date: null,
          sprint_race_time: null,
          winner_name: "George Russell",
          winner_code: "RUS",
          winner_driver_id: "george-russell",
          winner_team_id: "mercedes",
          winner_team_name: "Mercedes",
          winner_time: "1:23:06.801",
          pole_name: "George Russell",
          pole_code: "RUS",
        },
      ],
      "JOIN race ra ON rr.race_id": [
        {
          round: 1,
          position_number: 1,
          driver_code: "RUS",
          constructor_id: "mercedes",
          display_time: "1:23:06.801",
        },
        {
          round: 1,
          position_number: 2,
          driver_code: "ANT",
          constructor_id: "mercedes",
          display_time: "+2.974",
        },
        {
          round: 1,
          position_number: 3,
          driver_code: "LEC",
          constructor_id: "ferrari",
          display_time: "+15.519",
        },
      ],
    });
    const rows = await createRaceResultsRepository(db).getSeasonCalendar(2026);
    expect(rows).toEqual([
      {
        round: 1,
        slug: "australia",
        name: "Australia",
        raceName: "Australian Grand Prix",
        alpha2Code: "AU",
        countryName: "Australia",
        date: "2026-03-08",
        time: "04:00",
        laps: 58,
        circuitId: "melbourne",
        circuitLayoutId: "melbourne-2",
        circuitName: "Melbourne",
        circuitPlace: "Melbourne",
        sessions: [
          {
            key: "practice-1",
            label: "Practice 1",
            startsAtUtc: "2026-03-06T01:30:00Z",
          },
          {
            key: "practice-2",
            label: "Practice 2",
            startsAtUtc: "2026-03-06T05:00:00Z",
          },
          {
            key: "practice-3",
            label: "Practice 3",
            startsAtUtc: "2026-03-07T01:30:00Z",
          },
          {
            key: "qualifying",
            label: "Qualifying",
            startsAtUtc: "2026-03-07T05:00:00Z",
          },
          { key: "race", label: "Race", startsAtUtc: "2026-03-08T04:00:00Z" },
        ],
        podium: [
          {
            driverCode: "RUS",
            constructorId: "mercedes",
            time: "1:23:06.801",
          },
          {
            driverCode: "ANT",
            constructorId: "mercedes",
            time: "+2.974",
          },
          {
            driverCode: "LEC",
            constructorId: "ferrari",
            time: "+15.519",
          },
        ],
        winnerName: "George Russell",
        winnerCode: "RUS",
        winnerDriverId: "george-russell",
        winnerTeamId: "mercedes",
        winnerTeamName: "Mercedes",
        winnerTime: "1:23:06.801",
        poleName: "George Russell",
        poleCode: "RUS",
      },
    ]);
  });

  it("maps an upcoming race without winner row", async () => {
    const db = fakeDbBySql({
      circuit_place: [
        {
          round: 12,
          slug: "netherlands",
          name: "Netherlands",
          race_name: "Dutch Grand Prix",
          alpha2_code: "NL",
          country_name: "Netherlands",
          date: "2026-08-23",
          time: "13:00",
          laps: 72,
          circuit_id: "zandvoort",
          circuit_layout_id: "zandvoort-1",
          circuit_name: "Zandvoort",
          circuit_place: "Zandvoort",
          free_practice_1_date: null,
          free_practice_1_time: null,
          free_practice_2_date: null,
          free_practice_2_time: null,
          free_practice_3_date: null,
          free_practice_3_time: null,
          qualifying_date: null,
          qualifying_time: null,
          sprint_qualifying_date: null,
          sprint_qualifying_time: null,
          sprint_race_date: null,
          sprint_race_time: null,
          winner_name: null,
          winner_code: null,
          winner_driver_id: null,
          winner_team_id: null,
          winner_team_name: null,
          winner_time: null,
          pole_name: null,
          pole_code: null,
        },
      ],
      "JOIN race ra ON rr.race_id": [],
    });
    const [row] = await createRaceResultsRepository(db).getSeasonCalendar(2026);
    expect(row.winnerName).toBeNull();
    expect(row.winnerDriverId).toBeNull();
    expect(row.poleName).toBeNull();
  });

  it("orders sprint-weekend sessions by start time", async () => {
    const db = fakeDbBySql({
      circuit_place: [
        {
          round: 2,
          slug: "china",
          name: "China",
          race_name: "Chinese Grand Prix",
          alpha2_code: "CN",
          country_name: "China",
          date: "2026-03-15",
          time: "07:00",
          laps: 56,
          circuit_id: "shanghai",
          circuit_layout_id: "shanghai-1",
          circuit_name: "Shanghai",
          circuit_place: "Shanghai",
          free_practice_1_date: "2026-03-13",
          free_practice_1_time: "03:30",
          free_practice_2_date: null,
          free_practice_2_time: null,
          free_practice_3_date: null,
          free_practice_3_time: null,
          qualifying_date: "2026-03-14",
          qualifying_time: "07:00",
          sprint_qualifying_date: "2026-03-13",
          sprint_qualifying_time: "07:30",
          sprint_race_date: "2026-03-14",
          sprint_race_time: "03:00",
          winner_name: null,
          winner_code: null,
          winner_driver_id: null,
          winner_team_id: null,
          winner_team_name: null,
          winner_time: null,
          pole_name: null,
          pole_code: null,
        },
      ],
      "JOIN race ra ON rr.race_id": [],
    });
    const [row] = await createRaceResultsRepository(db).getSeasonCalendar(2026);
    // Quali 在 Sprint 之后，不能按字段定义序排列
    expect(row.sessions.map((s) => s.key)).toEqual([
      "practice-1",
      "sprint-qualifying",
      "sprint",
      "qualifying",
      "race",
    ]);
  });

  it("renders a shared-win race once, keeping the first P1 row", async () => {
    // 1951 法国站 Fagioli/Fangio 共享冠军：同 round 两条 P1 行，只渲染一条；
    // SQL 取 display_order 最小的 P1 行，映射层再按 round 去重兜底
    const sqls: string[] = [];
    const sharedWinRow = (winner_driver_id: string, winner_name: string) => ({
      round: 4,
      slug: "france",
      name: "France",
      race_name: "French Grand Prix",
      alpha2_code: "FR",
      country_name: "France",
      date: "1951-07-01",
      time: "14:00",
      laps: 77,
      circuit_id: "reims",
      circuit_layout_id: "reims-1",
      circuit_name: "Reims-Gueux",
      circuit_place: "Reims",
      free_practice_1_date: null,
      free_practice_1_time: null,
      free_practice_2_date: null,
      free_practice_2_time: null,
      free_practice_3_date: null,
      free_practice_3_time: null,
      qualifying_date: null,
      qualifying_time: null,
      sprint_qualifying_date: null,
      sprint_qualifying_time: null,
      sprint_race_date: null,
      sprint_race_time: null,
      winner_name,
      winner_code: null,
      winner_driver_id,
      winner_team_id: "alfa-romeo",
      winner_team_name: "Alfa Romeo",
      winner_time: null,
      pole_name: null,
      pole_code: null,
    });
    const db: RaceResultsDatabase = {
      batch(statements) {
        sqls.push(...statements.map((statement) => statement.sql));
        return Promise.resolve([
          {
            results: [
              sharedWinRow("luigi-fagioli", "Luigi Fagioli"),
              sharedWinRow("juan-manuel-fangio", "Juan Manuel Fangio"),
            ],
          },
          { results: [] }, // podium：1951 共享冠军老数据无前三名补充
        ]);
      },
    };
    const rows = await createRaceResultsRepository(db).getSeasonCalendar(1951);
    expect(rows).toHaveLength(1);
    expect(rows[0].winnerName).toBe("Luigi Fagioli");
    expect(rows[0].winnerDriverId).toBe("luigi-fagioli");
    expect(sqls[0]).toContain("MIN(x.position_display_order)");
  });

  it("DEV fixture calendar has 23 rounds with sessions and podium, list only completed", async () => {
    const repository = createRaceResultsRepository();
    const calendar = await repository.getSeasonCalendar(2026);
    expect(calendar).toHaveLength(23);
    expect(calendar.every((race) => race.sessions.length > 0)).toBe(true);
    expect(calendar.every((race) => race.circuitLayoutId.length > 0)).toBe(
      true,
    );
    const completed = await repository.listRaces(2026);
    expect(completed).toHaveLength(11);
    expect(completed.every((race) => race.winnerName !== null)).toBe(true);
    expect(completed.every((race) => race.winnerDriverId !== null)).toBe(true);
    // 完赛站都有前三名，且首站为 Russell/1:23:06.801
    expect(completed.every((race) => race.podium.length === 3)).toBe(true);
    expect(completed[0].podium[0]).toEqual({
      driverCode: "RUS",
      constructorId: "mercedes",
      time: "1:23:06.801",
    });
    expect(await repository.getSeasonCalendar(2025)).toEqual([]);
  });
});

describe("createRaceResultsRepository getSeasonYears", () => {
  it("reads season years from the season table", async () => {
    const db = fakeDbBySql({ "FROM season": [{ year: 2026 }, { year: 1950 }] });
    expect(await createRaceResultsRepository(db).getSeasonYears()).toEqual([
      2026, 1950,
    ]);
  });

  it("DEV fixture years are newest-first [2026, 2025]", async () => {
    expect(await createRaceResultsRepository().getSeasonYears()).toEqual([
      2026, 2025,
    ]);
  });
});

const metaRow = {
  year: 2026,
  round: 1,
  slug: "australia",
  name: "Australia",
  official_name: "Formula 1 Qatar Airways Australian Grand Prix 2026",
  date: "2026-03-08",
  time: "04:00",
  laps: 58,
  course_length: 5.278,
  distance: 306.124,
  turns: 14,
  direction: "CLOCKWISE",
  circuit_id: "melbourne",
  circuit_layout_id: "melbourne-2",
  circuit_full_name: "Melbourne Grand Prix Circuit",
  circuit_place: "Melbourne",
  country_name: "Australia",
  alpha2_code: "AU",
  free_practice_1_date: "2026-03-06",
  free_practice_1_time: "01:30",
  free_practice_2_date: "2026-03-06",
  free_practice_2_time: "05:00",
  free_practice_3_date: "2026-03-07",
  free_practice_3_time: "01:30",
  qualifying_date: "2026-03-07",
  qualifying_time: "05:00",
  sprint_qualifying_date: null,
  sprint_qualifying_time: null,
  sprint_race_date: null,
  sprint_race_time: null,
};

const circuitInfoRow = {
  total_races_held: 29,
  first_gp: 1996,
};

const recordLapRow = {
  time: "1:19.813",
  driver_name: "Charles Leclerc",
  year: 2024,
};

// 模拟 raceMetaSql 缺 session 字段的退化输入：详情页 Weekend schedule 只剩 race 一项
// （生产 SQL 曾在 D1 路径漏选 practice/qualifying/sprint 列，回归保护）
const metaRowNoSessions = {
  ...metaRow,
  free_practice_1_date: null,
  free_practice_2_date: null,
  free_practice_3_date: null,
  qualifying_date: null,
  sprint_qualifying_date: null,
  sprint_race_date: null,
};

// getRacePage 一次 batch 11 条语句；未登记的语句抛错，用本助手把其余 tab 置空
function tabFragments(
  extra: Record<string, unknown[]>,
): Record<string, unknown[]> {
  return {
    circuit_full_name: [metaRow],
    total_races_held: [circuitInfoRow],
    "time_millis IS NOT NULL": [recordLapRow],
    "FROM race_result rr": [],
    "FROM qualifying_result": [],
    "FROM starting_grid_position": [],
    "FROM fastest_lap": [],
    "FROM pit_stop": [],
    "FROM free_practice_1_result": [],
    "FROM free_practice_2_result": [],
    "FROM free_practice_3_result": [],
    ...extra,
  };
}

describe("createRaceResultsRepository getRacePage", () => {
  it("maps race meta, sessions and race result rows", async () => {
    const db = fakeDbBySql(
      tabFragments({
        "FROM race_result rr": [
          {
            position_number: 1,
            position_text: "1",
            driver_number: "63",
            driver_id: "george-russell",
            driver_name: "George Russell",
            driver_code: "RUS",
            constructor_id: "mercedes",
            constructor_name: "Mercedes",
            laps: 58,
            time: "1:23:06.801",
            reason_retired: null,
            gap: null,
            points: 25,
          },
          {
            position_number: null,
            position_text: "DNF",
            driver_number: "44",
            driver_id: "lewis-hamilton",
            driver_name: "Lewis Hamilton",
            driver_code: "HAM",
            constructor_id: "ferrari",
            constructor_name: "Ferrari",
            laps: 30,
            time: null,
            reason_retired: "Collision",
            gap: null,
            points: 0,
          },
          {
            position_number: 2,
            position_text: "2",
            driver_number: "4",
            driver_id: "lando-norris",
            driver_name: "Lando Norris",
            driver_code: "NOR",
            constructor_id: "mclaren",
            constructor_name: "McLaren",
            laps: 58,
            time: null,
            reason_retired: null,
            gap: "+26.874",
            points: 18,
          },
        ],
      }),
    );
    const page = await createRaceResultsRepository(db).getRacePage(
      2026,
      "australia",
    );
    expect(page?.meta.round).toBe(1);
    expect(page?.meta.sessions).toEqual([
      {
        key: "practice-1",
        label: "Practice 1",
        startsAtUtc: "2026-03-06T01:30:00Z",
      },
      {
        key: "practice-2",
        label: "Practice 2",
        startsAtUtc: "2026-03-06T05:00:00Z",
      },
      {
        key: "practice-3",
        label: "Practice 3",
        startsAtUtc: "2026-03-07T01:30:00Z",
      },
      {
        key: "qualifying",
        label: "Qualifying",
        startsAtUtc: "2026-03-07T05:00:00Z",
      },
      { key: "race", label: "Race", startsAtUtc: "2026-03-08T04:00:00Z" },
    ]);
    expect(page?.tabs.raceResult[0].driverName).toBe("George Russell");
    expect(page?.tabs.raceResult[1].time).toBeNull();
    expect(page?.tabs.raceResult[1].retiredReason).toBe("Collision");
    // 有名次但被套圈：time 为空时视图回退到 gap
    expect(page?.tabs.raceResult[2].time).toBeNull();
    expect(page?.tabs.raceResult[2].gap).toBe("+26.874");
    // 新增赛道维度字段（行程字段来自电路信息批处理）
    expect(page?.meta.circuitFullName).toBe("Melbourne Grand Prix Circuit");
    expect(page?.meta.raceTime).toBe("04:00");
    expect(page?.meta.distance).toBe(306.124);
    expect(page?.meta.turns).toBe(14);
    expect(page?.meta.direction).toBe("Clockwise");
    expect(page?.meta.totalRacesHeld).toBe(29);
    expect(page?.meta.firstGrandPrix).toBe(1996);
    expect(page?.meta.recordLap).toEqual({
      time: "1:19.813",
      driverName: "Charles Leclerc",
      year: 2024,
    });
  });

  it("renders the anti-clockwise direction without the raw underscore", async () => {
    const db = fakeDbBySql(
      tabFragments({
        circuit_full_name: [{ ...metaRow, direction: "ANTI_CLOCKWISE" }],
      }),
    );
    const page = await createRaceResultsRepository(db).getRacePage(
      2026,
      "australia",
    );
    expect(page?.meta.direction).toBe("Anti-clockwise");
  });

  it("degrades to race-only sessions when meta lacks session columns", async () => {
    // raceMetaSql 漏选 session 列时（生产 D1 曾犯过），Weekend schedule 只应有 race 一项而非崩溃
    const db = fakeDbBySql(
      tabFragments({ circuit_full_name: [metaRowNoSessions] }),
    );
    const page = await createRaceResultsRepository(db).getRacePage(
      2026,
      "australia",
    );
    expect(page?.meta.sessions).toEqual([
      { key: "race", label: "Race", startsAtUtc: "2026-03-08T04:00:00Z" },
    ]);
  });

  it("returns null for unknown slug", async () => {
    const db = fakeDbBySql(tabFragments({ circuit_full_name: [] }));
    expect(
      await createRaceResultsRepository(db).getRacePage(2026, "nope"),
    ).toBeNull();
  });

  it("maps qualifying rows", async () => {
    const db = fakeDbBySql(
      tabFragments({
        "FROM qualifying_result": [
          {
            position_number: 1,
            position_text: "1",
            driver_number: "63",
            driver_id: "george-russell",
            driver_name: "George Russell",
            driver_code: "RUS",
            constructor_id: "mercedes",
            constructor_name: "Mercedes",
            q1: "1:19.507",
            q2: "1:18.934",
            q3: "1:18.518",
            laps: 22,
          },
        ],
      }),
    );
    const page = await createRaceResultsRepository(db).getRacePage(
      2026,
      "australia",
    );
    expect(page?.tabs.qualifying[0].q3).toBe("1:18.518");
  });

  it("maps starting grid rows with null time", async () => {
    const db = fakeDbBySql(
      tabFragments({
        "FROM starting_grid_position": [
          {
            position_number: 20,
            position_text: "20",
            driver_number: "1",
            driver_id: "max-verstappen",
            driver_name: "Max Verstappen",
            driver_code: "VER",
            constructor_id: "red-bull",
            constructor_name: "Red Bull Racing",
            time: null,
          },
        ],
      }),
    );
    const page = await createRaceResultsRepository(db).getRacePage(
      2026,
      "australia",
    );
    expect(page?.tabs.startingGrid[0].time).toBeNull();
  });

  it("maps fastest lap rows with computed avg speed", async () => {
    const db = fakeDbBySql(
      tabFragments({
        "FROM fastest_lap": [
          {
            position_number: 1,
            position_text: "1",
            driver_number: "63",
            driver_id: "george-russell",
            driver_name: "George Russell",
            driver_code: "RUS",
            constructor_id: "mercedes",
            constructor_name: "Mercedes",
            lap: 43,
            time: "1:22.091",
            time_millis: 82091,
          },
        ],
      }),
    );
    const page = await createRaceResultsRepository(db).getRacePage(
      2026,
      "australia",
    );
    expect(page?.tabs.fastestLaps[0].avgSpeedKph).toBe("231.460");
  });

  it("maps pit stop rows aggregated per driver", async () => {
    const db = fakeDbBySql(
      tabFragments({
        "FROM pit_stop": [
          {
            driver_number: "43",
            driver_id: "franco-colapinto",
            driver_name: "Franco Colapinto",
            driver_code: "COL",
            constructor_id: "alpine",
            constructor_name: "Alpine",
            stops: 1,
            total_millis: 27733,
          },
        ],
      }),
    );
    const page = await createRaceResultsRepository(db).getRacePage(
      2026,
      "australia",
    );
    expect(page?.tabs.pitStops[0]).toMatchObject({
      stops: 1,
      totalSeconds: "27.733",
    });
  });

  it("maps practice rows", async () => {
    const db = fakeDbBySql(
      tabFragments({
        "FROM free_practice_1_result": [
          {
            position_number: 1,
            position_text: "1",
            driver_number: "63",
            driver_id: "george-russell",
            driver_name: "George Russell",
            driver_code: "RUS",
            constructor_id: "mercedes",
            constructor_name: "Mercedes",
            time: "1:20.100",
            gap: null,
            laps: 24,
          },
        ],
      }),
    );
    const page = await createRaceResultsRepository(db).getRacePage(
      2026,
      "australia",
    );
    expect(page?.tabs.practice1[0].gap).toBeNull();
  });

  it("maps sprint rows into their own tabs", async () => {
    const db = fakeDbBySql({
      "ra.official_name": [
        {
          year: 2026,
          round: 5,
          slug: "china",
          name: "China",
          official_name: "Chinese Grand Prix",
          date: "2026-03-15",
          time: "07:00",
          laps: 56,
          course_length: 5.451,
          circuit_id: "shanghai",
          circuit_layout_id: "shanghai-1",
          circuit_full_name: "Shanghai",
          circuit_place: "Shanghai",
          distance: 305.066,
          turns: 16,
          direction: "CLOCKWISE",
          country_name: "China",
          alpha2_code: "CN",
        },
      ],
      "FROM sprint_race_result": [
        {
          position_number: 1,
          position_text: "1",
          driver_number: "1",
          driver_id: "max-verstappen",
          driver_name: "Max Verstappen",
          driver_code: "VER",
          constructor_id: "red-bull",
          constructor_name: "Red Bull",
          laps: 19,
          time: "30:12.345",
          reason_retired: null,
          gap: null,
          points: 8,
        },
      ],
      "FROM sprint_qualifying_result": [
        {
          position_number: 1,
          position_text: "1",
          driver_number: "4",
          driver_id: "lando-norris",
          driver_name: "Lando Norris",
          driver_code: "NOR",
          constructor_id: "mclaren",
          constructor_name: "McLaren",
          q1: "1:30.1",
          q2: "1:29.8",
          q3: "1:29.5",
          laps: 12,
        },
      ],
      total_races_held: [{ total_races_held: 21, first_gp: 2004 }],
      "FROM race_result": [],
      "FROM qualifying_result": [],
      "FROM starting_grid_position": [],
      "FROM fastest_lap": [],
      "FROM pit_stop": [],
      "FROM free_practice_1_result": [],
      "FROM free_practice_2_result": [],
      "FROM free_practice_3_result": [],
      "SELECT fl.time, d.name AS driver_name": [],
    });
    const page = await createRaceResultsRepository(db).getRacePage(
      2026,
      "china",
    );
    expect(page?.tabs.sprintRace[0]).toMatchObject({
      driverCode: "VER",
      points: 8,
    });
    expect(page?.tabs.sprintQualifying[0]).toMatchObject({
      driverCode: "NOR",
      q3: "1:29.5",
    });
  });

  it("DEV fixture 派生出赛前/赛中/赛后三种形态", async () => {
    const repository = createRaceResultsRepository();
    expect(await repository.getRacePage(2026, "nope")).toBeNull();
    const finished = await repository.getRacePage(2026, "australia");
    expect(finished?.meta.name).toBe("Australia");
    expect(finished?.tabs.raceResult.length).toBeGreaterThan(0);
    // 赛中：排位赛已入库、正赛未开
    const mid = await repository.getRacePage(2026, "china");
    expect(mid?.tabs.qualifying.length).toBeGreaterThan(0);
    expect(mid?.tabs.raceResult).toHaveLength(0);
    // 赛前：全空，但赛程元信息跟着站次走
    const upcoming = await repository.getRacePage(2026, "japan");
    expect(upcoming?.meta.name).toBe("Japan");
    expect(upcoming?.tabs.qualifying).toHaveLength(0);
    expect(upcoming?.meta.sessions.length).toBeGreaterThan(0);
  });
});

describe("createRaceResultsRepository standings", () => {
  it("maps driver standings with aggregated wins", async () => {
    const db = fakeDbBySql({
      "FROM season_driver_standing": [
        {
          position_number: 1,
          position_text: "1",
          driver_id: "kimi-antonelli",
          driver_name: "Kimi Antonelli",
          driver_code: "ANT",
          points: 219,
          wins: 6,
          team_id: "mercedes",
          team_name: "Mercedes",
        },
      ],
    });
    const rows = await createRaceResultsRepository(db).getDriverStandings(2026);
    expect(rows).toEqual([
      {
        position: 1,
        positionText: "1",
        driverId: "kimi-antonelli",
        driverName: "Kimi Antonelli",
        driverCode: "ANT",
        points: 219,
        wins: 6,
        teamId: "mercedes",
        teamName: "Mercedes",
      },
    ]);
  });

  // 只有积分行、该年未上过正赛的车手无车队可归，归属列必须允许为空
  it("maps a driver standing with no team entry", async () => {
    const db = fakeDbBySql({
      "FROM season_driver_standing": [
        {
          position_number: null,
          position_text: "-",
          driver_id: "nyck-de-vries",
          driver_name: "Nyck de Vries",
          driver_code: "DEV",
          points: 0,
          wins: 0,
          team_id: null,
          team_name: null,
        },
      ],
    });
    const [row] =
      await createRaceResultsRepository(db).getDriverStandings(2026);
    expect(row.teamId).toBeNull();
    expect(row.teamName).toBeNull();
  });

  it("maps constructor standings", async () => {
    const db = fakeDbBySql({
      "FROM season_constructor_standing": [
        {
          position_number: null,
          position_text: "-",
          team_id: "mercedes",
          team_name: "Mercedes",
          points: 379,
          wins: 8,
        },
      ],
    });
    const rows =
      await createRaceResultsRepository(db).getConstructorStandings(2026);
    expect(rows[0]).toEqual({
      position: null,
      positionText: "-",
      teamId: "mercedes",
      teamName: "Mercedes",
      points: 379,
      wins: 8,
    });
  });

  it("DEV fixture serves 2026 standings only", async () => {
    const repository = createRaceResultsRepository();
    expect(await repository.getDriverStandings(2026)).toHaveLength(22);
    expect(await repository.getConstructorStandings(2026)).toHaveLength(11);
    expect(await repository.getDriverStandings(2025)).toEqual([]);
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

describe("buildSessions 合并 f1db 与 session_time", () => {
  // 2024+：f1db 自带完整时刻，session_time 即使有值也不该覆盖 f1db
  it("f1db 有真实时刻时优先生效", async () => {
    const metaWithSt = {
      ...metaRow,
      session_times: JSON.stringify([
        { key: "practice-1", value: "2026-03-06T99:00:00Z" },
      ]),
    };
    const db = fakeDbBySql(tabFragments({ circuit_full_name: [metaWithSt] }));
    const page = await createRaceResultsRepository(db).getRacePage(
      2026,
      "australia",
    );
    // practice-1 仍为 f1db 时刻 01:30，不被 session_time 的假值覆盖
    expect(page?.meta.sessions[0]).toEqual({
      key: "practice-1",
      label: "Practice 1",
      startsAtUtc: "2026-03-06T01:30:00Z",
    });
  });

  // 2018-2023：f1db 连练习/排位日期都没有，只能靠 session_time 补出整个周末
  it("f1db 无练习/排位日期时由 session_time 填充，并新增 race 的真实时刻", async () => {
    const meta2018 = {
      ...metaRow,
      date: "2023-03-05",
      time: null,
      free_practice_1_date: null,
      free_practice_1_time: null,
      free_practice_2_date: null,
      free_practice_2_time: null,
      free_practice_3_date: null,
      free_practice_3_time: null,
      qualifying_date: null,
      qualifying_time: null,
      sprint_qualifying_date: null,
      sprint_qualifying_time: null,
      sprint_race_date: null,
      sprint_race_time: null,
      session_times: JSON.stringify([
        { key: "practice-1", value: "2023-03-03T01:30:00Z" },
        { key: "practice-2", value: "2023-03-03T05:00:00Z" },
        { key: "practice-3", value: "2023-03-04T01:30:00Z" },
        { key: "qualifying", value: "2023-03-04T05:00:00Z" },
        { key: "race", value: "2023-03-05T04:00:00Z" },
      ]),
    };
    const db = fakeDbBySql(tabFragments({ circuit_full_name: [meta2018] }));
    const page = await createRaceResultsRepository(db).getRacePage(
      2023,
      "bahrain",
    );
    expect(page?.meta.sessions).toEqual([
      {
        key: "practice-1",
        label: "Practice 1",
        startsAtUtc: "2023-03-03T01:30:00Z",
      },
      {
        key: "practice-2",
        label: "Practice 2",
        startsAtUtc: "2023-03-03T05:00:00Z",
      },
      {
        key: "practice-3",
        label: "Practice 3",
        startsAtUtc: "2023-03-04T01:30:00Z",
      },
      {
        key: "qualifying",
        label: "Qualifying",
        startsAtUtc: "2023-03-04T05:00:00Z",
      },
      { key: "race", label: "Race", startsAtUtc: "2023-03-05T04:00:00Z" },
    ]);
  });

  // ≤2017：f1db 只有 race 有日期、无时刻，session_time 为空，落回占位（只显示日期）
  it("f1db 与 session_time 都没有时落回占位，仅 race 一格", async () => {
    const meta2017 = {
      ...metaRow,
      date: "2017-11-26",
      time: null,
      free_practice_1_date: null,
      free_practice_1_time: null,
      free_practice_2_date: null,
      free_practice_2_time: null,
      free_practice_3_date: null,
      free_practice_3_time: null,
      qualifying_date: null,
      qualifying_time: null,
      sprint_qualifying_date: null,
      sprint_qualifying_time: null,
      sprint_race_date: null,
      sprint_race_time: null,
      // 用空数组模拟该场无 session_time 行
      session_times: JSON.stringify([]),
    };
    const db = fakeDbBySql(tabFragments({ circuit_full_name: [meta2017] }));
    const page = await createRaceResultsRepository(db).getRacePage(
      2017,
      "abu-dhabi",
    );
    expect(page?.meta.sessions).toEqual([
      { key: "race", label: "Race", startsAtUtc: "2017-11-26T00:00:00Z" },
    ]);
  });

  it("session_times 列缺失时回落到 f1db", async () => {
    // 缺列（metaRowNoSessions 不携带 session_times）：夹具/本地 dev 的真实形态
    const dbMissing = fakeDbBySql(
      tabFragments({ circuit_full_name: [metaRowNoSessions] }),
    );
    const page = await createRaceResultsRepository(dbMissing).getRacePage(
      2026,
      "australia",
    );
    expect(page?.meta.sessions).toEqual([
      { key: "race", label: "Race", startsAtUtc: "2026-03-08T04:00:00Z" },
    ]);
  });

  it("session_weather 只挂到匹配的 session，其余不携带 weather 字段", async () => {
    const metaWithWeather = {
      ...metaRow,
      session_weather: JSON.stringify([
        {
          key: "race",
          tempC: 24.0,
          trackTempC: 41.0,
          prob: null,
          weatherCode: null,
          source: "trackside",
        },
        {
          key: "qualifying",
          tempC: 23.0,
          trackTempC: 40.0,
          prob: null,
          weatherCode: null,
          source: "trackside",
        },
      ]),
    };
    const db = fakeDbBySql(
      tabFragments({ circuit_full_name: [metaWithWeather] }),
    );
    const page = await createRaceResultsRepository(db).getRacePage(
      2026,
      "australia",
    );
    const race = page?.meta.sessions.find((s) => s.key === "race");
    const quali = page?.meta.sessions.find((s) => s.key === "qualifying");
    const p1 = page?.meta.sessions.find((s) => s.key === "practice-1");
    expect(race?.weather).toEqual({
      tempC: 24.0,
      trackTempC: 41.0,
      prob: null,
      weatherCode: null,
      source: "trackside",
    });
    expect(quali?.weather?.tempC).toBe(23.0);
    expect(p1?.weather).toBeUndefined();
  });

  it("forecast 天气只带 temp/prob/weatherCode，trackTempC 为 null", async () => {
    const metaForecast = {
      ...metaRow,
      session_weather: JSON.stringify([
        {
          key: "race",
          tempC: 24.0,
          trackTempC: null,
          prob: 40,
          weatherCode: "rain",
          source: "forecast",
        },
      ]),
    };
    const db = fakeDbBySql(tabFragments({ circuit_full_name: [metaForecast] }));
    const page = await createRaceResultsRepository(db).getRacePage(
      2026,
      "australia",
    );
    const race = page?.meta.sessions.find((s) => s.key === "race");
    expect(race?.weather).toEqual({
      tempC: 24.0,
      trackTempC: null,
      prob: 40,
      weatherCode: "rain",
      source: "forecast",
    });
  });
});
