# drivers 列表与详情页完善 实施计划

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: 把 drivers 板块升级为官方级视觉与完整信息：列表卡（车队色块/名姓/车号/国籍旗/水印）+ 全局生涯详情页 /drivers/{slug}（hero + 本赛季 + Career + wiki 外链）+ 可复用车号徽章组件。

Architecture: 数据侧在 SeasonPayload 以可选字段扩展（DriverStanding 增 slug/givenName/familyName/number/nationality/wikipediaUrl，RaceRow 增 fastestLapRank），ingest 从现有 Jolpica 响应顺手采集；前端 derive.ts 增统计派生，tokens.ts 旗标 API 重写为 nationality 原文映射；页面与组件纯 CSS/SVG 实现 VLM 审美规格。

Tech Stack: Astro SSR（Cloudflare adapter）、pnpm workspace、json-schema-to-typescript + ajv（contracts）、Python ingest（uv/pytest/ruff）、Playwright e2e、VLM 网关视觉审校。

## Global Constraints

- 工作分支：feat/drivers-pages（已从 origin/main 切出），不直推 main；PR 由用户合并。
- Commit：Conventional Commits 英文标题祈使语气 ≤72 字符，正文末尾 Co-Authored-By: Claude <noreply@anthropic.com>；git add 具体文件。
- TDD：每个任务先写失败测试再实现；提交前跑与改动匹配的验证（contracts/web：pnpm check、pnpm test；UI 变更加 pnpm --filter @f1-box/web test:e2e；ingest：uv run --project services/ingest pytest -q 与 uv run --project services/ingest ruff check）。
- 仓库文档与对话用中文；PR 标题/正文用英文。
- 代码卫生：不留死代码（本次删除 countryFlag/ALPHA3_TO_ALPHA2 与旧详情页路由）、不为将来预留抽象。
- 视觉常量以 Task 7 的 VLM 审校为最终微调依据；实现阶段先按本计划给定值落地。
- 计划与代码注释中不写 emoji 字面量（旗帜期望值一律用 String.fromCodePoint 表达，避免编码损坏）。

---

### Task 1: contracts schema 扩展（可选字段）

Files:

- Modify: packages/contracts/season.schema.json（$defs.driverStanding 与 $defs.raceRow）
- Test: packages/contracts/tests/season.test.ts

- [ ] Step 1: 写失败测试

在 packages/contracts/tests/season.test.ts 的 describe 内追加：

```ts
test("accepts optional driver identity fields and fastest lap rank", () => {
  const payload = {
    ...season2026,
    driverStandings: season2026.driverStandings.map((row, index) =>
      index === 0
        ? {
            ...row,
            givenName: "George",
            familyName: "Russell",
            slug: "george-russell",
            number: 63,
            nationality: "British",
            wikipediaUrl: "https://en.wikipedia.org/wiki/George_Russell_(racing_driver)",
          }
        : row,
    ),
    events: season2026.events.map((event) =>
      event.raceClassification
        ? {
            ...event,
            raceClassification: {
              ...event.raceClassification,
              rows: event.raceClassification.rows.map((row) => ({
                ...row,
                fastestLapRank: 1,
              })),
            },
          }
        : event,
    ),
  };

  expect(parseSeasonPayload(payload)).toBe(payload);
});
```

- [ ] Step 2: 运行确认失败

Run: pnpm --filter @f1-box/contracts test
Expected: FAIL（additionalProperties 拒绝新字段）

- [ ] Step 3: 扩展 schema

season.schema.json 的 $defs.driverStanding.properties 增（required 不变）：

```json
"givenName": { "type": "string" },
"familyName": { "type": "string" },
"slug": { "type": "string" },
"number": { "type": ["integer", "null"] },
"nationality": { "type": "string" },
"wikipediaUrl": { "type": "string" }
```

$defs.raceRow.properties 增：

```json
"fastestLapRank": { "type": ["integer", "null"] }
```

- [ ] Step 4: 重新生成并验证

Run: pnpm --filter @f1-box/contracts check && pnpm --filter @f1-box/contracts test
Expected: PASS（generate 重写 season.generated.ts 与 validator，tsc 通过）

- [ ] Step 5: 提交

```bash
git add packages/contracts/season.schema.json packages/contracts/src/season.generated.ts packages/contracts/src/season.validator.generated.js packages/contracts/src/season.validator.generated.d.ts packages/contracts/tests/season.test.ts
git commit -m "feat: add optional driver identity fields to season schema"
```

（生成文件实际产物以 generate 脚本输出为准，git status 核对后一并 add。）

---

### Task 2: ingest 采集车手身份与最快圈 rank

Files:

- Modify: services/ingest/src/f1box_ingest/normalize.py
- Modify: services/ingest/tests/fixtures/jolpica/driver_standings.json
- Test: services/ingest/tests/test_normalize.py
- Modify: packages/contracts/fixtures/season-2026.json（重新生成）

- [ ] Step 1: 更新 jolpica 测试 fixture

