# /// script
# requires-python = ">=3.12"
# dependencies = ["fastf1==3.8.3"]
# ///
"""Generate FastF1 api_path references for weather ingestion.

The schedule is resolved here, in a local/GitHub Actions environment. The
Cloudflare collector only receives the resulting api_path and never discovers
season schedules at runtime.
"""

import argparse
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlretrieve

import fastf1

from f1_session_keys import SESSION_KEYS, matches_race_date


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


def to_utc_iso(value) -> str | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def sessions_of(row) -> list[tuple[str, str, str]]:
    result: list[tuple[str, str, str]] = []
    for index in range(1, 6):
        name = row.get(f"Session{index}")
        if name is None or name == "Testing":
            continue
        key = SESSION_KEYS.get(name)
        if key is None:
            raise ValueError(f"unknown session name: {name}")
        starts_at = to_utc_iso(row.get(f"Session{index}DateUtc"))
        api_path = row.get_session(name).api_path
        if starts_at is None:
            raise ValueError(f"invalid start time for {name}")
        if not isinstance(api_path, str) or not api_path.startswith("/static/"):
            raise ValueError(f"invalid api path for {name}")
        result.append((key, api_path, starts_at))
    return result


def default_years(connection: sqlite3.Connection) -> list[int]:
    return [
        year
        for (year,) in connection.execute(
            "SELECT DISTINCT year FROM race WHERE year >= 2018 ORDER BY year"
        )
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("f1db_path", nargs="?", default=None)
    parser.add_argument("--out", default="session-refs.sql")
    parser.add_argument("--years", default=None)
    args = parser.parse_args()

    db_path = Path(args.f1db_path) if args.f1db_path else fetch_db()
    connection = sqlite3.connect(db_path)
    races = {
        (year, round_no): date
        for year, round_no, date in connection.execute(
            "SELECT year, round, date FROM race"
        )
    }
    years = (
        [int(year) for year in args.years.split(",")]
        if args.years
        else default_years(connection)
    )
    connection.close()

    inserts: list[str] = []
    skipped: list[str] = []
    failures: list[str] = []
    keys_by_year: dict[int, list[tuple[int, str]]] = {year: [] for year in years}
    fastf1.Cache.set_disabled()
    fastf1.set_log_level("WARNING")

    for year in years:
        expected_rounds = {
            round_no for race_year, round_no in races if race_year == year
        }
        if not expected_rounds:
            failures.append(f"{year}: no f1db races")
            continue
        schedule = fastf1.get_event_schedule(
            year, backend="fastf1", include_testing=False
        )
        seen_rounds: set[int] = set()
        for _, row in schedule.iterrows():
            round_no = None
            try:
                round_no = int(row.get("RoundNumber"))
                seen_rounds.add(round_no)
                race_date = races.get((year, round_no))
                if race_date is None:
                    skipped.append(f"{year} Round {round_no}: no f1db race")
                    continue
                if not matches_race_date(row, race_date):
                    skipped.append(
                        f"{year} Round {round_no}: date mismatch "
                        f"(fastf1 {row.get('EventDate')} vs f1db {race_date})"
                    )
                    continue
                sessions = sessions_of(row)
                if not sessions:
                    failures.append(f"{year} Round {round_no}: no usable sessions")
                    continue
                for session_key, api_path, starts_at in sessions:
                    keys_by_year[year].append((round_no, session_key))
                    inserts.append(
                        "INSERT INTO session_source_ref "
                        "(year, round, session_key, api_path, race_date, starts_at_utc, source) VALUES "
                        f"({year}, {round_no}, '{session_key}', '{api_path}', "
                        f"'{race_date}', '{starts_at}', 'fastf1-schedule') "
                        "ON CONFLICT(year, round, session_key) DO UPDATE SET "
                        "api_path = excluded.api_path, race_date = excluded.race_date, "
                        "starts_at_utc = excluded.starts_at_utc, source = excluded.source;"
                    )
            except (TypeError, ValueError, AttributeError) as exc:
                failures.append(f"{year} Round {round_no}: malformed row: {exc}")

        missing_rounds = sorted(expected_rounds - seen_rounds)
        if missing_rounds:
            failures.append(
                f"{year}: missing rounds {','.join(str(no) for no in missing_rounds)}"
            )

    if failures:
        raise RuntimeError("; ".join(failures))
    if not inserts:
        raise RuntimeError("no session references generated")

    prunes: list[str] = []
    for year in years:
        keys = sorted(set(keys_by_year[year]))
        if not keys:
            raise RuntimeError(f"{year}: no session references generated")
        keep = ", ".join(
            f"({round_no}, '{session_key}')" for round_no, session_key in keys
        )
        prunes.append(
            "DELETE FROM session_source_ref "
            f"WHERE year = {year} AND (round, session_key) NOT IN ({keep});"
        )

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join([*inserts, *prunes]) + "\n")
    print(f"wrote {len(inserts)} session_source_ref rows to {output}")
    if skipped:
        print(f"skipped {len(skipped)}:")
        for item in skipped:
            print(f"  - {item}")


if __name__ == "__main__":
    main()
