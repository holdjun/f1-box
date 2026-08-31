import timezones from "../data/circuit-timezones.json";

// circuitId → IANA 时区；未知赛道返回 null（还原为 UTC 渲染）。
// f1db 无时区字段，映射为新建的静态数据，覆盖全部 78 条赛道。
export function circuitTimeZone(circuitId: string): string | null {
  return (timezones as Record<string, string>)[circuitId] ?? null;
}
