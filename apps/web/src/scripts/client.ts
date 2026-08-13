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

// 详情页赛季筛选：空集 = 全部显示；选中集合则只显示对应 data-season-block
function enhanceSeasonFilters(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-season-filter]").forEach((bar) => {
    if (bar.dataset.enhanced === "true") return;
    bar.dataset.enhanced = "true";

    const buttons = [
      ...bar.querySelectorAll<HTMLButtonElement>("[data-season-year]"),
    ];
    const selected = new Set<number>();

    const sync = () => {
      const showingAll = selected.size === 0;
      for (const button of buttons) {
        const year = button.dataset.seasonYear;
        const active = year === "all" ? showingAll : selected.has(Number(year));
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      }
      document
        .querySelectorAll<HTMLElement>("[data-season-block]")
        .forEach((block) => {
          block.hidden = showingAll
            ? false
            : !selected.has(Number(block.dataset.seasonBlock));
        });
    };

    for (const button of buttons) {
      button.addEventListener("click", () => {
        const value = button.dataset.seasonYear;
        if (value === "all") {
          selected.clear();
        } else {
          const year = Number(value);
          if (selected.has(year)) selected.delete(year);
          else selected.add(year);
        }
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
