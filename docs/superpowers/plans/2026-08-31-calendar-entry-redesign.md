# Racing 页日历入口重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 racing 页日历订阅入口从 Next 卡片内的 `<details>` 下拉改为头部统计行按钮 + 原生 `<dialog>` 居中模态，保留无 JS 降级。

**Architecture:** 服务端渲染三份静态标记（触发按钮 `hidden`、内联降级行、`<dialog>`）；`client.ts` 在页面加载时做节点级增强（显示按钮、隐藏降级行、接线弹窗），委托型监听（复制）维持一次绑定。弹窗用原生 `<dialog showModal()>`，焦点圈闭/Esc/遮罩关闭全部由浏览器提供。

**Tech Stack:** Astro 7（.astro + 服务端 TS）、Tailwind 4 语义工具类 + `apps/web/src/styles/theme.css` 令牌单源、原生 `<dialog>`、Playwright e2e。

**规格：** `docs/superpowers/specs/2026-08-31-calendar-entry-redesign-design.md`

**关键环境陷阱：** Bash 工具的 cwd 不跨调用持久化（每次重置回 `/Users/hj/workspace/f1-box`）。本计划所有命令都显式带 `git -C` / `pnpm -C` / 同链内 `cd`，执行时不得省略。工作目录一律是 worktree：`/Users/hj/workspace/f1-box-ics-calendar`（分支 `feat/ics-calendar`）。

---

### Task 1: 提交既有 ICS 日历功能（当前 WIP）

重设计叠加在未提交的 ICS 功能之上；先把已通过全套验证（check/212 单测/build/114 e2e）的 WIP 落成一个提交，保持历史清晰。

**Files:**
- Commit: worktree 内全部 ICS 功能改动（`apps/web/src/lib/calendar-ics.ts`、`apps/web/src/pages/api/calendar.ics.ts`、`apps/web/tests/calendar-ics.test.ts`、`docs/requirements/2026-08-26-ics-calendar.md`、fixture 与 `[year].astro`/`client.ts`/`components.css`/`season.spec.ts` 中的 ICS 相关改动）

- [ ] **Step 1: 确认当前改动清单**

```bash
git -C /Users/hj/workspace/f1-box-ics-calendar status --short
```

预期：约 10 个修改文件 + 4 个未跟踪文件（上面 Commit 一行所列）；设计规格文档 `docs/superpowers/specs/2026-08-31-calendar-entry-redesign-design.md` 不应出现（已在 61e59db 提交）。

- [ ] **Step 2: 快速复核 diff 无 secrets/调试代码**

```bash
git -C /Users/hj/workspace/f1-box-ics-calendar diff --stat
git -C /Users/hj/workspace/f1-box-ics-calendar diff -- apps/web/src/scripts/client.ts | head -80
```

预期：只有 ICS 功能相关改动；无 `console.log`、无 `.env` 内容。

- [ ] **Step 3: 逐文件暂存并提交**

逐个 `git add` 具体文件（不用 `-A`），然后：

```bash
git -C /Users/hj/workspace/f1-box-ics-calendar commit -m "feat: add season ICS calendar endpoint and racing page entry"
```

- [ ] **Step 4: 确认工作区干净**

```bash
git -C /Users/hj/workspace/f1-box-ics-calendar status --short
```

预期：无输出。

---

### Task 2: 改写 e2e 用例（red）

**Files:**
- Modify: `apps/web/tests/e2e/season.spec.ts:120-142`（替换 "next panel exposes calendar subscribe/download links" 用例），并在其后追加服务端 HTML 降级用例

- [ ] **Step 1: 替换旧用例为新用例**

把 `tests/e2e/season.spec.ts` 中 `test("@desktop next panel exposes calendar subscribe/download links", ...)`（120-142 行）整体替换为：

