import { type AskDatabase, createD1AskDatabase } from "./ask/db.js";
import {
  type CircuitRepository,
  createCircuitRepository,
  createD1CircuitDatabase,
} from "./circuit-repository.js";
import {
  createD1DriverDatabase,
  createDriverRepository,
  type DriverRepository,
} from "./driver-repository.js";
import {
  createD1RaceResultsDatabase,
  createRaceResultsRepository,
  type RaceResultsRepository,
} from "./race-results-repository.js";
import {
  createD1TeamDatabase,
  createTeamRepository,
  type TeamRepository,
} from "./team-repository.js";

export interface AppRepositories {
  raceResults: RaceResultsRepository;
  driver: DriverRepository;
  team: TeamRepository;
  circuit: CircuitRepository;
}

export interface AppData {
  repositories: AppRepositories;
  askDb: AskDatabase;
}

// DEV 夹具与 D1 分支都收敛在此处，页面与 API 路由零 import.meta.env 判定
export async function createAppData(env: Env): Promise<AppData> {
  if (import.meta.env.DEV) {
    const { createDevAskDatabase } = await import("./ask/fixtures/ask-dev.js");
    return {
      repositories: {
        raceResults: createRaceResultsRepository(),
        driver: createDriverRepository(),
        team: createTeamRepository(),
        circuit: createCircuitRepository(),
      },
      askDb: await createDevAskDatabase(),
    };
  }
  return {
    repositories: {
      raceResults: createRaceResultsRepository(
        createD1RaceResultsDatabase(env.F1_DB),
      ),
      driver: createDriverRepository(createD1DriverDatabase(env.F1_DB)),
      team: createTeamRepository(createD1TeamDatabase(env.F1_DB)),
      circuit: createCircuitRepository(createD1CircuitDatabase(env.F1_DB)),
    },
    askDb: createD1AskDatabase(env.F1_DB),
  };
}

let cached: Promise<AppData> | undefined;

// 模块级 memo：D1 wrapper 与 DEV 夹具均无状态，worker 实例内跨请求复用安全；
// DEV 夹具只在首次请求构建一次，不随每次页面渲染重复 await
export function getAppData(env: Env): Promise<AppData> {
  cached ??= createAppData(env);
  return cached;
}
