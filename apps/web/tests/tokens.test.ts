import { describe, expect, it } from "vitest";

import { alpha2Flag, monogram } from "../src/lib/tokens.js";

describe("alpha2Flag", () => {
  it("builds regional indicator emoji from alpha-2 codes", () => {
    expect(alpha2Flag("GB")).toBe("🇬🇧");
    expect(alpha2Flag("br")).toBe("🇧🇷");
  });
});

describe("monogram", () => {
  it("takes first and last token initials", () => {
    expect(monogram("Ayrton Senna")).toBe("AS");
    expect(monogram("Max Emilian Verstappen")).toBe("MV");
  });

  it("falls back to the first two characters for a single token", () => {
    expect(monogram("Senna")).toBe("SE");
  });
});