driver_standings.json 两个 Driver 对象补字段：

norris 的 Driver 增 "permanentNumber": "1", "nationality": "British", "url": "https://en.wikipedia.org/wiki/Lando_Norris"；
piastri 的 Driver 增 "permanentNumber": "81", "nationality": "Australian", "url": "https://en.wikipedia.org/wiki/Oscar_Piastri"。
（givenName/familyName 已存在，保留。）

- [ ] Step 2: 写失败断言

test_normalize.py 的 test_build_season_normalizes_fixed_jolpica_payloads 中，把 driverStandings 期望改为：

```python
    assert payload["driverStandings"] == [
        {
            "position": 1,
            "name": "Lando Norris",
            "code": "NOR",
            "givenName": "Lando",
            "familyName": "Norris",
            "slug": "lando-norris",
            "number": 1,
            "nationality": "British",
            "wikipediaUrl": "https://en.wikipedia.org/wiki/Lando_Norris",
            "points": 25.0,
            "wins": 1,
        },
        {
            "position": 2,
            "name": "Oscar Piastri",
            "code": "PIA",
            "givenName": "Oscar",
            "familyName": "Piastri",
            "slug": "oscar-piastri",
            "number": 81,
            "nationality": "Australian",
            "wikipediaUrl": "https://en.wikipedia.org/wiki/Oscar_Piastri",
            "points": 18.0,
            "wins": 0,
        },
    ]
```

raceClassification 两行期望各增 "fastestLapRank": 1 与 "fastestLapRank": 2。

- [ ] Step 3: 运行确认失败

Run: uv run --project services/ingest pytest -q
Expected: FAIL（键缺失）

- [ ] Step 4: 实现 normalize 扩展

normalize.py 增 helper：

```python
def _optional_integer(value: object, label: str) -> int | None:
    return None if value is None else _integer(value, label)
```

_driver_standings 的行 dict 改为：

```python
        rows.append(
            {
                "position": _integer(row.get("position"), "DriverStandings.position"),
                "name": _driver_name(driver),
                "code": _string(driver.get("code"), "Driver.code"),
                "givenName": _string(driver.get("givenName"), "Driver.givenName"),
                "familyName": _string(driver.get("familyName"), "Driver.familyName"),
                "slug": _slug(_driver_name(driver)),
                "number": _optional_integer(
                    driver.get("permanentNumber"), "Driver.permanentNumber"
                ),
                "nationality": _optional_string(driver.get("nationality")),
                "wikipediaUrl": _optional_string(driver.get("url")),
                "points": _number(row.get("points"), "DriverStandings.points"),
                "wins": _integer(row.get("wins"), "DriverStandings.wins"),
            }
        )
```

_race_classification 的 fastest_lap 块改为同时取 time 与 rank：

```python
        fastest_time = None
        fastest_rank = None
        if fastest_lap is not None:
            fastest = _dict(fastest_lap, "Results.FastestLap")
            fastest_time_value = fastest.get("Time")
            if fastest_time_value is not None:
                fastest_time = _optional_string(
                    _dict(fastest_time_value, "Results.FastestLap.Time").get("time")
                )
            fastest_rank = _optional_integer(
                fastest.get("rank"), "Results.FastestLap.rank"
            )
```

行 dict 增 "fastestLapRank": fastest_rank,（跟在 "fastestLap": fastest_time, 之后）。

- [ ] Step 5: 运行验证

Run: uv run --project services/ingest pytest -q && uv run --project services/ingest ruff check
Expected: PASS

- [ ] Step 6: 重新生成 contracts fixture

Run: uv run --project services/ingest f1box-ingest season --season 2026 --output packages/contracts/fixtures/season-2026.json

（访问 Jolpica 活数据；.data/raw 为本地缓存，已 gitignore。生成后抽查 fixture 含 slug/number/nationality/wikipediaUrl/fastestLapRank。）

- [ ] Step 7: 提交

```bash
git add services/ingest/src/f1box_ingest/normalize.py services/ingest/tests/fixtures/jolpica/driver_standings.json services/ingest/tests/test_normalize.py packages/contracts/fixtures/season-2026.json
git commit -m "feat: capture driver identity and fastest lap rank in ingest"
```

---

### Task 3: tokens 旗标 API 重写

Files:

- Modify: apps/web/src/lib/tokens.ts
- Test: apps/web/tests/tokens.test.ts

- [ ] Step 1: 写失败测试

tokens.test.ts 整体替换为：

```ts
import { describe, expect, it } from "vitest";

import { flagForNationality, teamColor } from "../src/lib/tokens.js";

describe("tokens", () => {
  it("returns known team colors and a neutral fallback", () => {
    expect(teamColor("Ferrari")).toBe("#f41919");
    expect(teamColor("Not A Team")).toBe("#84909e");
  });

  it("maps nationality text to flag emoji with a fallback", () => {
    expect(flagForNationality("British")).toBe(String.fromCodePoint(0x1f1ec, 0x1f1e7));
    expect(flagForNationality("Monegasque")).toBe(String.fromCodePoint(0x1f1f2, 0x1f1e8));
    expect(flagForNationality("New Zealander")).toBe(String.fromCodePoint(0x1f1f3, 0x1f1ff));
    expect(flagForNationality("Unknown land")).toBe(String.fromCodePoint(0x1f3f3, 0xfe0f));
    expect(flagForNationality(undefined)).toBe(String.fromCodePoint(0x1f3f3, 0xfe0f));
  });
});
```

