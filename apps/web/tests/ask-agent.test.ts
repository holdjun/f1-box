import { describe, expect, it } from "vitest";
import {
  ASK_MODEL_ID,
  buildSystemPrompt,
  createFinalChunkDecoder,
  runAgent,
  type RunToolsFn,
} from "../src/lib/ask/agent.js";
import { createStaticAskDatabase } from "../src/lib/ask/db.js";
import { driverIdentitySql } from "../src/lib/ask/tools.js";
import type { KnowledgeEntry } from "../src/lib/ask/knowledge.js";

const entries: KnowledgeEntry[] = [
  { id: "undercut", terms: ["undercut"], content: "Undercut 内容" },
];

describe("buildSystemPrompt", () => {
  it("contains rules, data attribution and injected entries", () => {
    const prompt = buildSystemPrompt(entries);
    expect(prompt).toContain("f1-box");
    expect(prompt).toContain("必须来自工具查询结果");
    expect(prompt).toContain("f1db");
    expect(prompt).toContain("Undercut 内容");
  });

  it("omits knowledge section when no entries", () => {
    expect(buildSystemPrompt([])).not.toContain("参考知识");
  });
});

describe("createFinalChunkDecoder", () => {
  it("holds a raw text chunk until flush", () => {
    const decoder = createFinalChunkDecoder();
    expect(decoder.push("刘易斯")).toBe("");
    expect(decoder.flush()).toBe("刘易斯");
  });

  it("extracts text from sse data lines", () => {
    const decoder = createFinalChunkDecoder();
    expect(decoder.push('data: {"response":"汉密尔顿"}\n\n')).toBe("汉密尔顿");
  });

  it("ignores done markers and empty data", () => {
    expect(createFinalChunkDecoder().push("data: [DONE]\n\n")).toBe("");
    expect(createFinalChunkDecoder().push("data: {}\n\n")).toBe("");
  });

  it("reassembles a data line split across pushes", () => {
    const decoder = createFinalChunkDecoder();
    expect(decoder.push('data: {"resp')).toBe("");
    expect(decoder.push('onse":"汉"}\n')).toBe("汉");
  });

  it("keeps raw text containing a data: substring", () => {
    const decoder = createFinalChunkDecoder();
    expect(decoder.push("详见 data: 字段说明\n")).toBe("详见 data: 字段说明\n");
  });

  it("returns the pending line without newline from flush", () => {
    const decoder = createFinalChunkDecoder();
    expect(decoder.push("第一行\n")).toBe("第一行\n");
    expect(decoder.push("尾行")).toBe("");
    expect(decoder.flush()).toBe("尾行");
  });
});

function textStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

async function collectSse(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("runAgent", () => {
  it("pipes final text as delta events and ends with done", async () => {
    const ai = {} as Ai;
    // 完整行随 push 出 delta，无换行残行由 flush 补发
    const runTools = async () => textStream(["汉密尔顿\n", "七冠"]);
    const stream = runAgent({
      ai,
      db: createStaticAskDatabase({}),
      messages: [{ role: "user", content: "汉密尔顿几个冠军" }],
      runTools: runTools as unknown as RunToolsFn,
    });
    const out = await collectSse(stream);
    expect(out).toContain('event: delta\ndata: {"text":"汉密尔顿\\n"}');
    expect(out).toContain('event: delta\ndata: {"text":"七冠"}');
    expect(out.endsWith("event: done\ndata: {}\n\n")).toBe(true);
  });

  it("emits status event when a tool executes, before deltas", async () => {
    const ai = {} as Ai;
    const runTools = async (_ai: unknown, _model: string, input: any) => {
      await input.tools[0].function({ query: "x" });
      return textStream(["答案"]);
    };
    const stream = runAgent({
      ai,
      db: createStaticAskDatabase({ [driverIdentitySql]: [] }),
      messages: [{ role: "user", content: "x" }],
      runTools: runTools as unknown as RunToolsFn,
    });
    const out = await collectSse(stream);
    const statusAt = out.indexOf('event: status\ndata: {"phase":"querying"}');
    const deltaAt = out.indexOf('event: delta');
    expect(statusAt).toBeGreaterThanOrEqual(0);
    expect(statusAt).toBeLessThan(deltaAt);
  });

  it("configures runWithTools with strict validation, streaming and recursion cap", async () => {
    const ai = {} as Ai;
    let seenConfig: unknown;
    const runTools = async (
      _ai: unknown,
      _model: string,
      _input: unknown,
      config: unknown,
    ) => {
      seenConfig = config;
      return textStream(["答案"]);
    };
    await collectSse(
      runAgent({
        ai,
        db: createStaticAskDatabase({}),
        messages: [{ role: "user", content: "x" }],
        runTools: runTools as unknown as RunToolsFn,
      }),
    );
    expect(seenConfig).toEqual({
      strictValidation: true,
      streamFinalResponse: true,
      maxRecursiveToolRuns: 2,
    });
  });

  it("injects generation params via wrapped ai binding", async () => {
    const seenInputs: unknown[] = [];
    const ai = {
      run: async (_model: string, input: unknown) => {
        seenInputs.push(input);
        return {};
      },
    } as unknown as Ai;
    const runTools = async (ai: Ai) => {
      await ai.run("x", { messages: [] } as never);
      return textStream(["答案"]);
    };
    await collectSse(
      runAgent({
        ai,
        db: createStaticAskDatabase({}),
        messages: [{ role: "user", content: "x" }],
        runTools: runTools as unknown as RunToolsFn,
      }),
    );
    expect(seenInputs).toEqual([
      { messages: [], temperature: 0.3, max_tokens: 1024 },
    ]);
  });

  it("emits error event when the model call throws", async () => {
    const ai = {} as Ai;
    const runTools = async () => {
      throw new Error("boom");
    };
    const stream = runAgent({
      ai,
      db: createStaticAskDatabase({}),
      messages: [{ role: "user", content: "x" }],
      runTools: runTools as unknown as RunToolsFn,
    });
    const out = await collectSse(stream);
    expect(out).toContain('event: error\ndata: {"code":"model_error"');
    expect(out).not.toContain("boom");
  });
});
