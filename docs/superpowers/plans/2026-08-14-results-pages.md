# Results 页面复刻 f1.com 实现计划

> 面向 AI 代理的工作者：必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

目标：复刻 f1.com /en/results/2026/races 结构——`/results/[year]/races` 列表页 + `/results/[year]/races/[slug]/[tab]` 分站子页面（race-result、fastest-laps、pit-stop-summary、starting-grid、qualifying、practice-1/2/3），并把 Results 分区（列表、分站、积分榜）与日历页的数据源全部切到 D1 f1db。旧 results 地址 301、旧 racing 分站页删除，R2 访客路径只剩首页。

架构：新建 `race-results-repository.ts`（D1 单 batch 查询 + 行映射，DEV 走 fixture 真实快照，模式同 driver/team-repository）。核心是一条 calendar SQL（全年赛历 + 冠军/杆位），列表页是它的已完赛过滤视图；积分榜两条 SQL（wins 由正赛 P1 聚合）。新页面组 `pages/results/[year]/...`；`[year]/results/*` 变 301 stub；`[year]/racing/[event]`、`ResultTable.astro`、`SeasonError.astro`、`year-context.ts` 删除；日历页重写为 f1db 数据 + 直链新分站页。年份切换经 BaseLayout → SiteHeader → YearSelector 新增的 `yearHref` 停留在 Results 分区。

技术栈：Astro 7 + Cloudflare Workers（D1 `env.F1_DB`、wrangler 4）+ Vitest + Playwright。

需求文档：`docs/requirements/2026-08-14-results-pages.md`（已获用户批准的范围；实现与它有出入时停下确认，不要自行改需求）。

## 全局约束

- 提交前运行与改动范围匹配的验证：`pnpm check`、`pnpm test`、`pnpm -r build`、`pnpm --filter @f1-box/web test:e2e`。
- 访客请求不访问上游 F1 数据源；页面数据只来自 D1 或 fixture。
- 校验只放在系统边界：D1 行经 `db-parse.js` 守卫（asRecord/asString/asNumber），内部调用信任类型。
- fixture 仅 DEV 使用的真实数据快照，动态 import（不打进生产 bundle）；生产一律走 `env.F1_DB`。
- 车手姓名一律取 `driver.name`（显示名，如 George Russell），不用 `full_name`（正式名，如 George William Russell）。
- Commit 标题英文 Conventional Commits；`git add` 只加具体文件，禁止 `git add -A`。
- e2e 跑在 `astro dev` 上（fixture 数据），行数断言与 fixture 对齐。
- 操作真实云端 D1 必须 `--remote`；先 `cd apps/web && pnpm exec wrangler whoami` 确认登录，未登录停下找用户。

## 参考数据（f1db，2026-08-18 已在 D1 逐列核实）

- D1 绑定 `env.F1_DB`（database f1db）。内容为 f1db 官方 SQLite 全量：`race_data` 表按 type 存所有比赛数据行，各结果是它的视图；视图行序一律 `ORDER BY position_display_order`。
- `race`：id、year、round、date、time（UTC "HH:MM"）、grand_prix_id、official_name、laps、course_length（DECIMAL，km）、free_practice_1..3_date/time、qualifying_date/time、sprint_qualifying_date/time、sprint_race_date/time、circuit_id。
- `grand_prix`：id（即新路由 slug）、name（地名，如 Australia）、full_name（如 Australian Grand Prix，日历卡标题）、country_id。
- `country`：alpha2_code、name。`circuit`：name、place_name（2026 澳洲站 circuit.name 为 Melbourne）。
- `driver`：id、name（显示名）、full_name、abbreviation。`constructor`：id（与 vendor logo/color 的 teamId 同体系）、name。`season`：year，1950–2026 共 77 行。
- `season_driver_standing` / `season_constructor_standing`：year、position_display_order、position_number、position_text、driver_id/constructor_id、points（DECIMAL）、championship_won。无 wins 列——wins 由正赛 P1 行按年聚合（race_data 有 (driver_id, type) 索引，相关子查询可用）。
- 用到的视图（均含 race_id、position_display_order、position_number、position_text、driver_number、driver_id、constructor_id）：
  - `race_result`：laps、time、reason_retired、gap、points、pit_stops、fastest_lap
  - `qualifying_result`：q1、q2、q3、laps
  - `starting_grid_position`：time
  - `fastest_lap`：lap、time、time_millis
  - `pit_stop`：stop、lap、time、time_millis（数据自 1994 年起）
  - `free_practice_1_result` / `free_practice_2_result` / `free_practice_3_result`：time、gap、laps
- 2026 现状（快照）：22 站赛历，11 站已完赛（round 1–11）；澳洲站 race.id 1150，行数 race_result 22、starting_grid 22、qualifying 19、fastest_lap 20、pit_stop 30（单停）、free_practice_1/2/3 为 21/22/21；积分榜 driver 22 行、constructor 11 行。
- R2 现状：ingest 只发布 2026 一个赛季（ingest.yml 固定 `--season 2026`）。本计划完成后 R2 访客路径只剩首页 `getIndex`。
- session 本地时区显示沿用 `scripts/client.ts` 的 `[data-local-time][data-timestamp]` 机制：服务端输出 `<time>` + 隐藏 `<span data-local-time ...>`，客户端替换为本地时间。

## 文件结构

创建：

- `apps/web/src/lib/race-results-repository.ts` — D1 查询 + 行映射 + DEV fixture 分流；导出模型与 `createRaceResultsRepository(db?)`、`createD1RaceResultsDatabase(d1)`、`formatAvgSpeedKph`、`formatSeconds`、`RACE_TAB_FIELDS`
- `apps/web/src/lib/fixtures/season-races-2026.json` — 2026 全 22 站日历快照（未来站 winner/pole 字段为 null）
- `apps/web/src/lib/fixtures/standings-2026.json` — 2026 积分榜快照（drivers + teams）
- `apps/web/src/lib/fixtures/race-australia-2026.json` — 2026 澳洲站全 tab 快照
- `apps/web/src/pages/results/index.astro` — 301 最新赛季 races
- `apps/web/src/pages/results/[year]/index.astro` — 301 该年 races
- `apps/web/src/pages/results/[year]/races/index.astro` — 列表页
- `apps/web/src/pages/results/[year]/races/[slug]/index.astro` — 301 race-result
- `apps/web/src/pages/results/[year]/races/[slug]/[tab].astro` — 分站子页面
- `apps/web/src/pages/results/[year]/drivers.astro`、`teams.astro` — 积分榜页（f1db 数据源，全新实现）
- `apps/web/src/components/RaceHeader.astro` — 分站 hero（轮次、GP 名、日期、赛道、session 时间行）
- `apps/web/src/components/RaceTabsNav.astro` — 子导航（只显示有数据的 tab）
- `apps/web/src/components/RaceTable.astro` — 通用结果表（列配置按 tab，Driver monogram / Team logo 单元格）
- `apps/web/tests/race-results-repository.test.ts`、`apps/web/tests/e2e/results.spec.ts`

修改：

- `apps/web/src/lib/routing.ts` — `raceTabKeys`、`RaceTabKey`、`RACE_TAB_LABELS`、`resolveRaceTab`（tab key 的单一定义点）
- `apps/web/src/components/YearSelector.astro`、`SiteHeader.astro`、`apps/web/src/layouts/BaseLayout.astro` — 新增 `hrefFor/yearHref`（函数 `(year) => url`），新页面年份切换指向 `/results/...`；不传时行为不变
- `apps/web/src/components/ResultsNav.astro` — tabs 链接指向 `/results/[year]/...`
- `apps/web/src/components/StandingsTable.astro` — 行模型从 R2 类型改为 repository 的 DriverStandingRow/TeamStandingRow
- `apps/web/src/components/RaceCard.astro` — 重写为 f1db 日历模型（Props `{ race, href }`，state 由有无冠军推导）
- `apps/web/src/pages/[year]/racing.astro` — 数据层换 f1db calendar，分站链接直链新分站页
- `apps/web/src/pages/[year]/results/index.astro`、`races.astro`、`drivers.astro`、`teams.astro` — 变 301 stub
- `apps/web/src/lib/page-data.ts` — 删除只剩 year-context 使用的 `getSeason`
- `apps/web/src/styles/global.css` — 新增 `.vendor-cell` 系列单元格样式；清理 race-card 无效 state 变体
- `apps/web/tests/routing.test.ts`、`apps/web/tests/e2e/season.spec.ts` — 更新断言

删除：

- `apps/web/src/pages/[year]/racing/[event].astro` — 旧分站页不保留（用户决定：老地址直接删）
- `apps/web/src/components/ResultTable.astro` — 唯一引用者 racing/[event].astro 被删
- `apps/web/src/components/SeasonError.astro` — 引用者（racing/[event]、旧 results 四页）全部退役
- `apps/web/src/lib/year-context.ts` — 引用者全部退役

不动：`FreshnessBadge.astro`（SiteFooter 仍用）、`season-repository.ts`（首页 getIndex 仍走它，Jolpica 退役时再动）、首页。

## 模型定义（repository 导出，任务间共用，先定死）

```ts
// 一条 calendar SQL 的行：列表页、日历页共用
// winnerName === null 即未完赛（列表页过滤、日历卡状态、RaceTabsNav 均用此判定）
export interface RaceSummary {
  round: number;
  slug: string;              // grand_prix_id
  name: string;              // gp.name（地名，列表页 GP 列）
  raceName: string;          // gp.full_name（Australian Grand Prix，日历卡标题）
  alpha2Code: string;
  countryName: string;
  date: string;              // "YYYY-MM-DD"
  time: string | null;       // UTC "HH:MM"，日历卡 startsAt
  laps: number;
  circuitName: string;
  circuitPlace: string;
  winnerName: string | null;
  winnerCode: string | null;
  winnerTeamId: string | null;
  winnerTeamName: string | null;
  winnerTime: string | null;
  poleName: string | null;
  poleCode: string | null;
}

export interface RaceSession { key: string; label: string; startsAtUtc: string; }

export interface RaceMeta {
  year: number; round: number; slug: string; name: string; officialName: string;
  date: string; laps: number; courseLength: number;
  circuitName: string; circuitPlace: string; countryName: string; alpha2Code: string;
  sessions: RaceSession[];
}

// 下列行模型共有字段：position: number | null; positionText: string;
// driverNumber: string | null; driverId: string; driverName: string; driverCode: string;
// constructorId: string; constructorName: string（pit_stops 无 position/positionText）
export interface RaceResultRow { /* 共有字段 */ laps: number | null; time: string | null; retiredReason: string | null; gap: string | null; points: number | null; }
export interface QualifyingRow { /* 共有字段 */ q1: string | null; q2: string | null; q3: string | null; laps: number | null; }
export interface GridRow { /* 共有字段 */ time: string | null; }
export interface FastestLapRow { /* 共有字段 */ lap: number | null; time: string | null; avgSpeedKph: string | null; }
export interface PitStopRow { driverNumber: string | null; driverId: string; driverName: string; driverCode: string; constructorId: string; constructorName: string; stops: number; totalSeconds: string | null; }
export interface PracticeRow { /* 共有字段 */ time: string | null; gap: string | null; laps: number | null; }

export interface RacePage {
  meta: RaceMeta;
  tabs: {
    raceResult: RaceResultRow[];
    qualifying: QualifyingRow[];
    startingGrid: GridRow[];
    fastestLaps: FastestLapRow[];
    pitStops: PitStopRow[];
    practice1: PracticeRow[]; practice2: PracticeRow[]; practice3: PracticeRow[];
  };
}

// 积分榜行（f1db standings + wins 聚合）
export interface DriverStandingRow {
  position: number | null; positionText: string;
  driverId: string; driverName: string; driverCode: string;
  points: number; wins: number;
}
export interface TeamStandingRow {
  position: number | null; positionText: string;
  teamId: string; teamName: string;
  points: number; wins: number;
}

// tab key → tabs 字段，RaceTabsNav 与 [tab].astro 共用
export const RACE_TAB_FIELDS: Record<RaceTabKey, keyof RacePage["tabs"]> = {
  "race-result": "raceResult", "fastest-laps": "fastestLaps",
  "pit-stop-summary": "pitStops", "starting-grid": "startingGrid",
  "qualifying": "qualifying",
  "practice-1": "practice1", "practice-2": "practice2", "practice-3": "practice3",
};
```

格式辅助（repository 导出，纯函数便于测试）：

```ts
export function formatAvgSpeedKph(courseLengthKm: number, timeMillis: number | null): string | null {
  if (timeMillis === null || timeMillis <= 0) return null;
  return (courseLengthKm / (timeMillis / 3_600_000)).toFixed(3);
}
export function formatSeconds(totalMillis: number | null): string | null {
  if (totalMillis === null) return null;
  return (totalMillis / 1000).toFixed(3);
}
```

tab key 与标签定义在 `routing.ts`（任务 1）：`raceTabKeys`、`RaceTabKey`、`RACE_TAB_LABELS`、`resolveRaceTab`。

---

## 任务 1：路由 tab 辅助 + results 年份重定向

文件：修改 `apps/web/src/lib/routing.ts`；创建 `apps/web/src/pages/results/[year]/index.astro`；测试 `apps/web/tests/routing.test.ts`

- [ ] 步骤 1：编写失败的测试

`apps/web/tests/routing.test.ts`：顶部 import 块追加 `raceTabKeys`、`resolveRaceTab`，文件末尾追加：

