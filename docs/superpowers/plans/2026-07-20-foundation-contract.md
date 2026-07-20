# F1 Box 基础契约实施计划

> Agent 执行要求：逐任务使用 `superpowers:subagent-driven-development`；行为代码遵循测试驱动开发。

目标：建立最小 monorepo，并交付一份由 TypeScript 与 Python 共用、可运行时校验的比赛周末 JSON Schema，为后续采集和页面实现提供稳定边界。

架构：`packages/contracts/weekend.schema.json` 是唯一数据结构真源。TypeScript 从 Schema 推导类型并用 Ajv 校验；Python 直接读取同一 Schema 并用 `jsonschema` 校验。首轮只建立契约，不访问 Jolpica、不创建页面、不接入 Cloudflare。

技术栈：Node.js 22+、pnpm 11.9.0、TypeScript、Vitest、Ajv、json-schema-to-ts、Python 3.12、uv、pytest、jsonschema、Ruff。

## 全局约束

- 仓库保持单体结构，不引入微服务。
- 访客请求不得直接调用 Jolpica 或 FastF1。
- 时间统一为 UTC ISO 8601 字符串，格式为 `YYYY-MM-DDTHH:mm:ssZ`。
- Schema 版本固定为整数 `1`；未知版本必须失败。
- 场次状态为 `scheduled`、`provisional`、`complete`、`delayed`、`unavailable`。
- 新鲜度为 `fresh`、`stale`、`delayed`、`unavailable`。
- 首个样例为 2024 比利时大奖赛第 14 轮，包含排位赛和正赛分类。
- 数据必须包含生成时间、来源 URL、抓取时间和新鲜度。
- 不加入账户、新闻、实时计时、遥测、D1、R2 或生产部署。
- 不使用官方 F1、车队或车手图片和标志。

## 文件结构

```text
f1-box/
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── .python-version
├── packages/contracts/
│   ├── package.json
│   ├── tsconfig.json
│   ├── weekend.schema.json
│   ├── src/weekend.ts
│   └── tests/weekend.test.ts
└── services/ingest/
    ├── pyproject.toml
    ├── src/f1box_ingest/__init__.py
    ├── src/f1box_ingest/contracts.py
    └── tests/
        ├── fixtures/weekend.json
        └── test_contracts.py
```

## Task 1：建立最小工作区

文件：

- 修改 `.gitignore`
- 创建 `AGENTS.md`
- 创建 `package.json`
- 创建 `pnpm-workspace.yaml`
- 创建 `.python-version`
- 创建 `packages/contracts/package.json`
- 创建 `packages/contracts/tsconfig.json`
- 创建 `packages/contracts/src/weekend.ts`

输出接口：

- 根命令 `pnpm check`、`pnpm test`
- 包名 `@f1-box/contracts`
- Python 版本选择 `3.12`

步骤：

- [ ] 根 `package.json` 设置 `private: true`、`packageManager: pnpm@11.9.0`、`engines.node: >=22`。
- [ ] workspace 仅包含 `apps/*` 与 `packages/*`；Python 服务不伪装为 pnpm 包。
- [ ] contracts 包使用 ESM，并提供 `check` 与 `test` 脚本。
- [ ] contracts 的 TypeScript 配置启用 `strict`、`noEmit`、`resolveJsonModule`、`moduleResolution: Bundler`。
- [ ] `src/weekend.ts` 仅写入 `export {};`，让工作区在行为实现前可独立类型检查。
- [ ] `.gitignore` 增加 `.data/`、Python 虚拟环境、测试报告和覆盖率目录。
- [ ] 运行 `pnpm install` 生成锁文件。
- [ ] 运行 `pnpm check`；预期 TypeScript 配置加载成功且退出码为 0。
- [ ] 提交信息：`chore: establish project workspace`。

## Task 2：建立共享比赛周末契约

文件：

- 创建 `packages/contracts/weekend.schema.json`
- 修改 `packages/contracts/src/weekend.ts`
- 创建 `packages/contracts/tests/weekend.test.ts`
- 修改 `packages/contracts/package.json`

输入接口：无。

输出接口：

```ts
export type WeekendPayload = FromSchema<typeof weekendSchema>;
export function parseWeekendPayload(value: unknown): WeekendPayload;
```

