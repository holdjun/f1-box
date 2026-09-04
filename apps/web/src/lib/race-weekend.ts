import type { RaceSession } from "./race-results-repository.js";
import type { RaceTabKey } from "./routing.js";

// session key → 承载该 session 成绩的 tab
const SESSION_TAB: Partial<Record<string, RaceTabKey>> = {
  "practice-1": "practice-1",
  "practice-2": "practice-2",
  "practice-3": "practice-3",
  "sprint-qualifying": "sprint-qualifying",
  sprint: "sprint",
  qualifying: "qualifying",
  race: "race-result",
};

// tab 非 null = 该 session 的成绩已入库。时间不参与服务端判定：
// 页面走边缘缓存，"是否已开始"只能在客户端算（见 scripts/client.ts）
export interface WeekendNode {
  key: string;
  label: string;
  startsAtUtc: string;
  tab: RaceTabKey | null;
}

export function buildWeekendNodes(
  sessions: RaceSession[],
  tabsWithData: readonly RaceTabKey[],
): WeekendNode[] {
  const available = new Set(tabsWithData);
  return sessions.map((session) => {
    const tab = SESSION_TAB[session.key] ?? null;
    return {
      key: session.key,
      label: session.label,
      startsAtUtc: session.startsAtUtc,
      tab: tab !== null && available.has(tab) ? tab : null,
    };
  });
}

// 裸 slug 落点：最后一个已有结果的 session，赛中进来才不会撞上空的正赛 tab
export function latestResultTab(nodes: WeekendNode[]): RaceTabKey {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const tab = nodes[i].tab;
    if (tab !== null) return tab;
  }
  return "race-result";
}
