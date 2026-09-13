import hashlib
import json
import math
import os
import re
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

import fastf1
import fastf1.api as fastf1_api
import requests

fastf1.Cache.set_disabled()
fastf1.set_log_level("WARNING")

RESULTS_ADAPTER_VERSION = "session-results-v1"
RESULTS_SCHEMA_VERSION = 1
SESSION_IDENTIFIERS = {
    "practice-1": "FP1",
    "practice-2": "FP2",
    "practice-3": "FP3",
    "qualifying": "Q",
    "sprint-qualifying": "SQ",
    "sprint": "S",
    "race": "R",
}

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def is_authorized(header: str | None) -> bool:
    token = os.environ.get("WEATHER_CONTAINER_TOKEN")
    return bool(token) and header == f"Bearer {token}"


def column(weather, name: str) -> list:
    if hasattr(weather, "columns"):
        if name not in weather.columns:
            return []
        return weather[name].tolist()
    if isinstance(weather, dict):
        return list(weather.get(name, []))
    return []


def records(value) -> list[dict]:
    if hasattr(value, "to_dict"):
        return value.to_dict("records")
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    return []


def finite_numbers(values: list) -> list[float]:
    numbers: list[float] = []
    for value in values:
        if value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(number):
            numbers.append(number)
    return numbers


def median(values: list) -> float | None:
    numbers = finite_numbers(values)
    if not numbers:
        return None
    numbers.sort()
    middle = len(numbers) // 2
    if len(numbers) % 2:
        return numbers[middle]
    return (numbers[middle - 1] + numbers[middle]) / 2


def circular_mean_degrees(values: list) -> float | None:
    numbers = finite_numbers(values)
    if not numbers:
        return None
    x = sum(math.cos(math.radians(value)) for value in numbers) / len(numbers)
    y = sum(math.sin(math.radians(value)) for value in numbers) / len(numbers)
    angle = math.degrees(math.atan2(y, x)) % 360
    return 0.0 if angle == 360 else angle


def rainfall(values: list) -> bool | None:
    observations = []
    for value in values:
        # FastF1/pandas may return numpy.bool_ rather than a Python bool.
        if isinstance(value, bool):
            observations.append(value)
            continue
        if type(value).__name__ == "bool_":
            observations.append(bool(value))
    if not observations:
        return None
    return any(value is True for value in observations)


def parse_utc_datetime(value) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("session start is not timezone-aware")
    return parsed.astimezone(timezone.utc)


def duration_seconds(value) -> float | None:
    if value is None:
        return None
    if hasattr(value, "total_seconds"):
        try:
            seconds = float(value.total_seconds())
        except (TypeError, ValueError):
            return None
    elif isinstance(value, (int, float)):
        seconds = float(value)
    else:
        return None
    return seconds if math.isfinite(seconds) else None


def duration_ms(value) -> int | None:
    seconds = duration_seconds(value)
    return None if seconds is None else round(seconds * 1000)


def integer_value(value) -> int | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if math.isfinite(number) else None


def duration_text_ms(value: str) -> int | None:
    text = value.strip().removeprefix("+")
    if not text:
        return None
    parts = text.split(":")
    if len(parts) > 3 or not all(part for part in parts):
        return None
    try:
        seconds = sum(
            float(part) * (60 ** index)
            for index, part in enumerate(reversed(parts))
        )
    except ValueError:
        return None
    return round(seconds * 1000) if math.isfinite(seconds) else None


def text_value(value) -> str | None:
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return None
    text = str(value).strip()
    return text or None


def observed_at_utc(weather, starts_at: datetime) -> str | None:
    offsets = [
        seconds
        for seconds in (duration_seconds(value) for value in column(weather, "Time"))
        if seconds is not None
    ]
    if not offsets:
        return None
    return (starts_at + timedelta(seconds=max(offsets))).isoformat().replace(
        "+00:00", "Z"
    )


