# /// script
# requires-python = ">=3.12"
# dependencies = ["fastf1>=3.5", "requests"]
# ///
"""回填 2018 起的赛道天气到站点表 session_weather。

两个来源，按场次分工：
- trackside（FastF1 `api.weather_data`，只打 livetiming.formula1.com）：2018 起、已结束的场次。
  通道：AirTemp(°C) → temp_c、TrackTemp(°C) → track_temp_c、Rainfall(bool) → 是否降雨。
- forecast（Open-Meteo `/v1/forecast`）：未来 7 天内的场次。temp/prob/weather_code。

track_temp_c 只有 F1 计时流有（ERA5 给不了）；`precipitation_probability` 只有
Open-Meteo 有（集合预报产物）。两条路给的是不同的东西，写进不同列，读端按 source 判空。

只做 2018 起（fastf1 只覆盖 2018 起，≤2017 无计时流数据，不引入 Open-Meteo archive）。
增量：每天一到两次，只处理未来 7 天内的场次；场次结束后由 trackside 覆盖 forecast。

脚本只产出 INSERT OR REPLACE 到 .sql 文件（自身不连 D1），由 workflow 用
`wrangler d1 execute --remote --file` 应用。与 sync-session-times.py 同款 PEP 723。

用法: uv run scripts/sync-weather.py [f1db.db 路径] [--out 输出的 sql 路径] [--future-days 7]
不带 f1db.db 时下载 f1db 官方 SQLite release（与 f1db-d1-dump.sh 同源）。
"""

import argparse
import json
import sqlite3
import sys
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlretrieve

import fastf1
import fastf1.api as fastf1_api

import requests

from f1_session_keys import session_key, wmo_condition

# 时序常量：天气只覆盖 2018 起（fastf1 计时流起点）
WEATHER_SINCE = 2018
# Open-Meteo 免费档每日 10000 次额度；脚本只处理未来 7 天内的场次，逐场一次调用
FUTURE_DAYS = 7


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


def open_meteo_forecast(lat: float, lon: float) -> dict | None:
    """未来 N 天按小时的 Open-Meteo 预报，取该天日中的中位数温度/降水概率。"""
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "temperature_2m,precipitation_probability,weather_code",
        "forecast_days": 1,
    }
    resp = requests.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    return data.get("hourly")


