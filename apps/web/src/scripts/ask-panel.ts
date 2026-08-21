import { createSseAccumulator } from "../lib/ask/sse.js";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const conversation: Turn[] = [];
let controller: AbortController | null = null;

// transition:persist 保住 DOM；astro:page-load 首次加载与每次客户端导航后触发，
// setupAskPanel 用标志位防止重复绑定（模块本身每个完整加载只执行一次）
export function setupAskPanel(): void {
  const root = document.querySelector<HTMLElement>(".ask");
  if (!root || root.dataset.askBound === "true") return;
  root.dataset.askBound = "true";

  const trigger = root.querySelector<HTMLButtonElement>(".ask__trigger")!;
  const panel = root.querySelector<HTMLElement>(".ask__panel")!;
  const messages = root.querySelector<HTMLElement>(".ask__messages")!;
  const status = root.querySelector<HTMLElement>(".ask__status")!;
  const error = root.querySelector<HTMLElement>(".ask__error")!;
  const clear = root.querySelector<HTMLButtonElement>(".ask__clear")!;
  const close = root.querySelector<HTMLButtonElement>(".ask__close")!;
  const form = root.querySelector<HTMLFormElement>(".ask__form")!;
  const input = root.querySelector<HTMLTextAreaElement>(".ask__input")!;
  const send = root.querySelector<HTMLButtonElement>(".ask__send")!;
  const stop = root.querySelector<HTMLButtonElement>(".ask__stop")!;

  trigger.addEventListener("click", () => (panel.hidden ? openPanel() : closePanel()));
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
    if (event.key === "Enter" && !event.shiftKey) {
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
    messages.setAttribute("aria-busy", "true");
    const bubble = appendBubble("assistant");
    let answer = "";
    controller = new AbortController();

    // 失败时回滚这轮 user 消息并把问题放回输入框（保留问题、允许重试），
    // 否则数组里残留 user 结尾，下次发送会被服务端交替校验拒绝
    const rollback = () => {
      conversation.pop();
      userBubble.remove();
      input.value = text;
    };

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: conversation.slice(-9) }),
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
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of accumulator.push(decoder.decode(value, { stream: true }))) {
          if (event.event === "status") {
            status.hidden = false;
          } else if (event.event === "delta") {
            answer += (JSON.parse(event.data) as { text: string }).text;
            const stick = nearBottom();
            bubble.textContent = answer;
            if (stick) messages.scrollTop = messages.scrollHeight;
          } else if (event.event === "error") {
            showError("回答生成失败，请重试");
          }
        }
      }
      if (answer.length > 0) {
        conversation.push({ role: "assistant", content: answer });
        clear.hidden = false;
      } else {
        bubble.remove();
        rollback();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (answer.length > 0) {
          conversation.push({ role: "assistant", content: answer });
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
      stop.hidden = true;
      messages.setAttribute("aria-busy", "false");
      input.focus();
    }
  }
}

function trapFocus(event: KeyboardEvent, panel: HTMLElement): void {
  const focusable = panel.querySelectorAll<HTMLElement>(
    "button, textarea, [href], input, select",
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
