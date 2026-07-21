import seasonFixture from "@f1-box/contracts/fixtures/season-2026.json";
import {
  parseSeasonPayload,
  type SeasonPayload,
} from "@f1-box/contracts/season";

export interface SeasonRepository {
  getSeason(year: number): Promise<SeasonPayload>;
}

export interface SeasonObjectStore {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

interface SeasonManifest {
  schemaVersion: 1;
  season: number;
  checksum: string;
  payloadKey: string;
  generatedAt: string;
}

const manifestFields = [
  "schemaVersion",
  "season",
  "checksum",
  "payloadKey",
  "generatedAt",
];

export function createSeasonRepository(
  store?: SeasonObjectStore,
  clock: () => Date = () => new Date(),
): SeasonRepository {
  return {
    async getSeason(year) {
      if (store) {
        const manifestKey = `v1/seasons/${year}/latest.json`;
        const manifestObject = await store.get(manifestKey);
        if (!manifestObject) {
          throw new Error(`Season manifest not found: ${manifestKey}`);
        }

        const manifest = parseManifest(
          parseJson(await manifestObject.text(), manifestKey),
          year,
          manifestKey,
        );

        const payloadObject = await store.get(manifest.payloadKey);
        if (!payloadObject) {
          throw new Error(`Season payload not found: ${manifest.payloadKey}`);
        }

        const payload = parseStoredPayload(
          parseJson(await payloadObject.text(), manifest.payloadKey),
          manifest,
        );
        return withEffectiveFreshness(payload, clock());
      }

      const payload = parseSeasonPayload(seasonFixture);
      if (payload.season !== year) {
        throw new Error(`Season ${year} is not available in the local fixture`);
      }

      return withEffectiveFreshness(payload, clock());
    },
  };
}

function parseStoredPayload(
  value: unknown,
  manifest: SeasonManifest,
): SeasonPayload {
  let payload: SeasonPayload;
  try {
    payload = parseSeasonPayload(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid season payload at ${manifest.payloadKey}: ${reason}`,
      { cause: error },
    );
  }

  if (
    payload.season !== manifest.season ||
    payload.generatedAt !== manifest.generatedAt
  ) {
    throw new Error(
      `Invalid season payload at ${manifest.payloadKey}: season or generatedAt disagrees with manifest`,
    );
  }

  return payload;
}

function parseManifest(
  value: unknown,
  year: number,
  key: string,
): SeasonManifest {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== manifestFields.length ||
    !manifestFields.every((field) => Object.hasOwn(value, field))
  ) {
    throw invalidManifest(key);
  }

  const { checksum, generatedAt, payloadKey, schemaVersion, season } = value;
  if (
    schemaVersion !== 1 ||
    season !== year ||
    typeof checksum !== "string" ||
    !/^[a-f0-9]{64}$/.test(checksum) ||
    payloadKey !== `v1/seasons/${year}/${checksum}.json` ||
    typeof generatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(generatedAt) ||
    !Number.isFinite(Date.parse(generatedAt))
  ) {
    throw invalidManifest(key);
  }

  return { schemaVersion, season, checksum, payloadKey, generatedAt };
}

function invalidManifest(key: string): Error {
  return new Error(
    `Invalid season manifest at ${key}: expected schemaVersion, season, checksum, payloadKey and generatedAt`,
  );
}

function parseJson(text: string, key: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${key}: ${reason}`, { cause: error });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withEffectiveFreshness(
  payload: SeasonPayload,
  now: Date,
): SeasonPayload {
  const oldestSourceTime = Math.min(
    ...payload.sources.map((source) => Date.parse(source.fetchedAt)),
  );
  const ageMs = Math.max(now.getTime() - oldestSourceTime, 0);
  const freshness =
    ageMs <= 2 * 60 * 60 * 1_000
      ? "fresh"
      : ageMs <= 24 * 60 * 60 * 1_000
        ? "delayed"
        : "stale";

  return { ...payload, freshness };
}
