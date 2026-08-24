import { type AskDatabase, createStaticAskDatabase } from "../db.js";
import {
  constructorChampionshipYearsSql,
  constructorIdentitySql,
  constructorRefSql,
  constructorStandingsSql,
  driverChampionshipYearsSql,
  driverIdentitySql,
  driverRefSql,
  driverStandingsSql,
  grandPrixRefSql,
  raceMetaSql,
  raceResultRowsSql,
  seasonCheckSql,
} from "../tools.js";

// DEV 手动联调用：实体解析经 ref SQL 命中固定行（车手→Hamilton、车队→Ferrari），再走 identity/年份行（e2e 全程 mock /api/ask，不依赖这里）
export async function createDevAskDatabase(): Promise<AskDatabase> {
  return createStaticAskDatabase({
    [seasonCheckSql]: [{ ok: 1 }],
    [driverRefSql]: [{ id: "lewis-hamilton", name: "Lewis Hamilton" }],
    [constructorRefSql]: [{ id: "ferrari", name: "Ferrari" }],
    [driverIdentitySql]: [
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
        best_position: 1,
      },
    ],
    [driverChampionshipYearsSql]: [
      { year: 2008 },
      { year: 2014 },
      { year: 2015 },
      { year: 2017 },
      { year: 2018 },
      { year: 2019 },
      { year: 2020 },
    ],
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
        best_position: 1,
      },
    ],
    [constructorChampionshipYearsSql]: [{ year: 2008 }],
    [driverStandingsSql]: [
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
    [constructorStandingsSql]: [
      {
        position_text: "1",
        points: 613.5,
        championship_won: 1,
        constructor_id: "red-bull",
        constructor_name: "Red Bull",
      },
    ],
    [grandPrixRefSql]: [{ id: "monaco", name: "Monaco" }],
    [raceMetaSql]: [
      {
        race_id: 1108,
        year: 2024,
        round: 8,
        date: "2024-05-26",
        grand_prix_name: "Monaco",
      },
    ],
    [raceResultRowsSql]: [
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
    ],
  });
}