```ts
test("@desktop header calendar button opens a dialog with subscribe links", async ({
  page,
}) => {
  await page.goto("/racing/2026");
  const { host, origin } = new URL(page.url());
  // 有 JS 时降级行被增强脚本隐藏，只显示触发按钮
  await expect(page.locator("[data-calendar-fallback]")).toBeHidden();
  const trigger = page.locator("[data-calendar-trigger]");
  await expect(trigger).toBeVisible();

  await trigger.click();
  const dialog = page.locator("[data-calendar-dialog]");
  await expect(dialog).toBeVisible();
  // webcal 断言用正则：scheme 必须恰为 webcal://（防 webcals:// 回归），不耦合页面协议
  await expect(dialog.locator("[data-calendar-subscribe]")).toHaveAttribute(
    "href",
    new RegExp(
      `^webcal://${host.replace(/\./g, "\\.")}/api/calendar\\.ics\\?year=2026$`,
    ),
  );
  await expect(dialog.locator("[data-calendar-download]")).toHaveAttribute(
    "href",
    new RegExp(
      `^https?://${host.replace(/\./g, "\\.")}/api/calendar\\.ics\\?year=2026$`,
    ),
  );
  await expect(dialog.locator("[data-calendar-copy]")).toHaveAttribute(
    "data-calendar-copy",
    `${origin}/api/calendar.ics?year=2026`,
  );

  // 关闭三路径：✕ 按钮、Esc、点击弹窗自身（遮罩/内边距区）
  await dialog.locator("[data-calendar-close]").click();
  await expect(dialog).toBeHidden();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await dialog.click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeHidden();
});

test("@desktop server HTML ships no-JS calendar fallback", async ({
  request,
}) => {
  // 无 JS 降级直接看服务端产物：降级行存在、触发按钮带 hidden
  const res = await request.get("/racing/2026");
  const html = await res.text();
  expect(html).toContain("data-calendar-fallback");
  expect(html).toMatch(/data-calendar-trigger[^>]*hidden/);
});
```

说明：`dialog.click({ position: { x: 4, y: 4 } })` 命中弹窗自身 1.25rem 内边距区，`event.target === dialog` 成立即关闭。

- [ ] **Step 2: 运行，确认新用例失败**

```bash
cd /Users/hj/workspace/f1-box-ics-calendar/apps/web && pnpm exec playwright test tests/e2e/season.spec.ts --grep @desktop
```

预期：两个新用例失败（`[data-calendar-fallback]` 不存在 / `[data-calendar-trigger]` 不存在），其余 @desktop 用例通过。旧用例已被替换，不再出现。

---

### Task 3: 页面标记改造（green 之一）

**Files:**
- Modify: `apps/web/src/pages/racing/[year].astro`

- [ ] **Step 1: frontmatter 去掉面板专用注释**

第 38-41 行的 `calendarItemClass` 保留（弹窗内复用），把它上方两行注释：

```
// 日历菜单项与 SeasonFilter 下拉选项同一 hover 语言；面板底为 surface-overlay，
// 在 Next 卡片（surface-raised）上有区分，hover 行反向用 raised
```

替换为：

```
// 日历弹窗菜单项与 SeasonFilter 下拉选项同一 hover 语言
```

- [ ] **Step 2: Next 卡片删除 details 入口并去掉 relative**

第 63 行卡片容器：

```
        <div class="relative rounded-md border border-line bg-surface-raised p-6 light:shadow-panel">
```

改为（去掉 `relative`）：

```
        <div class="rounded-md border border-line bg-surface-raised p-6 light:shadow-panel">
```

第 79-108 行整段（`<div class="mt-5 flex flex-wrap ...">` 起始，含 View weekend 链接、`<details class="calendar-box" ...>` 及其闭合）替换为：

```
          <div class="mt-5">
            <a class="button button--text" href={cardHref(next)}>View weekend</a>
          </div>
```

- [ ] **Step 3: 头部统计行改造 + 降级行 + 弹窗**

第 55-61 行左列：

```
      <div>
        <p class="status-label">Formula 1 calendar</p>
        <h1 class="mt-3 text-display-lg uppercase">{year} Season</h1>
        <p class="mt-4 text-[0.85rem] text-ink-strong">
          {races.length} rounds · {completed.length} completed
        </p>
      </div>
