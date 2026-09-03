import type { RaceSummary } from "./race-results-repository.js";

// f1db 无时长数据：练习/排位类估 1h，Sprint/正赛估 2h
const SESSION_MINUTES: Record<string, number> = {
  "practice-1": 60,
  "practice-2": 60,
  "practice-3": 60,
  qualifying: 60,
  "sprint-qualifying": 60,
  sprint: 120,
  race: 120,
};

export function estimateSessionMinutes(key: string): number {
  return SESSION_MINUTES[key] ?? 60;
}

// year 必填且为四位数字；范围合法性交由空结果 → 404 兜底
export function parseCalendarYear(params: URLSearchParams): number | null {
  const raw = params.get("year");
  if (raw === null || !/^\d{4}$/.test(raw)) return null;
  return Number(raw);
}

// buildSessions 对未公布时间的 session 兜底 "00:00"，产生 T00:00:00Z 占位值；
// 该字符串本身就是精确判据（F1 没有 00:00 UTC 开赛的时段），直接过滤
const PLACEHOLDER_START = "T00:00:00Z";

const RFC5545_LINE_LIMIT = 75;

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// RFC 5545 3.1：单行不超过 75 octet，续行以单个空格开头；
// 按 UTF-8 字节折行，不劈开多字节字符（如 SUMMARY 里的 ·）
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= RFC5545_LINE_LIMIT) return line;
  const segments: string[] = [];
  let current = "";
  let bytes = 0;
  let budget = RFC5545_LINE_LIMIT;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (bytes + chBytes > budget) {
      segments.push(current);
      current = "";
      bytes = 0;
      // 续行预算扣掉前导空格自身的 1 octet
      budget = RFC5545_LINE_LIMIT - 1;
    }
    current += ch;
    bytes += chBytes;
  }
  if (current.length > 0) segments.push(current);
  return segments.join("\r\n ");
}

function formatIcsUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function toIcsTimestamp(isoUtc: string): string {
  return formatIcsUtc(new Date(Date.parse(isoUtc)));
}

interface SeasonIcs {
  ics: string;
  eventCount: number;
}

export function buildSeasonIcs(
  year: number,
  races: RaceSummary[],
  origin: string,
  options?: { dtstamp?: string },
): SeasonIcs {
  const dtstamp = options?.dtstamp ?? formatIcsUtc(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//f1-box//Racing Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:F1 ${year} · f1-box`,
    "REFRESH-INTERVAL;VALUE=DURATION:P1D",
  ];
  let eventCount = 0;
  for (const race of races) {
    const url = `${origin}/results/${year}/races/${race.slug}/race-result`;
    for (const s of race.sessions) {
      if (s.startsAtUtc.endsWith(PLACEHOLDER_START)) continue;
      eventCount += 1;
      const start = toIcsTimestamp(s.startsAtUtc);
      const end = formatIcsUtc(
        new Date(
          Date.parse(s.startsAtUtc) + estimateSessionMinutes(s.key) * 60_000,
        ),
      );
      lines.push(
        "BEGIN:VEVENT",
        `UID:${s.key}-${race.slug}-${year}@f1-box.com`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `SUMMARY:${escapeText(`${s.label} · ${race.name}`)}`,
        `URL:${url}`,
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return {
    ics: `${lines.map(foldLine).join("\r\n")}\r\n`,
    eventCount,
  };
}