def weather_result(api_path: str, starts_at: datetime) -> dict:
    weather = fastf1_api.weather_data(api_path)
    rain = rainfall(column(weather, "Rainfall"))
    sample_count = max(
        (
            len(column(weather, name))
            for name in (
                "Time",
                "AirTemp",
                "TrackTemp",
                "Humidity",
                "Pressure",
                "Rainfall",
                "WindDirection",
                "WindSpeed",
            )
        ),
        default=0,
    )
    base = {
        "status": "success",
        "sampleCount": sample_count,
        "tempC": None,
        "trackTempC": None,
        "humidityPct": None,
        "pressureHpa": None,
        "windSpeedKph": None,
        "windDirectionDeg": None,
        "rainfall": None,
        "observedAtUtc": None,
        "weatherCode": None,
        "fetchedAt": utc_now(),
        "error": None,
    }
    if sample_count == 0:
        return {**base, "status": "empty"}
    return {
        **base,
        "tempC": median(column(weather, "AirTemp")),
        "trackTempC": median(column(weather, "TrackTemp")),
        "humidityPct": median(column(weather, "Humidity")),
        "pressureHpa": median(column(weather, "Pressure")),
        "windSpeedKph": (
            median(
                [
                    value * 3.6
                    for value in finite_numbers(column(weather, "WindSpeed"))
                ]
            )
        ),
        "windDirectionDeg": circular_mean_degrees(
            column(weather, "WindDirection")
        ),
        "rainfall": rain,
        "observedAtUtc": observed_at_utc(weather, starts_at),
        "weatherCode": "rain" if rain is True else None,
    }


def mark_deleted_laps(laps: list[dict], messages) -> None:
    rows = records(messages)
    deleted: set[tuple[str, int]] = set()
    reinstated: set[tuple[str, int]] = set()
    pattern = re.compile(
        r"CAR (\d{1,2}) .* TIME (\d:\d\d\.\d\d\d) DELETED - (.*)"
    )
    reinstated_pattern = re.compile(
        r"CAR (\d{1,2}) .* TIME (\d:\d\d\.\d\d\d) .*REINSTATED.*"
    )
    for row in rows:
        message = str(row.get("Message", ""))
        if match := reinstated_pattern.match(message):
            milliseconds = duration_text_ms(match[2])
            if milliseconds is not None:
                reinstated.add((match[1], milliseconds))
    for row in rows:
        message = str(row.get("Message", ""))
        if match := pattern.match(message):
            milliseconds = duration_text_ms(match[2])
            if milliseconds is not None:
                deleted.add((match[1], milliseconds))
    for lap in laps:
        lap["Deleted"] = False
        milliseconds = duration_ms(lap.get("LapTime"))
        number = str(lap.get("DriverNumber", ""))
        if milliseconds is not None and (number, milliseconds) in deleted:
            if (number, milliseconds) not in reinstated:
                lap["Deleted"] = True


def gap_value(value) -> tuple[int | None, str | None]:
    if value is None:
        return None, None
    milliseconds = duration_ms(value)
    if milliseconds is not None:
        return milliseconds, None
    if isinstance(value, str):
        if "lap" in value.lower():
            return None, value
        parsed = duration_text_ms(value)
        if parsed is not None:
            return parsed, None
    return None, str(value)


def timing_laps(
    api_path: str,
) -> tuple[list[dict], list[dict], list, object, object]:
    laps_frame, stream_frame, split_times = fastf1_api._extended_timing_data(
        api_path
    )
    laps = records(laps_frame)
    messages = fastf1_api.race_control_messages(api_path)
    mark_deleted_laps(laps, messages)
    return laps, records(stream_frame), list(split_times), laps_frame, stream_frame


def frame_columns(frame) -> set[str] | None:
    if hasattr(frame, "columns"):
        return set(frame.columns)
    if isinstance(frame, list) and frame:
        return set(frame[0])
    if isinstance(frame, dict):
        return set(frame)
    return None


def timing_schema_error(
    laps_frame,
    stream_frame,
    session_key: str,
) -> str | None:
    lap_columns = frame_columns(laps_frame)
    stream_columns = frame_columns(stream_frame)
    required_laps = {"DriverNumber", "LapTime"}
    if lap_columns is not None and not required_laps.issubset(lap_columns):
        return "unexpected timing schema: laps columns changed"
    required_stream = {"DriverNumber", "Position", "GapToLeader"}
    if stream_columns is not None and not required_stream.issubset(stream_columns):
        return "unexpected timing schema: stream columns changed"
    if session_key in ("qualifying", "sprint-qualifying"):
        required_laps |= {"LapStartTime", "Time"}
        if lap_columns is not None and not required_laps.issubset(lap_columns):
            return "unexpected timing schema: qualifying columns changed"
    return None