```

替换为：

```
      <div>
        <p class="status-label">Formula 1 calendar</p>
        <h1 class="mt-3 text-display-lg uppercase">{year} Season</h1>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p class="text-[0.85rem] text-ink-strong">
            {races.length} rounds · {completed.length} completed
          </p>
          <button
            type="button"
            class="button button--text calendar-entry-trigger"
            data-calendar-trigger
            hidden
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"
              ><rect x="3.5" y="5" width="17" height="15.5"
              /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg
            >
            Add to calendar
          </button>
        </div>
        <p class="calendar-entry-fallback" data-calendar-fallback>
          <a class="underline decoration-line underline-offset-4" href={webcalHref}
            >Subscribe</a
          >
          <span aria-hidden="true"> · </span>
          <a
            class="underline decoration-line underline-offset-4"
            href={icsHref}
            download={`f1-${year}.ics`}>Download .ics</a
          >
          <span aria-hidden="true"> · </span>
          <code class="text-[0.72rem]" title={icsHref}>{icsHref}</code>
        </p>
        <dialog
          class="calendar-dialog"
          data-calendar-dialog
          aria-labelledby="calendar-dialog-title"
        >
          <div class="flex items-start justify-between gap-4">
            <h2
              id="calendar-dialog-title"
              class="font-display text-[1.25rem] leading-tight font-semibold uppercase"
            >
              Add F1 {year} to your calendar
            </h2>
            <button
              type="button"
              class="calendar-dialog__close"
              data-calendar-close
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"
                ><path d="M6 6l12 12M18 6L6 18" /></svg
              >
            </button>
          </div>
          <div class="mt-4 grid gap-0.5">
            <a class={calendarItemClass} href={webcalHref} data-calendar-subscribe
              >Subscribe — Apple Calendar</a
            >
            <a
              class={calendarItemClass}
              href={icsHref}
              download={`f1-${year}.ics`}
              data-calendar-download
            >Download .ics file</a>
            <div class="mt-1 min-w-0 border-t border-line pt-2">
              <button
                type="button"
                class:list={[calendarItemClass, "w-full cursor-pointer"]}
                data-calendar-copy={icsHref}
              >Copy calendar URL</button>
              <code
                class="block min-w-0 truncate px-3 pt-1.5 text-[0.72rem] text-ink-muted"
                title={icsHref}
              >{icsHref}</code>
            </div>
          </div>
        </dialog>
      </div>
```

要点：`hidden` 属性必须写在 `data-calendar-trigger` 之后（Task 2 的正则 `/data-calendar-trigger[^>]*hidden/` 依赖同一标签内先后顺序）。

- [ ] **Step 4: 静态校验**

```bash
pnpm -C /Users/hj/workspace/f1-box-ics-calendar --filter @f1-box/web exec astro check 2>&1 | tail -5
```

预期：无错误（若 `astro check` 不在此包内，用 `pnpm -C /Users/hj/workspace/f1-box-ics-calendar check`）。

---

### Task 4: client.ts 弹窗接线（green 之二）

**Files:**
- Modify: `apps/web/src/scripts/client.ts:66-78`（守卫结构）+ 新增 `enhanceCalendarDialog()`

- [ ] **Step 1: 替换守卫结构并新增函数**

把 `client.ts` 第 66-78 行：

```ts
let enhanced = false;

function enhancePage(): void {
  // document 级委托只需绑定一次；astro:page-load 后 DOM 已换但监听仍在
  if (enhanced) return;
  enhanced = true;
  enhanceRaceTabs();
  enhanceCalendarCopy();
}

