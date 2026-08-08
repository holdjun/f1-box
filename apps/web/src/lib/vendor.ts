export interface VendorStore {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export interface TeamBranding {
  colors: string[];
  logoSrc: string | null;
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
  logos: { file: string; yearFrom: number }[] | null;
}

// 一次拉取两份策展 JSON，供整页多队查询复用
export async function getVendorIndexes(
  store: VendorStore | undefined,
): Promise<VendorIndexes> {
  if (!store) return { colors: null, logos: null };

  const [colors, logos] = await Promise.all([
    getVendorJson(store, "team-colors/team-colors.json"),
    getVendorJson(store, "team-logos/logos.json"),
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
          return typeof record.file === "string" && typeof record.yearFrom === "number"
            ? [{ file: record.file, yearFrom: record.yearFrom }]
            : [];
        })
      : null,
  };
}

export async function getTeamBranding(
  store: VendorStore | undefined,
  teamId: string,
): Promise<TeamBranding> {
  const indexes = await getVendorIndexes(store);
  return {
    colors: latestColors(indexes, teamId),
    logoSrc: logoSrcFor(indexes, teamId),
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
  if (!indexes.logos) return null;
  const prefix = `team-logos/${teamId}@`;
  let best: { file: string; yearFrom: number } | null = null;
  for (const entry of indexes.logos) {
    if (!entry.file.startsWith(prefix)) continue;
    if (!best || entry.yearFrom >= best.yearFrom) best = entry;
  }
  return best ? `/vendor/${best.file}` : null;
}

async function getVendorJson(
  store: VendorStore,
  key: string,
): Promise<unknown> {
  try {
    const object = await store.get(`vendor/${key}`);
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
