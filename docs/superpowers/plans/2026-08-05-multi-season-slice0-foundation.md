# 多赛季站点 Slice 0：地基（路由壳 + 年份作用域 + 数据索引 + 视觉 token）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把站点从"写死的 2026 单赛季"切换到"年份为全局作用域"的新路由壳：根路径跳转 activeSeason、年份选择器、最小 racing 日历页，全部读 fixture，可测试。

**Architecture:** Astro 7 SSR（Cloudflare adapter）。新增 SeasonIndex 契约（手写校验，对齐 parseManifest 模式）；repository 扩展 getIndex；新路由 `/[year]/racing` 取代旧 `/`、`/seasons/*`；全局年份选择器按当前路径换年。视觉 token（车队色/国旗）独立模块。

**Tech Stack:** Astro 7.1.3、TypeScript 5.8、pnpm workspace、Vitest（单元）、Playwright（e2e）。

## Global Constraints

- Node >= 22.12.0；pnpm 11.9.0；Astro 7.1.3（不升级）。
- 验证命令：`pnpm check`、`pnpm test`、`pnpm --filter @f1-box/web test:e2e`。
- 校验只放系统边界（fixture/R2 读取）；内部调用信任类型。
- 不为将来预留过度抽象；注释只解释"为什么"。
- 分支已为 `feat/multi-season-site`；Conventional Commits 英文标题；commit 末尾加 `Co-Authored-By: Claude <noreply@anthropic.com`>。
- 文档/Markdown 不用 `**` 加粗；仓库文档用中文。
- 本 slice 只读 fixture，不碰 R2/ingest；多年份结构支持但数据暂只有 2026。

## File Structure

- Create `packages/contracts/src/season-index.ts`：SeasonIndex 类型 + parseSeasonIndex（手写校验）。
- Create `packages/contracts/fixtures/season-index.json`：索引 fixture。
- Create `packages/contracts/tests/season-index.test.ts`：parseSeasonIndex 单测。
- Modify `packages/contracts/package.json`：导出 season-index 与 fixture。
- Create `apps/web/src/lib/routing.ts`：splitYearPath 助手。
- Create `apps/web/src/lib/tokens.ts`：车队色 + 国旗 token。
- Create `apps/web/tests/tokens.test.ts`、`apps/web/tests/routing.test.ts`。
- Modify `apps/web/src/lib/season-repository.ts`：getIndex。
- Modify `apps/web/src/lib/page-data.ts`：getIndex。
- Create `apps/web/src/components/YearSelector.astro`。
- Modify `apps/web/src/components/SiteHeader.astro`：板块导航 + 年份选择器。
- Modify `apps/web/src/layouts/BaseLayout.astro`：透传年份上下文。
- Create `apps/web/src/pages/[year]/racing.astro`：最小赛历页。
- Create `apps/web/src/pages/[year]/index.astro`：`/{year}` → `/{year}/racing`。
- Modify `apps/web/src/pages/index.astro`：`/` → `/{activeSeason}/racing`。
- Delete `apps/web/src/pages/seasons/`（旧路由）。
- Modify `apps/web/tests/e2e/season.spec.ts`：改写为新 IA。

---

### Task 1: SeasonIndex 契约

**Files:**
- Create: `packages/contracts/src/season-index.ts`
- Create: `packages/contracts/fixtures/season-index.json`
- Create: `packages/contracts/tests/season-index.test.ts`
- Modify: `packages/contracts/package.json`

**Interfaces:**
- Produces: `parseSeasonIndex(value: unknown): SeasonIndex`；`interface SeasonIndex { schemaVersion: 1; activeSeason: number; availableYears: number[] }`。

- [ ] **Step 1: 写失败测试**