enhancePage();
document.addEventListener("astro:page-load", enhancePage);
```

替换为：

```ts
function enhanceCalendarDialog(): void {
  const dialog =
    document.querySelector<HTMLDialogElement>("[data-calendar-dialog]");
  const trigger =
    document.querySelector<HTMLButtonElement>("[data-calendar-trigger]");
  if (!dialog || !trigger) return;
  // 有 JS 时升级为"触发按钮 + 弹窗"，无 JS 的内联降级行隐藏
  document.querySelector("[data-calendar-fallback]")?.setAttribute("hidden", "");
  trigger.hidden = false;
  trigger.addEventListener("click", () => dialog.showModal());
  dialog
    .querySelector("[data-calendar-close]")
    ?.addEventListener("click", () => dialog.close());
  // 点击落在弹窗自身（内边距区/遮罩回退目标）即关闭；内容区点击冒泡时 target 是子节点
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

let enhanced = false;

function enhancePage(): void {
  // document 级委托只需绑定一次；astro:page-load 后 DOM 已换但监听仍在
  if (!enhanced) {
    enhanced = true;
    enhanceRaceTabs();
    enhanceCalendarCopy();
  }
  // 弹窗是节点级接线，ClientRouter 换页后 DOM 全新，每次加载都要重跑
  enhanceCalendarDialog();
}

enhancePage();
document.addEventListener("astro:page-load", enhancePage);
```

注意：复制按钮的委托监听（`enhanceCalendarCopy`）天然覆盖弹窗内的 `[data-calendar-copy]`，不需要额外接线。

- [ ] **Step 2: 运行 e2e 确认转绿**

```bash
cd /Users/hj/workspace/f1-box-ics-calendar/apps/web && pnpm exec playwright test tests/e2e/season.spec.ts --grep @desktop
```

预期：全部 @desktop 用例通过（含两个新用例）。若"点击弹窗自身关闭"失败，先用浏览器开发者工具确认 `dialog.click` 的 position 落在内边距区而非内容节点。

---

### Task 5: 样式替换（green 之三）

**Files:**
- Modify: `apps/web/src/styles/components.css:69-81`（删 `.calendar-box*`）+ 在 `.button--text:hover` 规则之后插入新规则

- [ ] **Step 1: 删除旧 details 规则**

删除第 69-81 行整段（含注释）：

```css
  /* racing 页 Next 面板的日历订阅入口：details 原生开合保证无 JS 可用；
     面板外观走 utility 类（与 SeasonFilter 下拉一致），这里只处理 details 特有部分 */
  .calendar-box__summary {
    list-style: none;
    cursor: pointer;
  }
  .calendar-box__summary::-webkit-details-marker {
    display: none;
  }
  .calendar-box[open] > .calendar-box__summary {
    background: var(--highlight);
    color: var(--on-highlight);
  }
```

- [ ] **Step 2: 在 `.button--text:hover` 规则之后插入新规则**

```css
  /* 日历订阅入口：触发按钮收敛 .button 的大按钮尺寸，进统计行；
     弹窗用原生 <dialog> modal——焦点圈闭/Esc 关闭免费，样式只管外观与入场 */
  .calendar-entry-trigger {
    min-height: 0;
    gap: 0.5rem;
    padding: 0.1rem 0;
    font-size: 0.82rem;
  }
  .calendar-entry-trigger svg {
    width: 16px;
    height: 16px;
  }
  /* UA 的 [hidden]{display:none} 会被作者层 .button{display:inline-flex} 盖过，
     不显式兜底则无 JS 时按钮照常出现（死按钮） */
  .calendar-entry-trigger[hidden] {
    display: none;
  }
  .calendar-entry-fallback {
    margin-top: 0.6rem;
    font-size: 0.78rem;
    color: var(--ink-muted);
    overflow-wrap: anywhere;
  }
  .calendar-dialog {
    width: min(100vw - 2rem, 24rem);
    padding: 1.25rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface-overlay);
    color: var(--ink);
    box-shadow: var(--shadow-panel);
  }
  .calendar-dialog[open] {
    animation: calendar-dialog-in 150ms ease;
  }
  .calendar-dialog::backdrop {
    background: rgb(0 0 0 / 55%);
  }
  .calendar-dialog__close {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    color: var(--ink-muted);
    cursor: pointer;
    transition: color 150ms ease;
  }
  .calendar-dialog__close:hover {
    color: var(--highlight);
  }
  .calendar-dialog__close svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
  }
  @keyframes calendar-dialog-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .calendar-dialog[open] {
      animation: none;
    }
  }
