# F1 Box 第一版赛季中心实施计划

> Agent 执行要求：使用 `superpowers:subagent-driven-development` 逐任务实现和审阅；行为代码遵循测试驱动开发。

目标：交付并自动部署 2026 赛季中心，包含全部分站、排位与正赛结果、车手和车队积分榜、来源与新鲜度，以及完整的 Night Grid 响应式视觉。

架构：Python 从 Jolpica 生成经 Schema 校验的 `SeasonPayload`；发布时先写 R2 不可变对象，再更新 latest manifest。Astro Cloudflare Worker 通过 `SeasonRepository` 读取 R2，本地与测试读取 fixture。第一版不使用 D1 和前端框架。

技术栈：Node.js >=22.12.0、pnpm 11.9.0、Astro 7.1.3、`@astrojs/cloudflare` 14.1.4、Wrangler 4.112.0、Playwright 1.61.1、Python 3.12、uv、httpx、jsonschema、Ruff。

## 全局约束

- 当前赛季固定为 2026；后续通过路由参数和数据契约扩展其他赛季。
- 浏览器和页面请求不得直接调用 Jolpica。
- R2 key 固定为 `v1/seasons/{year}/{checksum}.json` 与 `v1/seasons/{year}/latest.json`。
- payload 校验成功后才能生成 release；manifest 必须最后上传。
- UTC 存储，页面同时显示赛道当地语义和访客本地时间。
- UI 不使用模型生成图片，可用官方照片等真实图片（注明来源、留意版权）；不使用官方字体。
- 第一版不引入 React、图表库、D1、FastF1、实时计时和账户。
- 所有动画支持 `prefers-reduced-motion`。
- 生产域名切换前必须完成 preview 浏览器验收。

## Task 1：SeasonPayload 契约

文件：

- 创建 `packages/contracts/season.schema.json`
- 创建 `packages/contracts/src/season.generated.ts`
- 创建 `packages/contracts/src/season.ts`
- 创建 `packages/contracts/tests/season.test.ts`
- 创建 `packages/contracts/fixtures/season-2026.json`
- 修改 `packages/contracts/package.json`

接口：

```ts
export type { SeasonPayload } from "./season.generated.js";
export function parseSeasonPayload(value: unknown): SeasonPayload;
```

契约包含：`schemaVersion`、`generatedAt`、`freshness`、`season`、`currentRound`、`nextRound`、`events`、两类积分榜和 `sources`。每个 event 包含 round、slug、状态、赛道、场次、排位分类和正赛分类；已完成 event 必须同时拥有 qualifying 与 race classification。`currentRound`、`nextRound` 允许 `null`。共享 fixture 包含 2026 全部已排期分站，并通过 contracts 包的明确子路径导出，Web 不复制数据。

步骤：

- [ ] 先写有效 fixture、错误版本、空来源、重复 round、complete 但缺少 race 分类的失败测试。
- [ ] 运行 contracts 聚焦测试，确认因解析器缺失而失败。
- [ ] 实现 Draft 2020-12 Schema、Ajv parser 与自动类型生成；不手写同步 interface。
- [ ] 运行 `pnpm --filter @f1-box/contracts test` 和 `pnpm --filter @f1-box/contracts check`。
- [ ] 提交 `feat: define season payload contract`。

## Task 2：Jolpica 抓取与归一化

文件：

- 修改 `services/ingest/pyproject.toml`
- 创建 `services/ingest/src/f1box_ingest/client.py`
- 创建 `services/ingest/src/f1box_ingest/normalize.py`
- 创建 `services/ingest/src/f1box_ingest/cli.py`
- 创建 `services/ingest/tests/test_client.py`
- 创建 `services/ingest/tests/test_normalize.py`
- 创建 `services/ingest/tests/test_cli.py`
- 创建 `services/ingest/tests/fixtures/jolpica/*.json`

接口：

```python
@dataclass(frozen=True)
class FetchResult:
    url: str
    fetched_at: str
    payload: dict[str, object]
    checksum: str

class JolpicaClient:
    async def fetch(self, path: str) -> FetchResult: ...

async def build_season(*, season: int, client: JolpicaClient, generated_at: str) -> dict[str, object]: ...
```

CLI：`f1box-ingest season --season 2026 --output .data/season-2026.json`。