```ts
// packages/contracts/tests/season-index.test.ts
import { describe, expect, it } from "vitest";
import { parseSeasonIndex } from "../src/season-index.js";

describe("parseSeasonIndex", () => {
  it("accepts a valid index and sorts years", () => {
    const index = parseSeasonIndex({
      schemaVersion: 1,
      activeSeason: 2026,
      availableYears: [2026, 2025],
    });
    expect(index.availableYears).toEqual([2025, 2026]);
    expect(index.activeSeason).toBe(2026);
  });

  it("rejects when activeSeason not in availableYears", () => {
    expect(() =>
      parseSeasonIndex({ schemaVersion: 1, activeSeason: 2024, availableYears: [2026] }),
    ).toThrow(/activeSeason/);
  });

  it("rejects duplicate or empty years", () => {
    expect(() =>
      parseSeasonIndex({ schemaVersion: 1, activeSeason: 2026, availableYears: [2026, 2026] }),
    ).toThrow(/unique/);
    expect(() =>
      parseSeasonIndex({ schemaVersion: 1, activeSeason: 2026, availableYears: [] }),
    ).toThrow(/non-empty/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @f1-box/contracts test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

```ts
// packages/contracts/src/season-index.ts
export interface SeasonIndex {
  schemaVersion: 1;
  activeSeason: number;
  availableYears: number[];
}

const FIELDS = ["schemaVersion", "activeSeason", "availableYears"];

export function parseSeasonIndex(value: unknown): SeasonIndex {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid season index: expected object");
  }
  const record = value as Record<string, unknown>;
  if (!FIELDS.every((field) => Object.hasOwn(record, field))) {
    throw new TypeError(
      "Invalid season index: expected schemaVersion, activeSeason, availableYears",
    );
  }

  const { schemaVersion, activeSeason, availableYears } = record;
  if (schemaVersion !== 1) {
    throw new TypeError("Invalid season index: schemaVersion must be 1");
  }
  if (!Number.isInteger(activeSeason)) {
    throw new TypeError("Invalid season index: activeSeason must be an integer");
  }
  if (
    !Array.isArray(availableYears) ||
    availableYears.length === 0 ||
    !availableYears.every((year) => Number.isInteger(year))
  ) {
    throw new TypeError("Invalid season index: availableYears must be a non-empty integer array");
  }
  if (new Set(availableYears).size !== availableYears.length) {
    throw new TypeError("Invalid season index: availableYears must be unique");
  }
  if (!availableYears.includes(activeSeason as number)) {
    throw new TypeError("Invalid season index: activeSeason must be within availableYears");
  }

  return {
    schemaVersion: 1,
    activeSeason: activeSeason as number,
    availableYears: [...availableYears].sort((a, b) => a - b),
  };
}
```

- [ ] **Step 4: 写 fixture**

```json
// packages/contracts/fixtures/season-index.json
{
  "schemaVersion": 1,
  "activeSeason": 2026,
  "availableYears": [2026]
}
```

- [ ] **Step 5: 导出**

在 `packages/contracts/package.json` 的 `exports` 增加：

```json
"./season-index": "./src/season-index.ts",
"./fixtures/season-index.json": "./fixtures/season-index.json",
```

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @f1-box/contracts test`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/contracts/src/season-index.ts packages/contracts/fixtures/season-index.json packages/contracts/tests/season-index.test.ts packages/contracts/package.json
git commit -m "feat: add season index contract"
```

---

### Task 2: routing 与 token 助手

**Files:**
- Create: `apps/web/src/lib/routing.ts`
- Create: `apps/web/src/lib/tokens.ts`
- Create: `apps/web/tests/routing.test.ts`
- Create: `apps/web/tests/tokens.test.ts`

**Interfaces:**
- Produces: `splitYearPath(pathname: string): { year: number | null; rest: string }`；`teamColor(name: string): string`；`countryFlag(code: string): string`。

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/tests/routing.test.ts
import { describe, expect, it } from "vitest";
import { splitYearPath } from "../src/lib/routing.js";

describe("splitYearPath", () => {
  it("splits a year-scoped path", () => {
    expect(splitYearPath("/2026/racing")).toEqual({ year: 2026, rest: "/racing" });
    expect(splitYearPath("/2025/results/drivers")).toEqual({
      year: 2025,
      rest: "/results/drivers",
    });
  });

  it("returns null year for non-year paths", () => {
    expect(splitYearPath("/")).toEqual({ year: null, rest: "/" });
    expect(splitYearPath("/about")).toEqual({ year: null, rest: "/about" });
  });
});
```

