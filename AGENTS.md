# 原则

1. 优雅、高效、简洁 —— 代码和文档不得过度复杂或冗余。
2. 善用现有工具 —— 使用 MCP 服务、skills 和成熟的生态，不要重复造轮子。
3. 用中文回复 —— 不要使用日语/韩语。
4. 不做全文件系统搜索 —— 不要使用 `find /` 或在 `/` 下进行全局搜索（极慢）。需要某个文件直接问用户；只在明确的小范围目录内搜索。
5. 输出的文档、Markdown 等内容不使用 `**` 加粗语法。
6. 新行为先写失败测试；提交前运行与改动范围匹配的验证。
7. 不在访客请求中直接访问上游 F1 数据源。

# 环境

- Node.js >= 22.12.0；pnpm 11.9.0（Node 26 不再自带 corepack，用 `npm install -g pnpm@11.9.0` 安装）。
- Python 一律走 `uv`（`services/ingest` 下 `uv sync`、`uv run pytest`、`uv run ruff check .`）。
- 验证命令：`pnpm check`、`pnpm test`、`pnpm -r build`；e2e 用 `pnpm --filter @f1-box/web test:e2e`。
- 视觉审阅（截图检查）可用 VLM 网关，配置见 `.env.example`；token 只放本地 `.env`，严禁提交。
- `gh` 已登录 holdjun 账号；仓库为 holdjun/f1-box。Cloudflare 资源（Worker、R2）操作前先用 `wrangler whoami` 确认登录状态，有问题找用户处理。
- wrangler 的 `r2 object` / `kv key` 命令不带参数时默认操作本地模拟存储；操作真实云端必须加 `--remote`。

# 开发流程

1. 需求：聊天结论写入 `docs/requirements/`（见 TEMPLATE.md）——背景、用户可见行为、验收标准、范围外。
2. 开发：agent 从 main 建分支，按需求文档实现；新行为先写失败测试；提交前运行与改动范围匹配的验证。
3. PR：用 `gh pr create` 开 PR；CI 自动验证，preview worker 自动部署，PR 里给出预览地址。
4. 验收：用户在 preview 页面查看效果（桌面和 375px 移动端），确认后合并到 main。
5. 发布：合并触发 deploy 工作流，用户在 Actions 页面点 Approve，发布到 f1-box.com。
6. 数据：ingest.yml 定时从 Jolpica 采集并发布到 R2（周五至周日每 30 分钟、周一至周四每天一次，UTC），也可手动触发。
7. 回滚：数据问题重新上传旧的 latest.json；代码问题重新部署旧提交。

# 代码卫生

- 注释只解释"为什么"，不解释"做什么"；不留注释掉的代码。
- 校验只放在系统边界（上游 API 响应、R2 读取、用户输入）；内部调用信任类型，不叠防御。
- 不为"将来可能需要"预留抽象、配置开关或分支；需求变化时删除相应代码。
- 改动时顺手简化触及的代码：死代码、过期 TODO、冗余注释当场删除。
- 优先删代码而不是加代码：删掉某模块而测试仍全过，说明它该被删。
- 文档保持最新：过期文档删除或改写，不留历史遗迹。
