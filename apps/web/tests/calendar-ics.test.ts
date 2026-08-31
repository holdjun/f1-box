import { describe, expect, it } from "vitest";

import {
  buildSeasonIcs,
  estimateSessionMinutes,
  parseCalendarYear,
} from "../src/lib/calendar-ics.js";
import type { RaceSummary } from "../src/lib/race-results-repository.js";

const ORIGIN = "https://f1-box.com";

function race(partial: Partial<RaceSummary>): RaceSummary {
  return {
    round: 16,
    slug: "bahrain",
    name: "Bahrain",
    raceName: "Bahrain Grand Prix",
    alpha2Code: "BH",
    countryName: "Bahrain",
    date: "2026-10-04",
    time: "07:00",
    laps: 56,
    circuitId: "sepang",
    circuitLayoutId: "sepang-1",
    circuitName: "Sepang",
    circuitPlace: "Sepang",
    winnerName: null,
    winnerCode: null,
    winnerDriverId: null,
    winnerTeamId: null,
    winnerTeamName: null,
    winnerTime: null,
    poleName: null,
    poleCode: null,
    sessions: [],
    podium: [],
    ...partial,
  };
}

const session = (key: string, label: string, startsAtUtc: string) => ({
  key,
  label,
  startsAtUtc,
});

describe("estimateSessionMinutes", () => {
  it("gives practice/qualifying/sprint-qualifying one hour and sprint/race two", () => {
    expect(estimateSessionMinutes("practice-1")).toBe(60);
    expect(estimateSessionMinutes("practice-3")).toBe(60);
    expect(estimateSessionMinutes("qualifying")).toBe(60);
    expect(estimateSessionMinutes("sprint-qualifying")).toBe(60);
    expect(estimateSessionMinutes("sprint")).toBe(120);
    expect(estimateSessionMinutes("race")).toBe(120);
  });
});

describe("parseCalendarYear", () => {
  it("accepts a four-digit year", () => {
    expect(parseCalendarYear(new URLSearchParams("year=2026"))).toBe(2026);
  });

  it("rejects missing, non-numeric and malformed values", () => {
    expect(parseCalendarYear(new URLSearchParams())).toBeNull();
    expect(parseCalendarYear(new URLSearchParams("year=abc"))).toBeNull();
    expect(parseCalendarYear(new URLSearchParams("year=202"))).toBeNull();
    expect(parseCalendarYear(new URLSearchParams("year=-2026"))).toBeNull();
    expect(parseCalendarYear(new URLSearchParams("year=20.26"))).toBeNull();
  });
});

