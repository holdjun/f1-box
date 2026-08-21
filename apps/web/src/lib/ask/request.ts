// /api/ask 请求体边界校验：拒绝一切 system/tool 角色与超长内容（防注入与防滥用）
export const MAX_BODY_BYTES = 32_768;
export const MAX_MESSAGES = 9;
export const MAX_CONTENT_CHARS = 2_000;
export const MAX_TOTAL_CHARS = 8_000;

export interface AskMessage {
  role: "user" | "assistant";
  content: string;
}

export type AskBodyResult =
  | { ok: true; messages: AskMessage[] }
  | { ok: false; message: string };

export function validateAskBody(parsed: unknown): AskBodyResult {
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, message: "请求体必须是 JSON 对象" };
  }
  const raw = (parsed as { messages?: unknown }).messages;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_MESSAGES) {
    return { ok: false, message: `messages 必须是 1-${MAX_MESSAGES} 条消息` };
  }

  const messages: AskMessage[] = [];
  let total = 0;
  for (const [index, entry] of raw.entries()) {
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    if (
      typeof entry !== "object" ||
      entry === null ||
      (entry as { role?: unknown }).role !== expectedRole ||
      typeof (entry as { content?: unknown }).content !== "string"
    ) {
      return {
        ok: false,
        message: `第 ${index + 1} 条消息必须是 ${expectedRole} 角色且 content 为字符串`,
      };
    }
    const content = ((entry as { content: string }).content).trim();
    if (content.length < 1 || content.length > MAX_CONTENT_CHARS) {
      return {
        ok: false,
        message: `第 ${index + 1} 条消息长度须在 1-${MAX_CONTENT_CHARS} 字符（去首尾空白后）`,
      };
    }
    total += content.length;
    if (total > MAX_TOTAL_CHARS) {
      return { ok: false, message: `对话总长度超过 ${MAX_TOTAL_CHARS} 字符` };
    }
    messages.push({ role: expectedRole, content });
  }
  if (messages.at(-1)!.role !== "user") {
    return { ok: false, message: "最后一条消息必须是 user" };
  }
  return { ok: true, messages };
}
