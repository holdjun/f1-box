<script lang="ts">
  import { onMount } from "svelte";

  // meta theme-color 深亮值 = theme.css 的 --surface 令牌；两个静态字面量之一
  // （BaseLayout 内联脚本为另一处），browser chrome 常量读不了 CSS 变量，
  // 保持现状避免 getComputedStyle 的样式表时序依赖
  const THEME_COLORS = { dark: "#0b0d10", light: "#f3f0e9" } as const;

  // document 在 SSR 环境（cloudflare worker）不存在，初始只能按深色安全渲染；
  // 水合后由 onMount 从实际 data-theme 同步（localStorage 记忆的主题也可能非默认）
  let isLight = $state(false);

  onMount(() => {
    isLight = document.documentElement.dataset.theme === "light";
  });

  function toggle(): void {
    const next = isLight ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("f1-theme", next);
    } catch {
      // 隐私模式等场景写不进，主题仍在当次会话生效
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", THEME_COLORS[next]);
    isLight = next === "light";
  }
</script>

<!-- 图标显隐由 base.css 按 html[data-theme] 纯 CSS 驱动，组件只维护 aria 状态 -->
<button
  type="button"
  data-theme-toggle
  aria-pressed={isLight}
  aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
  class="grid size-10 shrink-0 place-items-center rounded-md border border-line text-ink-strong transition-colors hover:border-ink-muted hover:text-ink"
  onclick={toggle}
>
  <svg class="icon-to-light size-4.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <circle cx="8" cy="8" r="3.25" />
    <path d="M8 1.5v1.75M8 12.75v1.75M1.5 8h1.75M12.75 8h1.75M3.4 3.4l1.25 1.25M11.35 11.35l1.25 1.25M12.6 3.4l-1.25 1.25M4.65 11.35l-1.25 1.25" />
  </svg>
  <svg class="icon-to-dark size-4.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
  </svg>
</button>
