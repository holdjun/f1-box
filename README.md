# F1 Box

F1 比赛周末信息中心：为当前赛季提供结构化、易浏览的数据，包括赛历与赛季进度、下一站倒计时、各站排位赛与正赛结果、车手与车队积分榜、数据来源与新鲜度。

技术路线：Astro（Cloudflare Workers）+ 共享 JSON Schema 契约 + Python 采集（Jolpica → R2 版本化 JSON）。

## 目录结构

- `apps/web`：Astro 站点，部署为 Cloudflare Worker。本地开发读 fixture，生产读 R2。
- `packages/contracts`：共享 JSON Schema、自动生成的 TypeScript 类型、预编译校验器和赛季 fixture。
- `services/ingest`：Python 采集服务，负责抓取、归一化、校验并生成不可变 release 文件。
- `docs`：设计文档、实施计划和历史 thread 记录。

## 本地开发

依赖：Node.js >= 22.12.0、pnpm 11.9.0、uv（Python 3.12）。

```sh
pnpm install --frozen-lockfile        # JS 依赖
uv sync --project services/ingest     # Python 依赖

pnpm --filter @f1-box/web dev         # 本地开发（使用 fixture 数据）
pnpm check                            # 类型检查（含生成代码）
pnpm test                             # 单元测试（TS）
uv run --project services/ingest pytest   # Python 测试
pnpm --filter @f1-box/web test:e2e    # Playwright e2e（桌面 / 375px / reduced-motion）
```

## 数据流

Jolpica → Python 采集 → 共享 Schema 校验 → R2 不可变 payload + latest manifest → Astro Worker 读取 R2。

发布规则：先写不可变对象 `v1/seasons/{year}/{checksum}.json`，最后更新 `latest.json`；失败不覆盖最后有效版本。访客请求不直接访问上游数据源。

设计细节见 `docs/superpowers/specs/2026-07-21-v1-season-hub-design.md`。

## 当前状态

- 已完成：数据契约、采集与归一化、不可变 release、Web 数据层、Night Grid 首版页面（本地验证通过）。
- 待办：Cloudflare R2 真实资源与 preview 验收、GitHub Actions（CI / 定时采集 / 部署）、生产域名切换。
