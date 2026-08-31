# Racing 页日历入口重设计：头部按钮 + 模态弹窗

日期：2026-08-31
状态：已确认，待实施
关联：`docs/requirements/2026-08-26-ics-calendar.md`

## 背景

ICS 日历功能首版把入口做成 Next 卡片内的 `<details>` 下拉：面板 `absolute bottom-3` 向上展开，实测在 <768px 视口完全盖住触发按钮（`elementFromPoint` 命中面板菜单项），且 `<details>` 无点外部关闭——菜单一旦打开就收不起来。桌面端虽可关闭，面板也会遮挡 Next 卡片的站名、倒计时与 View weekend 按钮。

更根本的问题：入口挂在 Next 卡片上，而历史赛季（无未完赛站）没有 Next 卡片，订阅入口整站消失。订阅是赛季级动作，语义上属于页面头部，而不是某一场比赛的卡片。

## 已确认的决策

1. 弹窗形态：居中模态弹窗（原生 `<dialog>`）。用户在三方案对比（锚定浮出菜单 / 居中模态 / 底部抽屉）中选定。
2. 入口位置：头部统计行（"{year} rounds · N completed" 旁）。所有赛季页一致可见。
3. 保留无 JS 可用性：与原需求文档承诺一致，有 JS 时升级为"按钮 + 弹窗"。

## 设计

### 触发按钮

- Next 卡片恢复原样：只留 View weekend，删除 details/面板标记与卡片的 `relative`。
- 头部统计行（`[year].astro` 左列，原 `<p>`）改为 flex 容器：左侧保留轮次/完成数文字，右侧放触发按钮。
- 按钮风格：`button button--text`（项目既有三级按钮语言：下划线、hover 转 highlight），追加紧凑化覆写（`min-height`、`padding`、`font-size` 收敛，区别于 48px 高的大按钮），内联 16px 日历描边 SVG，复用 `.button svg` 的 currentColor 描边约定。
- 初始带 `hidden` 属性，仅在有 JS 时由增强脚本显示（见降级一节）。

### 模态弹窗

- 服务端渲染 `<dialog class="calendar-dialog" data-calendar-dialog aria-labelledby="calendar-dialog-title">`，位置紧跟头部触发按钮。
- 内容沿用现版三项操作，完整行样式复用现有 `calendarItemClass` hover 语言：
  - Subscribe — Apple Calendar（`webcal://`，`data-calendar-subscribe`）
  - Download .ics file（https + `download` 属性，`data-calendar-download`）
  - 分隔线下：Copy calendar URL 按钮（`data-calendar-copy`）+ 一行浅色提示（Google/Outlook 无一键订阅深链，指引用户粘贴到"从网址添加"）
- 标题：`Add F1 {year} to your calendar`，`h2` + `aria-labelledby` 关联。
- 右上角 ✕ 关闭按钮（`data-calendar-close`，`aria-label="Close"`）。
- 样式令牌：`bg-surface-overlay`、`border border-line`、`shadow-panel`、圆角、`max-w-sm`；`::backdrop` 半透明黑（双主题通用）。
- 打开动画：约 150ms 淡入 + 轻微上浮，`prefers-reduced-motion: reduce` 下禁用。
- 关闭三路径：✕ 按钮、Esc（`<dialog>` 原生）、点击遮罩（`click` 事件判 `event.target === dialog`）。
- 焦点：`showModal()` 原生提供焦点圈闭与关闭后归还，不写额外焦点管理代码。

### 无 JS 降级

- 服务端在触发按钮旁额外渲染一行紧凑内联链接：Subscribe · Download .ics + 可选中复制的 URL 文本（`<code>`）。
- 无 JS：内联行可见可用（订阅/下载是纯链接；URL 文本可手动选中），触发按钮因 `hidden` 不出现。
- 有 JS：增强脚本隐藏内联行、移除触发按钮的 `hidden`、接线弹窗。
- 内联行与弹窗内容是两份静态标记：前者是紧凑一行的降级形态，后者是完整交互形态，用途不同。

### client.ts 结构

- 委托型监听（race tabs、copy）维持现状：document 级、只绑一次（`enhanced` 守卫）。copy 的委托监听天然覆盖弹窗内的复制按钮。
- 弹窗是节点级接线（查节点、移属性、绑监听），ClientRouter 换页后 DOM 全新，必须每次页面加载重跑：`enhanceCalendarDialog()` 不进 `enhanced` 守卫，由模块顶层与 `astro:page-load` 各调用；目标节点缺失时静默返回。
- 现有 `raceTabsBound`→`enhanced` 的统一守卫逻辑保留，仅调整为"委托绑定一次 + 节点接线每次"两段。

## 涉及文件

- `apps/web/src/pages/racing/[year].astro`：头部统计行改造、删 Next 卡片内 details、新增触发按钮 + 内联降级行 + `<dialog>` 标记。
- `apps/web/src/scripts/client.ts`：`enhanceCalendarDialog()` 与守卫结构调整。
- `apps/web/src/styles/components.css`：删 `.calendar-box*` 规则，增 `.calendar-dialog` 与触发按钮紧凑覆写、`::backdrop`、打开动画与 reduced-motion 处理。
- `apps/web/tests/e2e/season.spec.ts`：把"Next 面板日历入口"用例改写为"头部按钮 → 弹窗内链接断言 → Esc 关闭"；`/api/calendar.ics` 端点用例不变。
- `docs/requirements/2026-08-26-ics-calendar.md`：同步入口位置、交互形态与验收标准描述。

## 验证

- `pnpm check`、`pnpm test`、`pnpm -r build`、完整 `pnpm --filter @f1-box/web test:e2e` 全绿。
- 浏览器实测：桌面与 375px 下打开/关闭（✕、Esc、遮罩点击）；深/亮双主题截图目检；axe 可访问性基线（e2e a11y.spec.ts）不回归。
- 无 JS 降级：检查服务端 HTML 中内联行可见、触发按钮隐藏（可在 e2e 用禁用 JS 上下文补充，实施时视成本决定）。

## 范围外

- 底部抽屉、锚定浮出菜单等其他弹窗形态。
- 弹窗内新增操作（提醒设置、其他日历服务一键链接）。
- ICS 端点本身（`/api/calendar.ics` 及其生成器不改）。
