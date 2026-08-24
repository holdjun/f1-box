# 移除 Jolpica → ingest → R2 链路

日期：2026-08-24
状态：开发中

## 背景与目标

样式现代化后站点全部页面改读 D1（f1db 周同步），Jolpica ingest 产出的 R2 season payload 只剩两个消费方：`/` 重定向取 `activeSeason`、`/api/health` 检查 manifest。定时采集写着没人读的数据，是纯成本。本次移除整条链路；实时/遥测数据后续以 FastF1 另立需求（静态 f1db + 动态 FastF1 的双源架构已讨论确认）。

## 用户可见行为

- 无可见变化：`/` 仍重定向到当前赛季；`/api/health` 仍返回 ok，改报 D1 赛季覆盖范围。
- 页脚本就不渲染 freshness 徽章（无调用方），删除相关死组件后无视觉差异。

## 验收标准

- `services/ingest`、`packages/contracts`、`.github/workflows/ingest.yml`、`scripts/publish-release.sh`、`season-repository.ts`、`page-data.ts`、`FreshnessBadge.astro`、`repository.test.ts` 全部删除；wrangler 两个配置文件移除 `F1_DATA` R2 绑定。
- `pages/index.astro` 的 activeSeason 改从 D1 赛历（`getSeasonYears` 最大值）取；`/` 与 `/undefined` 重定向 e2e 仍绿。
- `api/health.ts` 改查 D1，不再引用 R2。
- CI 移除 Python/ingest 与 contracts 生成检查步骤；`pnpm check`、`pnpm test`、`pnpm -r build`、e2e 全绿。
- README / AGENTS.md / CLAUDE.md / docs/context 同步：数据流改为 f1db → D1 + 仓库本地 vendor；过期上下文文档删除。
- 云端 R2 bucket 不删（破坏性操作留给用户另行处理），仅移除代码侧绑定。

## 范围外

- 不引入 FastF1 采集服务（另立需求）。
- 不删 Cloudflare 上的 R2 bucket 与其中对象。
- D1 四个 repository、dev fixture、data-sync 工作流不动。