def driver_identity(number: str, info: dict) -> dict:
    reference = info.get("Reference")
    full_name = info.get("FullName") or info.get("BroadcastName") or number
    code = info.get("Tla") or info.get("Abbreviation")
    if not isinstance(code, str) or not code:
        code = full_name[:3].upper()
    return {
        "driverNumber": number,
        "driverSourceId": reference if isinstance(reference, str) else None,
        "driverName": str(full_name),
        "driverCode": code,
        "constructorSourceId": None,
        "constructorName": str(info.get("TeamName") or "Unknown team"),
    }


def session_identifier(session_key: str) -> str:
    identifier = SESSION_IDENTIFIERS.get(session_key)
    if identifier is None:
        raise ValueError(f"unknown session key: {session_key}")
    return identifier


def public_identity(row: dict, number: str) -> dict:
    full_name = (
        text_value(row.get("FullName"))
        or text_value(row.get("BroadcastName"))
        or number
    )
    code = text_value(row.get("Abbreviation")) or full_name[:3].upper()
    return {
        "driverNumber": number,
        "driverSourceId": text_value(row.get("DriverId")),
        "driverName": full_name,
        "driverCode": code,
        "constructorSourceId": text_value(row.get("TeamId")),
        "constructorName": text_value(row.get("TeamName")) or "Unknown team",
    }


def public_result_rows(session, session_key: str) -> list[dict]:
    result_rows = records(session.results)
    lap_rows = records(session.laps)
    laps_by_driver: dict[str, list[dict]] = {}
    for lap in lap_rows:
        laps_by_driver.setdefault(str(lap.get("DriverNumber")), []).append(lap)

    rows: list[dict] = []
    for result in result_rows:
        number = text_value(result.get("DriverNumber"))
        if number is None:
            continue
        lap_rows_for_driver = laps_by_driver.get(number, [])
        valid_rows = [lap for lap in lap_rows_for_driver if valid_lap(lap)]
        row = {
            **public_identity(result, number),
            "position": integer_value(result.get("Position")),
            "positionText": "—",
            "bestLapMs": min(
                (
                    duration_ms(lap.get("LapTime"))
                    for lap in valid_rows
                    if duration_ms(lap.get("LapTime")) is not None
                ),
                default=None,
            ),
            "q1Ms": None,
            "q2Ms": None,
            "q3Ms": None,
            "totalTimeMs": None,
            "gapMs": None,
            "gapText": None,
            "laps": integer_value(result.get("Laps"))
            or lap_count(lap_rows_for_driver),
            "status": None,
            "points": None,
        }
        classified = text_value(result.get("ClassifiedPosition"))
        row["positionText"] = (
            str(row["position"])
            if row["position"] is not None
            else classified or "—"
        )
        if session_key in ("qualifying", "sprint-qualifying"):
            for key, field in (
                ("q1Ms", "Q1"),
                ("q2Ms", "Q2"),
                ("q3Ms", "Q3"),
            ):
                row[key] = duration_ms(result.get(field))
        elif session_key in ("race", "sprint"):
            row["totalTimeMs"] = duration_ms(result.get("Time"))
            row["status"] = text_value(result.get("Status"))
            row["points"] = result.get("Points")
            if isinstance(row["points"], float) and not math.isfinite(
                row["points"]
            ):
                row["points"] = None
        rows.append(row)
    return rows


def has_public_result_signal(
    rows: list[dict], session_key: str
) -> bool:
    if not rows:
        return False
    if session_key in ("qualifying", "sprint-qualifying"):
        # 只有整场都没有官方分段时间才尝试 timing fallback；个别车手缺失时保留 NULL。
        return any(row["position"] is not None for row in rows) or any(
            row["q1Ms"] is not None for row in rows
        )
    if session_key in ("race", "sprint"):
        return any(row["position"] is not None for row in rows)
    return any(row["bestLapMs"] is not None for row in rows)