```

说明：新规则必须位于 `@layer components { ... }` 内部、`.button`/`.button svg` 之后，保证紧凑覆写与 16px 图标尺寸生效。

---

### Task 6: 全套验证 + 浏览器双主题目检

**Files:** 无（验证）

- [ ] **Step 1: 静态与单测**

```bash
pnpm -C /Users/hj/workspace/f1-box-ics-calendar check
pnpm -C /Users/hj/workspace/f1-box-ics-calendar test
```

预期：0 错误；单测全过（约 212）。

- [ ] **Step 2: 构建与完整 e2e**

```bash
pnpm -C /Users/hj/workspace/f1-box-ics-calendar -r build
pnpm -C /Users/hj/workspace/f1-box-ics-calendar --filter @f1-box/web test:e2e
```

预期：构建成功；114+2 个 e2e 用例全绿（桌面 / 375px / reduced-motion / 双主题 axe 基线）。

- [ ] **Step 3: 启动 dev server 做浏览器目检**

用 Bash 工具的后台运行方式（run_in_background）执行，日志重定向到文件，不要加 `| head`（SIGPIPE 会杀掉 server）：

```bash
pnpm -C /Users/hj/workspace/f1-box-ics-calendar --filter @f1-box/web dev > /tmp/f1-ics-dev.log 2>&1
```

（启动后 `tail /tmp/f1-ics-dev.log` 确认出现 "Local" 地址。）

用 browser-use 依次验证：
1. 桌面深色：`/racing/2026` 头部统计行出现 "Add to calendar" 文字按钮（带日历图标），降级行不可见；点击打开弹窗，截图。
2. 切换亮色主题（`document.documentElement.dataset.theme` 或页面主题开关），重开弹窗截图；确认 `surface-overlay`/`line` 令牌下对比正常。
3. 375px 视口：打开/关闭弹窗（✕、Esc、点击内边距区）；确认页面无横向溢出。
4. 弹窗内点 Copy calendar URL：文案变 "Copied!"，2s 后还原。
5. ClientRouter 换页：从 `/racing/2026` 点赛季筛选进 `/racing/2025`（如 fixture 无 2025 则任意可导航页面往返），再开弹窗确认接线重跑成功。
6. 无 JS 形态：`curl http://localhost:4321/racing/2026 | grep data-calendar-fallback` 能看到内联行标记，且 `data-calendar-trigger` 带 `hidden`。

完成后 `kill %1`（或按端口杀进程）。

- [ ] **Step 4: 提交**

```bash
git -C /Users/hj/workspace/f1-box-ics-calendar add apps/web/src/pages/racing/\[year\].astro apps/web/src/scripts/client.ts apps/web/src/styles/components.css apps/web/tests/e2e/season.spec.ts
git -C /Users/hj/workspace/f1-box-ics-calendar commit -m "feat: move calendar entry to header button with native dialog"
```

---

### Task 7: 同步需求文档

**Files:**
- Modify: `docs/requirements/2026-08-26-ics-calendar.md`

- [ ] **Step 1: 更新用户可见行为第一条**

把：

```
- racing 页（/racing/2026）Next 面板内新增 "Add to calendar" 入口，点开后三个操作：
```

改为：

```
- racing 页（/racing/{year}）头部统计行提供 "Add to calendar" 按钮（所有赛季页一致可见，含无 Next 卡片的历史赛季），点击打开居中模态弹窗，三个操作：
```

三个子弹条（订阅/下载/复制）内容不变。把 `- 无 JS 可用（订阅/下载都是纯链接）` 改为：

```
- 无 JS 可用：头部显示内联 Subscribe / Download .ics / URL 文本行；有 JS 时升级为按钮 + 弹窗（原生 <dialog>，✕/Esc/遮罩三路径关闭）
```

- [ ] **Step 2: 更新验收标准 e2e 一条**

把：

```
- e2e：Next 面板日历入口存在、webcal 与 https 链接正确；ICS 端点 Content-Type 正确
```

改为：

```
- e2e：服务端 HTML 含无 JS 降级行且触发按钮带 hidden；有 JS 时头部按钮 → 弹窗内订阅/下载/复制链接正确、✕/Esc/遮罩三路径关闭；ICS 端点 Content-Type 正确
```

- [ ] **Step 3: 提交**

```bash
git -C /Users/hj/workspace/f1-box-ics-calendar add docs/requirements/2026-08-26-ics-calendar.md
git -C /Users/hj/workspace/f1-box-ics-calendar commit -m "docs: sync ics calendar requirement with header dialog entry"
```