- [ ] Step 2: 运行确认失败

Run: pnpm test -- --run tokens（或 pnpm --filter @f1-box/web test 过滤 tokens.test.ts）
Expected: FAIL（flagForNationality 不存在）

- [ ] Step 3: 重写 tokens.ts

删除 ALPHA3_TO_ALPHA2 与 countryFlag，替换为：

```ts
const NATIONALITY_TO_ALPHA2: Record<string, string> = {
  Argentine: "AR", Australian: "AU", Brazilian: "BR", British: "GB",
  Canadian: "CA", Dutch: "NL", Finnish: "FI", French: "FR", German: "DE",
  Italian: "IT", Mexican: "MX", Monegasque: "MC", "New Zealander": "NZ",
  Spanish: "ES", Thai: "TH",
};

export function flagForNationality(nationality: string | undefined): string {
  const alpha2 = nationality ? NATIONALITY_TO_ALPHA2[nationality] : undefined;
  if (!alpha2) return String.fromCodePoint(0x1f3f3, 0xfe0f);
  return String.fromCodePoint(
    ...[...alpha2.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}
```

TEAM_COLORS 与 teamColor 保持不变。

- [ ] Step 4: 运行验证

Run: pnpm check && pnpm test
Expected: PASS（确认无其它 countryFlag 调用点——当前没有）

- [ ] Step 5: 提交

```bash
git add apps/web/src/lib/tokens.ts apps/web/tests/tokens.test.ts
git commit -m "feat: map driver nationality text to flag emoji"
```

---

### Task 4: derive 赛季统计与生涯聚合

Files:

- Modify: apps/web/src/lib/derive.ts
- Test: apps/web/tests/derive.test.ts

- [ ] Step 1: 写失败测试

derive.test.ts 追加：

```ts
describe("driverSeasonStats", () => {
  test("aggregates the standings leader's season from classifications", () => {
    const code = season.driverStandings[0].code;
    const stats = driverSeasonStats(season, code);

    expect(stats).toMatchObject({
      position: season.driverStandings[0].position,
      points: season.driverStandings[0].points,
      wins: season.driverStandings[0].wins,
      races: completedCount,
    });

    const rows = season.events.flatMap(
      (event) =>
        event.raceClassification?.rows.filter((row) => row.driverCode === code) ?? [],
    );
    expect(stats?.podiums).toBe(rows.filter((row) => row.position <= 3).length);
    expect(stats?.top10s).toBe(rows.filter((row) => row.position <= 10).length);
    expect(stats?.dnfs).toBe(
      rows.filter((row) => !/^(Finished|\+\d+ Lap)/.test(row.status)).length,
    );
    expect(stats?.poles).toBe(
      season.events.filter(
        (event) =>
          event.qualifyingClassification?.rows.find(
            (row) => row.driverCode === code,
          )?.position === 1,
      ).length,
    );
  });

  test("counts fastest laps only when rank data exists", () => {
    const code = season.driverStandings[0].code;
    const stripped = parseSeasonPayload({
      ...seasonFixture,
      events: seasonFixture.events.map((event) =>
        event.raceClassification
          ? {
              ...event,
              raceClassification: {
                ...event.raceClassification,
                rows: event.raceClassification.rows.map(({ fastestLapRank, ...row }) => row),
              },
            }
          : event,
      ),
    });
    expect(driverSeasonStats(stripped, code)?.fastestLaps).toBeNull();
    expect(driverSeasonStats(season, code)?.fastestLaps).toBe(
      season.events.flatMap(
        (event) =>
          event.raceClassification?.rows.filter(
            (row) => row.driverCode === code && row.fastestLapRank === 1,
          ) ?? [],
      ).length,
    );
  });

  test("returns undefined for an unknown code", () => {
    expect(driverSeasonStats(season, "NOPE")).toBeUndefined();
  });
});

describe("driverCareer", () => {
  test("sums seasons and records one row per participated season", () => {
    const code = season.driverStandings[0].code;
    const career = driverCareer([season], code);
    const stats = driverSeasonStats(season, code);

    expect(career.seasons).toHaveLength(1);
    expect(career.seasons[0]).toMatchObject({
      year: 2026,
      position: stats?.position,
      points: stats?.points,
    });
    expect(career.points).toBe(stats?.points);
    expect(career.bestFinish).toBeGreaterThanOrEqual(1);
    expect(typeof career.seasons[0].team).toBe("string");
  });
});
```

（derive.test.ts 顶部 import 增 driverSeasonStats、driverCareer。）

