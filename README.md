# F1 Box

F1 比赛周末信息中心：为当前赛季提供结构化、易浏览的数据，包括赛历与赛季进度、下一站倒计时、各站排位赛与正赛结果、车手与车队积分榜、数据来源与新鲜度。

技术路线：Astro（Cloudflare Workers）+ Svelte 5 islands（仅交互组件）+ Tailwind CSS v4（双层令牌、深/亮双主题）+ f1db 数据经周同步进 D1。

## 目录结构

- `apps/web`：Astro 站点，部署为 Cloudflare Worker。本地开发读 fixture，生产读 D1。
- `docs`：设计文档、实施计划和历史 thread 记录。

## 本地开发

依赖：Node.js >= 22.12.0、pnpm 11.9.0；独立 Python 脚本用 `uv run` 执行（PEP 723，如 `scripts/generate-circuit-maps.py`）。

```sh
pnpm install --frozen-lockfile        # JS 依赖

pnpm --filter @f1-box/web dev         # 本地开发（使用 fixture 数据）
pnpm check                            # 类型检查（含生成代码）
pnpm test                             # 单元测试（TS）
pnpm --filter @f1-box/web test:e2e    # Playwright e2e（桌面 / 375px / reduced-motion / 双主题 axe 可访问性）
```

## 数据流

f1db（CC-BY-4.0）→ `data-sync.yml` 按上游发布节奏轮询 release tag（周日晚到周二每 2 小时、其余每天一次），有变化时全量导入 D1 → Astro Worker 读 D1；赛道轮廓 SVG、车队 logo、国旗存仓库 `public/vendor/`；本地开发读 fixture。访客请求不直接访问上游数据源。

实时与遥测数据后续以 FastF1 另立采集服务（静态 f1db + 动态 FastF1 双源架构，见 `docs/requirements/2026-08-24-remove-jolpica-r2.md`）。

历史赛季数据（结果、车手、车队、赛道）来自 [f1db](https://github.com/f1db/f1db)（CC-BY-4.0）：`scripts/f1db-d1-dump.sh` 生成导入 SQL，data-sync 每周把 SQLite 全量导入 D1；赛道轮廓 SVG 用 `scripts/f1db-circuit-svg-sync.sh` 从 f1db 仓库同步到 `apps/web/public/vendor/circuits/`，新增布局时手动跑。

设计细节见 `docs/superpowers/specs/2026-07-21-v1-season-hub-design.md`；样式架构与双主题见 `docs/requirements/2026-08-23-css-modernization.md`。

## 样式系统

- `apps/web/src/styles/theme.css`：`@theme` 原始令牌 + 语义令牌（随 `html[data-theme]` 整套翻转），是 `bg-surface`/`text-ink-muted` 等工具类的单源。
- `base.css` 承载元素级基础与全局效果，`components.css` 承载高频组件类。
- 组件以工具类为主、禁止硬编码颜色（队色等数据语义色例外，需注释）。
- 双主题与对比度由 `tests/e2e/theme.spec.ts` 与 `tests/e2e/a11y.spec.ts`（axe，双主题 × 页面矩阵）回归兜底。

## 前端架构

- Astro 负责页面、路由、布局、服务端数据层与全部纯展示组件；交互组件（ThemeToggle / SeasonFilter / AskPanel）是 Svelte 5 island，按需局部水合，其余页面零 JS。
- 选型判据与例外（渐进增强、一次性变换、首屏内联）见 `AGENTS.md` 的「框架边界」。

## 开发与发布流程

1. 需求写入 `docs/requirements/`（模板见 `docs/requirements/TEMPLATE.md`）。
2. agent 建分支开发，开 PR；CI 自动验证（类型、测试、e2e、Python），preview worker 自动部署。
3. 用户在 preview 页面验收后合并到 main。
4. 合并到 main 后 deploy 工作流自动发布到 f1-box.com（预览验收已在合并前完成）。
5. data-sync 工作流按 f1db 发布节奏轮询 release tag（周日晚到周二密集、其余每天兜底），有变化时全量导入 D1，也可手动触发。

回滚：数据问题重跑 data-sync 或恢复旧 D1 导入；代码问题重新部署旧提交。

## 当前状态

- 已上线：站点（f1-box.com）、真实 2026 赛季数据（R2）、CI、定时采集、preview/生产部署流程、Tailwind v4 样式系统与深/亮双主题。
- 待办：Biome lint/format 进 CI、部署切 Workers Versions（秒级回滚）、2025 dev fixture、Server Islands、Cloudflare 告警策略、真实比赛图片接入。
