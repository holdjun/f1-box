// 国旗用公共领域 emoji（区域指示符拼成），SVG 资产另走 /vendor/country-flags/。
export function alpha2Flag(alpha2: string): string {
  return String.fromCodePoint(
    ...[...alpha2.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

// 无车号/无 logo 时的两字母回落标识：首尾 token 首字母
export function monogram(name: string): string {
  const tokens = name.split(" ").filter((token) => token.length > 0);
  if (tokens.length < 2) return name.slice(0, 2).toUpperCase();
  return `${tokens[0][0]}${tokens[tokens.length - 1][0]}`.toUpperCase();
}
