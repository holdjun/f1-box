import rawAliases from "../../data/f1-aliases.json";

// 中文译名/绰号 → f1db id。别名归一化（trim + 小写）在查询侧做，避免长别名表进提示词
export interface AskAliases {
  drivers: Record<string, string>;
  constructors: Record<string, string>;
  grandPrix: Record<string, string>;
}

export const askAliases = rawAliases as AskAliases;

export function normalizeAlias(raw: string): string {
  return raw.trim().toLowerCase();
}

export function resolveAlias(
  raw: string,
  table: Record<string, string>,
): string | null {
  const key = normalizeAlias(raw);
  // hasOwn 防护：constructor/__proto__ 等原型键直接索引会返回继承成员
  return Object.hasOwn(table, key) ? table[key] : null;
}
