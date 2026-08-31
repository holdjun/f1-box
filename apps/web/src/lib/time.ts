type Timestamp = string | Date;

export function formatUtcDateTime(value: Timestamp, locale = "en-GB"): string {
  return formatDateTime(value, locale, "UTC");
}

export function formatUtcDate(value: Timestamp, locale = "en-GB"): string {
  return formatDate(value, locale, "UTC");
}

// 按指定时区渲染某日（与 formatUtcDate 同格式，用于赛道当地比赛日）
export function formatLocalDate(
  value: Timestamp,
  timeZone: string,
  locale = "en-GB",
): string {
  return formatDate(value, locale, timeZone);
}

// 副行日期渲染的唯一入口：仅当发车时刻与赛道时区均存在时按赛道时区渲染当地比赛日，
// 否则回退 UTC 日期。空 time 的历史赛绝不能按合成 00:00 做时区换算（负偏移时区会退一天）。
export function formatRaceDate(
  date: string,
  time: string | null,
  timeZone: string | null,
): string {
  if (time !== null && timeZone !== null) {
    return formatLocalDate(`${date}T${time}:00Z`, timeZone);
  }
  return formatUtcDate(date);
}

// Intl 同一选项：两位日/短月/四位年 + 指定时区
function formatDate(
  value: Timestamp,
  locale: string,
  timeZone: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`Invalid timestamp: ${String(value)}`);
  }
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(date);
}

// 周末日期范围（首练 → 正赛）：同月缩成 "06-08 MAR"，跨月 "27 FEB - 01 MAR"
export function formatWeekendRange(
  firstStartsAtUtc: string,
  lastStartsAtUtc: string,
  locale = "en-GB",
): string {
  const formatPart = (value: string, part: "day" | "month") => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new TypeError(`Invalid timestamp: ${String(value)}`);
    }
    return new Intl.DateTimeFormat(locale, {
      [part]: part === "day" ? "2-digit" : "short",
      timeZone: "UTC",
    }).format(date);
  };
  const first = new Date(firstStartsAtUtc);
  const last = new Date(lastStartsAtUtc);
  // 老赛季无练习赛数据：首尾同日的周末只显示单日，不重复 "06-06 MAR"；
  // getTime() 对 invalid 输入返回 NaN（NaN===NaN 为 false），诊断仍由 formatPart 抛出
  const sameDay =
    first.getTime() === last.getTime() && Number.isFinite(first.getTime());
  const sameMonth =
    first.getUTCFullYear() === last.getUTCFullYear() &&
    first.getUTCMonth() === last.getUTCMonth();
  // 老赛季无练习赛数据：首尾同日的周末只显示单日，不重复 "06-06 MAR"
  if (sameDay) {
    return `${formatPart(firstStartsAtUtc, "day")} ${formatPart(firstStartsAtUtc, "month").toUpperCase()}`;
  }
  return sameMonth
    ? `${formatPart(firstStartsAtUtc, "day")}-${formatPart(lastStartsAtUtc, "day")} ${formatPart(lastStartsAtUtc, "month").toUpperCase()}`
    : `${formatPart(firstStartsAtUtc, "day")} ${formatPart(firstStartsAtUtc, "month").toUpperCase()} - ${formatPart(lastStartsAtUtc, "day")} ${formatPart(lastStartsAtUtc, "month").toUpperCase()}`;
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
