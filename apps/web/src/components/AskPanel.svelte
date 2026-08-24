<script lang="ts">
  import { capStoredAnswer, windowForSend } from "../lib/ask/history.js";
  import type { AskMessage } from "../lib/ask/request.js";
  import { createSseAccumulator } from "../lib/ask/sse.js";
  import { onMount } from "svelte";

  // 对话与面板状态：本地 $state + sessionStorage 持久化（会话级）。
  // island 模块在每次页面导航都会重新执行（dev 与生产均如此），模块级状态
  // 不可靠；sessionStorage 跨导航保留、刷新清空，与原实现行为一致
  let messages = $state<AskMessage[]>([]);
  let openState = $state(false);
  // 流式中的回答文本：非 null 即渲染进行中的 assistant 气泡（不入 messages，
  // 完成后由 capStoredAnswer 收敛入列）；流式不跨导航，留组件局部
  let streamingText = $state<string | null>(null);
  let errorState = $state<string | null>(null);
  let inputValue = $state("");

  let triggerEl = $state<HTMLButtonElement>();
  let panelEl = $state<HTMLElement>();
  let messagesEl = $state<HTMLElement>();
  let inputEl = $state<HTMLTextAreaElement>();

  const streaming = $derived(streamingText !== null);

  // 导航期间的 popover 关闭（swap 前 light dismiss）不是用户操作，不得覆盖会话
  // 状态；window 级标志跨导航存活且只注册一次（island 模块每次导航重新执行）
  const navGuard = (): { isNavigating: () => boolean } => {
    const w = window as unknown as Record<string, unknown>;
    if (!w.__askNavGuard) {
      w.__askNavGuard = true;
      document.addEventListener("astro:before-swap", () => {
        w.__askNavigating = true;
      });
      document.addEventListener("astro:after-swap", () => {
        w.__askNavigating = false;
      });
    }
    return { isNavigating: () => w.__askNavigating === true };
  };

  let controller: AbortController | null = null;

  const bubbleClass = (role: AskMessage["role"]): string =>
    role === "user"
      ? "ask__bubble ask__bubble--user max-w-[86%] self-end rounded-md bg-accent px-3 py-2.5 leading-[1.55] whitespace-pre-wrap text-on-accent wrap-anywhere"
      : "ask__bubble ask__bubble--assistant max-w-[86%] self-start rounded-md border border-line bg-surface px-3 py-2.5 leading-[1.55] whitespace-pre-wrap text-ink wrap-anywhere";

  // 与 panel 相关的持久化 key；坏数据静默忽略，不回写
  const PERSIST_KEY = "f1-ask";

  function restorePersisted(): void {
    try {
      const raw = sessionStorage.getItem(PERSIST_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        messages: AskMessage[];
        open: boolean;
      };
      if (Array.isArray(data.messages)) messages = data.messages;
      if (data.open === true) openState = true;
    } catch {
      // 解析失败视为无历史
    }
  }

  function persistState(): void {
    try {
      sessionStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({ messages, open: openState }),
      );
    } catch {
      // 隐私模式等场景写不进，状态仅当次会话生效
    }
  }

  function closePanel(): void {
    panelEl?.hidePopover();
    // manual popover 无原生焦点恢复，显式还给 trigger
    triggerEl?.focus();
  }

  // 开合仍由原生 popover 触发（水合前也可用，点击不依赖 JS 时序）；面板
  // 可见性由 :popover-open 与 ask--open 双源驱动（见 style）。会话状态
  // （对话、面板开合）持久化在 sessionStorage：island 模块每次导航重新执行，
  // 新实例挂载时恢复显示
  onMount(() => {
    restorePersisted();
    const render = (): void => {
      const isOpen =
        openState || (panelEl?.matches(":popover-open") ?? false);
      panelEl?.classList.toggle("ask--open", isOpen);
      triggerEl?.setAttribute("aria-expanded", isOpen ? "true" : "false");
    };
    const onToggle = (event: Event): void => {
      // ClientRouter 导航会关闭当前 popover（swap 前的 light dismiss），
      // 这类 toggle 不视为用户操作，避免覆盖会话状态
      if (document.documentElement.hasAttribute("data-astro-transition")) {
        return;
      }
      const toggled = event as ToggleEvent;
      openState = toggled.newState === "open";
      persistState();
      render();
    };
    // 水合常晚于首次点击（popover 已开）：把实际打开状态只提升写入会话，
    // 导航后新实例才能恢复；水合时 popover 为关则不动已有会话状态
    if (panelEl?.matches(":popover-open")) {
      openState = true;
      persistState();
    }
    render();
    // 恢复会话中打开的面板：manual popover 的程序式显示不要求用户激活，
    // 直接把 popover 打回打开态，保持开合语义与其他交互一致
    if (openState && panelEl && !panelEl.matches(":popover-open")) {
      panelEl.showPopover();
      inputEl?.focus();
    }
    panelEl?.addEventListener("toggle", onToggle);
  });

  // 消息变更后自动持久化（流式文本独立不落盘）
  $effect(() => {
    if (messages.length > 0) persistState();
  });

  function scrollToBottomIfNear(): void {
    if (!messagesEl) return;
    const nearBottom =
      messagesEl.scrollTop + messagesEl.clientHeight >=
      messagesEl.scrollHeight - 48;
    if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showError(message: string): void {
    errorState = message;
  }

  async function ask(text: string): Promise<void> {
    messages = [...messages, { role: "user", content: text }];
    streamingText = "";
    controller = new AbortController();
    let answer = "";

    // 回答入库前 trim 再截断：服务端按 trim 后长度校验，纯空白轮次会让后续请求全部 400
    const finish = (): boolean => {
      const stored = capStoredAnswer(answer.trim());
      if (stored.length === 0) return false;
      messages = [...messages, { role: "assistant", content: stored }];
      return true;
    };
    // 失败/无内容时回滚本轮 user 消息；仅在输入框为空时把问题放回去，
    // 避免覆盖请求期间用户已键入的下一个问题
    const rollbackQuestion = (): void => {
      messages = messages.slice(0, -1);
      if (inputValue.trim().length === 0) inputValue = text;
    };

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: windowForSend(messages) }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        showError(
          response.status === 429
            ? "请求太频繁，请稍后再试"
            : "服务暂时不可用，请稍后重试",
        );
        rollbackQuestion();
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const accumulator = createSseAccumulator();
      let hadError = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of accumulator.push(
          decoder.decode(value, { stream: true }),
        )) {
          if (event.event === "delta") {
            try {
              answer += (JSON.parse(event.data) as { text: string }).text;
            } catch {
              // 单条数据损坏跳过，不打断后续事件
              continue;
            }
            streamingText = answer;
            scrollToBottomIfNear();
          } else if (event.event === "error") {
            hadError = true;
            // 文案以服务端为准（已脱敏）；解析失败退回通用提示
            let message = "";
            try {
              message =
                (JSON.parse(event.data) as { message?: string }).message ?? "";
            } catch {
              // 退回通用文案
            }
            showError(message.length > 0 ? message : "回答生成失败，请重试");
          }
        }
      }
      // 流出部分内容后失败：保留已有回答，把问题放回空输入框供重试
      if (finish()) {
        if (hadError && inputValue.trim().length === 0) inputValue = text;
      } else {
        rollbackQuestion();
      }
    } catch (err) {
      const aborted =
        err instanceof DOMException && err.name === "AbortError";
      if (aborted) {
        if (!finish()) rollbackQuestion();
      } else {
        showError("网络异常，请重试");
        rollbackQuestion();
      }
    } finally {
      controller = null;
      streamingText = null;
      inputEl?.focus();
    }
  }

  async function submit(): Promise<void> {
    const text = inputValue.trim();
    if (text.length === 0 || controller) return;
    inputValue = "";
    await ask(text);
  }

  function onInputKeydown(event: KeyboardEvent): void {
    // 输入法组词期的回车只确认候选词，否则拼音选词会直接把半成品文本发出去
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      closePanel();
      return;
    }
    if (event.key === "Tab") trapFocus(event);
  }

  function trapFocus(event: KeyboardEvent): void {
    if (!panelEl) return;
    // hidden/disabled 元素不可聚焦，计入它们会让 first/last 永远不等于 activeElement，
    // 焦点陷阱失效（与原实现一致）
    const focusable = panelEl.querySelectorAll<HTMLElement>(
      "button:not([hidden]):not(:disabled), textarea, [href], input, select",
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function clearHistory(): void {
    messages = [];
    errorState = null;
    streamingText = null;
    persistState();
  }
</script>

<div class="ask">
  <button
    type="button"
    bind:this={triggerEl}
    class="ask__trigger fixed right-4 bottom-4 z-40 grid size-12 cursor-pointer place-items-center rounded-md border border-line bg-surface-raised text-ink-strong shadow-panel transition-colors hover:text-ink light:shadow-panel"
    aria-expanded="false"
    aria-controls="ask-panel"
    aria-label="打开 F1 问答"
    popovertarget="ask-panel"
  >
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M12 3a8 8 0 0 1 8 8 8 8 0 0 1-8 8 8 8 0 0 1-3.4-.76L5 20l.9-3.2A8 8 0 0 1 12 3Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <path
        d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.24c-.72.38-1.2.9-1.2 1.86"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
      <circle cx="12" cy="16.4" r="1" fill="currentColor" />
    </svg>
  </button>
  <!-- 375px 视口下面板铺满全屏 (e2e 断言), md 起收回右下角浮层；
       popover 原生开合（UA 默认 margin:auto 居中，需 m-0 重置） -->
  <section
    bind:this={panelEl}
    class="ask__panel fixed inset-0 z-40 m-0 flex w-full flex-col bg-surface-raised md:inset-auto md:right-4 md:bottom-20 md:h-[35rem] md:max-h-[70svh] md:w-96 md:rounded-md md:border md:border-line md:shadow-panel md:light:shadow-panel"
    id="ask-panel"
    role="dialog"
    aria-label="F1 问答"
    tabindex="-1"
    popover="manual"
    onkeydown={onPanelKeydown}
  >
    <header class="ask__head flex items-center gap-2 border-b border-line px-3.5 py-3">
      <h2 class="ask__title font-display text-lg tracking-[0.04em]">F1 问答</h2>
      <p class="ask__note flex-1 text-[11px] text-ink-muted">
        统计数据：f1db（CC BY 4.0，非实时）
      </p>
      <button
        class="ask__clear min-h-11 min-w-11 cursor-pointer rounded-sm px-2 text-xs font-semibold tracking-wider uppercase text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
        type="button"
        hidden={messages.length === 0}
        disabled={streaming}
        onclick={clearHistory}
      >
        清空
      </button>
      <button
        class="ask__close grid min-h-11 min-w-11 cursor-pointer place-items-center rounded-sm text-ink-muted transition-colors hover:text-ink"
        type="button"
        aria-label="关闭问答面板"
        popovertarget="ask-panel"
      >
        ✕
      </button>
    </header>
    <div
      bind:this={messagesEl}
      class="ask__messages flex flex-1 flex-col gap-2.5 overflow-y-auto p-3.5"
      aria-live="polite"
      aria-busy={streaming}
    >
      {#each messages as message, i (i)}
        <div class={bubbleClass(message.role)}>{message.content}</div>
      {/each}
      {#if streamingText !== null}
        <div class={bubbleClass("assistant")}>{streamingText}</div>
      {/if}
    </div>
    <p class="ask__status px-3.5 py-1.5 text-[13px] text-ink-muted" hidden={!streaming}
      >正在查询数据…</p
    >
    <p class="ask__error px-3.5 py-1.5 text-[13px] text-accent" role="alert" hidden={errorState === null}
      >{errorState}</p
    >
    <form
      class="ask__form flex gap-2 border-t border-line p-3"
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        bind:this={inputEl}
        bind:value={inputValue}
        class="ask__input min-h-11 flex-1 resize-none rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-ink-muted"
        rows="1"
        placeholder="问点什么，如：汉密尔顿哪几年夺冠？"
        maxlength="2000"
        autofocus
        onkeydown={onInputKeydown}
      ></textarea>
      <button
        class="ask__send min-h-11 cursor-pointer rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-highlight hover:text-on-highlight disabled:opacity-50"
        type="submit"
        disabled={streaming}
      >
        发送
      </button>
      <button
        class="ask__stop min-h-11 cursor-pointer rounded-sm border border-accent px-4 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-on-accent"
        type="button"
        hidden={!streaming}
        onclick={() => controller?.abort()}
      >
        停止
      </button>
    </form>
  </section>
</div>

<style>
  /* 可见性双源：popover 原生打开（水合前）或组件 open 状态（水合后/跨导航持久）；
     flex 在类里恒有，必须在此显式覆盖关闭态 */
  .ask__panel {
    display: none;
  }
  .ask__panel:popover-open,
  .ask__panel.ask--open {
    display: flex;
  }
</style>