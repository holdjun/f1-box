// 车队色为事实数据；国旗用公共领域 emoji 兜底。
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

const NATIONALITY_TO_ALPHA2: Record<string, string> = {
  Argentine: "AR", Australian: "AU", Brazilian: "BR", British: "GB",
  Canadian: "CA", Dutch: "NL", Finnish: "FI", French: "FR", German: "DE",
  Italian: "IT", Mexican: "MX", Monegasque: "MC", "New Zealander": "NZ",
  Spanish: "ES", Thai: "TH",
};

export function teamColor(name: string): string {
  return TEAM_COLORS[name] ?? "#84909e";
}

export function flagForNationality(nationality: string | undefined): string {
  const alpha2 = nationality ? NATIONALITY_TO_ALPHA2[nationality] : undefined;
  if (!alpha2) return String.fromCodePoint(0x1f3f3, 0xfe0f);
  return String.fromCodePoint(
    ...[...alpha2.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}
