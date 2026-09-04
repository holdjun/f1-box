import { formatWeekdayTime } from "../lib/time.js";

// 比赛详情页各 tab 的表格已在服务端全部渲染；JS 可用时点击 tab 就地切换
// 面板并同步地址栏，省掉视图过渡与回页首。必须在捕获阶段拦截，
// 否则 ClientRouter 会先行接管链接做换页。无对应面板（如年份页的 tab）
// 或无 JS 时退化为正常导航
function enhanceRaceTabs(): void {
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

function enhanceCalendarCopy(): void {
  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("[data-calendar-copy]");
    if (!button) return;
    const url = button.dataset.calendarCopy ?? "";
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return; // 剪贴板不可用时保持原文案，URL 文本仍可手动复制
    }
    // 原文案存 dataset：连点时 textContent 已是反馈文案，直接读会把它当原文案永久卡住
    let label = button.dataset.copyLabel;
    if (label === undefined) {
      label = button.textContent ?? "";
      button.dataset.copyLabel = label;
    }
    button.textContent = "Copied!";
    setTimeout(() => {
      button.textContent = label;
    }, 2000);
  });
}

function enhanceCalendarDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>(
    "[data-calendar-dialog]",
  );
  const trigger = document.querySelector<HTMLButtonElement>(
    "[data-calendar-trigger]",
  );
  // 初次加载时模块顶层调用与 ClientRouter 首次 astro:page-load 都会跑，幂等标记防重复接线
  if (!dialog || !trigger || dialog.dataset.calendarWired) return;
  dialog.dataset.calendarWired = "true";
  // 有 JS 时升级为"触发按钮 + 弹窗"，无 JS 的内联降级行隐藏
  document
    .querySelector("[data-calendar-fallback]")
    ?.setAttribute("hidden", "");
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

function applyLocalTimes(): void {
  // My time 只能在客户端算：SSR 无从得知浏览器时区。内容相同的内联模块脚本
  // ClientRouter 只执行一次，所以这段一次性变换必须挂在每次 page-load 上
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const el of document.querySelectorAll<HTMLTimeElement>(
    "[data-my-time]",
  )) {
    el.textContent = formatWeekdayTime(el.dateTime, zone);
    // 整行（含 My 标签）隐在父节点上：无 JS 时不能只留一个孤零零的标签
    const row = el.parentElement;
    if (row) row.hidden = false;
  }
}

function enhancePage(): void {
  // document 级委托只需绑定一次；astro:page-load 后 DOM 已换但监听仍在
  if (!enhanced) {
    enhanced = true;
    enhanceRaceTabs();
    enhanceCalendarCopy();
  }
  // 弹窗是节点级接线，ClientRouter 换页后 DOM 全新，每次加载都要重跑
  enhanceCalendarDialog();
  applyLocalTimes();
}

enhancePage();
document.addEventListener("astro:page-load", enhancePage);
