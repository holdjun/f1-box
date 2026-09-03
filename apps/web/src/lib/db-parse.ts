// D1 行解析守卫：仓库层共享（仅系统边界校验，内部调用信任类型）
export function asRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid row data: expected ${label} to be an object`);
  }
  return value as Record<string, unknown>;
}

// 列读取器：列名本身就是错误信息里的字段标签，不再逐字段手写一遍。
// 空值统一按 `== null` 判定，同时覆盖 SQL NULL 与缺列。
export interface RowReader {
  str(column: string): string;
  num(column: string): number;
  strOrNull(column: string): string | null;
  numOrNull(column: string): number | null;
  bool(column: string): boolean;
  // 区分"未完赛"与"无该列"：判空不该逼调用方拿原始值自己比
  isNull(column: string): boolean;
}

export function rowReader(row: unknown, label: string): RowReader {
  const record = asRecord(row, label);
  const fail = (column: string, expected: string): never => {
    throw new Error(
      `Invalid row data: expected ${label}.${column} to be ${expected}`,
    );
  };
  const str = (column: string): string => {
    const value = record[column];
    return typeof value === "string" ? value : fail(column, "a string");
  };
  const num = (column: string): number => {
    const value = record[column];
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fail(column, "a number");
  };
  return {
    str,
    num,
    strOrNull: (column) => (record[column] == null ? null : str(column)),
    numOrNull: (column) => (record[column] == null ? null : num(column)),
    bool: (column) => Boolean(record[column]),
    isNull: (column) => record[column] == null,
  };
}
