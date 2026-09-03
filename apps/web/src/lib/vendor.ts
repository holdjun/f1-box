import rawLogos from "../data/logos.json";
import rawTeamColors from "../data/team-colors.json";

interface TeamBranding {
  colors: string[];
  logoSrc: string | null;
  logoVariant: LogoVariant | null;
}

type LogoVariant = "color" | "white" | "mono";

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

export function getTeamBranding(
  indexes: VendorIndexes,
  teamId: string,
): TeamBranding {
  const logo = logoFor(indexes, teamId);
  return {
    colors: latestColors(indexes, teamId),
    logoSrc: logo ? logoUrl(logo.file) : null,
    logoVariant: logo?.variant ?? null,
  };
}

function latestColors(indexes: VendorIndexes, teamId: string): string[] {
  return indexes.colors[teamId]?.colors ?? [];
}

export function latestColor(
  indexes: VendorIndexes,
  teamId: string,
): string | null {
  return latestColors(indexes, teamId)[0] ?? null;
}

// 取车队在指定年份的配色：覆盖该年的 period；早于最早 period 用最老配色；
// 车队缺失或期间无定义回落 null/最新色
// （data lookup 语义：colors(team, year)，year < oldest → oldest）
export function colorForYear(
  indexes: VendorIndexes,
  teamId: string,
  year: number,
): string | null {
  const team = indexes.colors[teamId];
  if (!team) return null;
  const containing = team.periods.find(
    (period) =>
      period.from <= year && (period.to === null || period.to >= year),
  );
  if (containing) return containing.colors[0] ?? null;
  if (team.periods[0] && year < team.periods[0].from) {
    return team.periods[0].colors[0] ?? null;
  }
  return team.colors[0] ?? null;
}

export function logoSrcFor(
  indexes: VendorIndexes,
  teamId: string,
): string | null {
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

// 文件名含年份版本 @：@ 本是合法路径字符；Astro dev 静态服务不解码 %40（404），
// 生产 Cloudflare 对裸 @ 仅多一次 307 跳转后同资产 200，浏览器可缓存，故保留裸 @
function logoUrl(file: string): string {
  return `/vendor/${file
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/%40/g, "@"))
    .join("/")}`;
}