- [ ] Step 2: 运行确认失败

Run: pnpm test（web 包 vitest）
Expected: FAIL（函数不存在）

- [ ] Step 3: 实现

derive.ts 追加：

```ts
export interface DriverSeasonStats {
  position: number;
  points: number;
  wins: number;
  races: number;
  podiums: number;
  poles: number;
  top10s: number;
  fastestLaps: number | null;
  dnfs: number;
}

export interface CareerSeasonRow {
  year: number;
  team: string;
  position: number;
  points: number;
}

export interface DriverCareer {
  races: number;
  points: number;
  wins: number;
  podiums: number;
  poles: number;
  bestFinish: number | null;
  seasons: CareerSeasonRow[];
}

const CLASSIFIED_FINISH = /^(Finished|\+\d+ Lap)/;

export function driverSeasonStats(
  season: SeasonPayload,
  code: string,
): DriverSeasonStats | undefined {
  const standing = season.driverStandings.find((row) => row.code === code);
  if (!standing) return undefined;

  let races = 0;
  let podiums = 0;
  let top10s = 0;
  let dnfs = 0;
  let poles = 0;
  let fastestLaps = 0;
  let hasFastestRank = false;

  for (const event of season.events) {
    const raceRow = event.raceClassification?.rows.find(
      (row) => row.driverCode === code,
    );
    if (raceRow) {
      races += 1;
      if (raceRow.position <= 3) podiums += 1;
      if (raceRow.position <= 10) top10s += 1;
      if (!CLASSIFIED_FINISH.test(raceRow.status)) dnfs += 1;
      if (raceRow.fastestLapRank !== undefined) {
        hasFastestRank = true;
        if (raceRow.fastestLapRank === 1) fastestLaps += 1;
      }
    }
    const qualifyingRow = event.qualifyingClassification?.rows.find(
      (row) => row.driverCode === code,
    );
    if (qualifyingRow?.position === 1) poles += 1;
  }

  return {
    position: standing.position,
    points: standing.points,
    wins: standing.wins,
    races,
    podiums,
    poles,
    top10s,
    fastestLaps: hasFastestRank ? fastestLaps : null,
    dnfs,
  };
}

export function driverCareer(
  seasons: SeasonPayload[],
  code: string,
): DriverCareer {
  const career: DriverCareer = {
    races: 0,
    points: 0,
    wins: 0,
    podiums: 0,
    poles: 0,
    bestFinish: null,
    seasons: [],
  };

  for (const season of seasons) {
    const stats = driverSeasonStats(season, code);
    if (!stats) continue;

    career.races += stats.races;
    career.points += stats.points;
    career.wins += stats.wins;
    career.podiums += stats.podiums;
    career.poles += stats.poles;

    for (const event of season.events) {
      const row = event.raceClassification?.rows.find(
        (candidate) => candidate.driverCode === code,
      );
      if (row && (career.bestFinish === null || row.position < career.bestFinish)) {
        career.bestFinish = row.position;
      }
    }

    const team =
      completedEvents(season)
        .at(-1)
        ?.raceClassification?.rows.find((row) => row.driverCode === code)
        ?.constructorName ?? "—";
    career.seasons.push({
      year: season.season,
      team,
      position: stats.position,
      points: stats.points,
    });
  }

  return career;
}
```

同时把 DriverCard 接口与 driverGrid 扩展（列表卡需要身份字段）：

```ts
export interface DriverCard {
  code: string;
  name: string;
  team: string;
  position: number;
  points: number;
  slug: string;
  givenName?: string;
  familyName?: string;
  number?: number | null;
  nationality?: string;
}
```

driverGrid 的 map 增：

```ts
    slug: standing.slug ?? standing.code.toLowerCase(),
    givenName: standing.givenName,
    familyName: standing.familyName,
    number: standing.number,
    nationality: standing.nationality,
```

- [ ] Step 4: 运行验证

Run: pnpm check && pnpm test
Expected: PASS

- [ ] Step 5: 提交

```bash
git add apps/web/src/lib/derive.ts apps/web/tests/derive.test.ts
git commit -m "feat: derive driver season stats and career aggregation"
```

---

### Task 5: DriverTag/DriverCard 组件与列表页重设计

Files:

- Create: apps/web/src/components/DriverTag.astro
- Create: apps/web/src/components/DriverCard.astro
- Modify: apps/web/src/pages/[year]/drivers/index.astro
- Modify: apps/web/src/layouts/BaseLayout.astro（补字体权重）
- Test: apps/web/tests/e2e/season.spec.ts（列表断言更新）

- [ ] Step 1: 更新 e2e 列表断言（先失败）

season.spec.ts 的 "drivers and teams directories link to detail pages" 测试中，drivers 部分替换为（点击跳转的断言在 Task 6 详情页就绪后补）：

