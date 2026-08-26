import { describe, expect, test } from "vitest";

import {
  formatLocalDateTime,
  formatUtcDateTime,
  formatUtcLongDate,
  formatWeekendRange,
} from "../src/lib/time.js";

describe("time formatting", () => {
  test("formats a timestamp in UTC", () => {
    expect(formatUtcDateTime("2026-03-08T04:00:00Z", "en-GB")).toBe(
      "08 Mar 2026, 04:00 UTC",
    );
  });

  test("formats a timestamp in an explicit local time zone", () => {
    expect(
      formatLocalDateTime("2026-03-08T04:00:00Z", "Asia/Shanghai", "en-GB"),
    ).toBe("08 Mar 2026, 12:00 GMT+8");
  });

  test("rejects an invalid timestamp with a diagnostic value", () => {
    expect(() => formatUtcDateTime("not-a-time")).toThrow(
      "Invalid timestamp: not-a-time",
    );
  });

  test("formats a birth date with the long month name", () => {
    expect(formatUtcLongDate("1998-02-15")).toBe("15 February 1998");
    expect(formatUtcLongDate("1960-03-21")).toBe("21 March 1960");
  });

  test("formats a weekend range within one month", () => {
    expect(
      formatWeekendRange("2026-03-06T01:30:00Z", "2026-03-08T04:00:00Z"),
    ).toBe("06-08 MAR");
  });

  // 老赛季无练习赛数据：首练与正赛同一天（同值），应显示单日而非重复的 "06-06 MAR"
  test("formats a single-day weekend as one date", () => {
    expect(
      formatWeekendRange("1951-07-01T14:00:00Z", "1951-07-01T14:00:00Z"),
    ).toBe("01 JUL");
  });

  test("formats a weekend range across months", () => {
    expect(
      formatWeekendRange("2026-06-26T12:00:00Z", "2026-07-05T14:00:00Z"),
    ).toBe("26 JUN - 05 JUL");
  });

  test("rejects an invalid range timestamp", () => {
    expect(() => formatWeekendRange("nope", "2026-03-08T04:00:00Z")).toThrow(
      "Invalid timestamp: nope",
    );
  });
});