```ts
describe("resolveRaceTab", () => {
  it("exposes the eight supported tabs in display order", () => {
    expect(raceTabKeys).toEqual([
      "race-result", "fastest-laps", "pit-stop-summary", "starting-grid",
      "qualifying", "practice-1", "practice-2", "practice-3",
    ]);
  });

  it("accepts known tabs and rejects unknown", () => {
    expect(resolveRaceTab("race-result")).toBe("race-result");
    expect(resolveRaceTab("practice-3")).toBe("practice-3");
    expect(resolveRaceTab("sprint")).toBeNull();
    expect(resolveRaceTab("")).toBeNull();
  });
});
```

- [ ] 步骤 2：运行测试验证失败

运行：`pnpm --filter @f1-box/web test routing.test.ts`
预期：FAIL，raceTabKeys/resolveRaceTab 未导出

- [ ] 步骤 3：实现路由辅助

`apps/web/src/lib/routing.ts` 末尾追加：

```ts
export const raceTabKeys = [
  "race-result", "fastest-laps", "pit-stop-summary", "starting-grid",
  "qualifying", "practice-1", "practice-2", "practice-3",
] as const;
export type RaceTabKey = (typeof raceTabKeys)[number];

// 顺序即分站子导航显示顺序（与 f1.com 一致）
export const RACE_TAB_LABELS: Record<RaceTabKey, string> = {
  "race-result": "Race Result",
  "fastest-laps": "Fastest Laps",
  "pit-stop-summary": "Pit Stop Summary",
  "starting-grid": "Starting Grid",
  qualifying: "Qualifying",
  "practice-1": "Practice 1",
  "practice-2": "Practice 2",
  "practice-3": "Practice 3",
};

export function resolveRaceTab(value: string): RaceTabKey | null {
  return (raceTabKeys as readonly string[]).includes(value) ? (value as RaceTabKey) : null;
}
```

- [ ] 步骤 4：创建年份重定向页

`apps/web/src/pages/results/[year]/index.astro`：

```astro
---
const year = Astro.params.year;
return Astro.redirect(`/results/${year}/races`, 301);
---
```

- [ ] 步骤 5：运行测试验证通过

运行：`pnpm --filter @f1-box/web test routing.test.ts`，再运行 `pnpm --filter @f1-box/web check`
预期：均 PASS

- [ ] 步骤 6：Commit

```bash
git add apps/web/src/lib/routing.ts apps/web/tests/routing.test.ts "apps/web/src/pages/results/[year]/index.astro"
git commit -m "feat: add race tab routing helpers and results year redirect"
```

---

## 任务 2：repository（getSeasonCalendar/listRaces/getSeasonYears）+ 日历 fixture + /results 重定向

文件：创建 `apps/web/src/lib/race-results-repository.ts`、`apps/web/src/lib/fixtures/season-races-2026.json`、`apps/web/src/pages/results/index.astro`；测试 `apps/web/tests/race-results-repository.test.ts`

- [ ] 步骤 1：写入日历 fixture（真实数据快照，2026-08-18 导出，无需重新查询）

`apps/web/src/lib/fixtures/season-races-2026.json`：

```json
{
  "years": [2026],
  "races": [
    { "round": 1, "slug": "australia", "name": "Australia", "raceName": "Australian Grand Prix", "alpha2Code": "AU", "countryName": "Australia", "date": "2026-03-08", "time": "04:00", "laps": 58, "circuitName": "Melbourne", "circuitPlace": "Melbourne", "winnerName": "George Russell", "winnerCode": "RUS", "winnerTeamId": "mercedes", "winnerTeamName": "Mercedes", "winnerTime": "1:23:06.801", "poleName": "George Russell", "poleCode": "RUS" },
    { "round": 2, "slug": "china", "name": "China", "raceName": "Chinese Grand Prix", "alpha2Code": "CN", "countryName": "China", "date": "2026-03-15", "time": "07:00", "laps": 56, "circuitName": "Shanghai", "circuitPlace": "Shanghai", "winnerName": "Kimi Antonelli", "winnerCode": "ANT", "winnerTeamId": "mercedes", "winnerTeamName": "Mercedes", "winnerTime": "1:33:15.607", "poleName": "Kimi Antonelli", "poleCode": "ANT" },
    { "round": 3, "slug": "japan", "name": "Japan", "raceName": "Japanese Grand Prix", "alpha2Code": "JP", "countryName": "Japan", "date": "2026-03-29", "time": "05:00", "laps": 53, "circuitName": "Suzuka", "circuitPlace": "Suzuka", "winnerName": "Kimi Antonelli", "winnerCode": "ANT", "winnerTeamId": "mercedes", "winnerTeamName": "Mercedes", "winnerTime": "1:28:03.403", "poleName": "Kimi Antonelli", "poleCode": "ANT" },
    { "round": 4, "slug": "miami", "name": "Miami", "raceName": "Miami Grand Prix", "alpha2Code": "US", "countryName": "United States of America", "date": "2026-05-03", "time": "17:00", "laps": 57, "circuitName": "Miami", "circuitPlace": "Miami Gardens", "winnerName": "Kimi Antonelli", "winnerCode": "ANT", "winnerTeamId": "mercedes", "winnerTeamName": "Mercedes", "winnerTime": "1:33:19.273", "poleName": "Kimi Antonelli", "poleCode": "ANT" },
    { "round": 5, "slug": "canada", "name": "Canada", "raceName": "Canadian Grand Prix", "alpha2Code": "CA", "countryName": "Canada", "date": "2026-05-24", "time": "20:00", "laps": 68, "circuitName": "Gilles Villeneuve", "circuitPlace": "Montreal", "winnerName": "Kimi Antonelli", "winnerCode": "ANT", "winnerTeamId": "mercedes", "winnerTeamName": "Mercedes", "winnerTime": "1:28:15.758", "poleName": "George Russell", "poleCode": "RUS" },
    { "round": 6, "slug": "monaco", "name": "Monaco", "raceName": "Monaco Grand Prix", "alpha2Code": "MC", "countryName": "Monaco", "date": "2026-06-07", "time": "13:00", "laps": 78, "circuitName": "Monaco", "circuitPlace": "Monte Carlo", "winnerName": "Kimi Antonelli", "winnerCode": "ANT", "winnerTeamId": "mercedes", "winnerTeamName": "Mercedes", "winnerTime": "2:23:31.243", "poleName": "Kimi Antonelli", "poleCode": "ANT" },
    { "round": 7, "slug": "barcelona-catalunya", "name": "Barcelona-Catalunya", "raceName": "Barcelona-Catalunya Grand Prix", "alpha2Code": "ES", "countryName": "Spain", "date": "2026-06-14", "time": "13:00", "laps": 66, "circuitName": "Catalunya", "circuitPlace": "Montmeló", "winnerName": "Lewis Hamilton", "winnerCode": "HAM", "winnerTeamId": "ferrari", "winnerTeamName": "Ferrari", "winnerTime": "1:32:28.105", "poleName": "George Russell", "poleCode": "RUS" },
    { "round": 8, "slug": "austria", "name": "Austria", "raceName": "Austrian Grand Prix", "alpha2Code": "AT", "countryName": "Austria", "date": "2026-06-28", "time": "13:00", "laps": 71, "circuitName": "Red Bull Ring", "circuitPlace": "Spielberg", "winnerName": "George Russell", "winnerCode": "RUS", "winnerTeamId": "mercedes", "winnerTeamName": "Mercedes", "winnerTime": "1:26:37.979", "poleName": "George Russell", "poleCode": "RUS" },
    { "round": 9, "slug": "great-britain", "name": "Great Britain", "raceName": "British Grand Prix", "alpha2Code": "GB", "countryName": "United Kingdom", "date": "2026-07-05", "time": "14:00", "laps": 52, "circuitName": "Silverstone", "circuitPlace": "Silverstone", "winnerName": "Charles Leclerc", "winnerCode": "LEC", "winnerTeamId": "ferrari", "winnerTeamName": "Ferrari", "winnerTime": "1:27:11.335", "poleName": "Kimi Antonelli", "poleCode": "ANT" },
    { "round": 10, "slug": "belgium", "name": "Belgium", "raceName": "Belgian Grand Prix", "alpha2Code": "BE", "countryName": "Belgium", "date": "2026-07-19", "time": "13:00", "laps": 44, "circuitName": "Spa-Francorchamps", "circuitPlace": "Spa", "winnerName": "Kimi Antonelli", "winnerCode": "ANT", "winnerTeamId": "mercedes", "winnerTeamName": "Mercedes", "winnerTime": "1:24:42.479", "poleName": "Kimi Antonelli", "poleCode": "ANT" },
    { "round": 11, "slug": "hungary", "name": "Hungary", "raceName": "Hungarian Grand Prix", "alpha2Code": "HU", "countryName": "Hungary", "date": "2026-07-26", "time": "13:00", "laps": 70, "circuitName": "Hungaroring", "circuitPlace": "Budapest", "winnerName": "Lando Norris", "winnerCode": "NOR", "winnerTeamId": "mclaren", "winnerTeamName": "McLaren", "winnerTime": "1:39:56.180", "poleName": "Lando Norris", "poleCode": "NOR" },
    { "round": 12, "slug": "netherlands", "name": "Netherlands", "raceName": "Dutch Grand Prix", "alpha2Code": "NL", "countryName": "Netherlands", "date": "2026-08-23", "time": "13:00", "laps": 72, "circuitName": "Zandvoort", "circuitPlace": "Zandvoort", "winnerName": null, "winnerCode": null, "winnerTeamId": null, "winnerTeamName": null, "winnerTime": null, "poleName": null, "poleCode": null },
    { "round": 13, "slug": "italy", "name": "Italy", "raceName": "Italian Grand Prix", "alpha2Code": "IT", "countryName": "Italy", "date": "2026-09-06", "time": "13:00", "laps": 53, "circuitName": "Monza", "circuitPlace": "Monza", "winnerName": null, "winnerCode": null, "winnerTeamId": null, "winnerTeamName": null, "winnerTime": null, "poleName": null, "poleCode": null },
    { "round": 14, "slug": "spain", "name": "Spain", "raceName": "Spanish Grand Prix", "alpha2Code": "ES", "countryName": "Spain", "date": "2026-09-13", "time": "13:00", "laps": 57, "circuitName": "Madring", "circuitPlace": "Madrid", "winnerName": null, "winnerCode": null, "winnerTeamId": null, "winnerTeamName": null, "winnerTime": null, "poleName": null, "poleCode": null },
    { "round": 15, "slug": "azerbaijan", "name": "Azerbaijan", "raceName": "Azerbaijan Grand Prix", "alpha2Code": "AZ", "countryName": "Azerbaijan", "date": "2026-09-26", "time": "11:00", "laps": 51, "circuitName": "Baku", "circuitPlace": "Baku", "winnerName": null, "winnerCode": null, "winnerTeamId": null, "winnerTeamName": null, "winnerTime": null, "poleName": null, "poleCode": null },
    { "round": 16, "slug": "singapore", "name": "Singapore", "raceName": "Singapore Grand Prix", "alpha2Code": "SG", "countryName": "Singapore", "date": "2026-10-11", "time": "12:00", "laps": 62, "circuitName": "Marina Bay", "circuitPlace": "Singapore", "winnerName": null, "winnerCode": null, "winnerTeamId": null, "winnerTeamName": null, "winnerTime": null, "poleName": null, "poleCode": null },
    { "round": 17, "slug": "united-states", "name": "United States", "raceName": "United States Grand Prix", "alpha2Code": "US", "countryName": "United States of America", "date": "2026-10-25", "time": "20:00", "laps": 56, "circuitName": "Americas", "circuitPlace": "Austin", "winnerName": null, "winnerCode": null, "winnerTeamId": null, "winnerTeamName": null, "winnerTime": null, "poleName": null, "poleCode": null },
    { "round": 18, "slug": "mexico", "name": "Mexico", "raceName": "Mexican Grand Prix", "alpha2Code": "MX", "countryName": "Mexico", "date": "2026-11-01", "time": "20:00", "laps": 71, "circuitName": "Hermanos Rodríguez", "circuitPlace": "Mexico City", "winnerName": null, "winnerCode": null, "winnerTeamId": null, "winnerTeamName": null, "winnerTime": null, "poleName": null, "poleCode": null },
    { "round": 19, "slug": "sao-paulo", "name": "São Paulo", "raceName": "São Paulo Grand Prix", "alpha2Code": "BR", "countryName": "Brazil", "date": "2026-11-08", "time": "17:00", "laps": 71, "circuitName": "José Carlos Pace", "circuitPlace": "São Paulo", "winnerName": null, "winnerCode": null, "winnerTeamId": null, "winnerTeamName": null, "winnerTime": null, "poleName": null, "poleCode": null },
    { "round": 20, "slug": "las-vegas", "name": "Las Vegas", "raceName": "Las Vegas Grand Prix", "alpha2Code": "US", "countryName": "United States of America", "date": "2026-11-22", "time": "04:00", "laps": 50, "circuitName": "Las Vegas", "circuitPlace": "Las Vegas", "winnerName": null, "winnerCode": null, "winnerTeamId": null, "winnerTeamName": null, "winnerTime": null, "poleName": null, "poleCode": null },
    { "round": 21, "slug": "qatar", "name": "Qatar", "raceName": "Qatar Grand Prix", "alpha2Code": "QA", "countryName": "Qatar", "date": "2026-11-29", "time": "16:00", "laps": 57, "circuitName": "Lusail", "circuitPlace": "Lusail", "winnerName": null, "winnerCode": null, "winnerTeamId": null, "winnerTeamName": null, "winnerTime": null, "poleName": null, "poleCode": null },
    { "round": 22, "slug": "abu-dhabi", "name": "Abu Dhabi", "raceName": "Abu Dhabi Grand Prix", "alpha2Code": "AE", "countryName": "United Arab Emirates", "date": "2026-12-06", "time": "13:00", "laps": 58, "circuitName": "Yas Marina", "circuitPlace": "Abu Dhabi", "winnerName": null, "winnerCode": null, "winnerTeamId": null, "winnerTeamName": null, "winnerTime": null, "poleName": null, "poleCode": null }
  ]
}
```

