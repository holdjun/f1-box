import { capStoredAnswer, windowForSend } from "../lib/ask/history.js";
import type { AskMessage } from "../lib/ask/request.js";
import { createSseAccumulator } from "../lib/ask/sse.js";

const conversation: AskMessage[] = [];
let controller: AbortController | null = null;

// 标记类与组件同源，正常渲染下必然齐备；缺一即视为结构异常，不绑定。
// 收敛进独立函数返回定型对象：内部 function 声明会提升，外层守卫的
// 收窄对它们不可见，必须让变量声明类型本身非空
function queryAskElements(root: HTMLElement) {
  const trigger = root.querySelector<HTMLButtonElement>(".ask__trigger");
  const panel = root.querySelector<HTMLElement>(".ask__panel");
  const messages = root.querySelector<HTMLElement>(".ask__messages");
  const status = root.querySelector<HTMLElement>(".ask__status");
  const error = root.querySelector<HTMLElement>(".ask__error");
  const clear = root.querySelector<HTMLButtonElement>(".ask__clear");
  const close = root.querySelector<HTMLButtonElement>(".ask__close");
  const form = root.querySelector<HTMLFormElement>(".ask__form");
  const input = root.querySelector<HTMLTextAreaElement>(".ask__input");
  const send = root.querySelector<HTMLButtonElement>(".ask__send");
  const stop = root.querySelector<HTMLButtonElement>(".ask__stop");
  if (
    !trigger ||
    !panel ||
    !messages ||
    !status ||
    !error ||
    !clear ||
    !close ||
    !form ||
    !input ||
    !send ||
    !stop
  ) {
    return null;
  }
  return {
    trigger,
    panel,
    messages,
    status,
    error,
    clear,
    close,
    form,
    input,
    send,
    stop,
  };
}

// transition:persist 保住 DOM；astro:page-load 首次加载与每次客户端导航后触发，
// setupAskPanel 用标志位防止重复绑定（模块本身每个完整加载只执行一次）
export function setupAskPanel(): void {
  const root = document.querySelector<HTMLElement>(".ask");
  if (!root || root.dataset.askBound === "true") return;
  root.dataset.askBound = "true";

  const els = queryAskElements(root);
  if (!els) return;
  const {
    trigger,
    panel,
    messages,
    status,
    error,
    clear,
    close,
    form,
    input,
    send,
    stop,
  } = els;

  trigger.addEventListener("click", () =>
    panel.hidden ? openPanel() : closePanel(),
  );
  close.addEventListener("click", closePanel);
  clear.addEventListener("click", () => {
    conversation.length = 0;
    messages.replaceChildren();
    clear.hidden = true;
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePanel();
      return;
    }
    if (event.key === "Tab") trapFocus(event, panel);
  });
  input.addEventListener("keydown", (event) => {
    // 输入法组词期的回车只确认候选词，否则拼音选词会直接把半成品文本发出去
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text.length === 0 || controller) return;
    input.value = "";
    void ask(text);
  });
  stop.addEventListener("click", () => controller?.abort());

  function openPanel(): void {
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    input.focus();
  }

  function closePanel(): void {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus();
  }

  function appendBubble(role: "user" | "assistant"): HTMLElement {
    const bubble = document.createElement("div");
    bubble.className = `ask__bubble ask__bubble--${role}`;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function nearBottom(): boolean {
    return (
      messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 48
    );
  }

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = false;
  }

  async function ask(text: string): Promise<void> {
    conversation.push({ role: "user", content: text });
    const userBubble = appendBubble("user");
    userBubble.textContent = text;
    error.hidden = true;
    status.hidden = false;
    send.disabled = true;
    stop.hidden = false;
    // 请求进行中禁止清空：否则流式回答会落进空会话，角色交替被服务端永久拒绝
    clear.disabled = true;
    messages.setAttribute("aria-busy", "true");
    const bubble = appendBubble("assistant");
    let answer = "";
    controller = new AbortController();

    // 失败时回滚这轮 user 消息；仅在输入框为空时把问题放回去，
    // 避免覆盖请求期间用户已键入的下一个问题
    const rollback = () => {
      conversation.pop();
      userBubble.remove();
      if (input.value.trim().length === 0) input.value = text;
    };

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: windowForSend(conversation) }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        showError(
          response.status === 429
            ? "请求太频繁，请稍后再试"
            : "服务暂时不可用，请稍后重试",
        );
        bubble.remove();
        rollback();
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
            let text = "";
            try {
              text = (JSON.parse(event.data) as { text: string }).text;
            } catch {
              // 单条数据损坏跳过，不打断后续事件
              continue;
            }
            answer += text;
            const stick = nearBottom();
            bubble.textContent = answer;
            if (stick) messages.scrollTop = messages.scrollHeight;
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
      // 入库前 trim 再截断：服务端按 trim 后长度校验，纯空白轮次会让后续请求全部 400
      const stored = capStoredAnswer(answer.trim());
      if (stored.length > 0) {
        conversation.push({ role: "assistant", content: stored });
        clear.hidden = false;
        // 流出部分内容后失败：保留已有回答，把问题放回空输入框供重试
        if (hadError && input.value.trim().length === 0) input.value = text;
      } else {
        bubble.remove();
        rollback();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        const stored = capStoredAnswer(answer.trim());
        if (stored.length > 0) {
          conversation.push({ role: "assistant", content: stored });
          clear.hidden = false;
        } else {
          bubble.remove();
          rollback();
        }
      } else {
        showError("网络异常，请重试");
        bubble.remove();
        rollback();
      }
    } finally {
      controller = null;
      status.hidden = true;
      send.disabled = false;
      clear.disabled = false;
      stop.hidden = true;
      messages.setAttribute("aria-busy", "false");
      input.focus();
    }
  }
}

function trapFocus(event: KeyboardEvent, panel: HTMLElement): void {
  // hidden/disabled 元素不可聚焦，计入它们会让 first/last 永远不等于 activeElement，焦点陷阱失效
  const focusable = panel.querySelectorAll<HTMLElement>(
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

document.addEventListener("astro:page-load", () => setupAskPanel());
