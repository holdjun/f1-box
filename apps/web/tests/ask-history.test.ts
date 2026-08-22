import { describe, expect, it } from "vitest";
import { capStoredAnswer, windowForSend } from "../src/lib/ask/history.js";
import { MAX_CONTENT_CHARS } from "../src/lib/ask/request.js";

type Turn = { role: "user" | "assistant"; content: string };

const turn = (role: Turn["role"], content: string): Turn => ({ role, content });

describe("capStoredAnswer", () => {
  it("truncates stored answers to the server per-message cap", () => {
    const answer = "冠".repeat(MAX_CONTENT_CHARS + 500);
    expect(capStoredAnswer(answer)).toHaveLength(MAX_CONTENT_CHARS);
  });

  it("keeps short answers untouched", () => {
    expect(capStoredAnswer("共七次夺冠")).toBe("共七次夺冠");
  });
});

describe("windowForSend", () => {
  it("keeps at most the nine newest turns", () => {
    const conversation = Array.from({ length: 11 }, (_, i) =>
      turn(i % 2 === 0 ? "user" : "assistant", `m${i}`),
    );
    const window = windowForSend(conversation);
    expect(window).toHaveLength(9);
    expect(window[0]).toEqual({ role: "user", content: "m2" });
    expect(window.at(-1)).toEqual({ role: "user", content: "m10" });
  });

  it("drops oldest user+assistant pairs until the total fits the server cap", () => {
    const big = "x".repeat(MAX_CONTENT_CHARS);
    // 5 条各 2000 字符共 10000，超过 8000 上限 → 丢最旧一对后 6000 合规
    const conversation = [
      turn("user", big),
      turn("assistant", big),
      turn("user", big),
      turn("assistant", big),
      turn("user", "最新问题"),
    ];
    const window = windowForSend(conversation);
    expect(window).toHaveLength(3);
    expect(window[0]).toEqual({ role: "user", content: big });
    expect(window.at(-1)).toEqual({ role: "user", content: "最新问题" });
  });

  it("returns the conversation unchanged when it already fits", () => {
    const conversation = [
      turn("user", "第一问"),
      turn("assistant", "第一答"),
      turn("user", "第二问"),
    ];
    expect(windowForSend(conversation)).toEqual(conversation);
  });
});
