// D1 行解析守卫：driver/team 仓库共享（仅系统边界校验，内部调用信任类型）
export function asRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid row data: expected ${label} to be an object`);
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid row data: expected ${label} to be a string`);
  }
  return value;
}

export function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid row data: expected ${label} to be a number`);
  }
  return value;
}