describe("buildSeasonIcs", () => {
  const dtstamp = "20260826T120000Z";

  it("renders one VEVENT per session with CRLF line endings", () => {
    const races = [
      race({
        sessions: [
          session("practice-1", "Practice 1", "2026-10-02T04:30:00Z"),
          session("race", "Race", "2026-10-04T07:00:00Z"),
        ],
      }),
    ];
    const { ics, eventCount } = buildSeasonIcs(2026, races, ORIGIN, {
      dtstamp,
    });
    expect(eventCount).toBe(2);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    // 除折叠续行外不允许裸 LF
    for (const line of ics.split("\r\n")) {
      expect(line.includes("\n")).toBe(false);
    }
  });

  it("includes mandatory calendar properties and refresh hint", () => {
    const { ics } = buildSeasonIcs(
      2026,
      [race({ sessions: [session("race", "Race", "2026-10-04T07:00:00Z")] })],
      ORIGIN,
      { dtstamp },
    );
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("PRODID:");
    expect(ics).toContain("X-WR-CALNAME:F1 2026 · f1-box\r\n");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:P1D\r\n");
  });

  it("writes UTC DTSTART/DTEND from the fixed duration estimate", () => {
    const { ics } = buildSeasonIcs(
      2026,
      [
        race({
          slug: "australia",
          name: "Australia",
          sessions: [
            session("practice-1", "Practice 1", "2026-03-06T01:30:00Z"),
            session("race", "Race", "2026-03-08T04:00:00Z"),
          ],
        }),
      ],
      ORIGIN,
      { dtstamp },
    );
    expect(ics).toContain("DTSTART:20260306T013000Z\r\n");
    expect(ics).toContain("DTEND:20260306T023000Z\r\n"); // 练习 1h
    expect(ics).toContain("DTSTART:20260308T040000Z\r\n");
    expect(ics).toContain("DTEND:20260308T060000Z\r\n"); // 正赛 2h
  });

  it("builds stable UIDs from key+slug+year and links the results page", () => {
    const { ics } = buildSeasonIcs(
      2026,
      [
        race({
          sessions: [
            session(
              "sprint-qualifying",
              "Sprint Qualifying",
              "2026-10-02T08:30:00Z",
            ),
          ],
        }),
      ],
      ORIGIN,
      { dtstamp },
    );
    expect(ics).toContain("UID:sprint-qualifying-bahrain-2026@f1-box.com\r\n");
    expect(ics).toContain(
      `URL:${ORIGIN}/results/2026/races/bahrain/race-result\r\n`,
    );
  });

  it("names events after the session label and grand prix", () => {
    const { ics } = buildSeasonIcs(
      2026,
      [
        race({
          name: "Spain",
          sessions: [session("race", "Race", "2026-09-13T13:00:00Z")],
        }),
      ],
      ORIGIN,
      { dtstamp },
    );
    expect(ics).toContain("SUMMARY:Race · Spain\r\n");
  });

  it("escapes text specials in summaries", () => {
    const { ics } = buildSeasonIcs(
      2026,
      [
        race({
          name: "Europe, here; we \\\\ go",
          sessions: [session("race", "Race", "2026-09-13T13:00:00Z")],
        }),
      ],
      ORIGIN,
      { dtstamp },
    );
    expect(ics).toContain(
      "SUMMARY:Race · Europe\\, here\\; we \\\\\\\\ go\r\n",
    );
  });

  it("folds lines longer than 75 octets without splitting a code point", () => {
    // X-WR-CALNAME + 长 GP 名（每个 · 占 3 字节）必然超 75 octet
    const longName = "Long".repeat(30); // 120 ASCII chars
    const { ics } = buildSeasonIcs(
      2026,
      [
        race({
          name: longName,
          sessions: [session("race", "Race", "2026-09-13T13:00:00Z")],
        }),
      ],
      ORIGIN,
      { dtstamp },
    );
    for (const rawLine of ics.split("\r\n")) {
      expect(Buffer.byteLength(rawLine, "utf8")).toBeLessThanOrEqual(75);
    }
    const summary = ics
      .split("\r\n")
      .reduce<string[]>((acc, line) => {
        if (acc.length > 0 && line.startsWith(" "))
          acc[acc.length - 1] += line.slice(1);
        else acc.push(line);
        return acc;
      }, [])
      .find((l) => l.startsWith("SUMMARY:"));
    expect(summary).toBe(`SUMMARY:Race · ${longName}`);
  });

  it("drops placeholder-midnight sessions (unpublished times) but keeps real data", () => {
    const { ics, eventCount } = buildSeasonIcs(
      2026,
      [
        race({
          sessions: [
            session("practice-1", "Practice 1", "2026-10-02T00:00:00Z"), // buildSessions 兜底值
            session("race", "Race", "2026-11-22T04:00:00Z"),
          ],
        }),
      ],
      ORIGIN,
      { dtstamp },
    );
    expect(eventCount).toBe(1);
    expect(ics).not.toContain("Practice 1");
    expect(ics).toContain("DTSTART:20261122T040000Z\r\n");
  });

  it("reports zero events when no session survives filtering", () => {
    const { eventCount } = buildSeasonIcs(
      2020,
      [race({ sessions: [session("race", "Race", "2020-07-05T00:00:00Z")] })],
      ORIGIN,
      { dtstamp },
    );
    expect(eventCount).toBe(0);
  });
});