```ts
  await page.goto("/2026/drivers");
  const driverLinks = page.locator('main a[href^="/drivers/"]');
  await expect(driverLinks.first()).toBeVisible();
  await expect(driverLinks.first().locator(".driver-card__number")).toBeVisible();
  await expect(driverLinks.first().locator(".driver-card__flag")).toBeVisible();
```

- [ ] Step 2: 运行确认失败

Run: pnpm --filter @f1-box/web test:e2e -- --grep "drivers and teams"
Expected: FAIL（链接仍是 /2026/drivers/ 且无新元素）

- [ ] Step 3: BaseLayout 补字体

BaseLayout.astro 的 fontsource import 增：

```ts
import "@fontsource/barlow-condensed/300.css";
import "@fontsource/barlow-condensed/900.css";
```

- [ ] Step 4: DriverTag 组件

```astro
---
interface Props {
  number: number;
  color: string;
}
const { number, color } = Astro.props;
---

<span class="driver-tag" style={`--team-color: ${color}`}>{number}</span>

<style>
  .driver-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 1.2em;
    padding-inline: 0.5em;
    border-radius: 999px;
    background: var(--team-color);
    color: #fff;
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 700;
    font-size: 0.9em;
    transform: skewX(-8deg);
  }
</style>
```

- [ ] Step 5: DriverCard 组件

```astro
---
import { flagForNationality, teamColor } from "../lib/tokens.js";

interface Props {
  slug: string;
  name: string;
  givenName?: string;
  familyName?: string;
  team: string;
  number?: number | null;
  nationality?: string;
}
const { slug, name, givenName, familyName, team, number, nationality } = Astro.props;
const spaceIndex = name.lastIndexOf(" ");
const first = givenName ?? (spaceIndex > 0 ? name.slice(0, spaceIndex) : name);
const last = familyName ?? (spaceIndex > 0 ? name.slice(spaceIndex + 1) : name);
---

<a class="driver-card" style={`--team-color: ${teamColor(team)}`} href={`/drivers/${slug}`}>
  {number != null ? (
    <span class="driver-card__watermark" aria-hidden="true">{number}</span>
  ) : null}
  <span class="driver-card__body">
    <span class="driver-card__name">
      <span class="driver-card__first">{first}</span>
      <span class="driver-card__last">{last}</span>
    </span>
    <span class="driver-card__team">{team}</span>
    {number != null ? (
      <span class="driver-card__number">{number}</span>
    ) : null}
  </span>
  <span class="driver-card__flag" aria-label={nationality ?? "Unknown nationality"}>
    {flagForNationality(nationality)}
  </span>
</a>

<style>
  .driver-card {
    position: relative;
    container-type: inline-size;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    aspect-ratio: 7 / 5;
    padding: 6cqw;
    border-radius: 8px;
    color: #fff;
    text-decoration: none;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--team-color) 70%, black),
      color-mix(in srgb, var(--team-color) 85%, white)
    );
  }

  .driver-card::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image: radial-gradient(circle, #fff 0.75px, transparent 0.75px);
    background-size: 3px 3px;
    opacity: 0.1;
    mask-image: linear-gradient(to left, #000 10%, transparent 60%);
    pointer-events: none;
  }

  .driver-card__watermark {
    position: absolute;
    right: -18%;
    top: 50%;
    transform: translateY(-50%) skewX(-10deg);
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 900;
    font-size: 52cqw;
    line-height: 1;
    color: #fff;
    opacity: 0.09;
  }

  .driver-card__body {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2cqw;
    max-width: 55%;
  }

  .driver-card__name { display: flex; flex-direction: column; }
  .driver-card__first { font-weight: 500; font-size: 6.5cqw; }
  .driver-card__last {
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 900;
    text-transform: uppercase;
    font-size: 8cqw;
    line-height: 1.05;
  }
  .driver-card__team { font-size: 4.5cqw; opacity: 0.9; }

  .driver-card__number {
    margin-top: 3cqw;
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 900;
    font-size: 14cqw;
    line-height: 1;
    transform: skewX(-10deg);
  }

  .driver-card__flag {
    position: relative;
    margin-top: auto;
    width: 8cqw;
    height: 8cqw;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: #fff;
    font-size: 5cqw;
  }
</style>
```

- [ ] Step 6: 列表页改用组件

[year]/drivers/index.astro 的 main 内网格替换为：

```astro
      <h1>{season.season} Drivers</h1>
      <div class="driver-grid">
        {grid.map((driver) => (
          <DriverCard
            slug={driver.slug}
            name={driver.name}
            givenName={driver.givenName}
            familyName={driver.familyName}
            team={driver.team}
            number={driver.number}
            nationality={driver.nationality}
          />
        ))}
      </div>
```

frontmatter 增 import DriverCard from "../../../components/DriverCard.astro";；style 块只保留：

```css
  .driver-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }
```

删除旧 .driver-card 相关样式。

- [ ] Step 7: 运行验证

Run: pnpm check && pnpm test && pnpm --filter @f1-box/web test:e2e
Expected: PASS（详情点击后落 /drivers/{slug}，旧详情页仍在，Task 6 替换）

