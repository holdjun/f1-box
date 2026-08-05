// 车队色为事实数据；国旗用公共领域 emoji 兜底，后续可换 SVG。
const TEAM_COLORS: Record<string, string> = {
  Mercedes: "#27f4d2",
  Ferrari: "#f41919",
  McLaren: "#ff8700",
  "Red Bull Racing": "#3671c6",
  "Racing Bulls": "#6691ff",
  Alpine: "#2293ce",
  Haas: "#848588",
  Audi: "#f10b1c",
  Williams: "#64c4ff",
  "Aston Martin": "#1e5f4f",
  Cadillac: "#b80202",
};

const ALPHA3_TO_ALPHA2: Record<string, string> = {
  GBR: "GB", ITA: "IT", NED: "NL", MON: "MC", AUS: "AU", FRA: "FR",
  NZL: "NZ", ARG: "AR", BRA: "BR", ESP: "ES", JPN: "JP", CAN: "CA",
  USA: "US", BEL: "BE", HUN: "HU", AUT: "AT", GER: "DE", MEX: "MX",
  CHN: "CN", BAH: "BS", AZE: "AZ", QAT: "QA", UAE: "AE", SIN: "SG",
};

export function teamColor(name: string): string {
  return TEAM_COLORS[name] ?? "#84909e";
}

export function countryFlag(code: string): string {
  const alpha2 = ALPHA3_TO_ALPHA2[code];
  if (!alpha2) return String.fromCodePoint(0x1f3f3, 0xfe0f);
  return String.fromCodePoint(
    ...[...alpha2.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}
