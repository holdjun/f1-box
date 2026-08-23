import { describe, expect, it } from "vitest";

import { gridFillers } from "../src/lib/layout.js";

describe("gridFillers", () => {
  it("returns nothing for counts that fill every breakpoint", () => {
    expect(gridFillers(6)).toEqual([]);
  });

  it("fills the md row only when lg is already complete", () => {
    // 915：md 缺一格，lg 满
    expect(gridFillers(915)).toEqual(["hidden md:block lg:hidden"]);
  });

  it("fills the lg row only when md is already complete", () => {
    expect(gridFillers(2)).toEqual(["hidden lg:block"]);
  });

  it("covers both breakpoints with shared and lg-only cells", () => {
    // 187：md 缺 1、lg 缺 2 → 一格共用 + 一格仅 lg
    expect(gridFillers(187)).toEqual(["hidden md:block", "hidden lg:block"]);
  });
});
