<script lang="ts">
  import { summarizeYears } from "../lib/season-summary.js";

  interface Props {
    years: number[];
    mode: "link" | "toggle";
    baseHref?: string;
    // link 模式的 href 模板，含 {year} 占位符（island props 不可传函数，替代 hrefFor）
    hrefPattern?: string;
    current?: number | null;
    label?: string;
    sticky?: boolean;
    initialSelected?: number[] | null;
    showAll?: boolean;
  }

  let {
    years,
    mode,
    baseHref = "",
    hrefPattern = "",
    current = null,
    label = "Season",
    sticky = false,
    initialSelected = null,
    showAll = mode === "link",
  }: Props = $props();

  interface DecadeGroup {
    label: string;
    years: number[];
  }

  // 年份按年代分组（1950s / …），年代与组内年份均降序（与原 .astro 组件一致）
  function groupDecades(years: number[]): DecadeGroup[] {
    const groups = new Map<number, number[]>();
    for (const year of years) {
      const decade = Math.floor(year / 10) * 10;
      const list = groups.get(decade) ?? [];
      list.push(year);
      groups.set(decade, list);
    }
    return [...groups.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([decade, list]) => ({
        label: `${decade}s`,
        years: list.sort((a, b) => b - a),
      }));
  }

  const decades = $derived(groupDecades(years));

  let open = $state(false);
  let expandingUp = $state(false);
  let selected = $state<Set<number>>(new Set());
  let triggerEl = $state<HTMLButtonElement>();
  let panelEl = $state<HTMLDivElement>();

  const summary = $derived(
    mode === "link"
      ? current === null
        ? "All seasons"
        : String(current)
      : summarizeYears([...selected]),
  );
  const countText = $derived(
    selected.size > 0 ? `${selected.size} selected` : "All seasons",
  );
  const isActive = (year: number): boolean =>
    mode === "link" ? current === year : selected.has(year);
  const hrefFor = (year: number): string =>
    hrefPattern !== ""
      ? hrefPattern.replace("{year}", String(year))
      : `${baseHref}?year=${year}`;

  const decadeOf = (year: number) => Math.floor(year / 10) * 10;
  const isDecadeFullySelected = (group: DecadeGroup): boolean =>
    group.years.length > 0 && group.years.every((year) => selected.has(year));

  function positionPanel(): void {
    if (!triggerEl || !panelEl) return;
    const triggerBox = triggerEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerBox.bottom;
    const spaceAbove = triggerBox.top;
    expandingUp = spaceBelow < spaceAbove;
    const available = expandingUp ? spaceAbove : spaceBelow;
    panelEl.style.maxHeight = `${Math.max(Math.min(available - 16, 480), 160)}px`;
  }

  function openPanel(): void {
    positionPanel();
    open = true;
    triggerEl?.setAttribute("aria-expanded", "true");
  }

  function closePanel(): void {
    open = false;
    triggerEl?.setAttribute("aria-expanded", "false");
  }

  // 外部点击（含滚动跟随重定位）监听只在面板展开期间注册，组件自洽，不依赖全局脚本
  $effect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelEl && !panelEl.contains(target) && !triggerEl?.contains(target)) {
        closePanel();
      }
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closePanel();
    };
    let scrollTick = false;
    const onScroll = () => {
      if (scrollTick || !open) return;
      scrollTick = true;
      requestAnimationFrame(() => {
        if (open) positionPanel();
        scrollTick = false;
      });
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeydown);
      window.removeEventListener("scroll", onScroll);
    };
  });

  // toggle 模式的筛选状态应用（跨组件 data-season-block 是唯一例外：
  // 目标元素在纯展示组件 SeasonMatrix 内，保留文档级查询）
  function applyFilter(): void {
    document
      .querySelectorAll<HTMLElement>("[data-season-block]")
      .forEach((block) => {
        block.hidden =
          selected.size === 0
            ? false
            : !selected.has(Number(block.dataset.seasonBlock));
      });
    try {
      const url = new URL(window.location.href);
      if (selected.size === 0) url.searchParams.delete("year");
      else {
        url.searchParams.set(
          "year",
          [...selected].sort((a, b) => a - b).join(","),
        );
      }
      window.history.replaceState(null, "", url);
    } catch {
      // window.location.href 恒为合法 URL，仅异常环境（jsdom 等）会走到这里
    }
  }

  function toggleYear(year: number): void {
    const next = new Set(selected);
    if (next.has(year)) next.delete(year);
    else next.add(year);
    selected = next;
    applyFilter();
  }

  function toggleDecade(group: DecadeGroup): void {
    const next = new Set(selected);
    if (isDecadeFullySelected(group)) {
      for (const year of group.years) next.delete(year);
    } else {
      for (const year of group.years) next.add(year);
    }
    selected = next;
    applyFilter();
  }

  function clearSelection(): void {
    selected = new Set();
    applyFilter();
  }

  // initialSelected 只在首次水合时建立（服务端渲染期 selected 恒空，
  // 避免在 SSR 阶段触碰 document）
  let initialised = false;
  $effect(() => {
    if (initialised) return;
    initialised = true;
    if (mode === "toggle" && initialSelected && initialSelected.length > 0) {
      selected = new Set(initialSelected);
      applyFilter();
    }
  });

  // preflight 把 button 光标重置为 default，交互按钮需补 cursor-pointer
  const itemClasses =
    "shrink-0 rounded-sm px-2.5 py-1.5 text-[0.78rem] tabular-nums text-ink-muted transition-colors";
  const itemHover = "hover:bg-surface-overlay hover:text-ink";
