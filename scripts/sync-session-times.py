# /// script
# requires-python = ">=3.12"
# dependencies = ["fastf1>=3.5"]
# ///
"""回填 2018–2023 各 session 的 UTC 发车时刻到站点表 session_time。

数据源为 fastf1 调度表（backend="fastf1"，只打 raw.githubusercontent.com 的赛程文件，
不碰任何 F1 私有端点，也不走在后台偷偷转 ergast 的路径）。与 generate-circuit-maps.py
同款，PEP 723 + uv run。f1db 只从 2024 起记录发车时刻，2024 前静默丢弃，故本脚本只补
2018–2023；2024 起由 f1db 自带，前端 buildSessions 以 f1db 时刻优先。

匹配：FastF1 的 RoundNumber 对齐 f1db race 的 (year, round)，再用日期双重校验；
对不上的跳过并在 summary 里列出，绝不猜。Session1..5 的名称（Practice 1/2/3、
Qualifying、Sprint Shootout、Sprint、Race）映射到现有 session_key；sprint 周末的场次
顺序与常规周末不同，映射按名称而不是按序号。

输出：把 session_time 的 INSERT 写到指定 .sql 文件（默认当前目录 session-times.sql），
由 workflow 用 `wrangler d1 execute --remote --file` 应用（对齐 data-sync 的导入链路）。
脚本本身不连 D1，产出纯 SQL，本地可跑、可测。

用法: uv run scripts/sync-session-times.py [f1db.db 路径] [--out 输出的 sql 路径] [--years 2018,2019,...]
不带 f1db.db 时下载 f1db 官方 SQLite release（与 f1db-d1-dump.sh 同源）。
"""

import argparse
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.request import urlretrieve

import fastf1

from f1_session_keys import SESSION_KEYS

# 期望回填的赛季（f1db 2024 起自带，2024 前都要补）
BACKFILL_YEARS = range(2018, 2024)

# "2023-03-03 11:30:00"（本地时区）→ 已有 DateUtc 列，直接用 Utc 即可，无需本地转 UTC
# 但 FastF1 只保证 DateUtc 是 UTC，Date 是本地；取 DateUtc。


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


def to_utc_iso(ts) -> str | None:
    """pandas Timestamp → 'YYYY-MM-DDTHH:MM:SSZ'；NaT 返回 None。"""
    if ts is None:
        return None
    value = str(ts)  # 已经是 'YYYY-MM-DD HH:MM:SS'（UTC，DateUtc 列）
    # 兼容带微秒/时区的格式：只取前 19 位
    value = value[:19]
    return value.replace(" ", "T") + "Z"


def sessions_of(row) -> list[tuple[str, str]]:
    """从一行调度表取 (session_key, starts_at_utc)。map 按名称，而非序号。"""
    out: list[tuple[str, str]] = []
    for i in range(1, 6):
        name = row.get(f"Session{i}")
        if name is None or name == "Testing":
            continue
        key = SESSION_KEYS.get(name)
        if key is None:
            continue
        utc = to_utc_iso(row.get(f"Session{i}DateUtc"))
        if utc is None:
            continue
        out.append((key, utc))
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("f1db_path", nargs="?", default=None,
                        help="f1db SQLite 路径；省略时下载官方 release")
    parser.add_argument("--out", default="session-times.sql",
                        help="输出的 SQL 文件路径（默认当前目录 session-times.sql）")
    parser.add_argument("--years", default=None,
                        help="要回填的赛季，逗号分隔（默认 2018-2023）")
    args = parser.parse_args()

    db_path = Path(args.f1db_path) if args.f1db_path else fetch_db()
    if args.years:
        # 非法输入走 argparse 的标准错误通道，而不是抛一个没人接的 ValueError
        # pi-lens-ignore: ast-grep:unchecked-throwing-call-python
        years = [int(y) for y in args.years.split(",") if y.strip().isdigit()]
        if not years:
            parser.error(f"--years 解析不出任何赛季: {args.years}")
    else:
        years = list(BACKFILL_YEARS)

    con = sqlite3.connect(db_path)
    # f1db race 参考：(year, round) -> date，用于匹配与日期双重校验。
    # 不取 id：站点表按 (year, round) 关联，代理键用不上。
    ref_dates = {
        (year, round_no): date
        for year, round_no, date in con.execute(
            "SELECT year, round, date FROM race"
        )
    }
    con.close()

    inserts: list[str] = []
    skipped: list[str] = []  # FastF1 有但 f1db 匹配不到

    fastf1.set_log_level("WARNING")
    for year in years:
        schedule = fastf1.get_event_schedule(
            year, backend="fastf1", include_testing=False
        )
        for _, row in schedule.iterrows():
            # 解析异常按"跳过+列出"处理，不整批崩溃。RoundNumber/日期任一损坏就跳。
            round_no = None
            try:
                round_no = int(row["RoundNumber"])
                ref_date = ref_dates.get((year, round_no))
                if ref_date is None:
                    skipped.append(f"{year} Round {round_no}: no f1db race row (round mismatch)")
                    continue
                # 日期双重校验：正赛日（Race 的 Date）应与 f1db race.date 一致
                race_date = str(row.get("EventDate"))[:10] if row.get("EventDate") is not None else None
                if race_date is not None and race_date != ref_date:
                    skipped.append(
                        f"{year} Round {round_no}: date mismatch "
                        f"(fastf1 {race_date} vs f1db {ref_date})"
                    )
                    continue
            except (TypeError, ValueError) as exc:
                skipped.append(f"{year} Round {round_no if round_no is not None else '?'}: malformed row: {exc}")
                continue
            for key, utc in sessions_of(row):
                inserts.append(
                    f"INSERT OR REPLACE INTO session_time "
                    f"(year, round, session_key, starts_at_utc, source) VALUES "
                    f"({year}, {round_no}, '{key}', '{utc}', 'fastf1-schedule');"
                )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(inserts) + ("\n" if inserts else ""))

    print(f"wrote {len(inserts)} session_time rows to {out}")
    if skipped:
        print(f"skipped {len(skipped)} (listed below):")
        for s in skipped:
            print(f"  - {s}")
    # 域名白名单：脚本只应请求 raw.githubusercontent.com（fastf1 调度表）与
    # github.com/f1db（下载 release）；断言见 CI，不在此处引 livetiming
    print("done")


if __name__ == "__main__":
    main()
