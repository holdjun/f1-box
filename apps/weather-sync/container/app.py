import json
import math
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests

_real_send = requests.adapters.HTTPAdapter.send
_REQUEST_LOG: list[dict[str, object]] = []
_ALL_HOSTS: set[str] = set()


def _recording_send(self, request, *args, **kwargs):
    host = requests.utils.urlparse(request.url).netloc.lower()
    _ALL_HOSTS.add(host)
    try:
        response = _real_send(self, request, *args, **kwargs)
    except requests.RequestException as exc:
        _REQUEST_LOG.append({"host": host, "status": None, "error": type(exc).__name__})
        raise
    _REQUEST_LOG.append({"host": host, "status": response.status_code})
    return response


requests.adapters.HTTPAdapter.send = _recording_send

import fastf1  # noqa: E402
import fastf1.api as fastf1_api  # noqa: E402

fastf1.Cache.set_disabled()
fastf1.set_log_level("WARNING")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _column(weather, name: str) -> list:
    if hasattr(weather, "columns"):
        if name not in weather.columns:
            return []
        return weather[name].tolist()
    if isinstance(weather, dict):
        return list(weather.get(name, []))
    return []


def _median(values: list) -> float | None:
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
    if not numbers:
        return None
    numbers.sort()
    middle = len(numbers) // 2
    if len(numbers) % 2:
        return numbers[middle]
    return (numbers[middle - 1] + numbers[middle]) / 2


def _matches_race_date(event, expected: str) -> bool:
    dates = {str(event.get("EventDate"))[:10]}
    for index in range(1, 6):
        if event.get(f"Session{index}") == "Race":
            dates.add(str(event.get(f"Session{index}DateUtc"))[:10])
    return expected in dates


def _failure_error(exc: BaseException | None) -> str:
    parts: list[str] = []
    for failure in _REQUEST_LOG:
        status = failure.get("status")
        host = failure.get("host")
        if status is None:
            parts.append(f"{failure.get('error')} {host}")
        elif isinstance(status, int) and status >= 400:
            parts.append(f"HTTP {status} {host}")
    if exc is not None:
        parts.append(f"{type(exc).__name__}: {exc}")
    return "; ".join(parts) or "weather request failed"


def _session_result(year: int, requested: dict, event: dict, name_by_key: dict[str, str]):
    round_no = requested["round"]
    session_key = requested["sessionKey"]
    base = {
        "year": year,
        "round": round_no,
        "sessionKey": session_key,
        "tempC": None,
        "trackTempC": None,
        "weatherCode": None,
        "fetchedAt": _utc_now(),
        "error": None,
    }
    if not _matches_race_date(event, requested["raceDate"]):
        return {**base, "status": "mismatch", "error": "race date mismatch"}

    name = name_by_key.get(session_key)
    if name is None or name not in [event.get(f"Session{index}") for index in range(1, 6)]:
        return {**base, "status": "no_data"}

    _REQUEST_LOG.clear()
    try:
        session = fastf1.get_session(year, round_no, name, backend="fastf1")
        weather = fastf1_api.weather_data(session.api_path)
        failures = [
            item
            for item in _REQUEST_LOG
            if item.get("status") is None or (isinstance(item.get("status"), int) and item["status"] >= 400)
        ]
        if failures:
            return {**base, "status": "unavailable", "error": _failure_error(None)}
        rows = max(
            (
                len(_column(weather, column))
                for column in ("AirTemp", "TrackTemp", "Rainfall")
            ),
            default=0,
        )
        if rows == 0:
            return {**base, "status": "no_data"}
        rainfall = _column(weather, "Rainfall")
        return {
            **base,
            "status": "success",
            "tempC": _median(_column(weather, "AirTemp")),
            "trackTempC": _median(_column(weather, "TrackTemp")),
            "weatherCode": "rain" if any(value is True for value in rainfall) else None,
        }
    except Exception as exc:
        return {**base, "status": "unavailable", "error": _failure_error(exc)}


def collect_payload(payload: dict) -> dict:
    year = payload.get("year")
    sessions = payload.get("sessions")
    session_names = payload.get("sessionNames")
    if not isinstance(year, int) or not isinstance(sessions, list) or not isinstance(session_names, dict):
        raise ValueError("invalid collect payload")

    _ALL_HOSTS.clear()
    _REQUEST_LOG.clear()
    schedule = fastf1.get_event_schedule(year, backend="fastf1", include_testing=False)
    events = {int(row["RoundNumber"]): row for _, row in schedule.iterrows()}
    name_by_key = {key: name for name, key in session_names.items()}
    results = []
    for requested in sessions:
        event = events.get(requested["round"])
        if event is None:
            results.append({
                "year": year,
                "round": requested["round"],
                "sessionKey": requested["sessionKey"],
                "status": "mismatch",
                "tempC": None,
                "trackTempC": None,
                "weatherCode": None,
                "fetchedAt": _utc_now(),
                "error": "round not found in FastF1 schedule",
            })
            continue
        results.append(_session_result(year, requested, event, name_by_key))

    banned = sorted(host for host in _ALL_HOSTS if "jolpi" in host or "ergast" in host)
    if banned:
        raise RuntimeError(f"banned host touched: {', '.join(banned)}")
    return {
        "fastf1Version": fastf1.__version__,
        "requestsVersion": requests.__version__,
        "hosts": sorted(_ALL_HOSTS),
        "sessions": results,
    }


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, value: dict, status: int = 200) -> None:
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        expected = f"Bearer {os.environ.get('WEATHER_CONTAINER_TOKEN', '')}"
        return bool(expected) and self.headers.get("authorization") == expected

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json({"ok": True})
            return
        self._send_json({"error": "not found"}, 404)

    def do_POST(self) -> None:
        if self.path != "/collect":
            self._send_json({"error": "not found"}, 404)
            return
        if not self._authorized():
            self._send_json({"error": "unauthorized"}, 401)
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > 2_000_000:
                raise ValueError("invalid body length")
            result = collect_payload(json.loads(self.rfile.read(length)))
            self._send_json(result)
        except ValueError as exc:
            self._send_json({"error": str(exc)}, 400)
        except RuntimeError as exc:
            self._send_json({"error": str(exc)}, 503)
        except Exception as exc:
            print(f"collect failed: {type(exc).__name__}: {exc}", flush=True)
            self._send_json({"error": "weather collection failed"}, 500)

    def log_message(self, format: str, *args) -> None:
        print(f"{self.address_string()} {format % args}", flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