- [ ] Step 8: 提交

```bash
git add apps/web/src/components/DriverTag.astro apps/web/src/components/DriverCard.astro "apps/web/src/pages/[year]/drivers/index.astro" apps/web/src/layouts/BaseLayout.astro apps/web/tests/e2e/season.spec.ts
git commit -m "feat: redesign drivers grid with team-colored identity cards"
```

---

### Task 6: 全局车手详情页 /drivers/{slug}

Files:

- Create: apps/web/src/pages/drivers/[driver].astro
- Delete: apps/web/src/pages/[year]/drivers/[driver].astro
- Test: apps/web/tests/e2e/season.spec.ts

- [ ] Step 1: 更新 e2e（先失败）

season.spec.ts 追加/替换：

```ts
test("@desktop drivers grid cards link to the global detail page", async ({
  page,
}) => {
  await page.goto("/2026/drivers");
  const firstCard = page.locator('main a[href^="/drivers/"]').first();
  await firstCard.click();
  await expect(page).toHaveURL(/\/drivers\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("@desktop driver detail shows hero, season stats, career and wiki link", async ({
  page,
}) => {
  await page.goto("/drivers/george-russell");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Wikipedia/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /2026 season/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /Career/ })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Seasons" }),
  ).toBeVisible();
});

test("@desktop unknown driver slug returns 404", async ({ page }) => {
  const response = await page.goto("/drivers/not-a-driver");
  expect(response?.status()).toBe(404);
});
```

并把旧测试 "unknown driver under a valid year returns 404" 删除（路由不存在）。

- [ ] Step 2: 运行确认失败

Run: pnpm --filter @f1-box/web test:e2e -- --grep "driver detail|unknown driver"
Expected: FAIL（404/路由缺失）

- [ ] Step 3: 实现详情页

apps/web/src/pages/drivers/[driver].astro：

