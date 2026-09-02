// SSE 编码服务端用；解析器给面板客户端流式读取用（纯函数，两侧共用）
interface SseEvent {
  event: string;
  data: string;
}

export function encodeSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createSseAccumulator(): { push(chunk: string): SseEvent[] } {
  let buffer = "";
  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk;
      const events: SseEvent[] = [];
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseBlock(block);
        if (parsed) events.push(parsed);
        boundary = buffer.indexOf("\n\n");
      }
      return events;
    },
  };
}

function parseBlock(block: string): SseEvent | null {
  let event: string | null = null;
  let data: string | null = null;
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) data = line.slice(6);
  }
  if (event === null || data === null) return null;
  return { event, data };
}
