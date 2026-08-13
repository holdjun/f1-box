import { describe, expect, it } from "vitest";
import { parseYearParam, splitYearPath } from "../src/lib/routing.js";

describe("splitYearPath", () => {
  it("splits a year-scoped path", () => {
    expect(splitYearPath("/2026/racing")).toEqual({ year: 2026, rest: "/racing" });
    expect(splitYearPath("/2025/results/drivers")).toEqual({
      year: 2025,
      rest: "/results/drivers",
    });
  });

  it("returns null year for non-year paths", () => {
    expect(splitYearPath("/")).toEqual({ year: null, rest: "/" });
    expect(splitYearPath("/about")).toEqual({ year: null, rest: "/about" });
  });
});

describe("parseYearParam", () => {
  it("parses a single year and comma-separated years", () => {
    expect(parseYearParam("1997")).toEqual([1997]);
    expect(parseYearParam("1997,2007")).toEqual([1997, 2007]);
    expect(parseYearParam("2007,1997")).toEqual([1997, 2007]);
  });

  it("returns null for missing, empty or invalid input", () => {
    expect(parseYearParam(null)).toBeNull();
    expect(parseYearParam("")).toBeNull();
    expect(parseYearParam("abc")).toBeNull();
    expect(parseYearParam("1900,2020")).toEqual([2020]);
  });
});