fixture 过期重新生成用的 SQL（本轮不需要跑）：任务 2 的 `seasonCalendarSql` 把 SELECT 列加 camelCase 别名（round/slug/name/raceName/alpha2Code/countryName/date/time/laps/circuitName/circuitPlace/winnerName/winnerCode/winnerTeamId/winnerTeamName/winnerTime/poleName/poleCode）。

- [ ] 步骤 2：编写失败的测试

`apps/web/tests/race-results-repository.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import {
  createRaceResultsRepository,
  formatAvgSpeedKph,
  formatSeconds,
  type RaceResultsDatabase,
} from "../src/lib/race-results-repository.js";

// 按 SQL 片段分发结果；未登记的语句直接抛错，暴露意外的查询
function fakeDbBySql(rowsBySqlFragment: Record<string, unknown[]>): RaceResultsDatabase {
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

describe("createRaceResultsRepository getSeasonCalendar / listRaces", () => {
  it("maps a completed race with winner and pole", async () => {
    const db = fakeDbBySql({
      circuit_place: [{
        round: 1, slug: "australia", name: "Australia", race_name: "Australian Grand Prix",
        alpha2_code: "AU", country_name: "Australia", date: "2026-03-08", time: "04:00",
        laps: 58, circuit_name: "Melbourne", circuit_place: "Melbourne",
        winner_name: "George Russell", winner_code: "RUS",
        winner_team_id: "mercedes", winner_team_name: "Mercedes",
        winner_time: "1:23:06.801", pole_name: "George Russell", pole_code: "RUS",
      }],
    });
    const rows = await createRaceResultsRepository(db).getSeasonCalendar(2026);
    expect(rows).toEqual([{
      round: 1, slug: "australia", name: "Australia", raceName: "Australian Grand Prix",
      alpha2Code: "AU", countryName: "Australia", date: "2026-03-08", time: "04:00",
      laps: 58, circuitName: "Melbourne", circuitPlace: "Melbourne",
      winnerName: "George Russell", winnerCode: "RUS",
      winnerTeamId: "mercedes", winnerTeamName: "Mercedes",
      winnerTime: "1:23:06.801", poleName: "George Russell", poleCode: "RUS",
    }]);
  });

  it("maps an upcoming race without winner row", async () => {
    const db = fakeDbBySql({
      circuit_place: [{
        round: 12, slug: "netherlands", name: "Netherlands", race_name: "Dutch Grand Prix",
        alpha2_code: "NL", country_name: "Netherlands", date: "2026-08-23", time: "13:00",
        laps: 72, circuit_name: "Zandvoort", circuit_place: "Zandvoort",
        winner_name: null, winner_code: null, winner_team_id: null,
        winner_team_name: null, winner_time: null, pole_name: null, pole_code: null,
      }],
    });
    const [row] = await createRaceResultsRepository(db).getSeasonCalendar(2026);
    expect(row.winnerName).toBeNull();
    expect(row.poleName).toBeNull();
  });

  it("DEV fixture calendar has 22 rounds, list only completed", async () => {
    const repository = createRaceResultsRepository();
    expect(await repository.getSeasonCalendar(2026)).toHaveLength(22);
    const completed = await repository.listRaces(2026);
    expect(completed).toHaveLength(11);
    expect(completed.every((race) => race.winnerName !== null)).toBe(true);
    expect(await repository.getSeasonCalendar(2025)).toEqual([]);
  });
});

describe("createRaceResultsRepository getSeasonYears", () => {
  it("reads season years from the season table", async () => {
    const db = fakeDbBySql({ "FROM season": [{ year: 2026 }, { year: 1950 }] });
    expect(await createRaceResultsRepository(db).getSeasonYears()).toEqual([2026, 1950]);
  });

  it("DEV fixture years are [2026]", async () => {
    expect(await createRaceResultsRepository().getSeasonYears()).toEqual([2026]);
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
```

- [ ] 步骤 3：运行测试验证失败

运行：`pnpm --filter @f1-box/web test race-results-repository.test.ts`
预期：FAIL，模块不存在

- [ ] 步骤 4：实现 repository

`apps/web/src/lib/race-results-repository.ts`：

```ts
import { asNumber, asRecord, asString } from "./db-parse.js";
import { mapSeasonYearRows, seasonYearsSql } from "./season-years.js";

export interface RaceSummary {
  round: number;
  slug: string;
  name: string;
  raceName: string;
  alpha2Code: string;
  countryName: string;
  date: string;
  time: string | null;
  laps: number;
  circuitName: string;
  circuitPlace: string;
  winnerName: string | null;
  winnerCode: string | null;
  winnerTeamId: string | null;
  winnerTeamName: string | null;
  winnerTime: string | null;
  poleName: string | null;
  poleCode: string | null;
}

export interface RaceResultsDatabase {
  batch(
    statements: { sql: string; values: readonly unknown[] }[],
  ): Promise<{ results: unknown[] }[]>;
}

// D1 batch 需要预编译语句，仓库层接口用 {sql, values} 以便测试替身
export function createD1RaceResultsDatabase(d1: D1Database): RaceResultsDatabase {
  return {
    batch: (statements) =>
      d1.batch(
        statements.map((statement) =>
          d1.prepare(statement.sql).bind(...statement.values),
        ),
      ),
  };
}

// 一条 SQL 出全年日历：冠军/完赛状态 = 正赛 P1 行，杆位 = 排位 P1 行；
// 车手名取显示名 d.name（与目录页同口径）
const seasonCalendarSql = `SELECT ra.round, ra.grand_prix_id AS slug, gp.name,
       gp.full_name AS race_name, c.alpha2_code, c.name AS country_name,
       ra.date, ra.time, ra.laps,
       ci.name AS circuit_name, ci.place_name AS circuit_place,
       wd.name AS winner_name, wd.abbreviation AS winner_code,
       wct.id AS winner_team_id, wct.name AS winner_team_name, wrr.time AS winner_time,
       pd.name AS pole_name, pd.abbreviation AS pole_code
FROM race ra
JOIN grand_prix gp ON ra.grand_prix_id = gp.id
JOIN country c ON gp.country_id = c.id
JOIN circuit ci ON ra.circuit_id = ci.id
LEFT JOIN race_result wrr ON wrr.race_id = ra.id AND wrr.position_number = 1
LEFT JOIN driver wd ON wrr.driver_id = wd.id
LEFT JOIN constructor wct ON wrr.constructor_id = wct.id
LEFT JOIN qualifying_result qr ON qr.race_id = ra.id AND qr.position_number = 1
LEFT JOIN driver pd ON qr.driver_id = pd.id
WHERE ra.year = ?1
ORDER BY ra.round`;

function mapRaceSummary(row: unknown): RaceSummary {
  const r = asRecord(row, "race summary");
  return {
    round: asNumber(r.round, "round"),
    slug: asString(r.slug, "slug"),
    name: asString(r.name, "grand prix name"),
    raceName: asString(r.race_name, "race name"),
    alpha2Code: asString(r.alpha2_code, "alpha2 code"),
    countryName: asString(r.country_name, "country name"),
    date: asString(r.date, "race date"),
    time: r.time === null ? null : asString(r.time, "race time"),
    laps: asNumber(r.laps, "laps"),
    circuitName: asString(r.circuit_name, "circuit name"),
    circuitPlace: asString(r.circuit_place, "circuit place"),
    winnerName: r.winner_name === null ? null : asString(r.winner_name, "winner name"),
    winnerCode: r.winner_code === null ? null : asString(r.winner_code, "winner code"),
    winnerTeamId: r.winner_team_id === null ? null : asString(r.winner_team_id, "winner team id"),
    winnerTeamName: r.winner_team_name === null ? null : asString(r.winner_team_name, "winner team name"),
    winnerTime: r.winner_time === null ? null : asString(r.winner_time, "winner time"),
    poleName: r.pole_name === null ? null : asString(r.pole_name, "pole name"),
    poleCode: r.pole_code === null ? null : asString(r.pole_code, "pole code"),
  };
}

export interface RaceResultsRepository {
  getSeasonCalendar(year: number): Promise<RaceSummary[]>;
  listRaces(year: number): Promise<RaceSummary[]>;
  getSeasonYears(): Promise<number[]>;
}

export function createRaceResultsRepository(db?: RaceResultsDatabase): RaceResultsRepository {
  const calendar = async (year: number): Promise<RaceSummary[]> => {
    if (!db) {
      // fixture 含全部 22 站（DEV）；生产同一条 SQL
      if (year !== 2026) return [];
      const { default: fixture } = await import("./fixtures/season-races-2026.json");
      return (fixture as { races: RaceSummary[] }).races;
    }
    const [rows] = await db.batch([{ sql: seasonCalendarSql, values: [year] }]);
    return rows.results.map(mapRaceSummary);
  };

  return {
    getSeasonCalendar: calendar,

    // 列表页只展示已完赛（有冠军行），与日历共用一次查询口径
    async listRaces(year) {
      return (await calendar(year)).filter((race) => race.winnerName !== null);
    },

    async getSeasonYears() {
      if (!db) {
        const { default: fixture } = await import("./fixtures/season-races-2026.json");
        return (fixture as { years: number[] }).years;
      }
      const [rows] = await db.batch([{ sql: seasonYearsSql, values: [] }]);
      return mapSeasonYearRows(rows.results);
    },
  };
}

export function formatAvgSpeedKph(courseLengthKm: number, timeMillis: number | null): string | null {
  if (timeMillis === null || timeMillis <= 0) return null;
  return (courseLengthKm / (timeMillis / 3_600_000)).toFixed(3);
}

export function formatSeconds(totalMillis: number | null): string | null {
  if (totalMillis === null) return null;
  return (totalMillis / 1000).toFixed(3);
}
```

（任务 4 在此文件补 getRacePage 与各模型，任务 6 补积分榜查询；接口同步扩展。）

- [ ] 步骤 5：创建 /results 根重定向页

`apps/web/src/pages/results/index.astro`：

```astro
---
import { env } from "cloudflare:workers";

import {
  createD1RaceResultsDatabase,
  createRaceResultsRepository,
} from "../../lib/race-results-repository.js";

const repository = import.meta.env.DEV
  ? createRaceResultsRepository()
  : createRaceResultsRepository(createD1RaceResultsDatabase(env.F1_DB));
const [latest] = await repository.getSeasonYears();
// 目标随最新赛季变化，不能用 301（浏览器会永久缓存过期地址）；默认 302
return Astro.redirect(latest === undefined ? "/" : `/results/${latest}/races`);
---
```

- [ ] 步骤 6：运行测试验证通过

运行：`pnpm --filter @f1-box/web test race-results-repository.test.ts`
预期：PASS

- [ ] 步骤 7：Commit

```bash
git add apps/web/src/lib/race-results-repository.ts apps/web/src/lib/fixtures/season-races-2026.json apps/web/src/pages/results/index.astro apps/web/tests/race-results-repository.test.ts
git commit -m "feat: add race results repository with season calendar"
```

---

## 任务 3：列表页 /results/[year]/races + 导航链接 + 年份切换

文件：创建 `apps/web/src/pages/results/[year]/races/index.astro`；修改 `SiteHeader.astro`、`ResultsNav.astro`、`YearSelector.astro`、`BaseLayout.astro`、`apps/web/src/styles/global.css`；测试 `apps/web/tests/e2e/results.spec.ts`

- [ ] 步骤 1：编写失败的 e2e 测试

`apps/web/tests/e2e/results.spec.ts`：

```ts
import { expect, test } from "@playwright/test";

test.describe("results races list", () => {
  test("@desktop lists completed races with winners", async ({ page }) => {
    await page.goto("/results/2026/races");
    const table = page.getByRole("table", { name: "2026 race results" });
    await expect(table).toBeVisible();
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(11);
    await expect(rows.first()).toContainText("Australia");
    await expect(rows.first()).toContainText("George Russell");
    await expect(rows.first().locator("th a")).toHaveAttribute(
      "href",
      "/results/2026/races/australia/race-result",
    );
    await expect(rows.first()).toContainText("1:23:06.801");
  });

  test("@desktop unknown year renders empty state", async ({ page }) => {
    await page.goto("/results/2027/races");
    await expect(page.locator("main")).toContainText("No race results");
  });

  test("@desktop results root and year redirect to races", async ({ page }) => {
    await page.goto("/results");
    await page.waitForURL(/\/results\/2026\/races$/);
    await page.goto("/results/2026");
    await page.waitForURL(/\/results\/2026\/races$/);
  });
});

test("@mobile 375px results list has no page overflow", async ({ page }) => {
  await page.goto("/results/2026/races");
  await expect(page.locator("main")).toBeVisible();
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
});
```

