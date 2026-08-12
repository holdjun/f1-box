type Timestamp = string | Date;

export function formatUtcDateTime(
  value: Timestamp,
  locale = "en-GB",
): string {
  return formatDateTime(value, locale, "UTC");
}

export function formatUtcDate(value: Timestamp, locale = "en-GB"): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`Invalid timestamp: ${String(value)}`);
  }
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

// 生日等"某日"展示：长月份名、无时间，UTC 防时区偏移
export function formatUtcLongDate(value: Timestamp, locale = "en-GB"): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`Invalid timestamp: ${String(value)}`);
  }
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatLocalDateTime(
  value: Timestamp,
  timeZone?: string,
  locale = "en-GB",
): string {
  return formatDateTime(value, locale, timeZone);
}

function formatDateTime(
  value: Timestamp,
  locale: string,
  timeZone?: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`Invalid timestamp: ${String(value)}`);
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: "short",
  }).format(date);
}
