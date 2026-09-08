# /// script
# requires-python = ">=3.12"
# dependencies = ["fastf1>=3.5"]
# ///
"""同步 FastF1 可提供的 session 实测天气到 session_weather。

只使用 FastF1 `api.weather_data`：AirTemp(°C) → temp_c、TrackTemp(°C) →
track_temp_c、Rainfall(bool) → weather_code='rain'。取不到的字段保持 NULL；整个
session 取不到就不写，不用其他来源补值。

默认处理 f1db 中 2018 起的全部赛季；日常 workflow 传当前赛季，历史回填由手动输入
显式触发。`--have` 清单中的成功行不会重抓，失败 session 则会在后续运行重试。

脚本只生成 INSERT OR REPLACE SQL，自身不连接 D1。
"""

import argparse
import math
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlretrieve

import fastf1  # pyright: ignore[reportMissingImports]
import fastf1.api as fastf1_api  # pyright: ignore[reportMissingImports]

from f1_session_keys import matches_race_date, session_key

WEATHER_SINCE = 2018
SESSION_SETTLE_DELAY = timedelta(hours=4)


def fetch_db() -> Path:
    work = Path(tempfile.mkdtemp())
    zip_path = work / "f1db-sqlite.zip"
    urlretrieve(
        "https://github.com/f1db/f1db/releases/latest/download/f1db-sqlite.zip",
        zip_path,
    )
    with zipfile.ZipFile(zip_path) as archive:
        archive.extract("f1db.db", work)
    return work / "f1db.db"


def _median(values: list[float | None]) -> float | None:
    nums: list[float] = []
    for value in values:
        if value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(number):
            nums.append(number)
    nums.sort()
    if not nums:
        return None
    mid = len(nums) // 2
    return nums[mid] if len(nums) % 2 else (nums[mid - 1] + nums[mid]) / 2


def _column(weather, name: str) -> list:
    if hasattr(weather, "columns"):
        if name not in weather.columns:
            return []
        return weather[name].tolist()
    if isinstance(weather, dict):
        return list(weather.get(name, []))
    return []


def _has_settled(value, now: datetime) -> bool:
    if value is None:
        return False
    text = str(value)
    if text in ("", "NaT", "nan", "None"):
        return False
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed + SESSION_SETTLE_DELAY <= now


def _parse_years(value: str | None, available: set[int]) -> list[int]:
    if value is None:
        return sorted(available)
    years: list[int] = []
    for text in value.split(","):
        try:
            years.append(int(text.strip()))
        except ValueError:
            continue
    if not years:
        raise ValueError(f"--years 解析不出任何赛季: {value}")
    return sorted(set(years) & available)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "f1db_path",
        nargs="?",
        default=None,
        help="f1db SQLite 路径；省略时下载官方 release",
    )
    parser.add_argument(
        "--out",
        default="session-weather.sql",
        help="输出的 SQL 文件路径（默认当前目录 session-weather.sql）",
    )
    parser.add_argument(
        "--years",
        default=None,
        help="要同步的赛季，逗号分隔；省略时处理 2018 起全部赛季",
    )
    parser.add_argument(
        "--have",
        default=None,
        help="已有 FastF1 行清单，每行 year,round,session_key；这些行不再请求",
    )
    args = parser.parse_args()

    have: set[tuple[int, int, str]] = set()
    if args.have:
        for line in Path(args.have).read_text().splitlines():
            parts = [part.strip() for part in line.split(",")]
            if (
                len(parts) == 3
                and parts[0].isdigit()
                and parts[1].isdigit()
                and parts[2]
            ):
                try:
                    year = int(parts[0])
                    round_no = int(parts[1])
                except ValueError:
                    continue
                have.add((year, round_no, parts[2]))
        print(f"skipping {len(have)} FastF1 rows already in D1")

    db_path = Path(args.f1db_path) if args.f1db_path else fetch_db()
    con = sqlite3.connect(db_path)
    race_rows = con.execute(
        "SELECT year, round, date FROM race WHERE year >= ? ORDER BY year, round",
        (WEATHER_SINCE,),
    ).fetchall()
    con.close()

    available_years = {year for year, _, _ in race_rows if isinstance(year, int)}
    try:
        years = _parse_years(args.years, available_years)
    except ValueError as exc:
        parser.error(str(exc))
    races = {(year, round_no): date for year, round_no, date in race_rows}

    inserts: list[str] = []
    failures = 0
    now = datetime.now(timezone.utc)
    fastf1.set_log_level("WARNING")

    for year in years:
        try:
            schedule = fastf1.get_event_schedule(
                year,
                backend="fastf1",
                include_testing=False,
            )
        except Exception as exc:
            failures += 1
            print(f"schedule skipped {year}: {type(exc).__name__}: {exc}")
            continue

        for _, event in schedule.iterrows():
            try:
                round_no = int(event["RoundNumber"])
            except (TypeError, ValueError):
                continue
            if (year, round_no) not in races:
                continue
            # 赛历变更可能重排轮次；和时刻回填一样，日期不一致时不猜对应关系。
            if not matches_race_date(event, races[(year, round_no)]):
                print(f"date mismatch skipped {year} R{round_no}")
                continue

            for index in range(1, 6):
                name = str(event.get(f"Session{index}"))
                if name in ("", "NaT", "nan", "None", "Testing"):
                    continue
                key = session_key(name)
                if key is None:
                    print(f"unknown session name {year} R{round_no}: {name}")
                    continue
                if (year, round_no, key) in have:
                    continue
                # 过早写入会把半场样本永久加入 --have；留出四小时再取完整 session。
                if not _has_settled(event.get(f"Session{index}DateUtc"), now):
                    continue

                try:
                    session = fastf1.get_session(
                        year,
                        round_no,
                        name,
                        backend="fastf1",
                    )
                    if not session.f1_api_support:
                        continue
                    weather = fastf1_api.weather_data(session.api_path)
                except Exception as exc:
                    failures += 1
                    print(
                        f"FastF1 skipped {year} R{round_no} {name}: "
                        f"{type(exc).__name__}: {exc}"
                    )
                    continue

                if weather is None or getattr(weather, "empty", False):
                    continue
                air = _median(_column(weather, "AirTemp"))
                track = _median(_column(weather, "TrackTemp"))
                rain_values = _column(weather, "Rainfall")
                has_rain = any(
                    bool(value)
                    for value in rain_values
                    if value is not None and str(value).lower() != "nan"
                )
                if air is None and track is None and not has_rain:
                    continue

                weather_code = "'rain'" if has_rain else "NULL"
                inserts.append(
                    "INSERT OR REPLACE INTO session_weather "
                    "(year, round, session_key, temp_c, track_temp_c, weather_code, "
                    "source, fetched_at) VALUES "
                    f"({year}, {round_no}, '{key}', "
                    f"{air if air is not None else 'NULL'}, "
                    f"{track if track is not None else 'NULL'}, {weather_code}, "
                    f"'fastf1', '{now.isoformat()}');"
                )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(inserts) + ("\n" if inserts else ""))
    print(f"wrote {len(inserts)} FastF1 session_weather rows to {out}")
    print(f"failed requests: {failures}")


if __name__ == "__main__":
    main()