```astro
---
import DriverTag from "../../components/DriverTag.astro";
import StatusPage from "../../components/StatusPage.astro";
import TrendChart from "../../components/TrendChart.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import {
  driverCareer,
  driverSeasonStats,
  driverSeries,
} from "../../lib/derive.js";
import { getIndex, getSeason } from "../../lib/page-data.js";
import { flagForNationality, teamColor } from "../../lib/tokens.js";
import type { SeasonPayload } from "@f1-box/contracts/season";

const slug = Astro.params.driver ?? "";
const index = await getIndex();

const seasons: SeasonPayload[] = [];
for (const year of index.availableYears) {
  try {
    seasons.push(await getSeason(year));
  } catch (error) {
    console.error(`season ${year} load failed`, error);
  }
}

function codeOf(season: SeasonPayload): string | undefined {
  return season.driverStandings.find(
    (row) => (row.slug ?? row.code.toLowerCase()) === slug,
  )?.code;
}

const participants = seasons.filter((season) => codeOf(season) !== undefined);
const thisSeason =
  participants.find((season) => season.season === index.activeSeason) ??
  participants.at(-1);

if (!thisSeason) Astro.response.status = 404;

const code = thisSeason ? codeOf(thisSeason) : undefined;
const standing = thisSeason?.driverStandings.find((row) => row.code === code);
const stats = thisSeason && code ? driverSeasonStats(thisSeason, code) : undefined;
const career = driverCareer(seasons, code ?? "");
const series = thisSeason && code ? driverSeries(thisSeason, code) : [];
const latestTeam =
  thisSeason && code
    ? thisSeason.events
        .filter((event) => event.raceClassification !== null)
        .at(-1)
        ?.raceClassification?.rows.find((row) => row.driverCode === code)
        ?.constructorName ?? "—"
    : "—";

const spaceIndex = standing?.name.lastIndexOf(" ") ?? -1;
const first =
  standing?.givenName ??
  (spaceIndex > 0 ? standing?.name.slice(0, spaceIndex) : standing?.name);
const last =
  standing?.familyName ??
  (spaceIndex > 0 ? standing?.name.slice(spaceIndex + 1) : standing?.name);
const color = teamColor(latestTeam);
---

{thisSeason && standing && stats ? (
  <BaseLayout
    title={standing.name}
    active="drivers"
    year={index.activeSeason}
    availableYears={index.availableYears}
    rest="/drivers"
  >
    <main id="main-content" class="page-shell">
      <p class="crumb"><a href={`/${index.activeSeason}/drivers`}>All drivers</a></p>

      <header class="hero" style={`--team-color: ${color}`}>
        <span class="hero__watermark" aria-hidden="true">{standing.number ?? ""}</span>
        <div class="hero__body">
          <p class="hero__first">{first}</p>
          <h1 class="hero__last">{last}</h1>
          <p class="hero__meta">
            <span class="hero__flag">{flagForNationality(standing.nationality)}</span>
            <span>{standing.nationality ?? "—"}</span>
            <span class="hero__sep" aria-hidden="true"></span>
            <span>{latestTeam}</span>
            {standing.number != null ? (
              <>
                <span class="hero__sep" aria-hidden="true"></span>
                <DriverTag number={standing.number} color={color} />
              </>
            ) : null}
          </p>
          {standing.wikipediaUrl ? (
            <a class="hero__wiki" href={standing.wikipediaUrl} target="_blank" rel="noopener">
              Wikipedia
            </a>
          ) : null}
        </div>
      </header>

      <div class="columns">
        <section aria-labelledby="season-title">
          <h2 id="season-title">{thisSeason.season} season</h2>
          <dl class="stat-grid">
            <div><dt>Season position</dt><dd>{stats.position}</dd></div>
            <div><dt>Points</dt><dd>{stats.points}</dd></div>
            <div><dt>Races</dt><dd>{stats.races}</dd></div>
            <div><dt>Wins</dt><dd>{stats.wins}</dd></div>
            <div><dt>Podiums</dt><dd>{stats.podiums}</dd></div>
            <div><dt>Poles</dt><dd>{stats.poles}</dd></div>
            <div><dt>Top 10s</dt><dd>{stats.top10s}</dd></div>
            {stats.fastestLaps !== null ? (
              <div><dt>Fastest laps</dt><dd>{stats.fastestLaps}</dd></div>
            ) : null}
            <div><dt>DNFs</dt><dd>{stats.dnfs}</dd></div>
          </dl>

          <h3>Race-by-race finish</h3>
          <TrendChart
            points={series}
            invert
            color={color}
            label={`Finishing position by round, ${thisSeason.season}`}
          />
        </section>

        <section aria-labelledby="career-title">
          <h2 id="career-title">Career</h2>
          <dl class="stat-grid">
            <div><dt>Grands prix entered</dt><dd>{career.races}</dd></div>
            <div><dt>Points</dt><dd>{career.points}</dd></div>
            <div><dt>Wins</dt><dd>{career.wins}</dd></div>
            <div><dt>Podiums</dt><dd>{career.podiums}</dd></div>
            <div><dt>Poles</dt><dd>{career.poles}</dd></div>
            <div><dt>Best finish</dt><dd>{career.bestFinish ?? "—"}</dd></div>
          </dl>

          {career.seasons.length >= 2 ? (
            <TrendChart
              points={career.seasons.map((row) => ({
                round: row.year,
                label: String(row.year),
                value: row.points,
              }))}
              color={color}
              label="Career points by season"
            />
          ) : null}

          <table class="seasons-table" aria-label="Seasons">
            <thead>
              <tr><th>Year</th><th>Team</th><th>Pos</th><th>Pts</th></tr>
            </thead>
            <tbody>
              {career.seasons.map((row) => (
                <tr>
                  <td><a href={`/${row.year}/drivers`}>{row.year}</a></td>
                  <td>{row.team}</td>
                  <td>{row.position}</td>
                  <td>{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  </BaseLayout>
) : (
  <BaseLayout title="Driver not found" year={index.activeSeason} availableYears={index.availableYears} rest="/drivers">
    <StatusPage
      code="404"
      title="Driver not found"
      message="This driver is outside the available season data."
    />
  </BaseLayout>
)}

<style>
  .crumb a { color: inherit; opacity: 0.7; }

  .hero {
    position: relative;
    container-type: inline-size;
    overflow: hidden;
    border-radius: 12px;
    padding: 6cqw;
    color: #fff;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--team-color) 70%, black),
      color-mix(in srgb, var(--team-color) 85%, white)
    );
  }
  .hero::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image: radial-gradient(circle, #fff 0.75px, transparent 0.75px);
    background-size: 3px 3px;
    opacity: 0.1;
    mask-image: linear-gradient(to left, #000 10%, transparent 60%);
    pointer-events: none;
  }
  .hero__watermark {
    position: absolute;
    right: -15%;
    top: 50%;
    transform: translateY(-50%) skewX(-10deg);
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 900;
    font-size: 55cqw;
    line-height: 1;
    opacity: 0.1;
  }
  .hero__body { position: relative; max-width: 55cqw; }
  .hero__first {
    font-weight: 300;
    font-style: italic;
    transform: skewX(-6deg);
    font-size: 6cqw;
    letter-spacing: 0.08em;
  }
  .hero__last {
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 900;
    text-transform: uppercase;
    font-size: 12cqw;
    line-height: 1;
    margin: 0;
  }
  .hero__meta {
    display: flex;
    align-items: center;
    gap: 2cqw;
    margin-top: 3cqw;
    font-weight: 500;
    font-size: 4.5cqw;
  }
  .hero__flag { font-size: 4.5cqw; }
  .hero__sep { width: 1px; height: 0.9em; background: rgb(255 255 255 / 0.4); }
  .hero__wiki {
    display: inline-block;
    margin-top: 3cqw;
    color: #fff;
    font-size: 4.5cqw;
    border: 1px solid rgb(255 255 255 / 0.6);
    border-radius: 999px;
    padding: 1cqw 3cqw;
    text-decoration: none;
  }

  .columns {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2rem;
    margin-top: 2rem;
  }
  @media (min-width: 900px) {
    .columns { grid-template-columns: 3fr 2fr; }
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 1rem;
    margin: 1rem 0;
  }
  .stat-grid dt { font-size: 0.8rem; opacity: 0.7; }
  .stat-grid dd {
    margin: 0;
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 700;
    font-size: 1.5rem;
  }

  .seasons-table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  .seasons-table th, .seasons-table td {
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid rgb(255 255 255 / 0.15);
  }
  .seasons-table a { color: inherit; }
</style>
```