def public_session_results(requested: dict) -> dict | None:
    session_key = requested["sessionKey"]
    session = fastf1.get_session(
        requested["year"],
        requested["round"],
        session_identifier(session_key),
    )
    # 公开 results 已含身份与 Q/Race 分类；只需 laps 补 Practice 最快圈和圈数。
    session.load(laps=True, telemetry=False, weather=False, messages=True)
    rows = public_result_rows(session, session_key)
    if not has_public_result_signal(rows, session_key):
        return None
    if session_key in ("qualifying", "sprint-qualifying", "race", "sprint"):
        rows.sort(
            key=lambda row: (
                row["position"] is None,
                row["position"] if row["position"] is not None else 0,
                row["driverNumber"],
            )
        )
    else:
        rank_rows(rows, session_key)
    return {
        "status": "success",
        "rowCount": len(rows),
        "rows": rows,
        "sourceRevision": hashlib.sha256(
            json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        "fetchedAt": utc_now(),
        "error": None,
        "adapter": "fastf1-session-results",
        "schemaVersion": RESULTS_SCHEMA_VERSION,
    }


def quick_laps(rows: list[dict]) -> list[dict]:
    times = [duration_ms(row.get("LapTime")) for row in rows]
    fastest = min((value for value in times if value is not None), default=None)
    if fastest is None:
        return []
    return [row for row in rows if duration_ms(row.get("LapTime")) is not None and duration_ms(row.get("LapTime")) <= fastest * 1.07]


def qualifying_segment(row: dict, split_times: list) -> int | None:
    start = duration_ms(row.get("LapStartTime"))
    end = duration_ms(row.get("Time"))
    if start is None:
        return None
    if len(split_times) >= 3:
        first = duration_ms(split_times[0]) or 0
        second = duration_ms(split_times[1])
        third = duration_ms(split_times[2])
        if second is not None and third is not None:
            if start < second:
                if (
                    end is not None
                    and end > second
                    and row.get("PitOutTime") is not None
                    and duration_ms(row.get("PitOutTime")) is not None
                ):
                    return 1
                return 0
            if start < third:
                if (
                    end is not None
                    and end > third
                    and row.get("PitOutTime") is not None
                    and duration_ms(row.get("PitOutTime")) is not None
                ):
                    return 2
                return 1
            return 2
    return None


def valid_lap(row: dict) -> bool:
    return (
        not bool(row.get("Deleted", False))
        and duration_ms(row.get("LapTime")) is not None
    )


def lap_count(rows: list[dict]) -> int | None:
    counts: list[int] = []
    for row in rows:
        value = row.get("NumberOfLaps")
        if value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(number):
            counts.append(int(number))
    return max(counts) if counts else (len(rows) if rows else None)


def result_row(
    identity: dict,
    lap_rows: list[dict],
    stream_rows: list[dict],
    session_key: str,
    split_times: list,
) -> dict:
    row = {
        **identity,
        "position": None,
        "positionText": "—",
        "bestLapMs": None,
        "q1Ms": None,
        "q2Ms": None,
        "q3Ms": None,
        "totalTimeMs": None,
        "gapMs": None,
        "gapText": None,
        "laps": lap_count(lap_rows),
        "status": None,
        "points": None,
    }
    valid_rows = [lap for lap in lap_rows if valid_lap(lap)]
    if valid_rows:
        row["bestLapMs"] = min(
            value
            for value in (duration_ms(lap.get("LapTime")) for lap in valid_rows)
            if value is not None
        )

    if session_key in ("qualifying", "sprint-qualifying"):
        segments: dict[int, list[dict]] = {0: [], 1: [], 2: []}
        for lap in valid_rows:
            segment = qualifying_segment(lap, split_times)
            if segment is not None:
                segments[segment].append(lap)
        for index, key in enumerate(("q1Ms", "q2Ms", "q3Ms")):
            driver_laps = [
                lap
                for lap in quick_laps(segments[index])
                if str(lap.get("DriverNumber")) == identity["driverNumber"]
            ]
            times = [
                value
                for value in (duration_ms(lap.get("LapTime")) for lap in driver_laps)
                if value is not None
            ]
            row[key] = min(times) if times else None
    elif session_key in ("race", "sprint"):
        if stream_rows:
            final = stream_rows[-1]
            position = integer_value(final.get("Position"))
            if position is not None:
                row["position"] = int(position)
                row["positionText"] = str(int(position))
            gap_ms, gap_text = gap_value(final.get("GapToLeader"))
            row["gapMs"] = gap_ms
            row["gapText"] = gap_text
            row["status"] = gap_text
    return row


def rank_rows(rows: list[dict], session_key: str) -> None:
    if session_key in ("qualifying", "sprint-qualifying"):
        rows.sort(
            key=lambda row: (
                row["q3Ms"] is None,
                row["q3Ms"] if row["q3Ms"] is not None else 0,
                row["q2Ms"] is None,
                row["q2Ms"] if row["q2Ms"] is not None else 0,
                row["q1Ms"] is None,
                row["q1Ms"] if row["q1Ms"] is not None else 0,
                row["driverNumber"],
            )
        )
    elif session_key in ("race", "sprint"):
        rows.sort(
            key=lambda row: (
                row["position"] is None,
                row["position"] if row["position"] is not None else 0,
                -(row["laps"] or 0),
                row["driverNumber"],
            )
        )
    else:
        rows.sort(
            key=lambda row: (
                row["bestLapMs"] is None,
                row["bestLapMs"] if row["bestLapMs"] is not None else 0,
                row["driverNumber"],
            )
        )
    if session_key not in ("race", "sprint"):
        for index, row in enumerate(rows, 1):
            row["position"] = index
            row["positionText"] = str(index)
        leader = rows[0].get("bestLapMs") if rows else None
        if leader is not None:
            for row in rows[1:]:
                if row.get("bestLapMs") is not None:
                    row["gapMs"] = row["bestLapMs"] - leader


def has_result_signal(rows: list[dict], session_key: str) -> bool:
    if session_key in ("qualifying", "sprint-qualifying"):
        return any(row["q1Ms"] is not None for row in rows)
    if session_key in ("race", "sprint"):
        return any(row["position"] is not None for row in rows)
    return any(row["bestLapMs"] is not None for row in rows)


def timing_results_result(api_path: str, session_key: str) -> dict:
    drivers = fastf1_api.driver_info(api_path)
    if not isinstance(drivers, dict) or not drivers:
        return {
            "status": "empty",
            "rowCount": 0,
            "rows": [],
            "sourceRevision": hashlib.sha256(b"empty").hexdigest(),
            "fetchedAt": utc_now(),
            "error": None,
            "adapter": "extended-timing-fallback",
            "schemaVersion": RESULTS_SCHEMA_VERSION,
        }

    laps, stream, split_times, laps_frame, stream_frame = timing_laps(api_path)
    schema_error = timing_schema_error(laps_frame, stream_frame, session_key)
    if schema_error is not None:
        raise RuntimeError(schema_error)
    laps_by_driver: dict[str, list[dict]] = {}
    stream_by_driver: dict[str, list[dict]] = {}
    for lap in laps:
        laps_by_driver.setdefault(str(lap.get("DriverNumber")), []).append(lap)
    for item in stream:
        stream_by_driver.setdefault(str(item.get("DriverNumber")), []).append(item)

    rows = []
    for number, info in drivers.items():
        if not isinstance(info, dict):
            continue
        identity = driver_identity(str(number), info)
        rows.append(
            result_row(
                identity,
                laps_by_driver.get(identity["driverNumber"], []),
                stream_by_driver.get(identity["driverNumber"], []),
                session_key,
                split_times,
            )
        )
    rank_rows(rows, session_key)
    if not has_result_signal(rows, session_key):
        return {
            "status": "empty",
            "rowCount": 0,
            "rows": [],
            "sourceRevision": hashlib.sha256(b"empty").hexdigest(),
            "fetchedAt": utc_now(),
            "error": None,
            "adapter": "extended-timing-fallback",
            "schemaVersion": RESULTS_SCHEMA_VERSION,
        }
    revision = hashlib.sha256(
        json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "status": "success",
        "rowCount": len(rows),
        "rows": rows,
        "sourceRevision": revision,
        "fetchedAt": utc_now(),
        "error": None,
        "adapter": "extended-timing-fallback",
        "schemaVersion": RESULTS_SCHEMA_VERSION,
    }


def results_result(requested: dict, api_path: str) -> dict:
    try:
        public = public_session_results(requested)
        if public is not None:
            return public
        public_error = "public session results had no usable data"
    except Exception as exc:
        public_error = f"{type(exc).__name__}: {exc}"
    fallback = timing_results_result(api_path, requested["sessionKey"])
    return {**fallback, "error": f"public adapter unavailable: {public_error}"}


def collect_session(requested: dict) -> dict:
    result = {
        "year": requested["year"],
        "round": requested["round"],
        "sessionKey": requested["sessionKey"],
    }
    api_path = requested.get("apiPath")
    if not isinstance(api_path, str) or not api_path.startswith("/static/"):
        mismatch = {
            "status": "mismatch",
            "error": "invalid FastF1 api path",
        }
        if requested.get("weather"):
            result["weather"] = {
                "sampleCount": 0,
                "tempC": None,
                "trackTempC": None,
                "humidityPct": None,
                "pressureHpa": None,
                "windSpeedKph": None,
                "windDirectionDeg": None,
                "rainfall": None,
                "observedAtUtc": None,
                "weatherCode": None,
                "fetchedAt": utc_now(),
                **mismatch,
            }
        if requested.get("results"):
            result["results"] = {
                "rowCount": 0,
                "rows": [],
                "sourceRevision": "0" * 64,
                "fetchedAt": utc_now(),
                **mismatch,
            }
        return result
    try:
        starts_at = parse_utc_datetime(requested.get("startsAtUtc"))
    except (AttributeError, TypeError, ValueError):
        mismatch = {
            "status": "mismatch",
            "error": "invalid session start time",
        }
        if requested.get("weather"):
            result["weather"] = {
                "sampleCount": 0,
                "tempC": None,
                "trackTempC": None,
                "humidityPct": None,
                "pressureHpa": None,
                "windSpeedKph": None,
                "windDirectionDeg": None,
                "rainfall": None,
                "observedAtUtc": None,
                "weatherCode": None,
                "fetchedAt": utc_now(),
                **mismatch,
            }
        if requested.get("results"):
            result["results"] = {
                "rowCount": 0,
                "rows": [],
                "sourceRevision": "0" * 64,
                "fetchedAt": utc_now(),
                **mismatch,
            }
        return result

    if requested.get("weather"):
        try:
            result["weather"] = weather_result(api_path, starts_at)
        except Exception as exc:
            result["weather"] = {
                "status": "unavailable",
                "sampleCount": 0,
                "tempC": None,
                "trackTempC": None,
                "humidityPct": None,
                "pressureHpa": None,
                "windSpeedKph": None,
                "windDirectionDeg": None,
                "rainfall": None,
                "observedAtUtc": None,
                "weatherCode": None,
                "fetchedAt": utc_now(),
                "error": f"{type(exc).__name__}: {exc}",
            }
    if requested.get("results"):
        try:
            result["results"] = results_result(requested, api_path)
        except Exception as exc:
            result["results"] = {
                "status": "unavailable",
                "rowCount": 0,
                "rows": [],
                "sourceRevision": "0" * 64,
                "fetchedAt": utc_now(),
                "error": f"{type(exc).__name__}: {exc}",
            }
    return result


def collect_payload(payload: dict) -> dict:
    sessions = payload.get("sessions")
    if not isinstance(sessions, list):
        raise ValueError("sessions must be an array")
    return {
        "fastf1Version": fastf1.__version__,
        "requestsVersion": requests.__version__,
        "resultsAdapterVersion": RESULTS_ADAPTER_VERSION,
        "sessions": [collect_session(session) for session in sessions],
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, value: dict, status: int = 200) -> None:
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        return is_authorized(self.headers.get("authorization"))

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json({"ok": True})
            return
        self.send_json({"error": "not found"}, 404)

    def do_POST(self) -> None:
        if self.path != "/collect":
            self.send_json({"error": "not found"}, 404)
            return
        if not self.authorized():
            self.send_json({"error": "unauthorized"}, 401)
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > 1_000_000:
                raise ValueError("invalid body length")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("payload must be an object")
            self.send_json(collect_payload(payload))
        except Exception as exc:
            self.send_json({"error": str(exc)}, 400)


def main() -> None:
    server = HTTPServer(("0.0.0.0", 8080), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
