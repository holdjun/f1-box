export interface VendorStore {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export interface TeamBranding {
  color: string | null;
  logoSrc: string | null;
}

// 展示元数据缺失或损坏时降级为 null，不抛错（页面主体不受影响）。
export async function getTeamBranding(
  store: VendorStore | undefined,
  teamId: string,
): Promise<TeamBranding> {
  if (!store) return { color: null, logoSrc: null };

  const [colors, logos] = await Promise.all([
    getVendorJson(store, "team-colors/team-colors.json"),
    getVendorJson(store, "team-logos/logos.json"),
  ]);

  return {
    color: pickTeamColor(colors, teamId),
    logoSrc: pickTeamLogo(logos, teamId),
  };
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

function pickTeamColor(colors: unknown, teamId: string): string | null {
  if (typeof colors !== "object" || colors === null) return null;
  const teams = (colors as Record<string, unknown>).teams;
  if (typeof teams !== "object" || teams === null) return null;
  const entry = (teams as Record<string, unknown>)[teamId];
  if (typeof entry !== "object" || entry === null) return null;
  const current = (entry as Record<string, unknown>).colors;
  if (!Array.isArray(current)) return null;
  const color = current[0];
  return typeof color === "string" && /^#[0-9a-f]{3,8}$/i.test(color)
    ? color
    : null;
}

function pickTeamLogo(logos: unknown, teamId: string): string | null {
  if (typeof logos !== "object" || logos === null) return null;
  const entries = (logos as Record<string, unknown>).logos;
  if (!Array.isArray(entries)) return null;

  const prefix = `team-logos/${teamId}@`;
  let best: { file: string; yearFrom: number } | null = null;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.file !== "string" || !record.file.startsWith(prefix)) {
      continue;
    }
    const yearFrom =
      typeof record.yearFrom === "number" ? record.yearFrom : Number.MIN_SAFE_INTEGER;
    if (!best || yearFrom >= best.yearFrom) {
      best = { file: record.file, yearFrom };
    }
  }

  return best ? `/vendor/${best.file}` : null;
}
