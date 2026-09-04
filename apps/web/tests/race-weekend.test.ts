import { describe, expect, it } from "vitest";
import type { RaceSession } from "../src/lib/race-results-repository.js";
import { buildWeekendNodes, latestResultTab } from "../src/lib/race-weekend.js";

const sessions: RaceSession[] = [
  {
    key: "practice-1",
    label: "Practice 1",
    startsAtUtc: "2026-03-06T01:30:00Z",
  },
  {
    key: "practice-2",
    label: "Practice 2",
    startsAtUtc: "2026-03-06T05:00:00Z",
  },
  {
    key: "practice-3",
    label: "Practice 3",
    startsAtUtc: "2026-03-07T01:30:00Z",
  },
  {
    key: "qualifying",
    label: "Qualifying",
    startsAtUtc: "2026-03-07T05:00:00Z",
  },
  { key: "race", label: "Race", startsAtUtc: "2026-03-08T04:00:00Z" },
];

describe("buildWeekendNodes", () => {
  it("赛前：无结果的 session 一律 upcoming 且不可点", () => {
    const nodes = buildWeekendNodes(sessions, []);
    expect(nodes).toHaveLength(5);
    expect(nodes.every((n) => n.state === "upcoming" && n.tab === null)).toBe(
      true,
    );
  });

  it("赛中：已入库的 session 变 done 并带 tab，其余保持 upcoming", () => {
    const nodes = buildWeekendNodes(sessions, [
      "practice-1",
      "practice-2",
      "practice-3",
      "qualifying",
    ]);
    expect(nodes.map((n) => n.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "upcoming",
    ]);
    expect(nodes[3].tab).toBe("qualifying");
    expect(nodes[4].tab).toBeNull();
  });

  it("正赛 session 指向 race-result tab", () => {
    const nodes = buildWeekendNodes(sessions, ["race-result"]);
    expect(nodes[4]).toMatchObject({ state: "done", tab: "race-result" });
  });

  it("无对应 tab 的 session（Sprint）永不 done", () => {
    const nodes = buildWeekendNodes(
      [{ key: "sprint", label: "Sprint", startsAtUtc: "2026-03-07T03:00:00Z" }],
      ["race-result"],
    );
    expect(nodes[0]).toMatchObject({ state: "upcoming", tab: null });
  });
});

describe("latestResultTab", () => {
  it("取最后一个有结果的 session 对应的 tab", () => {
    const nodes = buildWeekendNodes(sessions, ["practice-1", "qualifying"]);
    expect(latestResultTab(nodes)).toBe("qualifying");
  });

  it("全无结果时回落 race-result", () => {
    expect(latestResultTab(buildWeekendNodes(sessions, []))).toBe(
      "race-result",
    );
  });
});
