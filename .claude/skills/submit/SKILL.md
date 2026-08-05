---
name: submit
description: Use when 用户要求提交代码、push、创建 PR，或说"提交一下"/"push 一下"/"开个 PR"/"ship it"
---

# Submit

Self-review → 按范围验证 → commit → push → PR。仓库用 squash 合并：PR 标题和正文会原样成为最终提交信息，认真写。

## 1. 分支

- `git fetch origin` 后检查当前分支：
  - 已在带 PR 的功能分支 → 留在原地。
  - 在 main → 从 `origin/main` 切 `feat/<slug>`、`fix/<slug>`、`docs/<slug>`、`chore/<slug>`，未提交改动随 checkout 带过去；HEAD 与 origin/main 不一致时先 stash 再 pop。
- 不要 force push 别人的或已合并的分支；自己的功能分支 rebase 后用 `--force-with-lease`。

## 2. 按改动范围验证

对照 `git status --porcelain` 的改动路径选择：

- `packages/contracts` 或 `apps/web` 代码：`pnpm check`、`pnpm test`。
- UI 行为变化（页面、样式、路由）：再加 `pnpm --filter @f1-box/web test:e2e`。
- `services/ingest`：`uv run --project services/ingest pytest -q`、`uv run --project services/ingest ruff check`。
- 纯文档或 workflow YAML：跳过代码检查。

不因为"改动很小"跳过应跑的检查；发现失败先修复再继续。

## 3. Self-review

先看全貌再逐项过：`git status --porcelain`、`git diff`、`git diff --cached`。

必须移除：
- 泄露的 secrets（token、API key、`.env` 内容）。
- 调试代码（`console.log` 等）和临时探针端点。
- 与本次 PR 无关的改动（拆出去）。
- 不该入库的文件（`.env`、`.data/`、`dist/`、本地状态）。

按 AGENTS.md 代码卫生规则检查：死代码、过期 TODO、注释掉的代码、为"将来可能"预留的抽象。

文档同步：公共行为、命令、配置、目录结构变化时更新 README/AGENTS.md/docs；纯内部实现改动不要为了"完整"硬改文档。

## 4. Commit

- `git add <具体文件>`，不用 `git add -A`。
- Conventional Commits：`feat/fix/docs/chore/ci/refactor/test: <祈使句 ≤72 字符>`。
- 逻辑独立的改动拆成多个 commit；提交信息结尾保留 Co-Authored-By 行。

## 5. Push 与 PR

```bash
git push -u origin HEAD
gh pr create --title "<标题：与主题句一致的概括>" --body "<正文>"
```

PR 正文结构：

```
## 内容
改了什么、为什么（对应需求文档则引用 docs/requirements 路径）。

## 验证
跑过的命令与结果；页面级变化给出 preview 地址。
```

把 PR 地址报告给用户，等用户验收合并；不要自己合并。CI 变红先看日志修复，不要盲目重跑。
