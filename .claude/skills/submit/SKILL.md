---
name: submit
description: Use when 开发完成要提交 PR 交付验收：用户说"提 PR"/"开 PR"/"ship it"，或需求已完成待验收。纯本地 commit 不走此流程，按 AGENTS.md 提交规范执行。
---

# Submit（PR 提交流程）

仓库用 squash 合并：PR 标题和正文会原样成为永久提交信息。

## 适用判断

- 需求完成、验证过、要交付用户验收 → 走完整流程。
- 用户只要开发中途的存档 commit → 按 AGENTS.md 提交规范执行，不走此流程。
- 当前分支已有 PR → commit 后 push 即更新 PR，不重复开。

## 1. 分支

`git fetch origin` 后检查：

- 已在带 PR 的功能分支 → 留在原地。
- 在 main → 从 `origin/main` 切 `<type>/<slug>`（feat/fix/docs/chore），未提交改动随 checkout 带过去；HEAD 与 origin/main 不一致时先 stash 再 pop。
- 在无 PR 的旧分支 → 停下来问用户：可能是废弃分支（清理）或未开 PR 的工作分支（继续用）。

自己的分支 rebase 后用 `git push --force-with-lease`，不强推其他分支。

## 2. 全量自查

先看全貌：`git status --porcelain`、`git diff`、`git diff --cached`，再逐项过。

必须移除：

- 泄露的 secrets（token、API key、`.env` 内容）。
- 调试代码（`console.log` 等）和临时探针。
- 与本次需求无关的改动（拆到别的 PR）。
- 不该入库的文件（`.env`、`.data/`、`dist/`、本地状态）。

按 AGENTS.md 代码卫生规则检查：死代码、过期 TODO、注释掉的代码、为"将来可能"预留的抽象。

文档同步：公共行为、命令、配置、目录结构变化时更新 README/AGENTS.md/docs；纯内部改动不为"完整"硬改文档。

## 3. 完整验证

对照改动路径：

- `packages/contracts` 或 `apps/web` 代码：`pnpm check`、`pnpm test`。
- UI 行为变化（页面、样式、路由）：再加 `pnpm --filter @f1-box/web test:e2e`。
- `services/ingest`：`uv run --project services/ingest pytest -q`、`uv run --project services/ingest ruff check`。
- 纯文档或 workflow YAML：跳过代码检查。

不因为"改动很小"跳过应跑的检查；失败先修复再继续。

## 4. 提交并推送

- `git add <具体文件>`；Conventional Commits 英文标题，祈使语气 ≤72 字符；逻辑独立的改动拆多个 commit。
- `git push -u origin HEAD`。

## 5. 创建 PR

标题和正文都用英文（squash 后进入 git 历史，与现有提交保持一致）：

```bash
gh pr create --title "<English subject summarizing the requirement>" --body "$(cat <<'EOF'
## Changes

<What changed and why; cite docs/requirements path when a requirement doc exists.>

## Verification

<Commands run with results; for page-level changes include the preview URL.>
EOF
)"
```

把 PR 地址报告给用户，等用户验收合并，不自己合并。CI 变红先看日志修复，不盲目重跑。