def _median(values: list[float | None]) -> float | None:
    nums = sorted(v for v in values if v is not None)
    if not nums:
        return None
    mid = len(nums) // 2
    return nums[mid] if len(nums) % 2 else (nums[mid - 1] + nums[mid]) / 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("f1db_path", nargs="?", default=None,
                        help="f1db SQLite 路径；省略时下载官方 release")
    parser.add_argument("--out", default="session-weather.sql",
                        help="输出的 SQL 文件路径（默认当前目录 session-weather.sql）")
    parser.add_argument("--future-days", type=int, default=FUTURE_DAYS,
                        help="要回填的未来天数窗口（默认 7）")
    parser.add_argument("--have", default=None,
                        help="已有 trackside 行的清单文件，每行 year,round,session_key；"
                             "列内的场次不再拉 livetiming")
    args = parser.parse_args()

    # 历史场次的赛道天气不会变，拉过一次就够了。不跳过的话，日常增量每跑一次
    # 就要重抳 2018 起全部场次 × 5 session 近千次请求。forecast 不在此列：
    # 预报本来就要随时间刷新，而且只涉及未来 7 天内的少数几场。
    have: set[tuple[int, int, str]] = set()
    if args.have:
        for line in Path(args.have).read_text().splitlines():
            parts = [p.strip() for p in line.split(",")]
            # 清单由 wrangler 输出转成，可能带表头或空行，非法行直接跳过
            if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit() and parts[2]:
                have.add((int(parts[0]), int(parts[1]), parts[2]))
        print(f"skipping {len(have)} trackside rows already in D1")

    db_path = Path(args.f1db_path) if args.f1db_path else fetch_db()
    con = sqlite3.connect(db_path)

    # 2018 起的 race 参考：(year, round) 为关联键，加 date 与 circuit 坐标（天气取点）
    races = con.execute(
        """
        SELECT r.year, r.round, r.date, c.latitude, c.longitude
        FROM race r JOIN circuit c ON r.circuit_id = c.id
        WHERE r.year >= ?
        ORDER BY r.year, r.round
        """,
        (WEATHER_SINCE,),
    ).fetchall()
    con.close()

    inserts: list[str] = []
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=args.future_days)

    fastf1.set_log_level("WARNING")
    for year, round_no, date, lat, lon in races:
        race_date = datetime.strptime(date, "%Y-%m-%d").date()
        is_future = datetime.combine(race_date, datetime.min.time(), tzinfo=timezone.utc) > now
        if is_future:
            if datetime.combine(race_date, datetime.min.time(), tzinfo=timezone.utc) > cutoff:
                continue  # 比未来 7 天更远的场次不取
            hourly = open_meteo_forecast(lat, lon)
            if hourly is None:
                continue
            temp = _median(hourly.get("temperature_2m", []))
            prob = _median(hourly.get("precipitation_probability", []))
            codes = [c for c in hourly.get("weather_code", []) if c is not None]
            # WMO 数字码要翻成语义词：前端按关键词分图标，存数字的话
            # 一个都匹配不上，图标会永远停在默认值
            code = wmo_condition(codes[0]) if codes else None
            if temp is None:
                continue
            inserts.append(
                f"INSERT OR REPLACE INTO session_weather "
                f"(year, round, session_key, temp_c, precipitation_probability, "
                f"weather_code, source, fetched_at) VALUES "
                f"({year}, {round_no}, 'race', {temp}, {prob if prob is not None else 'NULL'}, "
                f"{json.dumps(code) if code is not None else 'NULL'}, 'forecast', '{now.isoformat()}');"
            )
            continue
        # 已结束（历史或本周末）：FastF1 trackside。只能在一个能连 livetiming 的环境跑
        # （CI/production runner），本地 403 会在此失败——由探针先行验证。
        # 这里按 session 取 api.weather_data 的中位数代表整场。
        # session 标识符要随 EventFormat 而定：非 Sprint 周末没有 'S'/'SQ'，
        # 'S' 在常规周末会抛 Session type does not exist。先取周末的 session 名单再挨个取。
        try:
            schedule_row = fastf1.get_event_schedule(year, backend="fastf1", include_testing=False)
            event = schedule_row[schedule_row["RoundNumber"] == round_no]
            if event.empty:
                continue
            event = event.iloc[0]
        except Exception as exc:
            print(f"  schedule lookup skipped {year} R{round_no}: {exc}")
            continue
        for i in range(1, 6):
            name = str(event.get(f"Session{i}"))
            if name in ("nan", "None", ""):
                continue
            key = session_key(name)
            # 认不出的 session 名宁可不写：键对不上 buildSessions 的 defs
            # 就是一行永远匹配不到、也不报错的死数据
            if key is None:
                print(f"  unknown session name {year} R{round_no}: {name}")
                continue
            if (year, round_no, key) in have:
                continue
            try:
                # backend 必须显式传：默认值会让 FastF1 自己选后端，
                # 选到 ergast 就是静默地去打 jolpica
                session = fastf1.get_session(year, round_no, name, backend="fastf1")
                if not session.f1_api_support:
                    continue
                weather = fastf1_api.weather_data(session.api_path)
            except Exception as exc:  # 单场失败不阻断整批
                print(f"  trackside skipped {year} R{round_no} {name}: {exc}")
                continue
            if weather is None:
                continue
            if hasattr(weather, "empty"):
                # FastF1 文档形态：pandas DataFrame，columns AirTemp/TrackTemp/Rainfall
                if weather.empty:
                    continue
                air = _median(weather["AirTemp"].tolist())
                track = _median(weather["TrackTemp"].tolist())
                rainfall = weather["Rainfall"].tolist()
            else:
                # 某些端点/离线形态返回 dict-of-lists；接入探针确认后以 DataFrame 为准
                if not weather:
                    continue
                air = _median(list(weather.get("AirTemp", [])))
                track = _median(list(weather.get("TrackTemp", [])))
                rainfall = list(weather.get("Rainfall", []))
            has_rain = any(rainfall) if rainfall else None
            # Rainfall 是布尔（下没下雨），塞进“降水毫米数”语义就错了；
            # 走已有的 weather_code，与 forecast 落在同一套语义词上
            code = "'rain'" if has_rain else "NULL"
            inserts.append(
                f"INSERT OR REPLACE INTO session_weather "
                f"(year, round, session_key, temp_c, track_temp_c, weather_code, "
                f"source, fetched_at) VALUES "
                f"({year}, {round_no}, '{key}', {air if air is not None else 'NULL'}, "
                f"{track if track is not None else 'NULL'}, {code}, "
                f"'trackside', '{now.isoformat()}');"
            )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(inserts) + ("\n" if inserts else ""))
    print(f"wrote {len(inserts)} session_weather rows to {out}")
    print("done")


if __name__ == "__main__":
    main()
