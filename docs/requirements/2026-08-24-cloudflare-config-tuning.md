# Cloudflare 配置调优：迁移到适配器原生缓存与小项清理

日期：2026-08-24
状态：预览验收（v7，PR #21）

## 背景与目标

缓存策略已在 main 上收敛到 src/middleware.ts（PR 19）：
GET 页面响应默认补 `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`，
四个列表页在数据为空时显式设 `no-store`。但 Workers Caching
仍未启用（生产响应实测无 `cf-cache-status` 头），这些头依旧不生效，每次访问都要执行
Worker 并查询 D1。

目标：按官方文档走 @astrojs/cloudflare 适配器的原生缓存路径完成接入，页面响应显式
opt-in 边缘缓存，命中请求完全不执行 Worker；未 opt-in 的响应由适配器自动保证不被
边缘缓存。

本需求即 astro-svelte-islands 需求文档"二期候选"的第一项（route caching +
cacheCloudflare 提供者 + 与 data-sync 的 tag 失效打通）。该文档将 cacheCloudflare
标注为实验性，但本方案的全部机制断言已按当前安装版本（adapter 14.2.3 /
astro 7.2.4）源码逐条核实。

## 关键机制（源码核实）

启用 cloudflare 缓存提供者后，适配器的部署入口会对每个响应执行：
未携带 `Cloudflare-CDN-Cache-Control` 的响应一律补 `no-store`
（设计意图见 vite-plugin-config.d.ts 注释："opting in to the cache provider never
accidentally caches routes that don't use it"）。该头在 CDN 层优先级高于普通
Cache-Control，因此：

- 页面必须通过 `Astro.cache.set()`（路由内）或 `context.cache.set()`（middleware）
  显式 opt-in 才会被边缘缓存，仅靠现有普通 Cache-Control 头在启用提供者后反而会
  全部变成 no-store；
- 重定向、404、API 端点等一切未 opt-in 的响应天然免于被缓存，无需额外兜底层。
  （此前版本设想的中间件兜底由此失去必要性，不再引入。）
- 这两个头由 Cloudflare 在边缘消费并从返回给客户端的响应中剥除，浏览器/curl 层
  不可见；客户端可观测信号是 `cf-cache-status`。
- 缓存按 Worker 版本分区：每次代码部署天然从全冷缓存开始，部署后新代码立即生效、
  不会服务旧 HTML；真正的陈旧场景是 data-sync——只更新 D1 不换 Worker 版本，
  此时缓存页面最长 15 分钟落后于库内数据，f1db 标签失效通道正是为它准备的。
- 与 middleware 的管线关系：缓存步骤包裹整个渲染管线（含 middleware）。平台层
  的缓存命中检查发生在 Worker 执行之前，命中即短路、Worker 完全不执行；Worker
  内应用缓存头的收尾（applyCacheHeaders）发生在中间件返回之后，因此 middleware
  内对 `context.cache.set()` 的调用会被正常应用。未 opt-in 的响应由适配器盖
  CDN 层 no-store 兜底（含列表页空数据信号、API、404、重定向与渲染抛错路径）。

## 用户可见行为

- 页面访问更快：重复访问命中边缘缓存，Worker 与 D1 不参与。
- 数据时效不变差：opt-in 页面最长约 15 分钟旧内容（300s TTL + 600s SWR），
  相对 f1db 周更节奏可感知但可接受；404/重定向/API 不被缓存。

## 变更项

### A. 接入适配器原生缓存提供者

astro.config.mjs 新增：

```js
import { cacheCloudflare } from "@astrojs/cloudflare/cache";

export default defineConfig({
  // ...现有配置不变
  cache: { provider: cacheCloudflare() },
});
```

- `cache` 为稳定顶层配置（非实验标志）。配置后适配器在构建时自动向 wrangler
  配置注入 `cache: { enabled: true }`（检测条件即 provider.name === "cloudflare"），
  生产与预览两条构建路径同样生效；我们不在 wrangler 层手写平台开关。
- 提供者负责生成 `Cloudflare-CDN-Cache-Control` 与 `Cache-Tag`，并提供基于标签的
  失效能力（`cache.purge({ tags })`），为将来 data-sync 后主动清缓存铺路。
- 刻意不使用 routeRules：其打头逻辑不区分状态码也不区分 HTTP 方法，且重定向路由
  在管线中早于打头步骤返回，声明式规则无法满足"仅成功响应可缓存"的要求；
  改用页面级显式 opt-in。

### B. middleware 默认策略切换为缓存 opt-in

PR 19 后逐页手写头已不存在，缓存收敛点是 src/middleware.ts 的默认策略分支。
将其从"设置普通 Cache-Control"改为调用缓存 opt-in，判定条件保持不变：

```ts
if (
  context.request.method === "GET" &&
  !url.pathname.startsWith("/api/") &&
  response.status >= 200 &&
  response.status < 300 &&
  !response.headers.has("Cache-Control")
) {
  context.cache.set({ maxAge: 300, swr: 600, tags: ["f1db"] });
}
```

- 条件中最后一项继续保留四个列表页空数据时的显式 `no-store` 信号：这些响应
  不 opt-in，由适配器兜底为 CDN 层 no-store，语义与现状一致。
