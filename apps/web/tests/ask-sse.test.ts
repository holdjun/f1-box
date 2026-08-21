import { describe, expect, it } from "vitest";
import { createSseAccumulator, encodeSseEvent } from "../src/lib/ask/sse.js";

describe("encodeSseEvent", () => {
  it("renders single-line JSON data", () => {
    expect(encodeSseEvent("delta", { text: "刘易斯" })).toBe(
      'event: delta\ndata: {"text":"刘易斯"}\n\n',
    );
    expect(encodeSseEvent("done", {})).toBe("event: done\ndata: {}\n\n");
  });

  it("escapes newlines inside text so data stays single-line", () => {
    expect(encodeSseEvent("delta", { text: "a\nb" })).toBe(
      'event: delta\ndata: {"text":"a\\nb"}\n\n',
    );
  });
});

describe("createSseAccumulator", () => {
  it("parses multiple events in one chunk", () => {
    const acc = createSseAccumulator();
    const events = acc.push(
      'event: status\ndata: {"phase":"querying"}\n\nevent: done\ndata: {}\n\n',
    );
    expect(events).toEqual([
      { event: "status", data: '{"phase":"querying"}' },
      { event: "done", data: "{}" },
    ]);
  });

  it("buffers an event split across chunks", () => {
    const acc = createSseAccumulator();
    expect(acc.push('event: delta\nda')).toEqual([]);
    expect(acc.push('ta: {"text":"汉"}\n\n')).toEqual([
      { event: "delta", data: '{"text":"汉"}' },
    ]);
  });

  it("ignores comment lines and unknown fields", () => {
    const acc = createSseAccumulator();
    const events = acc.push(": ping\nevent: delta\nid: 1\ndata: {}\n\n");
    expect(events).toEqual([{ event: "delta", data: "{}" }]);
  });
});
