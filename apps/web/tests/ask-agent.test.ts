import { describe, expect, it } from "vitest";
import {
  ASK_MODEL_ID,
  buildSystemPrompt,
  createFinalChunkDecoder,
  runAgent,
} from "../src/lib/ask/agent.js";
import { createStaticAskDatabase } from "../src/lib/ask/db.js";
import {
  driverChampionshipYearsSql,
  driverIdentitySql,
  driverRefSql,
} from "../src/lib/ask/tools.js";
import type { KnowledgeEntry } from "../src/lib/ask/knowledge.js";

const entries: KnowledgeEntry[] = [
  { id: "undercut", terms: ["undercut"], content: "Undercut 内容" },
];

const hamiltonIdentity = [
  {
    id: "lewis-hamilton",
    name: "Lewis Hamilton",
    full_name: "Lewis Carl Davidson Hamilton",
    country_name: "United Kingdom",
    entries: 380,
    starts: 378,
    wins: 105,
    podiums: 202,
    poles: 104,
    fastest_laps: 68,
    points: 4900.5,
    championships: 7,
    best_position: 1,
  },
];

function hamiltonDb() {
  return createStaticAskDatabase({
    [driverRefSql]: [{ id: "lewis-hamilton", name: "Lewis Hamilton" }],
    [driverIdentitySql]: hamiltonIdentity,
    [driverChampionshipYearsSql]: [
      { year: 2008 },
      { year: 2014 },
      { year: 2015 },
    ],
  });
}

describe("buildSystemPrompt", () => {
  it("contains rules, data attribution and injected entries", () => {
    const prompt = buildSystemPrompt(entries);
    expect(prompt).toContain("f1-box");
    expect(prompt).toContain("必须来自工具查询结果");
    expect(prompt).toContain("f1db");
    expect(prompt).toContain("Undercut 内容");
  });

  it("bans html and markdown markup including asterisks and hashes", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain("不要输出 HTML 或 Markdown");
    expect(prompt).toContain("不要使用 *、#");
  });

  it("omits knowledge section when no entries", () => {
    expect(buildSystemPrompt([])).not.toContain("参考知识");
  });
});

describe("createFinalChunkDecoder", () => {
  it("extracts delta content from openai sse data lines", () => {
    const decoder = createFinalChunkDecoder();
    expect(
      decoder.push('data: {"choices":[{"delta":{"content":"汉密尔顿"}}]}\n\n'),
    ).toBe("汉密尔顿");
  });

  it("keeps reasoning content out of the output", () => {
    const decoder = createFinalChunkDecoder();
    expect(
      decoder.push(
        'data: {"choices":[{"delta":{"reasoning_content":"思考过程","content":"答案"}}]}\n\n',
      ),
    ).toBe("答案");
    expect(
      decoder.push(
        'data: {"choices":[{"delta":{"reasoning_content":"只有思考"}}]}\n\n',
      ),
    ).toBe("");
  });

  it("ignores done markers, empty deltas and malformed json", () => {
    const decoder = createFinalChunkDecoder();
    expect(decoder.push("data: [DONE]\n\n")).toBe("");
    expect(
      decoder.push('data: {"choices":[{"delta":{"content":""}}]}\n\n'),
    ).toBe("");
    expect(
      decoder.push('data: {"choices":[{"delta":{"content":null}}]}\n\n'),
    ).toBe("");
    expect(decoder.push("data: 不是 json\n\n")).toBe("");
  });

  it("drops non-data lines such as event frames and keepalives", () => {
    const decoder = createFinalChunkDecoder();
    expect(decoder.push("event: message\n: keepalive\n\n")).toBe("");
  });

  it("reassembles a data line split across pushes", () => {
    const decoder = createFinalChunkDecoder();
    expect(decoder.push('data: {"choices":[{"delta":{"con')).toBe("");
    expect(decoder.push('tent":"汉"}}]}\n')).toBe("汉");
  });

  it("returns the pending partial line from flush", () => {
    const decoder = createFinalChunkDecoder();
    expect(decoder.push('data: {"choices":[{"delta":{"content":"尾"}}]}')).toBe("");
    expect(decoder.flush()).toBe("尾");
  });
});

interface ModelCall {
  model: string;
  input: Record<string, unknown>;
}