- 现有判定不感知页面级 `Astro.cache.set(false)` 显式禁用（该调用不产生任何响应
  头，applyCacheHeaders 直接跳过）：若将来页面用此方式禁用缓存，会被 middleware
  默认分支反向 opt-in。目前无页面使用，引入时需为它新增判定信号。
- `tags: ["f1db"]` 预埋失效标签（provider 还会自动附加 astro-path 标签），
  为 data-sync 成功后按标签清缓存铺路，避免二次改动收敛点。
- 原 s-maxage/SWR 均为共享缓存指令，浏览器本就不消费，替换对浏览器侧无行为变化。
- 测试说明：tests/middleware.test.ts 已有单测基建，本项可 TDD——先行修改断言
  （默认策略改为断言 context.cache.set 以预期参数被调用；列表页空数据信号不触发
  opt-in；API/重定向/404/非 GET 均不 opt-in），再改实现。注意测试夹具 makeContext
  目前未构造 context.cache，需同步新增 cache mock，断言对象从 response.headers
  换成 cache.set 调用参数。

### C. /api/health 显式禁用缓存

health.ts（PR 19 后经 locals 读仓库，仍无任何缓存头）响应补
`"cache-control": "no-store"`。启用提供者后适配器本也会给它盖上
CDN 层 no-store，此改动作为卫生措施保留：语义自文档化，且回退提供者时不失守。
/api/ask 的 handler 已自带 no-store（handler.ts 12/85 行），无需处理。

### D. workflow 并发控制：无需改动

原计划的 deploy.yml 拆分并发已被 PR 18（ci 合并与门控部署）提前落地且语义一致：
ci.yml 顶部为 workflow 级 `concurrency: { group: <workflow>-<ref>,
cancel-in-progress: <非 main> }`——preview 取消过期构建、生产部署排队串行永不中途
取消。本项仅作记录，不再包含变更。

### E. SESSION KV 保留

该绑定是 Astro 会话 API（`Astro.session`）的默认存储绑定（约定名 `SESSION`）。
应用目前未调用会话 API，但不能直接删——删掉手动声明后适配器会以无 id 的绑定
触发 wrangler 自动 provisioning，CI 环境可能反复创建垃圾 namespace。
保留现状，成本为零。将来如确认不用会话，可走干净移除路径
（Astro 顶层配置 `session: false` 后删绑定、删 namespace；注意 session 是
astro.config 顶层项而非适配器选项），作为独立清理项。

## 验收标准

- middleware 单测先行且通过（更新 tests/middleware.test.ts）：默认策略改为断言
  context.cache.set 以 { maxAge: 300, swr: 600, tags: ["f1db"] } 被调用；列表页
  空数据的显式 no-store 信号不触发 opt-in；API/重定向/404/非 GET 均不 opt-in。
- 预览环境实测（边缘行为的唯一有效验证层；CDN 层的 Cloudflare-CDN-Cache-Control
  与 Cache-Tag 头被 Cloudflare 剥除、对客户端不可见，其值只能经仪表盘/API 核验，
  不作本 PR 验收项。实施时先对预览域做一次二次请求冒烟：workers.dev 子域上该
  缓存能力若不可用，则把 HIT 验证收敛到生产层并同步调整本节表述）：
  - opt-in 页面第二次请求 `cf-cache-status: HIT`；
  - 详情页正例 URL 二次请求 HIT；任一缺失 slug（如 /teams/not-a-team）为实时
    404 且连续请求无 HIT——验证条件式 opt-in 的门控；
  - 全局 404 与重定向端点（如 /results/2024）连续请求始终非 HIT；
  - `/api/health` 返回普通头 `cache-control: no-store`（该头对客户端可见），
    且连续请求非 HIT；
  - /api/ask SSE 冒烟一问一答正常。
- 生产验证同预览（opt-in 页面 HIT / 缺失路径实时 404 / health 非 HIT）。
- `pnpm check`、`pnpm test` 全绿；e2e 通过（本地 dev 下缓存运行时为 Noop，
  e2e 不受影响）。
- 深浅两主题下页面功能目检正常（主题走 localStorage，不受 HTML 缓存影响）。

## 范围外

- compatibility_date 推进（2026-07-21 → 当前）：与本需求解耦，runtime 行为变化
  不应与缓存功能混在同一改动里归因不清，后续单独开 chore。
- wrangler 4.112.0 → 4.125.0 升级：4.112 已支持所需配置字段，拆成独立 chore PR。
- AI Gateway：需先在控制台创建 Gateway 资源获取 id，作为独立小需求后续再做。
- routeRules 声明式路由缓存：待上游支持状态码与方法门控后再评估；届时可把
  middleware 内的 opt-in 收敛进路由规则。
- 列表页空数据的普通 no-store 头在启用提供者后与适配器兜底重复，是否移除留待
  后续单独简化；注意该头同时是 middleware 默认分支的跳过信号
  （!response.headers.has("Cache-Control")），移除必须与 B 节判定联动，否则空数据
  列表页会被反向 opt-in 进缓存。
- data-sync 成功后主动清缓存：B 节已备好 f1db 标签通道，作为后续增强把 15 分钟
  陈旧窗口压到零。
