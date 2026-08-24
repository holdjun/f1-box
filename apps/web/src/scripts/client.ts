import { summarizeYears } from "../lib/season-summary.js";

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function enhanceLocalTimes(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-local-time]").forEach((element) => {
    const timestamp = element.dataset.timestamp;
    if (!timestamp) return;

    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return;

    element.textContent = `Your time · ${dateTimeFormatter.format(date)}`;
    element.hidden = false;
  });
}

// 详情页赛季筛选：触发器展开面板，点选年份/年代控制 data-season-block 显隐。
// document/window 级监听只注册一次（astro:page-load 后旧监听会残留累积），
// 触发时运行时查询当前 DOM，对页面上的 filter 实例都生效
let seasonFilterGlobalsBound = false;

function closeSeasonFilter(bar: HTMLElement): void {
  const trigger = bar.querySelector<HTMLElement>(
    "[data-season-filter-trigger]",
  );
  const panel = bar.querySelector<HTMLElement>("[data-season-filter-panel]");
  if (!panel) return;
  panel.hidden = true;
  panel.classList.remove("season-filter__panel--up");
  panel.style.maxHeight = "";
  trigger?.setAttribute("aria-expanded", "false");
}

function positionSeasonFilter(bar: HTMLElement): void {
  const trigger = bar.querySelector<HTMLElement>(
    "[data-season-filter-trigger]",
  );
  const panel = bar.querySelector<HTMLElement>("[data-season-filter-panel]");
  if (!trigger || !panel) return;
  // 触发器下方空间不足时向上展开，并限制高度避免溢出视口
  const triggerBox = trigger.getBoundingClientRect();
  const spaceBelow = window.innerHeight - triggerBox.bottom;
  const spaceAbove = triggerBox.top;
  const expandUp = spaceBelow < spaceAbove;
  panel.classList.toggle("season-filter__panel--up", expandUp);
  const available = expandUp ? spaceAbove : spaceBelow;
  panel.style.maxHeight = `${Math.max(Math.min(available - 16, 480), 160)}px`;
}

function bindSeasonFilterGlobals(): void {
  if (seasonFilterGlobalsBound) return;
  seasonFilterGlobalsBound = true;

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    document
      .querySelectorAll<HTMLElement>("[data-season-filter]")
      .forEach((bar) => {
        if (bar.dataset.enhanced !== "true") return;
        if (!bar.contains(target)) closeSeasonFilter(bar);
      });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document
      .querySelectorAll<HTMLElement>("[data-season-filter]")
      .forEach((bar) => {
        if (bar.dataset.enhanced !== "true") return;
        closeSeasonFilter(bar);
      });
  });
  // 滚动时跟随触发器重新定位（sticky 粘顶后方向可能变化），而非关闭
  let scrollTick = false;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTick) return;
      scrollTick = true;
      requestAnimationFrame(() => {
        document
          .querySelectorAll<HTMLElement>("[data-season-filter]")
          .forEach((bar) => {
            if (bar.dataset.enhanced !== "true") return;
            const panel = bar.querySelector<HTMLElement>(
              "[data-season-filter-panel]",
            );
            if (panel && !panel.hidden) positionSeasonFilter(bar);
          });
        scrollTick = false;
      });
    },
    { passive: true },
  );
}

