# CI 流水线整合与自动化加固

日期：2026-08-24
状态：开发中

## 背景与目标

ci 与 deploy 两条工作流对同一提交各跑一遍 install+build；生产部署不等 verify
出结果，main 上测试挂了生产也已换上。目标是合并为单条门禁式流水线，生产部署
由 verify 结构性把关，并补齐 concurrency、permissions、本地与 CI 一致性等基础项。
部署 job 仍是独立的 install+build（preview 与生产构建配置不同，产物无法复用），
重复计算没有消除；本次的收益是门禁与流水线收敛，不是省计算。

## 用户可见行为

- PR 与 main push 只触发一条 ci 流水线：verify（biome/check/test/build/e2e）
  全绿后，PR 事件部署 preview、main push 部署 production。
- 生产部署被 verify 结构性门禁：CI 不过则不会部署 f1-box.com。
- preview 可用时间从约 45 秒变为约 3 分半（等待 verify 完成）。
- 未开 PR 的分支 push 不再部署 preview（原 deploy.yml 的 push 触发移除）。
- PR 连续 push 自动取消过时流水线；main 上排队而非取消（不打断进行中的生产部署）。
- fork PR 不部署 preview（读不到仓库 secrets），只跑 verify。
- data-sync 定时与手动重叠时排队而非并发。
- 本地 `pnpm check` 与 CI 完全一致（含 biome），本地全绿即可放心推送。
- dependabot 每月跟进 GitHub Actions 版本升级（仅 actions 生态）。

## 验收标准

- `.github/workflows/` 仅存 ci.yml 与 data-sync.yml，deploy.yml 删除。
- ci.yml：preview/production 均 `needs: verify`；preview 限本仓库 PR（fork 跳过），
  production 限 main push；声明 permissions 与 concurrency（main 排队、PR 取消）。
- data-sync.yml 声明 permissions 与 concurrency（cancel-in-progress: false）。
- 根 package.json `check` 含 `biome ci .`；CI 中不再有独立 lint 步骤。
- biome.json 无 deprecation 与 ignore 写法告警（`preset: "recommended"`，
  文件夹排除用目录本身）；对违规样本文件仍能检出问题（防 preset: none 回归）。
- `pnpm check`、`pnpm test`、`pnpm -r build` 本地全部通过。

## 范围外

- data-sync 的同步逻辑与 scripts/ 下脚本不动（#17 刚加固过）。
- e2e 继续走 dev server，不改用 build 产物。
- npm 依赖不接入 dependabot（由 pnpm minimumReleaseAge 策略约束）。
