// 国旗用公共领域 emoji（区域指示符拼成），SVG 资产另走 /vendor/country-flags/。
export function alpha2Flag(alpha2: string): string {
  return String.fromCodePoint(
    ...[...alpha2.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}