- [ ] 步骤 2：运行验证失败

运行：`pnpm --filter @f1-box/web test:e2e results.spec.ts`
预期：FAIL（/results/2026/races 无页面）

- [ ] 步骤 3：年份切换支持（YearSelector / SiteHeader / BaseLayout）

`YearSelector.astro` Props 改为 `{ current: number; available: number[]; rest?: string; hrefFor?: (year: number) => string }`，链接 href 用 `hrefFor ?? ((year) => \`/${year}${rest ?? ""}\`)`（其余 markup 与 style 不变）。
`SiteHeader.astro` Props 追加 `yearHref?: (year: number) => string`，透传 `<YearSelector hrefFor={yearHref} ...>`。
`BaseLayout.astro` Props 追加 `yearHref?: (year: number) => string`，透传 `<SiteHeader yearHref={yearHref} ...>`。
现有调用方不传 yearHref，行为不变。

- [ ] 步骤 4：实现列表页

`apps/web/src/pages/results/[year]/races/index.astro`：

```astro
---
import { env } from "cloudflare:workers";

import ResultsNav from "../../../../components/ResultsNav.astro";
import BaseLayout from "../../../../layouts/BaseLayout.astro";
import {
  createD1RaceResultsDatabase,
  createRaceResultsRepository,
} from "../../../../lib/race-results-repository.js";
import { formatUtcDate } from "../../../../lib/time.js";
import { monogram } from "../../../../lib/tokens.js";
import { colorForYear, logoSrcFor, vendorIndexes } from "../../../../lib/vendor.js";

const year = Number(Astro.params.year);
const repository = import.meta.env.DEV
  ? createRaceResultsRepository()
  : createRaceResultsRepository(createD1RaceResultsDatabase(env.F1_DB));
const [availableYears, races] = await Promise.all([
  repository.getSeasonYears(),
  repository.listRaces(year),
]);
if (!availableYears.includes(year)) Astro.response.status = 404;
if (races.length > 0) {
  Astro.response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
}

// Winner monogram 底色用其当年车队配色，缺色回落中性灰（与 drivers 目录同口径）
const winnerColor = (teamId: string | null) =>
  (teamId && colorForYear(vendorIndexes, teamId, year)) ?? "#84909e";
---

<BaseLayout
  title={`${year} Race Results`}
  active="results"
  year={year}
  availableYears={availableYears}
  yearHref={(y) => `/results/${y}/races`}
>
  <main id="main-content" class="page-shell">
    <h1>{year} Race Results</h1>
    <ResultsNav year={year} active="races" />
    <div class="table-scroll" tabindex="0">
      <table class="result-table" aria-label={`${year} race results`}>
        <thead>
          <tr>
            <th scope="col">Grand Prix</th>
            <th scope="col">Date</th>
            <th scope="col">Winner</th>
            <th scope="col">Team</th>
            <th scope="col">Laps</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {races.length === 0 ? (
            <tr><td class="empty-cell" colspan="6">No race results yet.</td></tr>
          ) : (
            races.map((race) => (
              <tr>
                <th scope="row">
                  <a class="vendor-cell" href={`/results/${year}/races/${race.slug}/race-result`}>
                    <img class="vendor-cell__flag" src={`/vendor/country-flags/${race.alpha2Code.toLowerCase()}.svg`} alt="" loading="lazy" />
                    {race.name}
                  </a>
                </th>
                <td>{formatUtcDate(race.date)}</td>
                <td>
                  {race.winnerName ? (
                    <span class="vendor-cell vendor-cell--driver" style={`--monogram-bg: ${winnerColor(race.winnerTeamId)}`}>
                      <span class="vendor-cell__monogram" aria-hidden="true">{monogram(race.winnerName)}</span>
                      <span class="vendor-cell__name">{race.winnerName}</span>
                      <small>{race.winnerCode}</small>
                    </span>
                  ) : "—"}
                </td>
                <td>
                  {race.winnerTeamName ? (
                    <span class="vendor-cell">
                      {race.winnerTeamId && logoSrcFor(vendorIndexes, race.winnerTeamId) ? (
                        <img class="vendor-cell__logo" src={logoSrcFor(vendorIndexes, race.winnerTeamId) ?? ""} alt="" loading="lazy" />
                      ) : null}
                      {race.winnerTeamName}
                    </span>
                  ) : "—"}
                </td>
                <td>{race.laps}</td>
                <td>{race.winnerTime ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </main>
</BaseLayout>
```

- [ ] 步骤 5：global.css 追加单元格样式

```css
.vendor-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.vendor-cell__flag {
  width: 1.25rem;
  height: 0.875rem;
  object-fit: contain;
  flex: none;
}
.vendor-cell__monogram {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  flex: none;
  background: var(--monogram-bg, #84909e);
  color: var(--paper);
  font-family: var(--display);
  font-size: 0.6rem;
  font-weight: 700;
}
.vendor-cell__logo {
  height: 1.1rem;
  width: auto;
  flex: none;
}
.vendor-cell small {
  color: var(--muted);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
}
/* 小屏车手单元格只显示 monogram + 缩写（验收标准的"小屏缩写"） */
@media (max-width: 40rem) {
  .vendor-cell--driver .vendor-cell__name { display: none; }
}
```

- [ ] 步骤 6：更新 ResultsNav 与 SiteHeader 链接

`ResultsNav.astro`：链接 `href={\`/results/${year}/${key}\`}`。
`SiteHeader.astro`：Results 链接 `href={year ? \`/results/${year}/races\` : "/results"}`。

- [ ] 步骤 7：运行 e2e 验证通过

运行：`pnpm --filter @f1-box/web test:e2e results.spec.ts`
预期：PASS

- [ ] 步骤 8：Commit

```bash
git add "apps/web/src/pages/results/[year]/races/index.astro" apps/web/src/components/SiteHeader.astro apps/web/src/components/ResultsNav.astro apps/web/src/components/YearSelector.astro apps/web/src/layouts/BaseLayout.astro apps/web/src/styles/global.css apps/web/tests/e2e/results.spec.ts
git commit -m "feat: build f1-style race results list page"
```

---

## 任务 4：分站页 race-result tab（repository getRacePage + hero + 子导航）

文件：扩展 `apps/web/src/lib/race-results-repository.ts`（模型 + getRacePage）；创建 `apps/web/src/lib/fixtures/race-australia-2026.json`、`apps/web/src/pages/results/[year]/races/[slug]/index.astro`、`.../[slug]/[tab].astro`、`RaceHeader.astro`、`RaceTabsNav.astro`、`RaceTable.astro`；测试 repository + e2e

- [ ] 步骤 1：生成澳洲站 fixture（真实 D1 数据，meta 部分直接内嵌）

先确认登录：`cd apps/web && pnpm exec wrangler whoami`（未登录停下找用户）。
fixture 结构：`{ "meta": RaceMeta, "tabs": { raceResult: [...], qualifying: [...], startingGrid: [...], fastestLaps: [...], pitStops: [...], practice1: [...], practice2: [...], practice3: [...] } }`。

meta 直接使用（2026-08-18 核实）：

```json
{
  "year": 2026, "round": 1, "slug": "australia", "name": "Australia",
  "officialName": "Formula 1 Qatar Airways Australian Grand Prix 2026",
  "date": "2026-03-08", "laps": 58, "courseLength": 5.278,
  "circuitName": "Melbourne", "circuitPlace": "Melbourne",
  "countryName": "Australia", "alpha2Code": "AU",
  "sessions": [
    { "key": "practice-1", "label": "Practice 1", "startsAtUtc": "2026-03-06T01:30:00Z" },
    { "key": "practice-2", "label": "Practice 2", "startsAtUtc": "2026-03-06T05:00:00Z" },
    { "key": "practice-3", "label": "Practice 3", "startsAtUtc": "2026-03-07T01:30:00Z" },
    { "key": "qualifying", "label": "Qualifying", "startsAtUtc": "2026-03-07T05:00:00Z" },
    { "key": "race", "label": "Race", "startsAtUtc": "2026-03-08T04:00:00Z" }
  ]
}
```

tabs 各数组用下列命令导出（camelCase 别名，输出 `[0].results` 原样放入对应字段；null 保留）：

```bash
cd apps/web && pnpm exec wrangler d1 execute f1db --remote --json --command "<SQL>"
```

raceResult（其余 7 个视图同结构：FROM/JOIN 换视图别名，race_id 子查询与 ORDER BY 不变，SELECT 别名按括号内替换）：

```sql
SELECT rr.position_number AS position, rr.position_text AS positionText,
       rr.driver_number AS driverNumber,
       d.id AS driverId, d.name AS driverName, d.abbreviation AS driverCode,
       ct.id AS constructorId, ct.name AS constructorName,
       rr.laps AS laps, rr.time AS time, rr.reason_retired AS retiredReason,
       rr.gap AS gap, rr.points AS points
FROM race_result rr
JOIN driver d ON rr.driver_id = d.id
JOIN constructor ct ON rr.constructor_id = ct.id
WHERE rr.race_id = (SELECT id FROM race WHERE year = 2026 AND grand_prix_id = 'australia')
ORDER BY rr.position_display_order
```

| 视图（FROM 别名） | SELECT 专有列（共有列同上：position/positionText/driverNumber/driverId/driverName/driverCode/constructorId/constructorName） |
| --- | --- |
| qualifying_result qr | qr.q1 AS q1, qr.q2 AS q2, qr.q3 AS q3, qr.laps AS laps |
| starting_grid_position sg | sg.time AS time |
| fastest_lap fl | fl.lap AS lap, fl.time AS time, CASE WHEN fl.time_millis IS NULL THEN NULL ELSE printf('%.3f', ra.course_length / (fl.time_millis / 3600000.0)) END AS avgSpeedKph（额外 JOIN race ra ON ra.id = fl.race_id） |
| pit_stop ps | 无 position/positionText；ps.driver_number AS driverNumber + 共有车手/车队列 + COUNT(*) AS stops, printf('%.3f', SUM(ps.time_millis) / 1000.0) AS totalSeconds；追加 GROUP BY ps.driver_id, ps.driver_number, d.name, d.abbreviation, ct.id, ct.name，ORDER BY stops ASC, SUM(ps.time_millis) ASC（按数值排，别用 printf 字符串别名排序） |
| free_practice_1_result p（2/3 同） | p.time AS time, p.gap AS gap, p.laps AS laps |

- [ ] 步骤 2：编写失败的 repository 测试（getRacePage）

`race-results-repository.test.ts` 追加（metaRow 与任务 4 SQL 的行形状一致）：

```ts
const metaRow = {
  year: 2026, round: 1, slug: "australia", name: "Australia",
  official_name: "Formula 1 Qatar Airways Australian Grand Prix 2026",
  date: "2026-03-08", time: "04:00", laps: 58, course_length: 5.278,
  circuit_name: "Melbourne", circuit_place: "Melbourne",
  country_name: "Australia", alpha2_code: "AU",
  free_practice_1_date: "2026-03-06", free_practice_1_time: "01:30",
  free_practice_2_date: "2026-03-06", free_practice_2_time: "05:00",
  free_practice_3_date: "2026-03-07", free_practice_3_time: "01:30",
  qualifying_date: "2026-03-07", qualifying_time: "05:00",
  sprint_qualifying_date: null, sprint_qualifying_time: null,
  sprint_race_date: null, sprint_race_time: null,
};

describe("createRaceResultsRepository getRacePage", () => {
  it("maps race meta, sessions and race result rows", async () => {
    const db = fakeDbBySql({
      circuit_name: [metaRow],
      "FROM race_result rr": [
        { position_number: 1, position_text: "1", driver_number: "63",
          driver_id: "george-russell", driver_name: "George Russell", driver_code: "RUS",
          constructor_id: "mercedes", constructor_name: "Mercedes", laps: 58,
          time: "1:23:06.801", reason_retired: null, gap: null, points: 25 },
        { position_number: null, position_text: "DNF", driver_number: "44",
          driver_id: "lewis-hamilton", driver_name: "Lewis Hamilton", driver_code: "HAM",
          constructor_id: "ferrari", constructor_name: "Ferrari", laps: 30,
          time: null, reason_retired: "Collision", gap: null, points: 0 },
      ],
    });
    const page = await createRaceResultsRepository(db).getRacePage(2026, "australia");
    expect(page?.meta.round).toBe(1);
    expect(page?.meta.sessions).toEqual([
      { key: "practice-1", label: "Practice 1", startsAtUtc: "2026-03-06T01:30:00Z" },
      { key: "practice-2", label: "Practice 2", startsAtUtc: "2026-03-06T05:00:00Z" },
      { key: "practice-3", label: "Practice 3", startsAtUtc: "2026-03-07T01:30:00Z" },
      { key: "qualifying", label: "Qualifying", startsAtUtc: "2026-03-07T05:00:00Z" },
      { key: "race", label: "Race", startsAtUtc: "2026-03-08T04:00:00Z" },
    ]);
    expect(page?.tabs.raceResult[0].driverName).toBe("George Russell");
    expect(page?.tabs.raceResult[1].time).toBeNull();
    expect(page?.tabs.raceResult[1].retiredReason).toBe("Collision");
  });

  it("returns null for unknown slug", async () => {
    const db = fakeDbBySql({ circuit_name: [], "FROM race_result rr": [] });
    expect(await createRaceResultsRepository(db).getRacePage(2026, "nope")).toBeNull();
  });

  it("DEV fixture serves only australia 2026", async () => {
    const repository = createRaceResultsRepository();
    expect(await repository.getRacePage(2026, "monaco")).toBeNull();
    const page = await repository.getRacePage(2026, "australia");
    expect(page?.meta.name).toBe("Australia");
    expect(page?.tabs.raceResult.length).toBeGreaterThan(0);
  });
});
```

