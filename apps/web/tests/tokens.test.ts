import { describe, expect, it } from "vitest";

import { alpha2Flag } from "../src/lib/tokens.js";

describe("alpha2Flag", () => {
  it("builds regional indicator emoji from alpha-2 codes", () => {
    expect(alpha2Flag("GB")).toBe("🇬🇧");
    expect(alpha2Flag("br")).toBe("🇧🇷");
  });
});
