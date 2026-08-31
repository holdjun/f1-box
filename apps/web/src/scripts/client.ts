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
      // 透传现有 history.state：ClientRouter 靠它做 popstate 方向判断，
      // 传 null 会让浏览器后退被 Astro 忽略（页面无反应）
      history.replaceState(history.state, "", link.href);
    },
    true,
  );
}

function enhancePage(): void {
  enhanceRaceTabs();
}

enhancePage();
document.addEventListener("astro:page-load", enhancePage);
