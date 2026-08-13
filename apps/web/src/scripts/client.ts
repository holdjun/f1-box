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

function enhanceCountdowns(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-countdown]").forEach((element) => {
    if (element.dataset.enhanced === "true") return;

    const target = Date.parse(element.dataset.target ?? "");
    if (!Number.isFinite(target)) return;
    element.dataset.enhanced = "true";

    const countdown = element.querySelector<HTMLElement>(".countdown");
    const passed = element.querySelector<HTMLElement>("[data-countdown-passed]");
    let timer: number | undefined;

    const update = () => {
      const remaining = Math.max(target - Date.now(), 0);
      const values = {
        days: Math.floor(remaining / 86_400_000),
        hours: Math.floor((remaining % 86_400_000) / 3_600_000),
        minutes: Math.floor((remaining % 3_600_000) / 60_000),
        seconds: Math.floor((remaining % 60_000) / 1_000),
      };

      for (const [unit, value] of Object.entries(values)) {
        const output = element.querySelector<HTMLElement>(`[data-countdown-unit="${unit}"]`);
        if (output) output.textContent = String(value).padStart(2, "0");
      }

      const hasPassed = remaining === 0;
      if (countdown) countdown.hidden = hasPassed;
      if (passed) passed.hidden = !hasPassed;
      if (hasPassed && timer !== undefined) window.clearInterval(timer);
    };

    update();
    if (target > Date.now()) timer = window.setInterval(update, 1_000);
  });
}

function enhanceRails(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(".season-rail").forEach((rail) => {
    if (rail.dataset.enhanced === "true") return;
    rail.dataset.enhanced = "true";
    rail.addEventListener("focusin", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target !== rail) {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  });
}

// 把选中年份压缩为区间摘要：1990–2000, 2007
function summarizeYears(selected: Set<number>): string {
  if (selected.size === 0) return "All seasons";
  const years = [...selected].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = years[0];
  let prev = years[0];
  for (let i = 1; i < years.length; i++) {
    if (years[i] === prev + 1) {
      prev = years[i];
    } else {
      ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = years[i];
      prev = years[i];
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
  return ranges.join(", ");
}

// 详情页赛季筛选：触发器展开面板，点选年份/年代控制 data-season-block 显隐
function enhanceSeasonFilters(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-season-filter]").forEach((bar) => {
    if (bar.dataset.enhanced === "true") return;
    bar.dataset.enhanced = "true";

    const trigger = bar.querySelector<HTMLElement>(
      "[data-season-filter-trigger]",
    );
    const panel = bar.querySelector<HTMLElement>(
      "[data-season-filter-panel]",
    );
    if (!trigger || !panel) return;

    // 触发器下方空间不足时向上展开，并限制高度避免溢出视口
    const positionPanel = () => {
      const triggerBox = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - triggerBox.bottom;
      const spaceAbove = triggerBox.top;
      const expandUp = spaceBelow < spaceAbove;
      panel.classList.toggle("season-filter__panel--up", expandUp);
      const available = expandUp ? spaceAbove : spaceBelow;
      panel.style.maxHeight = `${Math.max(Math.min(available - 16, 480), 160)}px`;
    };
    const open = () => {
      panel.hidden = false;
      positionPanel();
      trigger.setAttribute("aria-expanded", "true");
    };
    const close = () => {
      panel.hidden = true;
      panel.classList.remove("season-filter__panel--up");
      panel.style.maxHeight = "";
      trigger.setAttribute("aria-expanded", "false");
    };

    trigger.addEventListener("click", () => {
      if (panel.hidden) open();
      else close();
    });
    document.addEventListener("click", (event) => {
      if (panel.hidden) return;
      if (event.target instanceof Node && !bar.contains(event.target)) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) close();
    });
    // 滚动时跟随触发器重新定位（sticky 粘顶后方向可能变化），而非关闭
    let scrollTick = false;
    window.addEventListener(
      "scroll",
      () => {
        if (panel.hidden || scrollTick) return;
        scrollTick = true;
        requestAnimationFrame(() => {
          positionPanel();
          scrollTick = false;
        });
      },
      { passive: true },
    );

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
    const selected = new Set<number>();

    const decadeOf = (year: number) => Math.floor(year / 10) * 10;
    const yearButtonsInDecade = (decadeStart: number) =>
      yearButtons.filter((button) => {
        const year = Number(button.dataset.seasonYear);
        return decadeOf(year) === decadeStart;
      });

    const sync = () => {
      const showingAll = selected.size === 0;
      for (const button of yearButtons) {
        const active = selected.has(Number(button.dataset.seasonYear));
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      }
      for (const decadeButton of decadeButtons) {
        const label = decadeButton.dataset.seasonDecade ?? "";
        const decadeStart = Number(label.slice(0, 4));
        const inDecade = yearButtonsInDecade(decadeStart);
        const allActive =
          inDecade.length > 0 &&
          inDecade.every((button) =>
            selected.has(Number(button.dataset.seasonYear)),
          );
        decadeButton.classList.toggle("is-active", allActive);
      }
      if (summary) summary.textContent = summarizeYears(selected);
      if (count) {
        count.textContent = showingAll ? "All seasons" : `${selected.size} selected`;
      }
      document
        .querySelectorAll<HTMLElement>("[data-season-block]")
        .forEach((block) => {
          block.hidden = showingAll
            ? false
            : !selected.has(Number(block.dataset.seasonBlock));
        });
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
        const label = decadeButton.dataset.seasonDecade ?? "";
        const decadeStart = Number(label.slice(0, 4));
        const inDecade = yearButtonsInDecade(decadeStart);
        const allActive =
          inDecade.length > 0 &&
          inDecade.every((button) =>
            selected.has(Number(button.dataset.seasonYear)),
          );
        for (const button of inDecade) {
          const year = Number(button.dataset.seasonYear);
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

function enhancePage(): void {
  enhanceLocalTimes();
  enhanceCountdowns();
  enhanceRails();
  enhanceSeasonFilters();
}

enhancePage();
document.addEventListener("astro:page-load", enhancePage);
