import json
import math
import os
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

import fastf1
import fastf1.api as fastf1_api
import requests

fastf1.Cache.set_disabled()
fastf1.set_log_level("WARNING")


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
    observations = [value for value in values if value is True or value is False]
    if not observations:
        return None
    return any(value is True for value in observations)


def parse_utc_datetime(value) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("session start is not timezone-aware")
    return parsed.astimezone(timezone.utc)


def duration_seconds(value) -> float | None:
    if isinstance(value, timedelta):
        return value.total_seconds()
    if hasattr(value, "total_seconds"):
        try:
            seconds = float(value.total_seconds())
        except (TypeError, ValueError):
            return None
        return seconds if math.isfinite(seconds) else None
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    return None


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


def collect_session(requested: dict) -> dict:
    base = {
        "year": requested["year"],
        "round": requested["round"],
        "sessionKey": requested["sessionKey"],
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
        "error": None,
    }
    api_path = requested.get("apiPath")
    if not isinstance(api_path, str) or not api_path.startswith("/static/"):
        return {**base, "status": "mismatch", "error": "invalid FastF1 api path"}
    try:
        starts_at = parse_utc_datetime(requested.get("startsAtUtc"))
    except (AttributeError, TypeError, ValueError):
        return {**base, "status": "mismatch", "error": "invalid session start time"}

    try:
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
        if sample_count == 0:
            return {**base, "status": "empty"}
        return {
            **base,
            "status": "success",
            "sampleCount": sample_count,
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
    except Exception as exc:
        return {
            **base,
            "status": "unavailable",
            "error": f"{type(exc).__name__}: {exc}",
        }


def collect_payload(payload: dict) -> dict:
    sessions = payload.get("sessions")
    if not isinstance(sessions, list):
        raise ValueError("sessions must be an array")
    return {
        "fastf1Version": fastf1.__version__,
        "requestsVersion": requests.__version__,
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
            self.send_json(collect_payload(payload))
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json({"error": str(exc)}, 400)


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