// 按调用序返回脚本化响应；Error 实例表示该次调用抛错
function fakeAi(responses: unknown[]) {
  const calls: ModelCall[] = [];
  const ai = {
    run: async (model: string, input: Record<string, unknown>) => {
      calls.push({ model, input });
      const response = responses[calls.length - 1];
      if (response === undefined) throw new Error("no scripted model response");
      if (response instanceof Error) throw response;
      return response;
    },
  } as unknown as Ai;
  return { ai, calls };
}

function toolCallResponse(id: string, name: string, args: unknown) {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

function openaiStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
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

const TOOL_NAMES = [
  "driver_summary",
  "constructor_summary",
  "season_driver_standings",
  "season_constructor_standings",
  "race_results",
];

describe("runAgent", () => {
  it("answers a pure knowledge question from the first response in one call", async () => {
    const { ai, calls } = fakeAi([
      { choices: [{ message: { content: "Undercut 是先进站换胎抢位置的策略" } }] },
    ]);
    const out = await collectSse(
      runAgent({
        ai,
        db: createStaticAskDatabase({}),
        messages: [{ role: "user", content: "什么是 undercut" }],
      }),
    );
    expect(out).toContain(
      'event: delta\ndata: {"text":"Undercut 是先进站换胎抢位置的策略"}',
    );
    expect(out.endsWith("event: done\ndata: {}\n\n")).toBe(true);
    expect(out).not.toContain("event: status");

    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(ASK_MODEL_ID);
    expect(calls[0].input.stream).toBe(false);
    expect(calls[0].input.temperature).toBe(0.3);
    expect(calls[0].input.max_tokens).toBe(2048);
    const tools = calls[0].input.tools as {
      type: string;
      function: { name: string };
    }[];
    expect(tools.map((tool) => tool.function.name)).toEqual(TOOL_NAMES);
    for (const tool of tools) expect(tool.type).toBe("function");
  });

  it("executes the tool, then streams the final answer without tools", async () => {
    const stream = openaiStream([
      'data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"刘易斯·汉密尔顿"}}]}\n',
      'data: {"choices":[{"delta":{"content":"，共七冠"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const { ai, calls } = fakeAi([
      toolCallResponse("chatcmpl-tool-1", "driver_summary", {
        query: "Lewis Hamilton",
      }),
      { choices: [{ message: { content: "中间稿" } }] },
      stream,
    ]);
    const out = await collectSse(
      runAgent({
        ai,
        db: hamiltonDb(),
        messages: [{ role: "user", content: "汉密尔顿几个冠军" }],
      }),
    );

    const statusAt = out.indexOf('event: status\ndata: {"phase":"querying"}');
    const deltaAt = out.indexOf("event: delta");
    expect(statusAt).toBeGreaterThanOrEqual(0);
    expect(statusAt).toBeLessThan(deltaAt);

    expect(out).toContain('event: delta\ndata: {"text":"刘易斯·汉密尔顿"}');
    expect(out).toContain('event: delta\ndata: {"text":"，共七冠"}');
    expect(out).not.toContain("思考中");
    expect(out).not.toContain("中间稿");
    expect(out.endsWith("event: done\ndata: {}\n\n")).toBe(true);

    // 两轮带 tools 的非流式调用 + 一次无 tools 的流式最终调用
    expect(calls).toHaveLength(3);
    expect(calls[0].input.tools).toBeDefined();
    expect(calls[1].input.tools).toBeDefined();
    expect(calls[2].input.stream).toBe(true);
    expect(calls[2].input.tools).toBeUndefined();

    // 工具往来按 OpenAI 形态原样回填，最终调用的 messages 能引用工具结果
    const finalMessages = calls[2].input.messages as Record<string, any>[];
    const assistant = finalMessages.find((m) => m.role === "assistant")!
    expect(assistant.tool_calls).toEqual([
      {
        id: "chatcmpl-tool-1",
        type: "function",
        function: {
          name: "driver_summary",
          arguments: '{"query":"Lewis Hamilton"}',
        },
      },
    ]);
    const toolMessage = finalMessages.find((m) => m.role === "tool")!
    expect(toolMessage.tool_call_id).toBe("chatcmpl-tool-1");
    expect(JSON.parse(toolMessage.content)).toMatchObject({
      found: true,
      driver: {
        name: "Lewis Hamilton",
        championshipYears: [2008, 2014, 2015],
      },
    });
  });

  it("feeds argument validation errors back for the model to self-correct", async () => {
    const stream = openaiStream([
      'data: {"choices":[{"delta":{"content":"已纠正"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const { ai, calls } = fakeAi([
      toolCallResponse("call-bad", "driver_summary", {}),
      toolCallResponse("call-good", "driver_summary", {
        query: "Lewis Hamilton",
      }),
      { choices: [{ message: { content: "中间稿" } }] },
      stream,
    ]);
    const out = await collectSse(
      runAgent({
        ai,
        db: hamiltonDb(),
        messages: [{ role: "user", content: "汉密尔顿几个冠军" }],
      }),
    );

    // 缺必填参数的调用以错误 tool 消息回传，供下一次调用自纠
    const retryMessages = calls[1].input.messages as Record<string, any>[];
    const errorTool = retryMessages.find((m) => m.role === "tool")!
    expect(errorTool.tool_call_id).toBe("call-bad");
    expect(errorTool.content).toContain("query");

    const correctedMessages = calls[2].input.messages as Record<string, any>[];
    const correctedTool = correctedMessages
      .filter((m) => m.role === "tool")
      .find((m) => m.tool_call_id === "call-good")!
    expect(JSON.parse(correctedTool.content)).toMatchObject({ found: true });

    expect(out).toContain('event: delta\ndata: {"text":"已纠正"}');
    expect(out.endsWith("event: done\ndata: {}\n\n")).toBe(true);
  });

  it("reports hallucinated tool names back to the model", async () => {
    const stream = openaiStream([
      'data: {"choices":[{"delta":{"content":"没有该工具"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const { ai, calls } = fakeAi([
      toolCallResponse("call-x", "schedule_lookup", { year: 2024 }),
      { choices: [{ message: { content: "中间稿" } }] },
      stream,
    ]);
    const out = await collectSse(
      runAgent({
        ai,
        db: createStaticAskDatabase({}),
        messages: [{ role: "user", content: "下站赛程" }],
      }),
    );

    const messages = calls[1].input.messages as Record<string, any>[];
    const toolMessage = messages.find((m) => m.role === "tool")!
    expect(toolMessage.tool_call_id).toBe("call-x");
    expect(toolMessage.content).toContain("未知工具");
    expect(toolMessage.content).toContain("schedule_lookup");
    expect(out).toContain('event: delta\ndata: {"text":"没有该工具"}');
    expect(out.endsWith("event: done\ndata: {}\n\n")).toBe(true);
  });

  it("stops after three tool rounds and answers from a no-tools stream", async () => {
    const stream = openaiStream([
      'data: {"choices":[{"delta":{"content":"请收窄问题范围"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const { ai, calls } = fakeAi([
      toolCallResponse("call-1", "driver_summary", {
        query: "Lewis Hamilton",
      }),
      toolCallResponse("call-2", "driver_summary", {
        query: "Lewis Hamilton",
      }),
      toolCallResponse("call-3", "driver_summary", {
        query: "Lewis Hamilton",
      }),
      stream,
    ]);
    const out = await collectSse(
      runAgent({
        ai,
        db: hamiltonDb(),
        messages: [{ role: "user", content: "汉密尔顿几个冠军" }],
      }),
    );

    expect(calls).toHaveLength(4);
    expect(
      calls.slice(0, 3).every((call) => Array.isArray(call.input.tools)),
    ).toBe(true);
    expect(calls[3].input.stream).toBe(true);
    expect(calls[3].input.tools).toBeUndefined();

    const finalMessages = calls[3].input.messages as Record<string, any>[];
    expect(finalMessages.filter((m) => m.role === "assistant")).toHaveLength(3);
    expect(finalMessages.filter((m) => m.role === "tool")).toHaveLength(3);

    expect(out).toContain('event: delta\ndata: {"text":"请收窄问题范围"}');
    expect(out.endsWith("event: done\ndata: {}\n\n")).toBe(true);
  });

  it("emits a sanitized error event and no done when the model call throws", async () => {
    const { ai } = fakeAi([new Error("upstream exploded")]);
    const out = await collectSse(
      runAgent({
        ai,
        db: createStaticAskDatabase({}),
        messages: [{ role: "user", content: "x" }],
      }),
    );
    expect(out).toContain('event: error\ndata: {"code":"model_error"');
    expect(out).not.toContain("upstream exploded");
    expect(out).not.toContain("event: done");
  });
});
