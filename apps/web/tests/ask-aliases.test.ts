import { describe, expect, it } from "vitest";
import { askAliases, resolveAlias } from "../src/lib/ask/aliases.js";

describe("resolveAlias", () => {
  it("resolves exact alias after normalization", () => {
    expect(resolveAlias("汉密尔顿", askAliases.drivers)).toBe("lewis-hamilton");
    expect(resolveAlias("  乐扣 ", askAliases.drivers)).toBe("charles-leclerc");
    expect(resolveAlias("Kimi", askAliases.drivers)).toBe("kimi-raikkonen");
    expect(resolveAlias("奔驰", askAliases.constructors)).toBe("mercedes");
  });

  it("returns null for unknown alias", () => {
    expect(resolveAlias("无名车手", askAliases.drivers)).toBeNull();
  });

  it("returns null for Object.prototype keys instead of inherited members", () => {
    const table: Record<string, string> = { 汉密尔顿: "lewis-hamilton" };
    expect(resolveAlias("constructor", table)).toBeNull();
    expect(resolveAlias("toString", table)).toBeNull();
    expect(resolveAlias("__proto__", table)).toBeNull();
  });
});

describe("askAliases seed", () => {
  it("maps every alias to a non-empty id", () => {
    for (const table of [
      askAliases.drivers,
      askAliases.constructors,
      askAliases.grandPrix,
    ]) {
      for (const [alias, id] of Object.entries(table)) {
        expect(alias.trim()).toBe(alias);
        expect(id.length).toBeGreaterThan(0);
      }
    }
  });
});
