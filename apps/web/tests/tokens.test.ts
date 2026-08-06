import { describe, expect, it } from "vitest";

import { flagForNationality, teamColor } from "../src/lib/tokens.js";

describe("tokens", () => {
  it("returns known team colors and a neutral fallback", () => {
    expect(teamColor("Ferrari")).toBe("#f41919");
    expect(teamColor("Not A Team")).toBe("#84909e");
  });

  it("maps nationality text to flag emoji with a fallback", () => {
    expect(flagForNationality("British")).toBe(String.fromCodePoint(0x1f1ec, 0x1f1e7));
    expect(flagForNationality("Monegasque")).toBe(String.fromCodePoint(0x1f1f2, 0x1f1e8));
    expect(flagForNationality("New Zealander")).toBe(String.fromCodePoint(0x1f1f3, 0x1f1ff));
    expect(flagForNationality("Unknown land")).toBe(String.fromCodePoint(0x1f3f3, 0xfe0f));
    expect(flagForNationality(undefined)).toBe(String.fromCodePoint(0x1f3f3, 0xfe0f));
  });
});
