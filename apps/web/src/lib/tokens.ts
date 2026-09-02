// 国旗用公共领域 emoji（区域指示符拼成），SVG 资产另走 /vendor/country-flags/。
export function alpha2Flag(alpha2: string): string {
  return String.fromCodePoint(
    ...[...alpha2.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

// 队色作 monogram 背景时，文字按背景亮度取纯黑/纯白，
// 保证小字号文本对比度 ≥ 4.5:1（主题色固定时部分队色两方向都不达标）
export function monogramStyle(
  color: string | null | undefined,
): string | undefined {
  if (!color) return undefined;
  // 经自定义属性下发：类自身的 color 声明会压过从父元素继承的内联 color
  return `--monogram-bg: ${color}; --monogram-fg: ${contrastOn(color)}`;
}

function contrastOn(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255);
  return luminance >= 0.18 ? "#000" : "#fff";
}
