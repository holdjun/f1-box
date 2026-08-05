import { describe, expect, it } from "vitest";
import { splitYearPath } from "../src/lib/routing.js";

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
