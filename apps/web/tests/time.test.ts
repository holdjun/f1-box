import { describe, expect, test } from "vitest";

import {
  formatLocalDateTime,
  formatLocalWeekdayTime,
  formatRaceDate,
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

  test("formats a start time as weekday, clock and zone", () => {
    expect(
      formatLocalWeekdayTime("2026-09-06T13:00:00Z", "Europe/Rome", "en-GB"),
    ).toBe("Sun 15:00 CEST");
  });

  // 无时区映射时调用方回退 UTC，与 formatRaceDate 同口径
  test("start time renders in UTC when the circuit has no zone", () => {
    expect(formatLocalWeekdayTime("2026-11-22T04:00:00Z", "UTC", "en-GB")).toBe(
      "Sun 04:00 UTC",
    );
  });

  // 负偏移夜赛：UTC 周日 04:00 在赛道当地仍是周六晚
  test("start time crosses back into the previous local day", () => {
    expect(
      formatLocalWeekdayTime(
        "2026-11-22T04:00:00Z",
        "America/Los_Angeles",
        "en-GB",
      ),
    ).toBe("Sat 20:00 GMT-8");
  });

  // 跨日夜赛：发车时刻 UTC 04:00，在负偏移时区落到前一天
  test("race date crosses into the previous local day", () => {
    expect(formatRaceDate("2026-11-22", "04:00", "America/Los_Angeles")).toBe(
      "21 Nov 2026",
    );
  });

  // 空 time + 负偏移时区：必须回退 UTC，绝不按合成 00:00 换算（会退一天）
  test("race date with no start time stays in UTC", () => {
    expect(formatRaceDate("1995-03-26", null, "America/New_York")).toBe(
      "26 Mar 1995",
    );
  });

  test("race date with no time zone mapping stays in UTC", () => {
    expect(formatRaceDate("2026-03-08", "04:00", null)).toBe("08 Mar 2026");
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

  // 与 hero 日期同口径：负偏移夜赛的周末范围也按赛道当地日算
  test("formats a weekend range in the circuit time zone", () => {
    expect(
      formatWeekendRange(
        "2026-11-20T02:30:00Z",
        "2026-11-22T04:00:00Z",
        "America/Los_Angeles",
      ),
    ).toBe("19-21 NOV");
  });

  // 占位 00:00（session 无公布时间）不做换算，否则负偏移时区退一天
  test("keeps placeholder weekend starts in UTC", () => {
    expect(
      formatWeekendRange(
        "1995-03-26T00:00:00Z",
        "1995-03-26T00:00:00Z",
        "America/New_York",
      ),
    ).toBe("26 MAR");
  });

  test("rejects an invalid range timestamp", () => {
    expect(() => formatWeekendRange("nope", "2026-03-08T04:00:00Z")).toThrow(
      "Invalid timestamp: nope",
    );
  });
});