步骤：

- [ ] 使用固定原始 Jolpica fixture 先覆盖赛历、排位、正赛、车手积分和车队积分的失败测试。
- [ ] HTTP 测试覆盖 200、429/503 有界重试、无效 JSON、非对象响应和超时。
- [ ] 实现 `httpx.AsyncClient`，总并发最多 6；禁止不安全 path；每个响应以 SHA-256 写入 `.data/raw/`。
- [ ] 根据赛历并发获取已完成站的 qualifying/results；未来站不请求结果端点。
- [ ] 归一化 event 状态、session UTC 时间、分类、积分榜、来源和新鲜度；输出必须通过共享 Season Schema。
- [ ] CLI 使用临时文件加原子 rename，不覆盖最后有效输出。
- [ ] 运行 Python pytest 与 Ruff；提交 `feat: ingest current season data`。

## Task 3：不可变 release 与 R2 发布边界

文件：

- 创建 `services/ingest/src/f1box_ingest/release.py`
- 创建 `services/ingest/tests/test_release.py`
- 修改 `services/ingest/src/f1box_ingest/cli.py`

接口：

```python
@dataclass(frozen=True)
class ReleaseFiles:
    checksum: str
    payload_path: Path
    manifest_path: Path

def write_release(payload: dict[str, object], output_dir: Path) -> ReleaseFiles: ...
```

manifest 仅包含 schemaVersion、season、checksum、payloadKey、generatedAt。payload JSON 使用稳定 key 顺序和紧凑编码，checksum 对最终字节计算。

步骤：

- [ ] 先写确定性 checksum、manifest key、重复运行幂等和无效 payload 拒绝测试。
- [ ] 实现 release 文件生成；CLI 增加 `--release-dir`。
- [ ] 证明同一 payload 两次生成相同 checksum，且 manifest 指向不可变对象。
- [ ] 运行 Python 全套测试与 Ruff；提交 `feat: create atomic season releases`。

## Task 4：Astro Worker 与数据仓库

文件：

- 创建 `apps/web/package.json`
- 创建 `apps/web/astro.config.mjs`
- 创建 `apps/web/tsconfig.json`
- 创建 `apps/web/src/env.d.ts`
- 创建 `apps/web/wrangler.jsonc`
- 创建 `apps/web/worker-configuration.d.ts`（Wrangler 生成）
- 创建 `apps/web/src/lib/season-repository.ts`
- 创建 `apps/web/src/lib/time.ts`
- 创建 `apps/web/tests/repository.test.ts`
- 修改根 `package.json`

接口：

```ts
export interface SeasonRepository {
  getSeason(year: number): Promise<SeasonPayload>;
}

export interface SeasonObjectStore {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export function createSeasonRepository(
  store?: SeasonObjectStore,
  clock?: () => Date,
): SeasonRepository;
```

本地 repository 读取 fixture；Worker 页面通过 `cloudflare:workers` 的生成类型 `env.F1_DATA` 创建 repository，从 R2 读取 latest manifest 和 payload，并执行 `parseSeasonPayload`。每次读取按最旧来源和注入时钟重新计算有效 freshness，使 last-known-good 随时间变为 delayed/stale。生产不得静默回退到 fixture；不得手写 Env binding 类型。

步骤：

- [ ] 安装 Astro 7.1.3、`@astrojs/cloudflare` 14.1.4、`@fontsource-variable/space-grotesk` 5.3.0、`@fontsource/barlow-condensed` 5.3.0、Vitest。
- [ ] 创建最小 Wrangler JSONC：`compatibility_date` 为 `2026-07-21`、启用 `nodejs_compat`、声明 `F1_DATA` R2 binding 和 observability；所有 Web scripts 先运行 `wrangler types`。
- [ ] 先写本地读取、R2 manifest/payload、无效 payload、缺失 manifest 和旧 payload 动态 stale 的失败测试。
- [ ] 实现 repository、UTC/本地时间格式化和可诊断错误。
- [ ] 配置 Cloudflare server output，不增加 React。
- [ ] 运行 Web test、Astro check 和 build；提交 `feat: establish cloudflare web app`。

## Task 5：Night Grid 页面与动效

文件：