注意：fakeDbBySql 的片段匹配只在单次调用的语句集合内进行——getRacePage 只发 raceMetaSql（含 `circuit_name`，匹配 metaRow）与 raceResultSql（含 `FROM race_result rr`），不会碰到 calendar SQL，片段互不冲突。

- [ ] 步骤 3：运行验证失败

运行：`pnpm --filter @f1-box/web test race-results-repository.test.ts`
预期：FAIL（getRacePage 不存在）

- [ ] 步骤 4：实现 getRacePage（meta + raceResult，其余 tab 任务 5 补）

repository 追加模型定义（RaceSession/RaceMeta/RacePage/各 Row 接口与 RACE_TAB_FIELDS，按本计划"模型定义"小节原样；文件顶部相应追加 `import type { RaceTabKey } from "./routing.js";`）、SQL 与映射：

```ts
// 分站与所有 tab 行都用 (year, slug) 子查询定位，一次 batch 取齐
const raceIdSubquery = `(SELECT id FROM race WHERE year = ?1 AND grand_prix_id = ?2)`;

const raceMetaSql = `SELECT ra.year, ra.round, ra.grand_prix_id AS slug, gp.name,
       ra.official_name, ra.date, ra.time, ra.laps, ra.course_length,
       ci.name AS circuit_name, ci.place_name AS circuit_place,
       cc.name AS country_name, cc.alpha2_code
FROM race ra
JOIN grand_prix gp ON ra.grand_prix_id = gp.id
JOIN circuit ci ON ra.circuit_id = ci.id
JOIN country cc ON gp.country_id = cc.id
WHERE ra.year = ?1 AND ra.grand_prix_id = ?2`;

const raceResultSql = `SELECT rr.position_number, rr.position_text, rr.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name,
       rr.laps, rr.time, rr.reason_retired, rr.gap, rr.points
FROM race_result rr
JOIN driver d ON rr.driver_id = d.id
JOIN constructor ct ON rr.constructor_id = ct.id
WHERE rr.race_id = ${raceIdSubquery}
ORDER BY rr.position_display_order`;

function buildSessions(r: Record<string, unknown>): RaceSession[] {
  const defs: [string, string, string, string][] = [
    ["practice-1", "Practice 1", "free_practice_1_date", "free_practice_1_time"],
    ["practice-2", "Practice 2", "free_practice_2_date", "free_practice_2_time"],
    ["practice-3", "Practice 3", "free_practice_3_date", "free_practice_3_time"],
    ["qualifying", "Qualifying", "qualifying_date", "qualifying_time"],
    ["sprint-qualifying", "Sprint Qualifying", "sprint_qualifying_date", "sprint_qualifying_time"],
    ["sprint", "Sprint", "sprint_race_date", "sprint_race_time"],
    ["race", "Race", "date", "time"],
  ];
  const sessions: RaceSession[] = [];
  for (const [key, label, dateKey, timeKey] of defs) {
    const date = r[dateKey];
    if (date === null || date === undefined) continue;
    const time = r[timeKey] ?? "00:00";
    sessions.push({ key, label, startsAtUtc: `${date}T${time}:00Z` });
  }
  return sessions;
}

function mapRaceMeta(row: unknown): RaceMeta {
  const r = asRecord(row, "race meta");
  return {
    year: asNumber(r.year, "race year"),
    round: asNumber(r.round, "race round"),
    slug: asString(r.slug, "race slug"),
    name: asString(r.name, "race name"),
    officialName: asString(r.official_name, "race official name"),
    date: asString(r.date, "race date"),
    laps: asNumber(r.laps, "race laps"),
    courseLength: asNumber(r.course_length, "course length"),
    circuitName: asString(r.circuit_name, "circuit name"),
    circuitPlace: asString(r.circuit_place, "circuit place"),
    countryName: asString(r.country_name, "country name"),
    alpha2Code: asString(r.alpha2_code, "alpha2 code"),
    sessions: buildSessions(r),
  };
}

// 各 tab 行共有的车手/车队字段
function mapDriverFields(r: Record<string, unknown>) {
  return {
    driverNumber: r.driver_number === null ? null : asString(r.driver_number, "driver number"),
    driverId: asString(r.driver_id, "driver id"),
    driverName: asString(r.driver_name, "driver name"),
    driverCode: asString(r.driver_code, "driver code"),
    constructorId: asString(r.constructor_id, "constructor id"),
    constructorName: asString(r.constructor_name, "constructor name"),
  };
}

function mapPositionFields(r: Record<string, unknown>) {
  return {
    position: r.position_number === null ? null : asNumber(r.position_number, "position"),
    positionText: asString(r.position_text, "position text"),
  };
}

function mapRaceResultRow(row: unknown): RaceResultRow {
  const r = asRecord(row, "race result row");
  return {
    ...mapPositionFields(r),
    ...mapDriverFields(r),
    laps: r.laps === null ? null : asNumber(r.laps, "laps"),
    time: r.time === null ? null : asString(r.time, "time"),
    retiredReason: r.reason_retired === null ? null : asString(r.reason_retired, "retired reason"),
    gap: r.gap === null ? null : asString(r.gap, "gap"),
    points: r.points === null ? null : asNumber(r.points, "points"),
  };
}
```

`createRaceResultsRepository` 返回对象追加（接口同步加 `getRacePage(year: number, slug: string): Promise<RacePage | null>`）：

```ts
    async getRacePage(year, slug) {
      if (!db) {
        if (year !== 2026 || slug !== "australia") return null;
        const { default: fixture } = await import("./fixtures/race-australia-2026.json");
        return fixture as RacePage;
      }
      const [metaRows, raceRows] = await db.batch([
        { sql: raceMetaSql, values: [year, slug] },
        { sql: raceResultSql, values: [year, slug] },
      ]);
      if (metaRows.results.length === 0) return null;
      const meta = mapRaceMeta(metaRows.results[0]);
      return {
        meta,
        tabs: {
          raceResult: raceRows.results.map(mapRaceResultRow),
          qualifying: [], startingGrid: [], fastestLaps: [], pitStops: [],
          practice1: [], practice2: [], practice3: [],
        },
      };
    },
```

（空数组在任务 5 被真实查询替换。）

- [ ] 步骤 5：编写失败的 e2e 测试（分站页）

`results.spec.ts` 追加：

```ts
test.describe("race detail", () => {
  test("@desktop shows race result table with winner", async ({ page }) => {
    await page.goto("/results/2026/races/australia/race-result");
    await expect(page.locator("main h1")).toHaveText("Australia");
    const table = page.getByRole("table", { name: "Race classification" });
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr").first()).toContainText("George Russell");
    await expect(table.locator("tbody tr").first()).toContainText("1:23:06.801");
  });

  test("@desktop hero lists the weekend sessions", async ({ page }) => {
    await page.goto("/results/2026/races/australia/race-result");
    const schedule = page.locator(".weekend-schedule");
    await expect(schedule.locator("li")).toHaveCount(5);
    await expect(schedule).toContainText("Qualifying");
  });

  test("@desktop bare slug redirects to race-result", async ({ page }) => {
    await page.goto("/results/2026/races/australia");
    await page.waitForURL(/\/results\/2026\/races\/australia\/race-result$/);
  });

  test("@desktop unknown slug and unknown tab are 404", async ({ page }) => {
    expect((await page.goto("/results/2026/races/nope/race-result"))?.status()).toBe(404);
    expect((await page.goto("/results/2026/races/australia/sprint"))?.status()).toBe(404);
  });
});
```

并把任务 3 的 @mobile 测试改为循环访问 `["/results/2026/races", "/results/2026/races/australia/race-result"]` 两条路径分别断言无横向溢出（测试名改为 "results pages have no page overflow"）。

- [ ] 步骤 6：运行验证失败

运行：`pnpm --filter @f1-box/web test:e2e results.spec.ts`
预期：FAIL（新路径 404）

- [ ] 步骤 7：实现分站页面与组件

`pages/results/[year]/races/[slug]/index.astro`：

```astro
---
const year = Astro.params.year;
const slug = (Astro.params.slug ?? "").toLowerCase();
return Astro.redirect(`/results/${year}/races/${slug}/race-result`, 301);
---
```

`pages/results/[year]/races/[slug]/[tab].astro`：

```astro
---
import { env } from "cloudflare:workers";

import RaceHeader from "../../../../../components/RaceHeader.astro";
import RaceTable from "../../../../../components/RaceTable.astro";
import RaceTabsNav from "../../../../../components/RaceTabsNav.astro";
import StatusPage from "../../../../../components/StatusPage.astro";
import BaseLayout from "../../../../../layouts/BaseLayout.astro";
import {
  createD1RaceResultsDatabase,
  createRaceResultsRepository,
  RACE_TAB_FIELDS,
} from "../../../../../lib/race-results-repository.js";
import { RACE_TAB_LABELS, resolveRaceTab } from "../../../../../lib/routing.js";

const year = Number(Astro.params.year);
const slug = (Astro.params.slug ?? "").toLowerCase();
const tab = resolveRaceTab(Astro.params.tab ?? "");
const repository = import.meta.env.DEV
  ? createRaceResultsRepository()
  : createRaceResultsRepository(createD1RaceResultsDatabase(env.F1_DB));
const [availableYears, page] = await Promise.all([
  repository.getSeasonYears(),
  tab ? repository.getRacePage(year, slug) : Promise.resolve(null),
]);
if (!tab || !page || !availableYears.includes(year)) Astro.response.status = 404;
if (page) {
  Astro.response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
}
---

{tab && page ? (
  <BaseLayout
    title={`${page.meta.name} ${RACE_TAB_LABELS[tab]}`}
    active="results"
    year={year}
    availableYears={availableYears}
    yearHref={(y) => `/results/${y}/races/${slug}/${tab}`}
  >
    <main id="main-content">
      <RaceHeader meta={page.meta} />
      <div class="page-shell">
        <RaceTabsNav year={year} slug={slug} active={tab} tabs={page.tabs} />
        <RaceTable tab={tab} rows={page.tabs[RACE_TAB_FIELDS[tab]]} year={year} />
      </div>
    </main>
  </BaseLayout>
) : (
  <BaseLayout title="Race not found" year={year} availableYears={availableYears}>
    <main id="main-content" class="page-shell">
      <StatusPage code="404" title="Race not found" message="This race is not available yet." />
    </main>
  </BaseLayout>
)}
```

`RaceHeader.astro`：

```astro
---
import type { RaceMeta } from "../lib/race-results-repository.js";
import { formatUtcDate, formatUtcDateTime } from "../lib/time.js";

interface Props {
  meta: RaceMeta;
}
const { meta } = Astro.props;
const round = String(meta.round).padStart(2, "0");
---

<header class="race-hero page-shell">
  <div class="race-hero__title">
    <p class="giant-round" aria-hidden="true">{round}</p>
    <div>
      <h1>{meta.name}</h1>
      <p>{formatUtcDate(meta.date)} · {meta.circuitName}, {meta.circuitPlace} · {meta.countryName}</p>
      <p class="muted">{meta.officialName}</p>
    </div>
  </div>
  {meta.sessions.length > 0 ? (
    <ol class="weekend-schedule">
      {meta.sessions.map((session, index) => (
        <li>
          <span class="session-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <h3>{session.label}</h3>
            <time datetime={session.startsAtUtc}>{formatUtcDateTime(session.startsAtUtc)}</time>
            <span data-local-time data-timestamp={session.startsAtUtc} hidden></span>
          </div>
        </li>
      ))}
    </ol>
  ) : null}
</header>
```

（`.race-hero`、`.giant-round`、`.weekend-schedule`、`.session-index` 样式 global.css 已有，直接复用。）

`RaceTabsNav.astro`：

```astro
---
import type { RacePage, RaceTabKey } from "../lib/race-results-repository.js";
import { RACE_TAB_FIELDS } from "../lib/race-results-repository.js";
import { RACE_TAB_LABELS, raceTabKeys } from "../lib/routing.js";

interface Props {
  year: number;
  slug: string;
  active: RaceTabKey;
  tabs: RacePage["tabs"];
}
const { year, slug, active, tabs } = Astro.props;
const visibleTabs = raceTabKeys.filter((key) => tabs[RACE_TAB_FIELDS[key]].length > 0);
---

<nav class="results-nav" aria-label="Race result types">
  {visibleTabs.map((key) => (
    <a
      href={`/results/${year}/races/${slug}/${key}`}
      class:list={["results-nav__item", { "is-active": key === active }]}
      aria-current={key === active ? "page" : undefined}
    >{RACE_TAB_LABELS[key]}</a>
  ))}
</nav>

<style>
  .results-nav { display: flex; flex-wrap: wrap; gap: 1rem; margin-block: 1rem; }
  .results-nav__item { color: inherit; text-decoration: none; opacity: 0.7; padding-block: 0.25rem; }
  .results-nav__item.is-active { opacity: 1; box-shadow: inset 0 -2px 0 currentColor; }
</style>
```

`RaceTable.astro`（本任务只实现 race-result 分支，骨架与 CONFIG 一次建好）：

