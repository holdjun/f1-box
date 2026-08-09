export interface VendorStore {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export interface TeamBranding {
  colors: string[];
  logoSrc: string | null;
  logoVariant: LogoVariant | null;
}

export type LogoVariant = "color" | "white" | "mono";

interface LogoAsset {
  file: string;
  yearFrom: number;
  variant: LogoVariant;
}

interface ColorPeriod {
  from: number;
  to: number | null;
  colors: string[];
}

interface TeamColors {
  colors: string[];
  periods: ColorPeriod[];
}

export interface VendorIndexes {
  colors: Record<string, TeamColors> | null;
  logos: LogoAsset[] | null;
}

const VENDOR_CONTENT_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  json: "application/json",
};

export function vendorContentType(key: string): string {
  const extension = key.split("/").at(-1)?.split(".").pop()?.toLowerCase() ?? "";
  return VENDOR_CONTENT_TYPES[extension] ?? "application/octet-stream";
}

// 一次拉取两份策展 JSON，供整页多队查询复用
export async function getVendorIndexes(
  store: VendorStore | undefined,
  overrideStore?: VendorStore,
): Promise<VendorIndexes> {
  if (!store) return { colors: null, logos: null };

  const [colors, logos] = await Promise.all([
    getVendorJson(store, "team-colors/team-colors.json", overrideStore),
    getVendorJson(store, "team-logos/logos.json", overrideStore),
  ]);

  const colorsIndex =
    typeof colors === "object" && colors !== null
      ? ((colors as Record<string, unknown>).teams as Record<string, TeamColors> | undefined) ?? null
      : null;
  const logosRaw =
    typeof logos === "object" && logos !== null
      ? ((logos as Record<string, unknown>).logos as unknown[] | undefined)
      : null;

  return {
    colors: colorsIndex,
    logos: Array.isArray(logosRaw)
      ? logosRaw.flatMap((entry) => {
          if (typeof entry !== "object" || entry === null) return [];
          const record = entry as Record<string, unknown>;
          const variant = record.variant;
          return typeof record.file === "string" &&
            typeof record.yearFrom === "number" &&
            (variant === "color" || variant === "white" || variant === "mono")
            ? [{ file: record.file, yearFrom: record.yearFrom, variant }]
            : [];
        })
      : null,
  };
}

export async function getTeamBranding(
  store: VendorStore | undefined,
  teamId: string,
  overrideStore?: VendorStore,
): Promise<TeamBranding> {
  const indexes = await getVendorIndexes(store, overrideStore);
  const logo = logoFor(indexes, teamId);
  return {
    colors: latestColors(indexes, teamId),
    logoSrc: logo ? `/vendor/${logo.file}` : null,
    logoVariant: logo?.variant ?? null,
  };
}

export function latestColors(indexes: VendorIndexes, teamId: string): string[] {
  const team = indexes.colors?.[teamId];
  if (!team) return [];
  return team.colors.filter((c): c is string => Boolean(validHex(c)));
}

export function latestColor(indexes: VendorIndexes, teamId: string): string | null {
  return latestColors(indexes, teamId)[0] ?? null;
}

export function colorForYear(
  indexes: VendorIndexes,
  teamId: string,
  year: number,
): string | null {
  const team = indexes.colors?.[teamId];
  if (!team) return null;
  const period = team.periods.find(
    (p) => p.from <= year && (p.to === null || year <= p.to),
  );
  return validHex((period ?? team).colors[0]);
}

export function logoSrcFor(indexes: VendorIndexes, teamId: string): string | null {
  const logo = logoFor(indexes, teamId);
  return logo ? `/vendor/${logo.file}` : null;
}

export function logoVariantFor(
  indexes: VendorIndexes,
  teamId: string,
): LogoVariant | null {
  return logoFor(indexes, teamId)?.variant ?? null;
}

function logoFor(indexes: VendorIndexes, teamId: string): LogoAsset | null {
  if (!indexes.logos) return null;
  const prefix = `team-logos/${teamId}@`;
  let best: LogoAsset | null = null;
  for (const entry of indexes.logos) {
    if (!entry.file.startsWith(prefix)) continue;
    if (!best || entry.yearFrom >= best.yearFrom) best = entry;
  }
  return best;
}

async function getVendorJson(
  store: VendorStore,
  key: string,
  overrideStore?: VendorStore,
): Promise<unknown> {
  try {
    const object =
      (overrideStore ? await overrideStore.get(`vendor/${key}`) : null) ??
      (await store.get(`vendor/${key}`));
    if (!object) return null;
    return JSON.parse(await object.text());
  } catch (error) {
    console.error(`Failed to read vendor/${key}:`, error);
    return null;
  }
}

function validHex(color: string | undefined): string | null {
  return typeof color === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)
    ? color
    : null;
}