function enhanceSeasonFilters(root: ParentNode = document): void {
  bindSeasonFilterGlobals();
  root.querySelectorAll<HTMLElement>("[data-season-filter]").forEach((bar) => {
    if (bar.dataset.enhanced === "true") return;
    bar.dataset.enhanced = "true";

    const trigger = bar.querySelector<HTMLElement>(
      "[data-season-filter-trigger]",
    );
    const panel = bar.querySelector<HTMLElement>("[data-season-filter-panel]");
    if (!trigger || !panel) return;

    const open = () => {
      panel.hidden = false;
      positionSeasonFilter(bar);
      trigger.setAttribute("aria-expanded", "true");
    };

    trigger.addEventListener("click", () => {
      if (panel.hidden) open();
      else closeSeasonFilter(bar);
    });

    // link 模式：面板内是 <a> 链接，点击即导航，无需额外交互
    if (bar.dataset.mode !== "toggle") return;

    const yearButtons = [
      ...panel.querySelectorAll<HTMLButtonElement>("[data-season-year]"),
    ];
    const decadeButtons = [
      ...panel.querySelectorAll<HTMLButtonElement>("[data-season-decade]"),
    ];
    const allButton = panel.querySelector<HTMLButtonElement>(
      "[data-season-filter-all]",
    );
    const summary = trigger.querySelector<HTMLElement>(
      "[data-season-filter-summary]",
    );
    const count = panel.querySelector<HTMLElement>(
      "[data-season-filter-count]",
    );
    const selected = new Set<number>(
      (bar.dataset.initialSelected ?? "").split(",").flatMap((part) => {
        const year = Number(part);
        return Number.isInteger(year) && year > 0 ? [year] : [];
      }),
    );

    const decadeOf = (year: number) => Math.floor(year / 10) * 10;
    const decadeYears = (decadeStart: number) =>
      yearButtons
        .filter(
          (button) =>
            decadeOf(Number(button.dataset.seasonYear)) === decadeStart,
        )
        .map((button) => Number(button.dataset.seasonYear));
    const decadeStartOf = (button: HTMLButtonElement) =>
      Number((button.dataset.seasonDecade ?? "").slice(0, 4));
    const isDecadeFullySelected = (button: HTMLButtonElement) => {
      const years = decadeYears(decadeStartOf(button));
      return years.length > 0 && years.every((year) => selected.has(year));
    };

    const sync = () => {
      const showingAll = selected.size === 0;
      for (const button of yearButtons) {
        const active = selected.has(Number(button.dataset.seasonYear));
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      }
      for (const decadeButton of decadeButtons) {
        decadeButton.classList.toggle(
          "is-active",
          isDecadeFullySelected(decadeButton),
        );
      }
      if (summary) summary.textContent = summarizeYears(selected);
      if (count) {
        count.textContent = showingAll
          ? "All seasons"
          : `${selected.size} selected`;
      }
      document
        .querySelectorAll<HTMLElement>("[data-season-block]")
        .forEach((block) => {
          block.hidden = showingAll
            ? false
            : !selected.has(Number(block.dataset.seasonBlock));
        });
      // 同步 URL：?year=1997,2007 让筛选状态可分享、刷新保持
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
    };

    for (const button of yearButtons) {
      button.addEventListener("click", () => {
        const year = Number(button.dataset.seasonYear);
        if (selected.has(year)) selected.delete(year);
        else selected.add(year);
        sync();
      });
    }

    for (const decadeButton of decadeButtons) {
      decadeButton.addEventListener("click", () => {
        const years = decadeYears(decadeStartOf(decadeButton));
        const allActive = isDecadeFullySelected(decadeButton);
        for (const year of years) {
          if (allActive) selected.delete(year);
          else selected.add(year);
        }
        sync();
      });
    }

    if (allButton) {
      allButton.addEventListener("click", () => {
        selected.clear();
        sync();
      });
    }
  });
}

// 比赛详情页各 tab 的表格已在服务端全部渲染；JS 可用时点击 tab 就地切换
// 面板并同步地址栏，省掉视图过渡与回页首。必须在捕获阶段拦截，
// 否则 ClientRouter 会先行接管链接做换页。无对应面板（如年份页的 tab）
// 或无 JS 时退化为正常导航
let raceTabsBound = false;

function enhanceRaceTabs(): void {
  if (raceTabsBound) return;
  raceTabsBound = true;

  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("[data-tab-anchor] a");
      if (!link) return;
      const key = link.pathname.split("/").pop() ?? "";
      const panel = document.querySelector<HTMLElement>(
        `[data-race-tab-panel="${key}"]`,
      );
      if (!panel) return;
      event.preventDefault();
      // 已完全接管这次点击，阻断 ClientRouter 等后续监听者
      event.stopPropagation();
      for (const el of document.querySelectorAll<HTMLElement>(
        "[data-race-tab-panel]",
      )) {
        el.hidden = el !== panel;
      }
      for (const el of document.querySelectorAll("[data-tab-anchor] a")) {
        if (el === link) el.setAttribute("aria-current", "page");
        else el.removeAttribute("aria-current");
      }
      history.replaceState(null, "", link.href);
    },
    true,
  );
}

function enhancePage(): void {
  enhanceLocalTimes();
  enhanceSeasonFilters();
  enhanceRaceTabs();
}

enhancePage();
document.addEventListener("astro:page-load", enhancePage);
