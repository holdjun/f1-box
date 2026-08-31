import { describe, expect, test } from "vitest";
import timezones from "../src/data/circuit-timezones.json";
import { circuitTimeZone } from "../src/lib/circuit-time.js";

describe("circuitTimeZone", () => {
  test("returns an IANA time zone for a known circuit", () => {
    expect(circuitTimeZone("melbourne")).toBe("Australia/Melbourne");
    expect(circuitTimeZone("las-vegas")).toBe("America/Los_Angeles");
  });

  test("returns null for an unknown circuit id", () => {
    expect(circuitTimeZone("nope")).toBeNull();
    expect(circuitTimeZone("")).toBeNull();
  });

  // 映射本身的有效性：每个值都必须是 Intl 能构造的 IANA 时区。
  // 不写"覆盖全部赛道 id"类断言——测试环境没有赛道全集数据源。
  test("every mapped time zone constructs an Intl.DateTimeFormat", () => {
    for (const value of Object.values(timezones) as string[]) {
      expect(
        () => new Intl.DateTimeFormat("en-GB", { timeZone: value }),
      ).not.toThrow();
    }
  });
});