Schema 必须使用 `additionalProperties: false`，并表达以下结构：

```text
WeekendPayload
├── schemaVersion: 1
├── generatedAt: UTC timestamp
├── freshness: fresh | stale | delayed | unavailable
├── event
│   ├── season, round, slug, raceName, startsAt
│   └── circuit: id, name, locality, country, latitude, longitude
├── sessions[]
│   └── key, name, startsAt, state
├── classifications[]
│   ├── qualifying: rows[position, driverCode, driverName, constructorName, q1, q2, q3]
│   └── race: rows[position, driverCode, driverName, constructorName, laps, status, points, time, fastestLap]
├── driverStandings[]: position, name, code, points, wins
├── constructorStandings[]: position, name, points, wins
├── history[]: season, round, raceName, winnerName, winnerConstructor
├── seasonSchedule[]: round, raceName, slug, startsAt, circuitName, country
└── sources[]: name, url, fetchedAt
```

可空规则：排位赛的 `q1`、`q2`、`q3` 和正赛的 `time`、`fastestLap` 必须存在，值可为字符串或 `null`。积分允许小数。分类通过 `sessionKey` 的 `const` 值组成可辨识联合，只允许 `qualifying` 与 `race`。

测试顺序：

- [ ] 先写有效样例测试；由于 validator 尚不存在，预期测试失败。
- [ ] 写四个无效样例：错误版本、缺少来源、未知场次状态、排位分类缺少 `q3`；每个都必须被拒绝。
- [ ] 运行 `pnpm --filter @f1-box/contracts test`，确认失败原因来自缺少实现。
- [ ] 安装 Ajv 与 json-schema-to-ts，导入 JSON Schema，编译一次 validator。
- [ ] `parseWeekendPayload` 成功时返回同一已校验对象；失败时抛出包含 Ajv 错误路径的 `TypeError`。
- [ ] 运行 `pnpm --filter @f1-box/contracts test`；预期 5 个测试全部通过。
- [ ] 运行 `pnpm --filter @f1-box/contracts check`；预期无类型错误。
- [ ] 提交信息：`feat: define weekend payload contract`。

## Task 3：证明 Python 与 TypeScript 共用契约

文件：

- 创建 `services/ingest/pyproject.toml`
- 创建 `services/ingest/src/f1box_ingest/__init__.py`
- 创建 `services/ingest/src/f1box_ingest/contracts.py`
- 创建 `services/ingest/tests/fixtures/weekend.json`
- 创建 `services/ingest/tests/test_contracts.py`

输入接口：`packages/contracts/weekend.schema.json`。

输出接口：

```python
def validate_weekend(value: object) -> dict[str, object]: ...
```

步骤：

- [ ] 配置 Python 3.12，运行依赖仅含 `jsonschema`，开发依赖仅含 `pytest` 与 `ruff`。
- [ ] fixture 使用 Task 2 的完整 2024 比利时大奖赛有效样例，不复制 Schema。
- [ ] 先写测试：有效 fixture 原样返回；错误 `schemaVersion` 和未知状态抛出 `jsonschema.ValidationError`。
- [ ] 运行 `uv run --project services/ingest pytest services/ingest/tests/test_contracts.py -v`，确认因实现缺失而失败。
- [ ] `contracts.py` 从仓库根定位并加载共享 Schema；模块级缓存已解析的 validator，不缓存业务数据。
- [ ] `validate_weekend` 先校验再返回输入；非字典输入同样由 Schema 拒绝。
- [ ] 运行 Python 测试；预期 3 个测试全部通过。
- [ ] 运行 `uv run --project services/ingest ruff check services/ingest`；预期无错误。
- [ ] 运行 `pnpm check && pnpm test`；预期 TypeScript 验证保持通过。
- [ ] 提交信息：`feat: validate weekend contract in python`。

## 完成标准

- TypeScript 与 Python 使用同一个 JSON Schema 文件。
- 排位赛和正赛分类均有稳定结构。
- 计划中的五种场次状态均可表达，未知值失败。
- 有效 fixture 在两种语言中通过；代表性漂移在两种语言中失败。
- 所有依赖由锁文件固定，仓库没有生成物和缓存文件。
- 本轮结束后再为 Jolpica 原始快照、归一化与新鲜缓存单独写下一份短计划。
