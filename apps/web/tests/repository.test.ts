import { describe, expect, test } from "vitest";

import seasonFixture from "@f1-box/contracts/fixtures/season-2026.json";

import {
  createSeasonRepository,
  type SeasonObjectStore,
} from "../src/lib/season-repository.js";

const checksum = "a".repeat(64);
const payloadKey = `v1/seasons/2026/${checksum}.json`;

function object(text: string): { text(): Promise<string> } {
  return { text: async () => text };
}

function storeWith(
  entries: Record<string, string>,
  reads: string[] = [],
): SeasonObjectStore {
  return {
    async get(key) {
      reads.push(key);
      const value = entries[key];
      return value === undefined ? null : object(value);
    },
  };
}

function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    season: 2026,
    checksum,
    payloadKey,
    generatedAt: seasonFixture.generatedAt,
    ...overrides,
  });
}

describe("createSeasonRepository", () => {
  test("reads the shared fixture when no object store is provided", async () => {
    const repository = createSeasonRepository(
      undefined,
      () => new Date("2026-01-01T01:00:00Z"),
    );

    const season = await repository.getSeason(2026);

    expect(season.season).toBe(2026);
    expect(season.events).toHaveLength(22);
    expect(season.freshness).toBe("fresh");
  });

  test("reads a validated manifest before its immutable R2 payload", async () => {
    const reads: string[] = [];
    const repository = createSeasonRepository(
      storeWith(
        {
          "v1/seasons/2026/latest.json": manifest(),
          [payloadKey]: JSON.stringify(seasonFixture),
        },
        reads,
      ),
      () => new Date("2026-01-01T01:00:00Z"),
    );

    const season = await repository.getSeason(2026);

    expect(season.season).toBe(2026);
    expect(reads).toEqual(["v1/seasons/2026/latest.json", payloadKey]);
  });

  test.each([
    ["an extra field", { extra: true }],
    ["the wrong schema version", { schemaVersion: 2 }],
    ["the wrong season", { season: 2025 }],
    ["an invalid checksum", { checksum: "not-a-checksum" }],
    [
      "a payload key inconsistent with its checksum",
      { payloadKey: "v1/seasons/2026/b.json" },
    ],
    ["an invalid generated time", { generatedAt: "yesterday" }],
  ])("rejects a manifest with %s before reading a payload", async (_, overrides) => {
    const reads: string[] = [];
    const repository = createSeasonRepository(
      storeWith(
        {
          "v1/seasons/2026/latest.json": manifest(overrides),
          [payloadKey]: JSON.stringify(seasonFixture),
          "v1/seasons/2026/b.json": JSON.stringify(seasonFixture),
        },
        reads,
      ),
    );

    await expect(repository.getSeason(2026)).rejects.toThrow(
      /Invalid season manifest.*v1\/seasons\/2026\/latest\.json/,
    );
    expect(reads).toEqual(["v1/seasons/2026/latest.json"]);
  });

  test("does not fall back to the fixture when an R2 manifest is missing", async () => {
    const repository = createSeasonRepository(storeWith({}));

    await expect(repository.getSeason(2026)).rejects.toThrow(
      "Season manifest not found: v1/seasons/2026/latest.json",
    );
  });

  test("reports a missing immutable R2 payload", async () => {
    const repository = createSeasonRepository(
      storeWith({ "v1/seasons/2026/latest.json": manifest() }),
    );

    await expect(repository.getSeason(2026)).rejects.toThrow(
      `Season payload not found: ${payloadKey}`,
    );
  });

  test("reports the R2 key when a payload fails schema validation", async () => {
    const repository = createSeasonRepository(
      storeWith({
        "v1/seasons/2026/latest.json": manifest(),
        [payloadKey]: JSON.stringify({ ...seasonFixture, sources: [] }),
      }),
    );

    await expect(repository.getSeason(2026)).rejects.toThrow(
      new RegExp(`Invalid season payload at ${payloadKey}.*\\/sources`),
    );
  });

  test.each([
    ["season", { ...seasonFixture, season: 2025 }],
    [
      "generatedAt",
      { ...seasonFixture, generatedAt: "2026-01-01T00:00:01Z" },
    ],
  ])("rejects a payload whose %s disagrees with its manifest", async (_, payload) => {
    const repository = createSeasonRepository(
      storeWith({
        "v1/seasons/2026/latest.json": manifest(),
        [payloadKey]: JSON.stringify(payload),
      }),
    );

    await expect(repository.getSeason(2026)).rejects.toThrow(
      new RegExp(`Invalid season payload at ${payloadKey}.*manifest`),
    );
  });

  test.each([
    ["2026-01-01T02:00:00Z", "fresh"],
    ["2026-01-01T02:00:01Z", "delayed"],
    ["2026-01-02T00:00:00Z", "delayed"],
    ["2026-01-02T00:00:01Z", "stale"],
  ] as const)(
    "computes %s source data as %s at read time",
    async (now, expectedFreshness) => {
      const repository = createSeasonRepository(
        storeWith({
          "v1/seasons/2026/latest.json": manifest(),
          [payloadKey]: JSON.stringify(seasonFixture),
        }),
        () => new Date(now),
      );

      await expect(repository.getSeason(2026)).resolves.toMatchObject({
        freshness: expectedFreshness,
      });
    },
  );

  test("uses the oldest source and recomputes freshness on every read", async () => {
    let now = new Date("2026-01-01T01:00:00Z");
    const storedPayload = JSON.stringify({
      ...seasonFixture,
      freshness: "unavailable",
      sources: [
        ...seasonFixture.sources,
        {
          name: "Recent source",
          url: "https://example.com/recent",
          fetchedAt: "2026-01-01T00:59:00Z",
        },
      ],
    });
    const repository = createSeasonRepository(
      storeWith({
        "v1/seasons/2026/latest.json": manifest(),
        [payloadKey]: storedPayload,
      }),
      () => now,
    );

    await expect(repository.getSeason(2026)).resolves.toMatchObject({
      freshness: "fresh",
    });

    now = new Date("2026-01-02T01:00:01Z");

    await expect(repository.getSeason(2026)).resolves.toMatchObject({
      freshness: "stale",
    });
    expect(JSON.parse(storedPayload)).toMatchObject({ freshness: "unavailable" });
  });
});
