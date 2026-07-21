# Task 4：Astro Worker 与数据仓库

状态：完成

## 实现

- 新建 Astro 7.1.3 Cloudflare server 应用，使用 `@astrojs/cloudflare` 14.1.4；最小技术页通过 `cloudflare:workers` 的生成类型 `env.F1_DATA` 创建 repository，不提前实现 Task 5 视觉。
- Wrangler 配置使用 `2026-07-21`、`nodejs_compat`、`F1_DATA` R2 binding、静态资源 binding 与 logs/traces observability；Web dev/test/check/build 均先执行 `wrangler types`。
- `worker-configuration.d.ts` 由 Wrangler 4.112.0 生成，包含 `F1_DATA: R2Bucket`，没有手写 Env。
- `SeasonRepository` 无 store 时读取 contracts 共享 fixture；传入 store 后严格读取 `v1/seasons/{year}/latest.json` 和 manifest 指向的不可变 payload，不在失败时回退 fixture。
- manifest 在读取 payload 前验证精确五字段、schemaVersion、year、64 位小写 checksum、payloadKey/checksum 一致性和 UTC generatedAt；payload 使用共享 `parseSeasonPayload`，并与 manifest 的 season/generatedAt 对齐。
- 每次读取按最旧来源与注入 clock 重新计算 freshness：不超过 2 小时为 fresh，不超过 24 小时为 delayed，超过 24 小时为 stale；返回浅拷贝，不改 R2 原始 JSON。
- `time.ts` 提供 UTC 与可指定 IANA 时区的本地时间格式化，并为无效时间提供诊断。

## TDD 证据

1. 本地 repository RED：测试先运行，因 `season-repository.ts` 不存在而失败；实现共享 fixture 路径后 1 passed。
2. R2 正常路径 RED：store 路径抛出 `Object store repository is not implemented`；实现 manifest→payload 读取后 2 passed。
3. manifest 严格校验 RED：额外字段、错误 schemaVersion/year/checksum/payloadKey/generatedAt 共 6 failed；实现前置精确校验后 8 passed。
4. payload 诊断与一致性 RED：Schema 错误缺少 R2 key 上下文，错误 season/generatedAt 被接受，共 3 failed；增加带 key 的诊断和 manifest 对齐后 13 passed。
5. freshness 覆盖 2h/24h 边界、最旧来源、同一 repository 重复读取及不修改存储字节；repository 聚焦测试最终 18 passed。
6. 时间格式化 RED：测试先运行，因 `time.ts` 不存在而失败；实现后 3 passed。

## Astro 7 配置诊断

首次 `astro check` 稳定失败：显式 `main: ./dist/_worker.js/index.js` 在检查阶段尚不存在。读取 adapter 14.1.4 的 `cloudflareConfigCustomizer` 和 Cloudflare Vite plugin 源码后确认，adapter 在 main 缺省时自动注入 `@astrojs/cloudflare/entrypoints/server`；显式 dist 路径覆盖了正确默认值。

仅做一次最小配置实验：删除显式 main，其余不变。随后 `astro check` 为 0 errors/warnings，`astro build` 成功，生成的 `dist/server/wrangler.json` 使用 `main: entry.mjs`、`assets.directory: ../client` 并保留 `F1_DATA`。

## 最终验证

- `pnpm --filter @f1-box/web test`：2 files，21 tests passed。
- `pnpm --filter @f1-box/web check`：8 files，0 errors、0 warnings、0 hints。
- `pnpm --filter @f1-box/web build`：Cloudflare server build complete。
- `pnpm test`：contracts 13 tests、Web 21 tests 全部通过。
- `pnpm check`：contracts TypeScript 与 Web Astro check 通过。
- `pnpm build`：Web Cloudflare server build 通过。
- `git diff --check -- . ':(exclude)apps/web/worker-configuration.d.ts'`：业务源码、测试与配置通过。

## 自审

- `R2Bucket` 可结构化赋值给 `SeasonObjectStore`，由 Astro check 实际验证；无条件 R2 `get()` 的最新类型为 `R2ObjectBody | null`，port 只依赖其 `text()` 能力。
- 没有 Worker 内 Cloudflare REST 调用、访客上游 F1 请求、浮动 Promise、请求级全局可变状态、手写 binding 类型、`any` 或双重断言。
- manifest 与 payload JSON 是已知、受控的小型发布对象，读取后立即执行精确字段和共享 Schema 校验。
- Wrangler schema 已核实 observability、R2 和 assets 字段；生成构建配置保留所有 binding。

## Concerns

无阻塞项。`worker-configuration.d.ts` 包含 Wrangler 生成的完整 runtime 类型，文件较大且 Wrangler 4.112.0 当前输出含 5 处行尾空格；该文件不手工修正，后续 binding 或 compatibility 配置变化时由所有 Web scripts 自动重生成。

## Important 修复：严格 UTC manifest 与 Wrangler 固定版本

问题一：manifest 的 generatedAt 只检查格式和 `Date.parse` 可解析，JavaScript 会把 `2026-02-31T00:00:00Z` 和 `2026-01-01T24:00:00Z` 自动归一化，因此 repository 会错误地读取 payload。

RED：先增加两项测试，并断言只读取 latest manifest：

```text
pnpm --filter @f1-box/web exec vitest run tests/repository.test.ts -t normalized
2 failed, 18 skipped
```

两个失败都实际进入 payload 读取，收到 `Invalid season payload ... disagrees with manifest`，证明拒绝时机错误。

GREEN：generatedAt 现在同时满足固定 `YYYY-MM-DDTHH:mm:ssZ` 格式，并要求 `Date.parse` 后转为 ISO、移除固定 `.000` 的结果与原字符串完全一致，不接受自动归一化。

```text
同一聚焦命令：2 passed, 18 skipped
repository 全套：20 passed
```

问题二：`apps/web/package.json` 的 Wrangler 范围过宽。现已精确固定为 `4.112.0`，lockfile importer 同步为 `specifier: 4.112.0`、`version: 4.112.0`。

```text
pnpm install --lockfile-only
pnpm --filter @f1-box/web types
git diff --exit-code -- apps/web/worker-configuration.d.ts
```

Wrangler 报告版本 `4.112.0`，类型生成成功，生成文件无漂移。

修复后完整验证：

```text
pnpm --filter @f1-box/web test
2 files / 23 tests passed

pnpm --filter @f1-box/web check
8 files / 0 errors / 0 warnings / 0 hints

pnpm --filter @f1-box/web build
Cloudflare server build complete

pnpm test
contracts 13 tests / Web 23 tests passed

pnpm check
contracts TypeScript / Web Astro check passed

pnpm build
Cloudflare server build complete
```