</script>

<div
  class={["season-filter relative mt-4 mb-5", { "season-filter--sticky": sticky }]}
  data-season-filter
  data-mode={mode}
  data-initial-selected={initialSelected?.join(",") ?? ""}
>
  <button
    type="button"
    bind:this={triggerEl}
    class="season-filter__trigger inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface-raised px-4 text-[0.72rem] font-semibold tracking-[0.09em] uppercase text-ink-strong transition-colors hover:border-ink-muted hover:text-ink"
    aria-expanded="false"
    aria-label={label}
    data-season-filter-trigger
    onclick={() => (open ? closePanel() : openPanel())}
  >
    <span class="season-filter__summary" data-season-filter-summary
      >{summary}</span
    >
    <svg
      class="season-filter__caret w-2.8 h-auto fill-none stroke-current stroke-[1.6] transition-transform duration-200"
      viewBox="0 0 12 8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M1 1l5 5 5-5"></path>
    </svg>
  </button>

  <div
    bind:this={panelEl}
    class={["season-filter__panel absolute left-0 top-[calc(100%+0.4rem)] z-20 w-[min(92vw,26rem)] min-w-64 overflow-y-auto rounded-md border border-line bg-surface-raised p-3 shadow-panel", { "season-filter__panel--up": expandingUp }]}
    data-season-filter-panel
    hidden={!open}
  >
    {#if mode !== "link" || showAll}
      <div class="season-filter__actions mb-3 flex items-center gap-2.5 border-b border-line pb-3">
        {#if mode === "link"}
          <a
            class={["season-filter__action", itemClasses, itemHover, "text-ink-strong", { "is-active": current === null }]}
            href={baseHref}
          >All seasons</a>
        {:else}
          <button
            type="button"
            class={["season-filter__action", itemClasses, itemHover, "cursor-pointer text-ink-strong"]}
            data-season-filter-all
            onclick={clearSelection}
          >All</button>
          <span
            class="season-filter__count ml-auto text-[0.7rem] text-ink-muted"
            data-season-filter-count
            >{countText}</span
          >
        {/if}
      </div>
    {/if}

    <div class="season-filter__groups">
      {#each decades as decade (decade.label)}
        <div class="season-filter__group grid grid-cols-[3.5rem_1fr] items-baseline gap-2 py-1.5">
          {#if mode === "toggle"}
            <button
              type="button"
              class={["season-filter__decade", itemClasses, itemHover, "cursor-pointer", { "is-active": isDecadeFullySelected(decade) }]}
              data-season-decade={decade.label}
              onclick={() => toggleDecade(decade)}
            >{decade.label}</button>
          {:else}
            <span class={["season-filter__decade", itemClasses]}
              >{decade.label}</span
            >
          {/if}
          <div class="season-filter__years flex flex-wrap gap-1">
            {#each decade.years as year (year)}
              {#if mode === "link"}
                <a
                  class={["season-filter__year", itemClasses, itemHover, { "is-active": current === year }]}
                  href={hrefFor(year)}
                  data-season-year={year}
                >{year}</a>
              {:else}
                <button
                  type="button"
                  class={["season-filter__year", itemClasses, itemHover, "cursor-pointer", { "is-active": isActive(year) }]}
                  data-season-year={year}
                  aria-pressed={isActive(year)}
                  onclick={() => toggleYear(year)}
                >{year}</button>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  /* 以下选择器依赖动态 class / aria 属性（class 数组、expandingUp、is-active），
     scoped 编译器无法静态识别会报 unused；类名本身带 season-filter__ 命名空间，
     用 :global 局部包裹与迁移前全局行为保持一致 */
  :global(.season-filter :is(.is-active, [aria-pressed="true"])) {
    background-color: var(--accent);
    color: var(--on-accent);
  }
  /* 顶部导航 sticky（min-h-16 / lg:min-h-18），粘顶位置需避开导航 */
  :global(.season-filter--sticky) { position: sticky; z-index: 5; top: 4.5rem; }
  @media (min-width: 61.25rem) { :global(.season-filter--sticky) { top: 5rem; } }
  :global(.season-filter__panel--up) { top: auto; bottom: calc(100% + 0.4rem); }
  :global(.season-filter__trigger[aria-expanded="true"]) :global(.season-filter__caret) { transform: rotate(180deg); }
</style>
