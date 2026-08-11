import rawLogos from "../data/logos.json";
import rawTeamColors from "../data/team-colors.json";

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
  colors: Record<string, TeamColors>;
  logos: LogoAsset[];
}

// 策展资产与索引存放在仓库（src/data + public/vendor），构建期内联、随代码一起部署。
// preview 与生产天然同源，无需运行时 R2 读取，也不再有桶级覆盖层。
export const vendorIndexes: VendorIndexes = {
  colors: rawTeamColors.teams as Record<string, TeamColors>,
  logos: rawLogos.logos as LogoAsset[],
};

export function getTeamBranding(indexes: VendorIndexes, teamId: string): TeamBranding {
  const logo = logoFor(indexes, teamId);
  return {
    colors: latestColors(indexes, teamId),
    logoSrc: logo ? logoUrl(logo.file) : null,
    logoVariant: logo?.variant ?? null,
  };
}

export function latestColors(indexes: VendorIndexes, teamId: string): string[] {
  return indexes.colors[teamId]?.colors ?? [];
}

export function latestColor(indexes: VendorIndexes, teamId: string): string | null {
  return latestColors(indexes, teamId)[0] ?? null;
}

export function logoSrcFor(indexes: VendorIndexes, teamId: string): string | null {
  const logo = logoFor(indexes, teamId);
  return logo ? logoUrl(logo.file) : null;
}

export function logoVariantFor(
  indexes: VendorIndexes,
  teamId: string,
): LogoVariant | null {
  return logoFor(indexes, teamId)?.variant ?? null;
}

function logoFor(indexes: VendorIndexes, teamId: string): LogoAsset | null {
  const prefix = `team-logos/${teamId}@`;
  let best: LogoAsset | null = null;
  for (const entry of indexes.logos) {
    if (!entry.file.startsWith(prefix)) continue;
    if (!best || entry.yearFrom >= best.yearFrom) best = entry;
  }
  return best;
}

// 文件名里的 @ 需编码为 %40，否则 Cloudflare 静态资产层会先回一个 307 跳转
function logoUrl(file: string): string {
  return `/vendor/${file.split("/").map(encodeURIComponent).join("/")}`;
}
