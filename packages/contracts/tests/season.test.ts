import { describe, expect, test } from "vitest";

import season2026 from "../fixtures/season-2026.json";
import { parseSeasonPayload } from "../src/season.js";

describe("parseSeasonPayload", () => {
  test("returns the same valid 2026 season fixture object", () => {
    expect(parseSeasonPayload(season2026)).toBe(season2026);
    expect(season2026.events).toHaveLength(22);
  });

  test("accepts a season without a next round", () => {
    const payload = { ...season2026, nextRound: null };

    expect(parseSeasonPayload(payload)).toBe(payload);
  });

  test("rejects an unsupported schema version", () => {
    expectInvalidPayload({ ...season2026, schemaVersion: 2 }, "/schemaVersion");
  });

  test("rejects a payload with no sources", () => {
    expectInvalidPayload({ ...season2026, sources: [] }, "/sources");
  });

  test("rejects duplicate event rounds", () => {
    expectInvalidPayload(
      {
        ...season2026,
        events: [season2026.events[0], { ...season2026.events[1], round: 1 }],
      },
      "/events/1/round",
    );
  });

  test("rejects a complete event without a race classification", () => {
    expectInvalidPayload(
      {
        ...season2026,
        events: [
          {
            ...season2026.events[0],
            state: "complete",
            qualifyingClassification: { sessionKey: "qualifying", rows: [] },
          },
          ...season2026.events.slice(1),
        ],
      },
      "/events/0/raceClassification",
    );
  });

  test("rejects a complete event without a qualifying classification", () => {
    expectInvalidPayload(
      {
        ...season2026,
        events: [
          {
            ...season2026.events[0],
            state: "complete",
            raceClassification: { sessionKey: "race", rows: [] },
          },
          ...season2026.events.slice(1),
        ],
      },
      "/events/0/qualifyingClassification",
    );
  });
});

function expectInvalidPayload(value: unknown, errorPath: string): void {
  expect(() => parseSeasonPayload(value)).toThrow(TypeError);
  expect(() => parseSeasonPayload(value)).toThrow(errorPath);
}