```ts
// apps/web/tests/tokens.test.ts
import { describe, expect, it } from "vitest";
import { countryFlag, teamColor } from "../src/lib/tokens.js";

describe("tokens", () => {
  it("returns known team colors and a neutral fallback", () => {
    expect(teamColor("Ferrari")).toBe("#f41919");
    expect(teamColor("Not A Team")).toBe("#84909e");
  });

  it("maps country codes to flag emoji with a fallback", () => {
    expect(countryFlag("GBR")).toBe("🇬🇧");
    expect(countryFlag("XXX")).toBe("🏳️");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @f1-box/web test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

```ts
// apps/web/src/lib/routing.ts
export function splitYearPath(pathname: string): { year: number | null; rest: string } {
  const match = pathname.match(/^\/(\d{4})(\/.*)?$/);
  if (!match) return { year: null, rest: pathname };
  return { year: Number(match[1]), rest: match[2] || "" };
}
```

```ts
// apps/web/src/lib/tokens.ts
// 车队色为事实数据；国旗用公共领域 emoji 兜底，后续可换 SVG。
const TEAM_COLORS: Record<string, string> = {
  Mercedes: "#27f4d2",
  Ferrari: "#f41919",
  McLaren: "#ff8700",
  "Red Bull Racing": "#3671c6",
  "Racing Bulls": "#6691ff",
  Alpine: "#2293ce",
  Haas: "#848588",
  Audi: "#f10b1c",
  Williams: "#64c4ff",
  "Aston Martin": "#1e5f4f",
  Cadillac: "#b80202",
};

const ALPHA3_TO_ALPHA2: Record<string, string> = {
  GBR: "GB", ITA: "IT", NED: "NL", MON: "MC", AUS: "AU", FRA: "FR",
  NZL: "NZ", ARG: "AR", BRA: "BR", ESP: "ES", JPN: "JP", CAN: "CA",
  USA: "US", BEL: "BE", HUN: "HU", AUT: "AT", GER: "DE", MEX: "MX",
  CHN: "CN", BAH: "BS", AZE: "AZ", QAT: "QA", UAE: "AE", SIN: "SG",
};

export function teamColor(name: string): string {
  return TEAM_COLORS[name] ?? "#84909e";
}

