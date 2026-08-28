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

// 模块级 memo：D1 wrapper 与 DEV 夹具均无状态，worker 实例内跨请求复用安全；
// DEV 夹具只在首次请求构建一次，不随每次页面渲染重复 await。
// 首次构建失败（如 DEV 夹具异常）时重置，避免失败被永久缓存成 rejected promise
let cached: Promise<AppData> | undefined;

export function getAppData(env: Env): Promise<AppData> {
  cached ??= createAppData(env);
  cached.catch(() => {
    cached = undefined;
  });
  return cached;
}

// f1db 数据版本（sync_state 自增 id），ETag 的数据侧组成部分。刻意不随
// AppData memo：缓存 ETag 必须反映当前数据版本，同步重导后长活 worker
// 隔离实例若持旧值会让过期页面持续 304，用户拿不到新数据。每次渲染一次点查
export async function getF1dbVersion(d1: D1Database): Promise<number> {
  const { results } = await d1
    .prepare("SELECT id FROM sync_state")
    .all<{ id: number }>();
  return results[0]?.id ?? 0;
}
