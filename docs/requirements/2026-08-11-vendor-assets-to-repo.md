# 策展资产进仓库，取消 R2 双桶覆盖层

日期：2026-08-11
状态：开发中

## 背景与目标

车队 logo 策展资产此前放在 R2：预览用 `f1-box-preview-overrides` 覆盖桶，合并后再手动跑脚本推广到生产桶 `f1-box-data`。代码和数据分离发布，带来合并窗口期数据缺失、预览桶半上传、索引被 CDN 缓存 24 小时等问题，也需要维护覆盖绑定和发布脚本。

资产按性质分两类：策展静态资产（logo、车队色、国旗）人工整理、低频变更、总量约 4 MB；动态采集数据（ingest 产出的赛季 payload）高频更新，必须留在 R2。本次把前者迁进 git 仓库，随代码一起构建部署，让 preview 与生产天然同源。

## 用户可见行为

- PR 预览部署即包含该分支的全部策展资产，所见即合并后所得，不再有"合并后补传数据"的步骤。
- `/teams` 目录与车队详情页的 logo、车队色、国旗显示不变；logo 框保持 contain 等比缩放与 monogram 回落。
- 本地开发（astro dev）也能看到真实 logo 与国旗，不再是 monogram 占位。
- `/vendor/[...key]` 动态路由移除：logo 与国旗由 Workers 静态资产直接下发。

## 验收标准

- `apps/web/public/vendor/` 承载 logo 与国旗图片，`apps/web/src/data/` 承载 logos.json 与 team-colors.json，构建期内联。
- 测试覆盖：索引与文件一一对应（无缺失、无孤儿）、variant 合法、颜色为合法 hex；e2e 断言真实 logo 渲染。
- `wrangler.preview.jsonc` 不再有 `F1_PREVIEW_OVERRIDES` 绑定；发布脚本删除。
- `pnpm check`、`pnpm test`、e2e、`pnpm --dir apps/web build` 通过；部署干跑确认资产从 `dist/client` 读取。

## 范围外

- 不动 R2 的动态数据（v1/seasons 等，待 #38 退役 jolpica 后统一清理）。
- 不批量补充无可靠来源的历史 logo。
- 生产桶 `vendor/` 前缀的清理（合并验收后另行处理）。