```astro
---
import type {
  FastestLapRow, GridRow, PitStopRow, PracticeRow, QualifyingRow,
  RaceResultRow, RaceTabKey,
} from "../lib/race-results-repository.js";
import { colorForYear, logoSrcFor, vendorIndexes } from "../lib/vendor.js";
import { monogram } from "../lib/tokens.js";

interface Props {
  tab: RaceTabKey;
  rows: readonly (RaceResultRow | QualifyingRow | GridRow | FastestLapRow | PitStopRow | PracticeRow)[];
  year: number;
}
const { tab, rows, year } = Astro.props;

const CONFIG: Record<RaceTabKey, { label: string; empty: string }> = {
  "race-result": { label: "Race classification", empty: "Race results are not available yet." },
  "fastest-laps": { label: "Fastest laps", empty: "Fastest laps are not available yet." },
  "pit-stop-summary": { label: "Pit stop summary", empty: "Pit stops are not available yet." },
  "starting-grid": { label: "Starting grid", empty: "Starting grid is not available yet." },
  qualifying: { label: "Qualifying classification", empty: "Qualifying results are not available yet." },
  "practice-1": { label: "Practice 1 classification", empty: "Practice 1 results are not available yet." },
  "practice-2": { label: "Practice 2 classification", empty: "Practice 2 results are not available yet." },
  "practice-3": { label: "Practice 3 classification", empty: "Practice 3 results are not available yet." },
};
const { label, empty } = CONFIG[tab];

const teamColor = (constructorId: string) =>
  colorForYear(vendorIndexes, constructorId, year) ?? "#84909e";
const teamLogo = (constructorId: string) => logoSrcFor(vendorIndexes, constructorId);
const positionLabel = (position: number | null, positionText: string) =>
  position === null ? positionText : String(position).padStart(2, "0");
const columnCount = { "race-result": 7, "fastest-laps": 7, "pit-stop-summary": 6, "starting-grid": 5, qualifying: 8, "practice-1": 7, "practice-2": 7, "practice-3": 7 }[tab];
---

<div class="table-scroll" tabindex="0">
  <table class="result-table" aria-label={label}>
    {tab === "race-result" ? (
      <>
        <thead>
          <tr>
            <th scope="col">Pos</th><th scope="col">No.</th><th scope="col">Driver</th>
            <th scope="col">Team</th><th scope="col">Laps</th>
            <th scope="col">Time / Retired</th><th scope="col">Pts</th>
          </tr>
        </thead>
        <tbody>
          {(rows as RaceResultRow[]).length === 0 ? (
            <tr><td class="empty-cell" colspan={columnCount}>{empty}</td></tr>
          ) : (
            (rows as RaceResultRow[]).map((row) => (
              <tr>
                <td class="position-cell">{positionLabel(row.position, row.positionText)}</td>
                <td>{row.driverNumber ?? "—"}</td>
                <td>
                  <span class="vendor-cell vendor-cell--driver" style={`--monogram-bg: ${teamColor(row.constructorId)}`}>
                    <span class="vendor-cell__monogram" aria-hidden="true">{monogram(row.driverName)}</span>
                    <span class="vendor-cell__name">{row.driverName}</span>
                    <small>{row.driverCode}</small>
                  </span>
                </td>
                <td>
                  <span class="vendor-cell">
                    {teamLogo(row.constructorId) ? (
                      <img class="vendor-cell__logo" src={teamLogo(row.constructorId) ?? ""} alt="" loading="lazy" />
                    ) : null}
                    {row.constructorName}
                  </span>
                </td>
                <td>{row.laps ?? "—"}</td>
                <td>{row.time ?? row.gap ?? row.retiredReason ?? "—"}</td>
                <td>{row.points ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </>
    ) : (
      <tbody>
        <tr><td class="empty-cell">{empty}</td></tr>
      </tbody>
    )}
  </table>
</div>
```

- [ ] 步骤 8：运行验证通过

运行：`pnpm --filter @f1-box/web test race-results-repository.test.ts`、`pnpm --filter @f1-box/web test:e2e results.spec.ts`
预期：均 PASS

- [ ] 步骤 9：Commit

```bash
git add apps/web/src/lib/race-results-repository.ts apps/web/src/lib/fixtures/race-australia-2026.json "apps/web/src/pages/results/[year]/races/[slug]" apps/web/src/components/RaceHeader.astro apps/web/src/components/RaceTabsNav.astro apps/web/src/components/RaceTable.astro apps/web/tests/race-results-repository.test.ts apps/web/tests/e2e/results.spec.ts
git commit -m "feat: add race detail page with result tab and weekend sessions"
```

---

## 任务 5：其余 tabs（qualifying / starting-grid / fastest-laps / pit-stop-summary / practice）

文件：扩展 `race-results-repository.ts`（5 条 SQL + 映射 + batch 扩为 9 条）、`RaceTable.astro`（其余分支）；测试 repository + e2e

- [ ] 步骤 1：编写失败的 repository 测试

`race-results-repository.test.ts` 追加。getRacePage 此时一次 batch 9 条语句，fakeDbBySql 对未登记的语句会抛错，所以先加一个把其余 tab 全部置空的助手（metaRow 复用任务 4 定义）：

```ts
function tabFragments(extra: Record<string, unknown[]>): Record<string, unknown[]> {
  return {
    circuit_name: [metaRow],
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

it("maps qualifying rows", async () => {
  const db = fakeDbBySql(tabFragments({
    "FROM qualifying_result": [{ position_number: 1, position_text: "1", driver_number: "63",
      driver_id: "george-russell", driver_name: "George Russell", driver_code: "RUS",
      constructor_id: "mercedes", constructor_name: "Mercedes",
      q1: "1:19.507", q2: "1:18.934", q3: "1:18.518", laps: 22 }],
  }));
  const page = await createRaceResultsRepository(db).getRacePage(2026, "australia");
  expect(page?.tabs.qualifying[0].q3).toBe("1:18.518");
});

it("maps starting grid rows with null time", async () => {
  const db = fakeDbBySql(tabFragments({
    "FROM starting_grid_position": [{ position_number: 20, position_text: "20", driver_number: "1",
      driver_id: "max-verstappen", driver_name: "Max Verstappen", driver_code: "VER",
      constructor_id: "red-bull", constructor_name: "Red Bull Racing", time: null }],
  }));
  const page = await createRaceResultsRepository(db).getRacePage(2026, "australia");
  expect(page?.tabs.startingGrid[0].time).toBeNull();
});

it("maps fastest lap rows with computed avg speed", async () => {
  const db = fakeDbBySql(tabFragments({
    "FROM fastest_lap": [{ position_number: 1, position_text: "1", driver_number: "63",
      driver_id: "george-russell", driver_name: "George Russell", driver_code: "RUS",
      constructor_id: "mercedes", constructor_name: "Mercedes",
      lap: 43, time: "1:22.091", time_millis: 82091 }],
  }));
  const page = await createRaceResultsRepository(db).getRacePage(2026, "australia");
  expect(page?.tabs.fastestLaps[0].avgSpeedKph).toBe("231.460");
});

it("maps pit stop rows aggregated per driver", async () => {
  const db = fakeDbBySql(tabFragments({
    "FROM pit_stop": [{ driver_number: "43", driver_id: "franco-colapinto",
      driver_name: "Franco Colapinto", driver_code: "COL",
      constructor_id: "alpine", constructor_name: "Alpine", stops: 1, total_millis: 27733 }],
  }));
  const page = await createRaceResultsRepository(db).getRacePage(2026, "australia");
  expect(page?.tabs.pitStops[0]).toMatchObject({ stops: 1, totalSeconds: "27.733" });
});

it("maps practice rows", async () => {
  const db = fakeDbBySql(tabFragments({
    "FROM free_practice_1_result": [{ position_number: 1, position_text: "1", driver_number: "63",
      driver_id: "george-russell", driver_name: "George Russell", driver_code: "RUS",
      constructor_id: "mercedes", constructor_name: "Mercedes",
      time: "1:20.100", gap: null, laps: 24 }],
  }));
  const page = await createRaceResultsRepository(db).getRacePage(2026, "australia");
  expect(page?.tabs.practice1[0].gap).toBeNull();
});
```

- [ ] 步骤 2：运行验证失败

运行：`pnpm --filter @f1-box/web test race-results-repository.test.ts`
预期：FAIL（新 tab 数组仍为空）

- [ ] 步骤 3：实现其余 tab 查询与映射

repository 追加 SQL（均用 `${raceIdSubquery}`，ORDER BY position_display_order；pit stops 除外）：

```ts
const qualifyingSql = `SELECT qr.position_number, qr.position_text, qr.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name,
       qr.q1, qr.q2, qr.q3, qr.laps
FROM qualifying_result qr
JOIN driver d ON qr.driver_id = d.id
JOIN constructor ct ON qr.constructor_id = ct.id
WHERE qr.race_id = ${raceIdSubquery}
ORDER BY qr.position_display_order`;

const startingGridSql = `SELECT sg.position_number, sg.position_text, sg.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name, sg.time
FROM starting_grid_position sg
JOIN driver d ON sg.driver_id = d.id
JOIN constructor ct ON sg.constructor_id = ct.id
WHERE sg.race_id = ${raceIdSubquery}
ORDER BY sg.position_display_order`;

const fastestLapsSql = `SELECT fl.position_number, fl.position_text, fl.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name,
       fl.lap, fl.time, fl.time_millis
FROM fastest_lap fl
JOIN driver d ON fl.driver_id = d.id
JOIN constructor ct ON fl.constructor_id = ct.id
WHERE fl.race_id = ${raceIdSubquery}
ORDER BY fl.position_display_order`;

// f1.com pit-stop-summary 口径：按车手聚合单停
const pitStopsSql = `SELECT ps.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name,
       COUNT(*) AS stops, SUM(ps.time_millis) AS total_millis
FROM pit_stop ps
JOIN driver d ON ps.driver_id = d.id
JOIN constructor ct ON ps.constructor_id = ct.id
WHERE ps.race_id = ${raceIdSubquery}
GROUP BY ps.driver_id, ps.driver_number, d.name, d.abbreviation, ct.id, ct.name
ORDER BY stops ASC, total_millis ASC`;

const practiceSql = (n: 1 | 2 | 3) => `SELECT p.position_number, p.position_text, p.driver_number,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       ct.id AS constructor_id, ct.name AS constructor_name,
       p.time, p.gap, p.laps
FROM free_practice_${n}_result p
JOIN driver d ON p.driver_id = d.id
JOIN constructor ct ON p.constructor_id = ct.id
WHERE p.race_id = ${raceIdSubquery}
ORDER BY p.position_display_order`;
```

映射函数（模式同 mapRaceResultRow，用 mapPositionFields + mapDriverFields）：mapQualifyingRow、mapGridRow、mapPracticeRow；mapFastestLapRow(row, courseLength) 额外 `avgSpeedKph: formatAvgSpeedKph(courseLength, r.time_millis === null ? null : asNumber(r.time_millis, "lap millis"))`；mapPitStopRow 无 position 字段，`stops: asNumber(...)`、`totalSeconds: formatSeconds(r.total_millis === null ? null : asNumber(r.total_millis, "pit stop millis"))`。

getRacePage 的 batch 扩为 9 条（meta + raceResult + qualifying + startingGrid + fastestLaps + pitStops + practiceSql(1..3)，values 均为 [year, slug]），tabs 各字段换成对应映射（fastestLaps 行映射传 meta.courseLength）。

- [ ] 步骤 4：实现 RaceTable 其余分支

按 race-result 分支的同款结构补 7 个分支，列定义如下（Driver/Team 单元格复用任务 4 的 vendor-cell markup，Pos 用 positionLabel，空态 colspan = 列数）：

| tab | 表头 | 专有列单元格 |
| --- | --- | --- |
| qualifying | Pos, No., Driver, Team, Q1, Q2, Q3, Laps | `row.q1 ?? "—"`、`row.q2 ?? "—"`、`row.q3 ?? "—"`、`row.laps ?? "—"` |
| starting-grid | Pos, No., Driver, Team, Time | `row.time ?? "—"` |
| fastest-laps | Pos, No., Driver, Team, Lap, Time, Avg. Speed | `row.lap ?? "—"`、`row.time ?? "—"`、`row.avgSpeedKph ?? "—"` |
| pit-stop-summary | Pos, No., Driver, Team, Stops, Total Time | Pos = `String(rowIndex + 1).padStart(2, "0")`（行序即名次）、`row.stops`、`row.totalSeconds ?? "—"` |
| practice-1/2/3 | Pos, No., Driver, Team, Time, Gap, Laps | `row.time ?? "—"`、`row.gap ?? "—"`、`row.laps ?? "—"` |

- [ ] 步骤 5：编写 e2e tab 导航测试并运行

`results.spec.ts` 追加：

```ts
test("@desktop tab nav switches between result types", async ({ page }) => {
  await page.goto("/results/2026/races/australia/race-result");
  const nav = page.getByRole("navigation", { name: "Race result types" });
  await nav.getByRole("link", { name: "Qualifying" }).click();
  await page.waitForURL(/\/results\/2026\/races\/australia\/qualifying$/);
  await expect(page.getByRole("table", { name: "Qualifying classification" })).toBeVisible();
  await nav.getByRole("link", { name: "Fastest Laps" }).click();
  await page.waitForURL(/\/results\/2026\/races\/australia\/fastest-laps$/);
  await expect(page.getByRole("table", { name: "Fastest laps" })).toBeVisible();
  await nav.getByRole("link", { name: "Pit Stop Summary" }).click();
  await expect(page.getByRole("table", { name: "Pit stop summary" })).toBeVisible();
});
```

