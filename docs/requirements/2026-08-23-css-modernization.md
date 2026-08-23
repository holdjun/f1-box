# 样式架构现代化（Tailwind CSS v4）与视觉刷新

日期：2026-08-23
状态：开发中

## 背景与目标

现有样式是单一 `global.css`（1508 行）加 8 个组件内联 scoped 样式块；设计令牌只有颜色和字体两个变量族，没有字号、间距阶梯，页面里散落大量手写的 `clamp(...)` 魔法值；仅深色主题，无切换能力。样式难维护、难扩展，视觉表达缺少系统化地基。

本次引入 Tailwind CSS v4 重建样式架构，补齐双层令牌体系，新增加亮色主题与切换开关，并对全部页面做一轮视觉刷新；同时把 Astro 升到当前稳定版，让整个技术栈保持现代。保留现有设计基因（深色底色、condensed 大标题、赛车编辑感），不重做品牌。

## 用户可见行为

- 整体观感在现有设计基因上更现代：严格的字号/间距阶梯、清晰的表面层次、双主题完整的对比度、更克制的动效。
- 站点头部提供主题切换开关，深色（默认）与亮色主题可随时切换；选择记住在浏览器里，未选择时跟随系统偏好。
- 页面加载不出现主题闪烁（先渲染出错误主题再跳变）。
- 全部现有页面的内容、路由、交互行为不变。

## 验收标准

- 新行为先有失败测试：主题切换的 e2e（点击切换 → `data-theme` 翻转 → localStorage 持久 → 重载后保持）。
- 现有 6 个 e2e spec 全绿；`pnpm check`、`pnpm test`、`pnpm -r build` 全过。
- 旧 `global.css` 完全删除，不留双轨；组件样式全部走令牌/工具类，无硬编码颜色值。
- 双主题 × 桌面/375px 双视口，每页截图审阅无布局破坏；正文文本对比度达到 WCAG AA（≥ 4.5:1）。
- Tailwind v4 经 `@tailwindcss/vite` 接入；令牌在 `@theme` 单源定义，分原始层与语义层，组件只消费语义令牌。
- Astro 与 @astrojs/cloudflare 升级到当前稳定版（7.2.x / 14.2.x），构建与部署正常。
- 每个区域完成后由独立 review agent 审查通过，再继续下一区域。

## 范围外

- 不改数据层、API、路由、ingest 服务。
- 不引入 JS UI 框架（React 等）或第三方组件库。
- 不引入 pixel-diff 视觉回归基建。
- 不加第三种主题。
- 不换字体家族（保留 Barlow Condensed + Space Grotesk）。

## 技术方案摘要

- 依赖：`tailwindcss@4.3.x` + `@tailwindcss/vite@4.3.x`，在 `astro.config.mjs` 的 `vite.plugins` 注册；Astro 升级至 7.2.x、适配器至 14.2.x（同步更新 pnpm-workspace.yaml 的 minimumReleaseAgeExclude 条目）。
- 样式文件从单一 `global.css` 变为三个文件：`styles/theme.css`（@theme 令牌，单源）、`styles/base.css`（基础元素与全局效果）、`styles/components.css`（@layer components 组件类）。
- 令牌双层：原始层（oklch 色阶、字体、--text-* 字号阶梯、间距、断点、缓动）定义一次不直接使用；语义层（surface / ink / muted / border / accent / highlight 等）随 `html[data-theme]` 整套翻转，组件只用语义层。
- 双主题：默认深色；亮色靠语义变量翻转实现，个别场景（阴影强度、图片明暗）用 `@custom-variant` 定义的 `light:` 变体兜底。切换状态 = localStorage 偏好 > 系统偏好，BaseLayout 内联同步脚本防 FOUC，`theme-color` 同步。
- 组件纪律：标记以工具类为主，高频组合抽组件类；特效（斜线网格、描边巨型数字、切角）跟随组件、引用令牌；现有 8 个组件内联样式块随所属区域一并迁移。
- 区域切分（单分支单 PR，五个提交，每区一个独立 review 检查点）：基建与布局框架 → 首页 → results 区域 → 目录与详情页 → 收尾（404、AskPanel、删旧文件、文档）。