- 创建 `apps/web/src/layouts/BaseLayout.astro`
- 创建 `apps/web/src/components/*.astro`
- 创建 `apps/web/src/pages/index.astro`
- 创建 `apps/web/src/pages/seasons/[year]/index.astro`
- 创建 `apps/web/src/pages/seasons/[year]/races/[event].astro`
- 创建 `apps/web/src/pages/404.astro`
- 创建 `apps/web/src/styles/global.css`
- 创建 `apps/web/src/scripts/client.ts`
- 创建 `apps/web/playwright.config.ts`
- 创建 `apps/web/tests/e2e/season.spec.ts`

组件边界：`SiteHeader`、`NextRaceHero`、`SeasonRail`、`RaceCard`、`StandingsTable`、`ResultTable`、`FreshnessBadge`、`SiteFooter`。单个组件不同时承担数据读取和展示。

步骤：

- [ ] 先写桌面和 375px 移动端 E2E：三类路由、全部分站链接、积分榜、排位/正赛、来源时间、404。
- [ ] 实现语义化 HTML 和 Night Grid tokens；积分用 CSS 比例条与 inline SVG，不用 Canvas/图表库。
- [ ] 实现下一站倒计时、赛季轨道、焦点/悬停、页面转场和首屏分层进入。
- [ ] 添加 reduced-motion E2E，确认关键内容不依赖动画出现。
- [ ] 运行 Vitest、Astro check/build、Playwright desktop/mobile，并保存关键页面截图供视觉审阅。
- [ ] 提交 `feat: build v1 season experience`。

## Task 6：Cloudflare R2 与 preview

文件：

- 修改 `apps/web/wrangler.jsonc`
- 创建 `apps/web/src/pages/api/health.ts`
- 创建 `scripts/publish-release.sh`
- 修改 `.gitignore`

资源：Worker `f1-box`、R2 bucket `f1-box-data`、binding `F1_DATA`。`scripts/publish-release.sh` 只能按 payload、manifest 顺序调用 Wrangler，并使用 `set -euo pipefail`。

步骤：

- [ ] 使用 `cloudflare`、`workers-best-practices` 和 `wrangler` skills 核对当前配置方式。
- [ ] 创建或复用 R2 bucket，不删除任何已有资源。
- [ ] 为脚本写命令顺序测试或 dry-run 验证，确保 manifest 最后上传。
- [ ] 上传 fixture release，部署 Workers preview，验证 `/api/health`、首页、赛季页和分站页。
- [ ] 用浏览器检查响应式布局、控制台、网络请求和无障碍基础项。
- [ ] 提交 `infra: add cloudflare preview deployment`。

## Task 7：CI、定时采集与生产部署

文件：

- 创建 `.github/workflows/ci.yml`
- 创建 `.github/workflows/ingest.yml`
- 创建 `.github/workflows/deploy.yml`
- 创建 `README.md`

步骤：

- [ ] CI 使用 pnpm/uv 缓存，运行 Schema、TypeScript、Python、Astro build 与 Playwright；并检查生成类型无漂移。
- [ ] ingest 支持 `workflow_dispatch`；周五至周日每 30 分钟、周一至周四每日执行；设置 concurrency 防止重叠。
- [ ] ingest 先生成和校验 release，再以不可变 payload、manifest 顺序写 R2；失败不得执行第二步。
- [ ] deploy 仅在 `main` CI 成功后运行 Wrangler；使用 GitHub environment `production`。
- [ ] README 只记录本地启动、验证、手动采集、release 发布、所需 secrets 和回滚到旧 manifest 的命令。
- [ ] 在 preview 验收通过后配置 `f1-box.com` 与 `www` 重定向，执行生产 smoke test。
- [ ] 提交 `ci: automate ingestion and deployment`。

## 最终验证

- [ ] `pnpm install --frozen-lockfile && pnpm check && pnpm test && pnpm build`。
- [ ] `uv run --project services/ingest pytest -v` 与 Ruff 全通过。
- [ ] Playwright desktop、mobile、reduced-motion 全通过。
- [ ] 2026 每站可访问，已完成站有排位与正赛积分，积分榜与 fixture/上游一致。
- [ ] R2 失败不会让浏览器直接访问 Jolpica；manifest-last 可回滚。
- [ ] preview 和生产 health/page smoke test 通过。
- [ ] 整分支独立代码、数据、安全与视觉审阅无阻塞项。
