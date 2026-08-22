import { MAX_CONTENT_CHARS, MAX_MESSAGES, MAX_TOTAL_CHARS } from "./request.js";

export interface AskTurn {
  role: "user" | "assistant";
  content: string;
}

// 服务端对每条消息与对话总长都有硬校验（见 request.ts）：回答原样入库会让一次
// 长回答把后续所有请求打成 400，入库与发送前必须先收敛到上限内
export function capStoredAnswer(answer: string): string {
  return answer.slice(0, MAX_CONTENT_CHARS);
}

export function windowForSend(conversation: AskTurn[]): AskTurn[] {
  let window = conversation.slice(-MAX_MESSAGES);
  const totalChars = (turns: AskTurn[]) =>
    turns.reduce((sum, turn) => sum + turn.content.length, 0);
  // 按 user+assistant 成对丢弃最旧轮次，保证窗口仍以 user 开头、交替不乱
  while (window.length > 1 && totalChars(window) > MAX_TOTAL_CHARS) {
    window = window.slice(2);
  }
  return window;
}
