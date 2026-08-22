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

历史赛季数据（结果、车手、车队、赛道）来自 [f1db](https://github.com/f1db/f1db)（CC-BY-4.0）：`scripts/f1db-d1-dump.sh` 生成导入 SQL，data-sync 每周把 SQLite 全量导入 D1；赛道轮廓 SVG 用 `scripts/f1db-circuit-svg-sync.sh` 从 f1db 仓库同步到 `apps/web/public/vendor/circuits/`，新增布局时手动跑。

设计细节见 `docs/superpowers/specs/2026-07-21-v1-season-hub-design.md`。

## 开发与发布流程

1. 需求写入 `docs/requirements/`（模板见 `docs/requirements/TEMPLATE.md`）。
2. agent 建分支开发，开 PR；CI 自动验证（类型、测试、e2e、Python），preview worker 自动部署。
3. 用户在 preview 页面验收后合并到 main。
4. 合并到 main 后 deploy 工作流自动发布到 f1-box.com（预览验收已在合并前完成）。
5. ingest 工作流定时从 Jolpica 采集并发布到 R2：周五至周日每 30 分钟、周一至周四每天一次（UTC），支持手动触发。

回滚：数据问题重新上传旧的 latest.json；代码问题重新部署旧提交。

## 当前状态

- 已上线：站点（f1-box.com）、真实 2026 赛季数据（R2）、CI、定时采集、preview/生产部署流程。
- 待办：真实比赛图片接入、浏览器视觉验收后的 UI 细节迭代。
