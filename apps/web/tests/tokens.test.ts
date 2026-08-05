import { describe, expect, it } from "vitest";
import { countryFlag, teamColor } from "../src/lib/tokens.js";

describe("tokens", () => {
  it("returns known team colors and a neutral fallback", () => {
    expect(teamColor("Ferrari")).toBe("#f41919");
    expect(teamColor("Not A Team")).toBe("#84909e");
  });

  it("maps country codes to flag emoji with a fallback", () => {
    expect(countryFlag("GBR")).toBe("🇬🇧");
    expect(countryFlag("XXX")).toBe("🏳️");
  });
});