- [ ] Step 4: 删除旧路由

删除 apps/web/src/pages/[year]/drivers/[driver].astro。

- [ ] Step 5: 运行验证

Run: pnpm check && pnpm test && pnpm --filter @f1-box/web test:e2e
Expected: PASS

- [ ] Step 6: 提交

```bash
git add apps/web/src/pages/drivers apps/web/src/pages/[year]/drivers apps/web/tests/e2e/season.spec.ts
git commit -m "feat: add global driver career detail page"
```

---

### Task 7: VLM 视觉审校与迭代

Files:

- Modify: apps/web/src/components/DriverCard.astro、apps/web/src/pages/drivers/[driver].astro（仅样式常量）

- [ ] Step 1: 截图

后台启动 dev server（pnpm --filter @f1-box/web dev，端口以 astro 输出为准），用 Playwright CLI 截四张：

```bash
pnpm --filter @f1-box/web exec playwright screenshot --viewport-size=1440,900 http://localhost:4321/2026/drivers /tmp/shot-grid.png
pnpm --filter @f1-box/web exec playwright screenshot --viewport-size=375,740 http://localhost:4321/2026/drivers /tmp/shot-grid-mobile.png
pnpm --filter @f1-box/web exec playwright screenshot --viewport-size=1440,900 http://localhost:4321/drivers/george-russell /tmp/shot-detail.png
pnpm --filter @f1-box/web exec playwright screenshot --viewport-size=375,740 http://localhost:4321/drivers/george-russell /tmp/shot-detail-mobile.png
```

- [ ] Step 2: VLM 对照审校

沿用 /tmp/vlm-aesthetic.mjs 的调用方式（读 .env、OpenAI 兼容 chat completions、model 用 .env 中已修正的 VLM_MODEL），prompt 改为：附上官方 drivers-grid.png 与本次四张截图，要求逐条对照本计划视觉规格节输出"偏差清单"（位置/比例/字重/透明度/间距），只列需要修改的条目。

- [ ] Step 3: 按偏差清单修样式常量

只改 DriverCard.astro 与详情页 <style> 内的数值常量（cqw 比例、opacity、圆角、字号），不改结构与数据流。

- [ ] Step 4: 复查截图与移动端无溢出

重截四张确认偏差消除；e2e 的 375px 无溢出测试保持绿。

- [ ] Step 5: 提交

```bash
git add apps/web/src/components/DriverCard.astro apps/web/src/pages/drivers/[driver].astro
git commit -m "style: tune driver card and hero to reviewed visual spec"
```

---

### Task 8: 收尾、全量验证与 PR

Files:

- Modify: .env.example（VLM 模型名大小写）
- Modify: docs/superpowers/specs/2026-08-05-multi-season-site-design.md（drivers 路由指针）

- [ ] Step 1: .env.example 修正

VLM_MODEL=Doubao-Seed-2.1-pro 改为 VLM_MODEL=Doubao-Seed-2.1-Pro（网关大小写敏感）。

- [ ] Step 2: 旧设计文档加指针

multi-season-site-design.md 路由节的 /{year}/drivers/{driver-slug} 行与页面清单 drivers/{slug} 行，各追加括注：（已改为全局 /drivers/{slug}，见 2026-08-05-drivers-pages-design.md）。

- [ ] Step 3: 全量验证

Run: pnpm check && pnpm test && pnpm -r build && pnpm --filter @f1-box/web test:e2e && uv run --project services/ingest pytest -q && uv run --project services/ingest ruff check
Expected: 全绿

- [ ] Step 4: 提交

```bash
git add .env.example docs/superpowers/specs/2026-08-05-multi-season-site-design.md
git commit -m "chore: fix VLM model name case and point drivers routing to new spec"
```

- [ ] Step 5: 推送并开 PR

git push -u origin HEAD；用 gh pr create 开 PR，标题 feat: upgrade drivers grid and add global career detail pages；正文写清 Changes（schema 可选字段扩展、ingest 采集、列表卡视觉、全局详情页、VLM 审校）与 Verification（全量命令结果 + preview URL）。报告 PR 地址给用户，等用户验收合并。

- [ ] Step 6: 合并后（用户操作）数据重发布提醒

PR 合并后提醒用户触发 ingest 工作流重发布 R2 数据（workflow_dispatch），生产卡片车号/国旗/wiki 才会补全；重发布前旧数据优雅降级，不会 503。
