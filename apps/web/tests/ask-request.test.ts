import { describe, expect, it } from "vitest";
import { validateAskBody } from "../src/lib/ask/request.js";

const ok = (messages: unknown[]) => ({ ok: true, messages });

describe("validateAskBody", () => {
  it("accepts alternating messages ending with user", () => {
    expect(
      validateAskBody({
        messages: [
          { role: "user", content: "汉密尔顿哪几年夺冠？" },
          { role: "assistant", content: "……" },
          { role: "user", content: "一共几次？" },
        ],
      }),
    ).toEqual(
      ok([
        { role: "user", content: "汉密尔顿哪几年夺冠？" },
        { role: "assistant", content: "……" },
        { role: "user", content: "一共几次？" },
      ]),
    );
  });

  it("rejects non-object or missing messages array", () => {
    expect(validateAskBody(null).ok).toBe(false);
    expect(validateAskBody({}).ok).toBe(false);
    expect(validateAskBody({ messages: "x" }).ok).toBe(false);
  });

  it("rejects empty or over-long history", () => {
    expect(validateAskBody({ messages: [] }).ok).toBe(false);
    const ten = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x",
    }));
    expect(validateAskBody({ messages: ten }).ok).toBe(false);
  });

  it("rejects wrong roles and wrong order", () => {
    expect(
      validateAskBody({
        messages: [{ role: "system", content: "x" }],
      }).ok,
    ).toBe(false);
    expect(
      validateAskBody({
        messages: [{ role: "assistant", content: "x" }],
      }).ok,
    ).toBe(false);
    expect(
      validateAskBody({
        messages: [
          { role: "user", content: "x" },
          { role: "user", content: "y" },
        ],
      }).ok,
    ).toBe(false);
    expect(
      validateAskBody({
        messages: [
          { role: "user", content: "x" },
          { role: "assistant", content: "y" },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects empty or over-long content and trims whitespace", () => {
    expect(
      validateAskBody({ messages: [{ role: "user", content: "  " }] }).ok,
    ).toBe(false);
    expect(
      validateAskBody({
        messages: [{ role: "user", content: "a".repeat(2001) }],
      }).ok,
    ).toBe(false);
    expect(
      validateAskBody({
        messages: [{ role: "user", content: `  ${"汉".repeat(2000)}  ` }],
      }),
    ).toEqual(ok([{ role: "user", content: "汉".repeat(2000) }]));
  });

  it("rejects total content over 8000 chars", () => {
    const four = "汉".repeat(2000);
    expect(
      validateAskBody({
        messages: [
          { role: "user", content: four },
          { role: "assistant", content: four },
          { role: "user", content: four },
          { role: "assistant", content: four },
          { role: "user", content: "超" },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects non-string content", () => {
    expect(
      validateAskBody({ messages: [{ role: "user", content: 1 }] }).ok,
    ).toBe(false);
  });
});
