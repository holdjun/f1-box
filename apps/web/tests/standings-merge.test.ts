import { describe, expect, it } from "vitest";
import { mergeStanding } from "../src/lib/standings-merge.js";

function slice(points: number, positionText: string, championshipWon = false) {
  return { points, positionText, championshipWon };
}

describe("mergeStanding", () => {
  it("starts the total from the first row", () => {
    expect(mergeStanding(undefined, slice(9, "2"))).toEqual({
      points: 9,
      positionText: "2",
      championshipWon: false,
    });
  });

  it("sums points across engine-variant rows", () => {
    const total = mergeStanding(
      mergeStanding(undefined, slice(48, "1", true)),
      slice(8, "5"),
    );
    expect(total.points).toBe(56);
  });

  it("keeps the best numeric position", () => {
    let total = mergeStanding(undefined, slice(9, "4"));
    total = mergeStanding(total, slice(6, "2"));
    total = mergeStanding(total, slice(1, "5"));
    expect(total.positionText).toBe("2");
  });

  it("marks champion when any variant row won", () => {
    let total = mergeStanding(undefined, slice(9, "2"));
    expect(total.championshipWon).toBe(false);
    total = mergeStanding(total, slice(6, "4", true));
    expect(total.championshipWon).toBe(true);
  });

  it("prefers numeric positions over non-numeric labels", () => {
    let total = mergeStanding(undefined, slice(9, "NC"));
    total = mergeStanding(total, slice(6, "3"));
    expect(total.positionText).toBe("3");
    total = mergeStanding(total, slice(1, "EX"));
    expect(total.positionText).toBe("3");
  });

  it("adopts a non-numeric label when nothing is set yet", () => {
    expect(mergeStanding(undefined, slice(0, "NC")).positionText).toBe("NC");
  });
});