运行：`pnpm --filter @f1-box/web test race-results-repository.test.ts`、`pnpm --filter @f1-box/web test:e2e results.spec.ts`
预期：PASS

- [ ] 步骤 6：Commit

```bash
git add apps/web/src/lib/race-results-repository.ts apps/web/src/components/RaceTable.astro apps/web/tests/race-results-repository.test.ts apps/web/tests/e2e/results.spec.ts
git commit -m "feat: add qualifying, grid, practice, fastest laps and pit stop tabs"
```

---

## 任务 6：积分榜页迁 f1db（/results/[year]/drivers、/results/[year]/teams）

文件：扩展 `race-results-repository.ts`（两条 standings SQL + 映射）；创建 `apps/web/src/lib/fixtures/standings-2026.json`、`apps/web/src/pages/results/[year]/drivers.astro`、`teams.astro`；修改 `StandingsTable.astro`；测试 repository + e2e

- [ ] 步骤 1：写入积分榜 fixture（真实数据快照，2026-08-18 导出，无需重新查询）

`apps/web/src/lib/fixtures/standings-2026.json`：

```json
{
  "drivers": [
    { "position": 1, "positionText": "1", "driverId": "kimi-antonelli", "driverName": "Kimi Antonelli", "driverCode": "ANT", "points": 219, "wins": 6 },
    { "position": 2, "positionText": "2", "driverId": "lewis-hamilton", "driverName": "Lewis Hamilton", "driverCode": "HAM", "points": 169, "wins": 1 },
    { "position": 3, "positionText": "3", "driverId": "george-russell", "driverName": "George Russell", "driverCode": "RUS", "points": 160, "wins": 2 },
    { "position": 4, "positionText": "4", "driverId": "charles-leclerc", "driverName": "Charles Leclerc", "driverCode": "LEC", "points": 138, "wins": 1 },
    { "position": 5, "positionText": "5", "driverId": "lando-norris", "driverName": "Lando Norris", "driverCode": "NOR", "points": 128, "wins": 1 },
    { "position": 6, "positionText": "6", "driverId": "max-verstappen", "driverName": "Max Verstappen", "driverCode": "VER", "points": 109, "wins": 0 },
    { "position": 7, "positionText": "7", "driverId": "oscar-piastri", "driverName": "Oscar Piastri", "driverCode": "PIA", "points": 92, "wins": 0 },
    { "position": 8, "positionText": "8", "driverId": "isack-hadjar", "driverName": "Isack Hadjar", "driverCode": "HAD", "points": 68, "wins": 0 },
    { "position": 9, "positionText": "9", "driverId": "liam-lawson", "driverName": "Liam Lawson", "driverCode": "LAW", "points": 43, "wins": 0 },
    { "position": 10, "positionText": "10", "driverId": "pierre-gasly", "driverName": "Pierre Gasly", "driverCode": "GAS", "points": 42, "wins": 0 },
    { "position": 11, "positionText": "11", "driverId": "arvid-lindblad", "driverName": "Arvid Lindblad", "driverCode": "LIN", "points": 23, "wins": 0 },
    { "position": 12, "positionText": "12", "driverId": "franco-colapinto", "driverName": "Franco Colapinto", "driverCode": "COL", "points": 19, "wins": 0 },
    { "position": 13, "positionText": "13", "driverId": "oliver-bearman", "driverName": "Oliver Bearman", "driverCode": "BEA", "points": 18, "wins": 0 },
    { "position": 14, "positionText": "14", "driverId": "gabriel-bortoleto", "driverName": "Gabriel Bortoleto", "driverCode": "BOR", "points": 10, "wins": 0 },
    { "position": 15, "positionText": "15", "driverId": "carlos-sainz-jr", "driverName": "Carlos Sainz Jr.", "driverCode": "SAI", "points": 6, "wins": 0 },
    { "position": 16, "positionText": "16", "driverId": "alexander-albon", "driverName": "Alexander Albon", "driverCode": "ALB", "points": 5, "wins": 0 },
    { "position": 17, "positionText": "17", "driverId": "esteban-ocon", "driverName": "Esteban Ocon", "driverCode": "OCO", "points": 3, "wins": 0 },
    { "position": 18, "positionText": "18", "driverId": "nico-hulkenberg", "driverName": "Nico Hülkenberg", "driverCode": "HUL", "points": 2, "wins": 0 },
    { "position": 19, "positionText": "19", "driverId": "fernando-alonso", "driverName": "Fernando Alonso", "driverCode": "ALO", "points": 1, "wins": 0 },
    { "position": 20, "positionText": "20", "driverId": "lance-stroll", "driverName": "Lance Stroll", "driverCode": "STR", "points": 0, "wins": 0 },
    { "position": 21, "positionText": "21", "driverId": "valtteri-bottas", "driverName": "Valtteri Bottas", "driverCode": "BOT", "points": 0, "wins": 0 },
    { "position": 22, "positionText": "22", "driverId": "sergio-perez", "driverName": "Sergio Pérez", "driverCode": "PER", "points": 0, "wins": 0 }
  ],
  "teams": [
    { "position": 1, "positionText": "1", "teamId": "mercedes", "teamName": "Mercedes", "points": 379, "wins": 8 },
    { "position": 2, "positionText": "2", "teamId": "ferrari", "teamName": "Ferrari", "points": 307, "wins": 2 },
    { "position": 3, "positionText": "3", "teamId": "mclaren", "teamName": "McLaren", "points": 220, "wins": 1 },
    { "position": 4, "positionText": "4", "teamId": "red-bull", "teamName": "Red Bull", "points": 177, "wins": 0 },
    { "position": 5, "positionText": "5", "teamId": "racing-bulls", "teamName": "Racing Bulls", "points": 66, "wins": 0 },
    { "position": 6, "positionText": "6", "teamId": "alpine", "teamName": "Alpine", "points": 61, "wins": 0 },
    { "position": 7, "positionText": "7", "teamId": "haas", "teamName": "Haas", "points": 21, "wins": 0 },
    { "position": 8, "positionText": "8", "teamId": "audi", "teamName": "Audi", "points": 12, "wins": 0 },
    { "position": 9, "positionText": "9", "teamId": "williams", "teamName": "Williams", "points": 11, "wins": 0 },
    { "position": 10, "positionText": "10", "teamId": "aston-martin", "teamName": "Aston Martin", "points": 1, "wins": 0 },
    { "position": 11, "positionText": "11", "teamId": "cadillac", "teamName": "Cadillac", "points": 0, "wins": 0 }
  ]
}
```

- [ ] 步骤 2：编写失败的测试

`race-results-repository.test.ts` 追加：

```ts
describe("createRaceResultsRepository standings", () => {
  it("maps driver standings with aggregated wins", async () => {
    const db = fakeDbBySql({
      "FROM season_driver_standing": [{ position_number: 1, position_text: "1",
        driver_id: "kimi-antonelli", driver_name: "Kimi Antonelli",
        driver_code: "ANT", points: 219, wins: 6 }],
    });
    const rows = await createRaceResultsRepository(db).getDriverStandings(2026);
    expect(rows).toEqual([{ position: 1, positionText: "1", driverId: "kimi-antonelli",
      driverName: "Kimi Antonelli", driverCode: "ANT", points: 219, wins: 6 }]);
  });

  it("maps constructor standings", async () => {
    const db = fakeDbBySql({
      "FROM season_constructor_standing": [{ position_number: null, position_text: "-",
        team_id: "mercedes", team_name: "Mercedes", points: 379, wins: 8 }],
    });
    const rows = await createRaceResultsRepository(db).getConstructorStandings(2026);
    expect(rows[0]).toEqual({ position: null, positionText: "-", teamId: "mercedes",
      teamName: "Mercedes", points: 379, wins: 8 });
  });

  it("DEV fixture serves 2026 standings only", async () => {
    const repository = createRaceResultsRepository();
    expect(await repository.getDriverStandings(2026)).toHaveLength(22);
    expect(await repository.getConstructorStandings(2026)).toHaveLength(11);
    expect(await repository.getDriverStandings(2025)).toEqual([]);
  });
});
```

`results.spec.ts` 追加：

```ts
test.describe("standings", () => {
  test("@desktop driver standings table from f1db", async ({ page }) => {
    await page.goto("/results/2026/drivers");
    const table = page.getByRole("table", { name: "Driver standings" });
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(22);
    await expect(table.locator("tbody tr").first()).toContainText("Kimi Antonelli");
    await expect(table.locator("tbody tr").first()).toContainText("219");
  });

  test("@desktop constructor standings table from f1db", async ({ page }) => {
    await page.goto("/results/2026/teams");
    const table = page.getByRole("table", { name: "Constructor standings" });
    await expect(table.locator("tbody tr")).toHaveCount(11);
    await expect(table.locator("tbody tr").first()).toContainText("Mercedes");
  });
});
```

- [ ] 步骤 3：运行验证失败

运行：`pnpm --filter @f1-box/web test race-results-repository.test.ts`、`pnpm --filter @f1-box/web test:e2e results.spec.ts`
预期：FAIL（方法与页面不存在）

- [ ] 步骤 4：实现 standings 查询

repository 追加模型（DriverStandingRow/TeamStandingRow，按"模型定义"小节）与 SQL：

```ts
// wins：f1db 积分榜表无该列，从正赛 P1 行按年聚合（race_data (driver_id, type) 索引可用）
const driverStandingsSql = `SELECT sds.position_number, sds.position_text,
       d.id AS driver_id, d.name AS driver_name, d.abbreviation AS driver_code,
       sds.points,
       (SELECT COUNT(*) FROM race_result rr JOIN race ra ON ra.id = rr.race_id
        WHERE rr.driver_id = d.id AND rr.position_number = 1 AND ra.year = sds.year) AS wins
FROM season_driver_standing sds
JOIN driver d ON sds.driver_id = d.id
WHERE sds.year = ?1
ORDER BY sds.position_display_order`;

const constructorStandingsSql = `SELECT scs.position_number, scs.position_text,
       ct.id AS team_id, ct.name AS team_name, scs.points,
       (SELECT COUNT(*) FROM race_result rr JOIN race ra ON ra.id = rr.race_id
        WHERE rr.constructor_id = ct.id AND rr.position_number = 1 AND ra.year = scs.year) AS wins
FROM season_constructor_standing scs
JOIN constructor ct ON scs.constructor_id = ct.id
WHERE scs.year = ?1
ORDER BY scs.position_display_order`;

function mapDriverStandingRow(row: unknown): DriverStandingRow {
  const r = asRecord(row, "driver standing row");
  return {
    position: r.position_number === null ? null : asNumber(r.position_number, "standing position"),
    positionText: asString(r.position_text, "standing position text"),
    driverId: asString(r.driver_id, "driver id"),
    driverName: asString(r.driver_name, "driver name"),
    driverCode: asString(r.driver_code, "driver code"),
    points: asNumber(r.points, "standing points"),
    wins: asNumber(r.wins, "standing wins"),
  };
}

function mapTeamStandingRow(row: unknown): TeamStandingRow {
  const r = asRecord(row, "team standing row");
  return {
    position: r.position_number === null ? null : asNumber(r.position_number, "standing position"),
    positionText: asString(r.position_text, "standing position text"),
    teamId: asString(r.team_id, "team id"),
    teamName: asString(r.team_name, "team name"),
    points: asNumber(r.points, "standing points"),
    wins: asNumber(r.wins, "standing wins"),
  };
}
```

接口与实现追加（DEV 分流读 `standings-2026.json` 的 `drivers`/`teams`，非 2026 返回 []；生产单语句 batch）：

```ts
    async getDriverStandings(year) {
      if (!db) {
        if (year !== 2026) return [];
        const { default: fixture } = await import("./fixtures/standings-2026.json");
        return (fixture as { drivers: DriverStandingRow[] }).drivers;
      }
      const [rows] = await db.batch([{ sql: driverStandingsSql, values: [year] }]);
      return rows.results.map(mapDriverStandingRow);
    },

    async getConstructorStandings(year) {
      if (!db) {
        if (year !== 2026) return [];
        const { default: fixture } = await import("./fixtures/standings-2026.json");
        return (fixture as { teams: TeamStandingRow[] }).teams;
      }
      const [rows] = await db.batch([{ sql: constructorStandingsSql, values: [year] }]);
      return rows.results.map(mapTeamStandingRow);
    },
```

- [ ] 步骤 5：改造 StandingsTable 并创建两个页面

`StandingsTable.astro` 整体替换为（行模型换 repository 类型，markup 结构不变）：

