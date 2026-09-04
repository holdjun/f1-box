type Timestamp = string | Date;

export function formatUtcDateTime(value: Timestamp, locale = "en-GB"): string {
  return formatDateTime(value, locale, "UTC");
}

function formatUtcDate(value: Timestamp, locale = "en-GB"): string {
  return formatDate(value, locale, "UTC");
}

// 按指定时区渲染某日（与 formatUtcDate 同格式，用于赛道当地比赛日）
function formatLocalDate(
  value: Timestamp,
  timeZone: string,
  locale = "en-GB",
): string {
  return formatDate(value, locale, timeZone);
}

// buildSessions 对未公布时间的 session 兜底 00:00，产生 T00:00:00Z 占位值。
// 该字符串本身就是精确判据（F1 没有 00:00 UTC 开赛的时段），占位时刻绝不做时区换算：
// 负偏移时区会把它推到前一天。
const PLACEHOLDER_START = "T00:00:00Z";

function displayZone(startsAtUtc: string, timeZone: string | null): string {
  return timeZone !== null && !startsAtUtc.endsWith(PLACEHOLDER_START)
    ? timeZone
    : "UTC";
}

// 发车时刻是否真实存在。占位时刻不允许进入任何“几点开跑”的渲染：
// 它既不是真实时刻，做时区换算后连日期都会漂移
export function hasPublishedStart(startsAtUtc: string): boolean {
  return !startsAtUtc.endsWith(PLACEHOLDER_START);
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

// en-GB 的九月缩写是四字母（Sept），其余十一个月三字母，日期列宽会跟着跳；
// 统一成三字母，不动 locale（en-US 会把日期顺序整个换成月前日后的写法）
const normalizeShortMonth = (s: string): string => s.replaceAll("Sept", "Sep");

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
  return normalizeShortMonth(
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone,
    }).format(date),
  );
}

// 周末日期范围（首练 → 正赛）：同月缩成 "06-08 MAR"，跨月 "27 FEB - 01 MAR"。
// 日期口径与 hero 一致——有 timeZone 时按赛道当地日算，负偏移夜赛才不会比详情页多一天。
export function formatWeekendRange(
  firstStartsAtUtc: string,
  lastStartsAtUtc: string,
  timeZone: string | null = null,
  locale = "en-GB",
): string {
  const first = zonedParts(firstStartsAtUtc, timeZone, locale);
  const last = zonedParts(lastStartsAtUtc, timeZone, locale);
  const sameMonth = first.month === last.month && first.year === last.year;
  // 老赛季无练习赛数据：首尾同日的周末只显示单日，不重复 "06-06 MAR"
  if (sameMonth && first.day === last.day) {
    return `${first.day} ${first.month}`;
  }
  return sameMonth
    ? `${first.day}-${last.day} ${last.month}`
    : `${first.day} ${first.month} - ${last.day} ${last.month}`;
}

function zonedParts(
  startsAtUtc: string,
  timeZone: string | null,
  locale: string,
): { day: string; month: string; year: string } {
  const date = new Date(startsAtUtc);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`Invalid timestamp: ${String(startsAtUtc)}`);
  }
  const parts = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: displayZone(startsAtUtc, timeZone),
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: pick("day"),
    month: normalizeShortMonth(pick("month")).toUpperCase(),
    year: pick("year"),
  };
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

// 未开赛场次的发车时刻：星期 + 时刻 + 时区缩写（"Sun 15:00 CEST"），
// 与卡片周末日期同口径按赛道当地渲染；无时区映射时由调用方传 UTC，
// 不留可选参数默认到服务端本地时区。Intl 输出带逗号，卡片行里是噪音，按部件拼装
export function formatLocalWeekdayTime(
  value: Timestamp,
  timeZone: string,
  locale = "en-GB",
): string {
  const parts = weekdayTimeParts(value, timeZone, locale, true);
  return `${parts.weekday} ${parts.time} ${parts.zone}`;
}

// 周末赛程表：两行并列已经说明了哪行是哪个时区，缩写只是噪音
export function formatWeekdayTime(
  value: Timestamp,
  timeZone: string,
  locale = "en-GB",
): string {
  const parts = weekdayTimeParts(value, timeZone, locale, false);
  return `${parts.weekday} ${parts.time}`;
}

// 未公布发车时刻的场次：只出星期与日期（"Sun 19 Nov"）。date 存的就是赛道
// 当地日期，按 UTC 原样呈现；换算反而会把负偏移赛道推到前一天
export function formatWeekdayDate(
  startsAtUtc: string,
  locale = "en-GB",
): string {
  const date = new Date(startsAtUtc);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`Invalid timestamp: ${String(startsAtUtc)}`);
  }
  const parts = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("weekday")} ${pick("day")} ${normalizeShortMonth(pick("month"))}`;
}

function weekdayTimeParts(
  value: Timestamp,
  timeZone: string,
  locale: string,
  withZone: boolean,
): { weekday: string; time: string; zone: string } {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`Invalid timestamp: ${String(value)}`);
  }
  const parts = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: withZone ? "short" : undefined,
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: pick("weekday"),
    time: `${pick("hour")}:${pick("minute")}`,
    zone: pick("timeZoneName"),
  };
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

  return normalizeShortMonth(
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
      timeZoneName: "short",
    }).format(date),
  );
}