export function countryFlag(code: string): string {
  const alpha2 = ALPHA3_TO_ALPHA2[code];
  if (!alpha2) return String.fromCodePoint(0x1f3f3, 0xfe0f);
  return String.fromCodePoint(
    ...[...alpha2.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @f1-box/web test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/routing.ts apps/web/src/lib/tokens.ts apps/web/tests/routing.test.ts apps/web/tests/tokens.test.ts
git commit -m "feat: add year routing and visual token helpers"
```

---

### Task 3: repository 与 page-data 支持索引

**Files:**
- Modify: `apps/web/src/lib/season-repository.ts`
- Modify: `apps/web/src/lib/page-data.ts`
- Modify: `apps/web/tests/repository.test.ts`

**Interfaces:**
- Consumes: `parseSeasonIndex`（Task 1）、fixture `season-index.json`。
- Produces: `SeasonRepository.getIndex(): Promise<SeasonIndex>`。

- [ ] **Step 1: 写失败测试**

在 `apps/web/tests/repository.test.ts` 增加：

```ts
it("exposes the season index from the local fixture", async () => {
  const repository = createSeasonRepository();
  const index = await repository.getIndex();
  expect(index.activeSeason).toBe(2026);
  expect(index.availableYears).toContain(2026);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @f1-box/web test`
Expected: FAIL（getIndex 不存在）。

- [ ] **Step 3: 扩展 repository**

在 `season-repository.ts` 顶部导入：

```ts
import seasonIndexFixture from "@f1-box/contracts/fixtures/season-index.json";
import { parseSeasonIndex, type SeasonIndex } from "@f1-box/contracts/season-index";
```

接口 `SeasonRepository` 加 `getIndex(): Promise<SeasonIndex>;`，并在 `createSeasonRepository` 返回对象中实现：

```ts
async getIndex() {
  if (store) {
    const key = "v1/seasons/index.json";
    const object = await store.get(key);
    if (!object) throw new Error(`Season index not found: ${key}`);
    return parseSeasonIndex(parseJson(await object.text(), key));
  }
  return parseSeasonIndex(seasonIndexFixture);
},
```

- [ ] **Step 4: 扩展 page-data**

```ts
export function getIndex() {
  const repository = import.meta.env.DEV
    ? createSeasonRepository()
    : createSeasonRepository(env.F1_DATA);
  return repository.getIndex();
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @f1-box/web test`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/lib/season-repository.ts apps/web/src/lib/page-data.ts apps/web/tests/repository.test.ts
git commit -m "feat: expose season index from repository"
```

---

### Task 4: 年份选择器与新导航

**Files:**
- Create: `apps/web/src/components/YearSelector.astro`
- Modify: `apps/web/src/components/SiteHeader.astro`
- Modify: `apps/web/src/layouts/BaseLayout.astro`

**Interfaces:**
- Consumes: `splitYearPath`（Task 2）。
- Produces: YearSelector props `{ current: number; available: number[]; rest: string }`。

- [ ] **Step 1: 写 YearSelector**

```astro
---
interface Props {
  current: number;
  available: number[];
  rest: string;
}
const { current, available, rest } = Astro.props;
---

<nav class="year-selector" aria-label="Season">
  {available.map((year) => (
    <a
      href={`/${year}${rest}`}
      class:list={["year-selector__item", { "is-active": year === current }]}
      aria-current={year === current ? "page" : undefined}
    >{year}</a>
  ))}
</nav>

<style>
  .year-selector { display: flex; gap: 0.25rem; }
  .year-selector__item { padding: 0.25rem 0.6rem; border-radius: 999px; color: inherit; text-decoration: none; opacity: 0.7; }
  .year-selector__item.is-active { opacity: 1; outline: 1px solid currentColor; }
</style>
```

- [ ] **Step 2: 重写 SiteHeader 接收年份上下文并渲染板块导航 + 选择器**

```astro
---
// apps/web/src/components/SiteHeader.astro
import YearSelector from "./YearSelector.astro";

interface Props {
  active?: "racing" | "results" | "drivers" | "teams";
  year?: number;
  availableYears?: number[];
  rest?: string;
}

const { active = "racing", year, availableYears, rest = "/racing" } = Astro.props;
---

<header class="site-header">
  <div class="site-header__inner page-shell">
    <a class="wordmark" href="/" aria-label="F1 Box home">
      <span>F1</span> Box
    </a>
    <nav aria-label="Primary navigation">
      <a
        href={year ? `/${year}/racing` : "/"}
        aria-current={active === "racing" ? "page" : undefined}
      >Racing</a>
    </nav>
    {year !== undefined && availableYears !== undefined ? (
      <YearSelector current={year} available={availableYears} rest={rest} />
    ) : null}
  </div>
</header>
```

（复用 global.css 现有 `.site-header` 样式；其余板块导航在后续 slice 增加。）

- [ ] **Step 3: BaseLayout 透传年份上下文**

在 BaseLayout props 接口增加 `year?: number; availableYears?: number[]; rest?: string;`，解构后传给 SiteHeader：

```astro
<SiteHeader active={active} year={year} availableYears={availableYears} rest={rest} />
```

保留 title/description/freshness 等现有 props 不变。

- [ ] **Step 4: 运行 check**

Run: `pnpm check`
Expected: PASS（类型无误）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/YearSelector.astro apps/web/src/components/SiteHeader.astro apps/web/src/layouts/BaseLayout.astro
git commit -m "feat: add global year selector and section nav"
```

---

### Task 5: 新路由壳（重定向 + 最小 racing 页）

**Files:**
- Modify: `apps/web/src/pages/index.astro`
- Create: `apps/web/src/pages/[year]/index.astro`
- Create: `apps/web/src/pages/[year]/racing.astro`
- Delete: `apps/web/src/pages/seasons/`

**Interfaces:**
- Consumes: `getIndex`、`getSeason`（page-data）、`splitYearPath`、RaceCard/SeasonRail 组件。

- [ ] **Step 1: 根重定向**

```astro
---
// apps/web/src/pages/index.astro
import { getIndex } from "../lib/page-data.js";
const index = await getIndex();
return Astro.redirect(`/${index.activeSeason}/racing`);
---
```

- [ ] **Step 2: 年份重定向**

```astro
---
// apps/web/src/pages/[year]/index.astro
const year = Astro.params.year;
return Astro.redirect(`/${year}/racing`);
---
```

- [ ] **Step 3: 最小 racing 页**

```astro
---
// apps/web/src/pages/[year]/racing.astro
import RaceCard from "../../../components/RaceCard.astro";
import StatusPage from "../../../components/StatusPage.astro";
import BaseLayout from "../../../layouts/BaseLayout.astro";
import { getIndex, getSeason } from "../../../lib/page-data.js";
import { splitYearPath } from "../../../lib/routing.js";

const year = Number(Astro.params.year);
const index = await getIndex();

if (!index.availableYears.includes(year)) {
  Astro.response.status = 404;
}

const season = index.availableYears.includes(year) ? await getSeason(year) : undefined;
const { rest } = splitYearPath(Astro.url.pathname);
---

{season ? (
  <BaseLayout title={`${season.season} Season`} year={year} availableYears={index.availableYears} rest={rest}>
    <main id="main-content" class="page-shell">
      <h1>{season.season} Season</h1>
      <div class="race-grid">
        {season.events.map((event) => (
          <RaceCard event={event} season={season.season} density="full" hrefBase={`/${year}/racing`} />
        ))}
      </div>
    </main>
  </BaseLayout>
) : (
  <BaseLayout title="Season not found" year={year} availableYears={index.availableYears} rest={rest}>
    <StatusPage code="404" title="Season not found" message="This season is not available yet." />
  </BaseLayout>
)}
```

- [ ] **Step 4: 给 RaceCard 增加 hrefBase prop**

RaceCard 现有 href 写死 `/seasons/...`。加可选 prop 使新页链接指向 `/{year}/racing/{round}-{slug}`：

```astro
---
// apps/web/src/components/RaceCard.astro（frontmatter 修改）
interface Props {
  event: SeasonEvent;
  season: number;
  density?: "compact" | "full";
  hrefBase?: string;
}

const { event, season, density = "compact", hrefBase } = Astro.props;
const href = `${hrefBase ?? `/seasons/${season}/races`}/${event.round}-${event.slug}`;
---
```

- [ ] **Step 5: 删除旧 seasons 路由**

Run: `rm -r apps/web/src/pages/seasons`

- [ ] **Step 6: 运行 check**

Run: `pnpm check`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/pages apps/web/src/components/RaceCard.astro
git commit -m "feat: add year-scoped routing shell and racing calendar"
```

---

### Task 6: e2e 改写为新 IA

**Files:**
- Modify: `apps/web/tests/e2e/season.spec.ts`

- [ ] **Step 1: 改写 e2e**

保留"不直连上游"断言；改写为：根路径重定向到 `/2026/racing`；racing 页渲染 22 个 race 链接（href 以 `/2026/racing/` 开头）；年份选择器可见；未知年份 404。

```ts
test("@desktop root redirects to active season racing page", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/2026\/racing$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("@desktop racing page lists the full calendar", async ({ page }) => {
  await page.goto("/2026/racing");
  const raceLinks = page.locator('main a[href^="/2026/racing/"]');
  await expect(raceLinks).toHaveCount(22);
  await expect(page.getByRole("navigation", { name: "Season" })).toBeVisible();
});

test("@desktop unknown year returns 404", async ({ page }) => {
  const response = await page.goto("/2019/racing");
  expect(response?.status()).toBe(404);
});
```

（删除针对旧 `/seasons/*` 与旧 home 的断言；移动端/减动效测试改指向 `/2026/racing`。）

- [ ] **Step 2: 运行 e2e**

Run: `pnpm --filter @f1-box/web test:e2e`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add apps/web/tests/e2e/season.spec.ts
git commit -m "test: rework e2e for year-scoped routing"
```

---

### Task 7: 全量验证

- [ ] **Step 1: 类型 + 单测**

Run: `pnpm check && pnpm test`
Expected: PASS。

- [ ] **Step 2: e2e**

Run: `pnpm --filter @f1-box/web test:e2e`
Expected: PASS。

- [ ] **Step 3: 构建**

Run: `pnpm -r build`
Expected: PASS。

- [ ] **Step 4: 如有失败，修复后重跑；全绿后提交收尾**

```bash
git commit --allow-empty -m "chore: slice 0 foundation verified"
```