```astro
---
import type {
  DriverStandingRow,
  TeamStandingRow,
} from "../lib/race-results-repository.js";

interface Props {
  kind: "drivers" | "constructors";
  rows: DriverStandingRow[] | TeamStandingRow[];
  limit?: number;
}

const { kind, rows, limit } = Astro.props;
const visibleRows = limit ? rows.slice(0, limit) : rows;
const maxPoints = Math.max(...rows.map((row) => row.points), 1);
const label = kind === "drivers" ? "Driver standings" : "Constructor standings";
const emptyText = kind === "drivers"
  ? "Driver standings are not available yet."
  : "Constructor standings are not available yet.";
const nameOf = (row: DriverStandingRow | TeamStandingRow) =>
  "driverName" in row ? row.driverName : row.teamName;
---

<div class="table-scroll standings-scroll" tabindex="0">
  <table class="standings-table" aria-label={label}>
    <thead>
      <tr>
        <th scope="col">Pos</th>
        <th scope="col">{kind === "drivers" ? "Driver" : "Constructor"}</th>
        <th scope="col">Points</th>
        <th scope="col">Wins</th>
      </tr>
    </thead>
    <tbody>
      {visibleRows.length > 0 ? visibleRows.map((row) => (
        <tr>
          <td class="position-cell">{String(row.position ?? row.positionText).padStart(2, "0")}</td>
          <th scope="row">
            <span class="standing-name">{nameOf(row)}</span>
            {"driverCode" in row && <span class="driver-code">{row.driverCode}</span>}
            <span class="points-bar" aria-hidden="true">
              <span style={`--bar-size: ${(row.points / maxPoints) * 100}%`}></span>
            </span>
          </th>
          <td class="points-cell">{row.points}</td>
          <td>{row.wins}</td>
        </tr>
      )) : (
        <tr>
          <td class="empty-cell" colspan="4">{emptyText}</td>
        </tr>
      )}
    </tbody>
  </table>
</div>
```

`pages/results/[year]/drivers.astro`：

```astro
---
import { env } from "cloudflare:workers";

import ResultsNav from "../../../components/ResultsNav.astro";
import StandingsTable from "../../../components/StandingsTable.astro";
import BaseLayout from "../../../layouts/BaseLayout.astro";
import {
  createD1RaceResultsDatabase,
  createRaceResultsRepository,
} from "../../../lib/race-results-repository.js";

const year = Number(Astro.params.year);
const repository = import.meta.env.DEV
  ? createRaceResultsRepository()
  : createRaceResultsRepository(createD1RaceResultsDatabase(env.F1_DB));
const [availableYears, rows] = await Promise.all([
  repository.getSeasonYears(),
  repository.getDriverStandings(year),
]);
if (!availableYears.includes(year)) Astro.response.status = 404;
if (rows.length > 0) {
  Astro.response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
}
---

<BaseLayout
  title={`${year} Driver Standings`}
  active="results"
  year={year}
  availableYears={availableYears}
  yearHref={(y) => `/results/${y}/drivers`}
>
  <main id="main-content" class="page-shell">
    <h1>{year} Driver Standings</h1>
    <ResultsNav year={year} active="drivers" />
    <StandingsTable kind="drivers" rows={rows} />
  </main>
</BaseLayout>
```

`pages/results/[year]/teams.astro` 同构：`getConstructorStandings`、`kind="constructors"`、title `Constructor Standings`、ResultsNav `active="teams"`、yearHref `/results/${y}/teams`。

- [ ] 步骤 6：运行验证通过

运行：`pnpm --filter @f1-box/web test race-results-repository.test.ts`、`pnpm --filter @f1-box/web test:e2e results.spec.ts`
预期：PASS

- [ ] 步骤 7：Commit

```bash
git add apps/web/src/lib/race-results-repository.ts apps/web/src/lib/fixtures/standings-2026.json "apps/web/src/pages/results/[year]/drivers.astro" "apps/web/src/pages/results/[year]/teams.astro" apps/web/src/components/StandingsTable.astro apps/web/tests/race-results-repository.test.ts apps/web/tests/e2e/results.spec.ts
git commit -m "feat: back standings pages with f1db season standings"
```

---

## 任务 7：旧路由退役 + 日历页迁 f1db

文件：重写 `[year]/racing.astro`、`RaceCard.astro`；`[year]/results/*` 变 301 stub；删除 `[year]/racing/[event].astro`、`ResultTable.astro`、`SeasonError.astro`、`year-context.ts`；修改 `page-data.ts`、`season.spec.ts`、`results.spec.ts`

- [ ] 步骤 1：编写失败的测试

`results.spec.ts` 追加：

```ts
test.describe("legacy results redirects", () => {
  test("@desktop old results paths redirect to new", async ({ page }) => {
    await page.goto("/2026/results/races");
    await page.waitForURL(/\/results\/2026\/races$/);
    await page.goto("/2026/results");
    await page.waitForURL(/\/results\/2026\/races$/);
    await page.goto("/2026/results/drivers");
    await page.waitForURL(/\/results\/2026\/drivers$/);
    await page.goto("/2026/results/teams");
    await page.waitForURL(/\/results\/2026\/teams$/);
  });

  test("@desktop old race detail path is gone", async ({ page }) => {
    expect((await page.goto("/2026/racing/10-belgian-grand-prix"))?.status()).toBe(404);
  });
});
```

`season.spec.ts` 改动（本步先改测试，让其 FAIL）：

- "racing page lists the full calendar" 改为：

```ts
test("@desktop racing calendar links every round to its results page", async ({ page }) => {
  await page.goto("/2026/racing");
  const cards = page.locator("main .race-card");
  await expect(cards).toHaveCount(22);
  await expect(cards.first()).toContainText("Australian Grand Prix");
  await expect(cards.first()).toContainText("Melbourne");
  const raceLinks = page.locator('main a[href^="/results/2026/races/"]');
  await expect(raceLinks).toHaveCount(22);
  await expect(raceLinks.first()).toHaveAttribute(
    "href",
    "/results/2026/races/australia/race-result",
  );
  await expect(page.getByRole("navigation", { name: "Season" })).toBeVisible();
});
```

- "unknown year returns 404" 的 URL 从 `/2019/racing` 改为 `/1900/racing`（2019 现在是有效 f1db 赛季）。
- "race detail shows schedule and classifications" 删除（旧分站页已删，新分站页覆盖在 results.spec）。
- "results pages show races, drivers and teams tables" 与 "results index redirects to races" 删除（results.spec 已覆盖）。
- 其余（首页重定向、非数字年份、unknown race 404、@mobile、@reduced）不动。

运行 e2e 预期 FAIL（旧页面未退役、日历仍旧数据）。

- [ ] 步骤 2：旧 results 位置变 301 stub

`[year]/results/index.astro`、`races.astro`：

```astro
---
const year = Astro.params.year;
return Astro.redirect(`/results/${year}/races`, 301);
---
```

`[year]/results/drivers.astro`、`teams.astro`：同上，目标分别为 `/results/${year}/drivers`、`/results/${year}/teams`（覆盖原实现）。

- [ ] 步骤 3：日历页重写为 f1db 数据

`RaceCard.astro` 整体替换为：

```astro
---
import type { RaceSummary } from "../lib/race-results-repository.js";
import { formatUtcDateTime } from "../lib/time.js";

interface Props {
  race: RaceSummary;
  href: string;
}

const { race, href } = Astro.props;
const round = String(race.round).padStart(2, "0");
const complete = race.winnerName !== null;
const startsAt = `${race.date}T${race.time ?? "00:00"}:00Z`;
---

<article class:list={["race-card", `race-card--${complete ? "complete" : "upcoming"}`]}>
  <a href={href} aria-label={`Round ${round}: ${race.raceName}`}>
    <div class="race-card__topline">
      <span class="race-card__round" aria-hidden="true">{round}</span>
      <span class="status-label">{complete ? "COMPLETE" : "UPCOMING"}</span>
    </div>
    <div class="race-card__body">
      <h3>{race.raceName}</h3>
      <time datetime={startsAt}>{formatUtcDateTime(startsAt)}</time>
      <p>{race.circuitPlace}, {race.countryName}</p>
      <p class="race-card__circuit">{race.circuitName}</p>
    </div>
    {complete && (
      <dl class="race-card__results">
        <div>
          <dt>Pole</dt>
          <dd>{race.poleName ?? "—"}</dd>
        </div>
        <div>
          <dt>Winner</dt>
          <dd>{race.winnerName}</dd>
        </div>
      </dl>
    )}
    <svg class="race-card__arrow" viewBox="0 0 28 16" aria-hidden="true">
      <path d="M1 8h24M18 1l7 7-7 7" />
    </svg>
  </a>
</article>
```

`[year]/racing.astro` 整体替换为：

```astro
---
import { env } from "cloudflare:workers";

import RaceCard from "../../components/RaceCard.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import {
  createD1RaceResultsDatabase,
  createRaceResultsRepository,
} from "../../lib/race-results-repository.js";

const year = Number(Astro.params.year);
const repository = import.meta.env.DEV
  ? createRaceResultsRepository()
  : createRaceResultsRepository(createD1RaceResultsDatabase(env.F1_DB));
const [availableYears, races] = await Promise.all([
  repository.getSeasonYears(),
  repository.getSeasonCalendar(year),
]);
if (!availableYears.includes(year)) Astro.response.status = 404;
if (races.length > 0) {
  Astro.response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
}
---

<BaseLayout title={`${year} Season`} year={year} availableYears={availableYears} rest="/racing">
  <main id="main-content" class="page-shell">
    <h1>{year} Season</h1>
    <div class="race-grid">
      {races.map((race) => (
        <RaceCard race={race} href={`/results/${year}/races/${race.slug}/race-result`} />
      ))}
    </div>
  </main>
</BaseLayout>
```

（年份切换用默认 `/{year}/racing`（rest），留在日历页内。）

- [ ] 步骤 4：删除退役文件与死代码

```bash
git rm "apps/web/src/pages/[year]/racing/[event].astro" apps/web/src/components/ResultTable.astro apps/web/src/components/SeasonError.astro apps/web/src/lib/year-context.ts
grep -rn "ResultTable\|SeasonError\|year-context" apps/web/src   # 预期无输出
```

`page-data.ts` 删除只剩 year-context 使用的 `getSeason`（保留 `getIndex`）。`global.css` 中 `grep -n "race-card--"` 清理旧 state 变体（scheduled/running 等不再产出的 class）；`grep -n "results-scroll"` 若仅 ResultTable 使用则一并删除。

- [ ] 步骤 5：运行验证

运行：`pnpm --filter @f1-box/web test`、`pnpm --filter @f1-box/web check`、`pnpm --filter @f1-box/web test:e2e`
预期：全绿

- [ ] 步骤 6：Commit

```bash
git add "apps/web/src/pages/[year]/results" "apps/web/src/pages/[year]/racing.astro" apps/web/src/components/RaceCard.astro apps/web/src/lib/page-data.ts apps/web/src/styles/global.css apps/web/tests/e2e/season.spec.ts apps/web/tests/e2e/results.spec.ts
git commit -m "refactor: retire legacy race pages and back calendar with f1db"
```

（`git rm` 的删除已在暂存区，无需重复 add。）

---

## 任务 8：收尾验证与交付

- [ ] 步骤 1：全量验证

运行：`pnpm check`、`pnpm test`、`pnpm -r build`、`pnpm --filter @f1-box/web test:e2e`
预期：全绿

- [ ] 步骤 2：本地视觉检查

`pnpm --filter @f1-box/web dev` 起服务，浏览器检查（桌面 + 375px）：
`/results/2026/races`（列表、monogram、logo、国旗）、`/results/2026/races/australia/race-result` 与其余 tab（含 pit-stop-summary 聚合列）、`/results/2026/drivers`、`/results/2026/teams`、`/2026/racing`（f1db 日历卡、未来分站无 Pole/Winner 行）、未来分站页（hero + session 时间 + 空态）、session 时间行本地化、年份切换停留在 Results 分区、旧 results 路径 301 落点。
按需微调样式后重跑 e2e。

- [ ] 步骤 3：提交 PR

更新 `docs/requirements/2026-08-14-results-pages.md` 状态为"预览验收"；按 submit skill 流程开 PR（分支从 origin/main 切出，PR 标题/正文英文）。

## 自检记录

- 规格覆盖度：列表页与各 tab 列结构/monogram/logo → 任务 3/4/5；tab 子导航按数据显示 → 任务 4/5；未知 tab/slug 404 → 任务 4；`/results` 与 `/results/[year]` 重定向 → 任务 1/2；积分榜 f1db 化与年份一致 → 任务 6；日历 f1db 化、`/[year]/results/*` 301、旧分站页 404 → 任务 7；年份切换停留 Results 分区 → 任务 3（yearHref）；D1/fixture 数据源 → 任务 2；全绿 + 桌面/375px 视觉 → 任务 8。范围外各项（sprint tab、Time of Day、practice-4/pre-qualifying/warming-up、车手照片、首页数据源）在计划中无对应实现。
- 类型一致性：所有模型单一定义于 race-results-repository.ts；tab key/标签单一定义于 routing.ts；RACE_TAB_FIELDS 由 RaceTabsNav 与 [tab].astro 共用；StandingsTable/RaceCard 直接吃 repository 导出类型；fakeDb 片段与 SQL 文本逐条对齐。
- 已核实（2026-08-18，远端 D1 + 本地 dump 双重验证）：全部表/视图与列存在；standings 表无 wins 列（聚合口径已验证：Antonelli 6 胜 / Mercedes 8 胜与 11 站结果吻合）；driver.name 为显示名；season 表 1950–2026；pit_stop 数据自 1994 年；2026 已完赛 11 站；日历/积分榜/澳洲站 fixture 均已按真实数据内嵌本计划。
- 已知取舍：未来分站页（hero + 空态）DEV fixture 只含澳洲站，无法 e2e 覆盖，任务 8 的 preview 视觉检查验证；R2 读取只剩首页 getIndex，Jolpica 退役时处理。
