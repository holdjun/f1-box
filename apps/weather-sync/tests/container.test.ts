import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const appPath = path.join(repoRoot, "apps/weather-sync/container/app.py");

function runPython(source: string): void {
  execFileSync("python3", [
    "-c",
    `
import importlib.util, pathlib, sys, types
fastf1 = types.ModuleType("fastf1")
fastf1.api = types.ModuleType("fastf1.api")
fastf1.Cache = types.SimpleNamespace(set_disabled=lambda: None)
fastf1.set_log_level = lambda level: None
fastf1.__version__ = "3.8.3"
def forbidden_schedule(*args, **kwargs):
    raise AssertionError("weather container must not discover schedules")
fastf1.get_event_schedule = forbidden_schedule
fastf1.get_session = forbidden_schedule
sys.modules["fastf1"] = fastf1
sys.modules["fastf1.api"] = fastf1.api
requests = types.ModuleType("requests")
requests.__version__ = "2.34.2"
sys.modules["requests"] = requests
spec = importlib.util.spec_from_file_location("app", pathlib.Path(${JSON.stringify(appPath)}))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
${source}
`,
  ]);
}

describe("weather container", () => {
  it("collects explicit api paths without schedule discovery", () => {
    runPython(`
from datetime import timedelta

paths = []
def weather_data(path):
    paths.append(path)
    return {
        "AirTemp": [20, None, 24],
        "TrackTemp": [30, 34],
        "Humidity": [50, None, 54],
        "Pressure": [1010, 1012],
        "Rainfall": [False, True, None],
        "WindDirection": [350, 10],
        "WindSpeed": [5],
        "Time": [timedelta(minutes=1), timedelta(minutes=2)],
    }
fastf1.api.weather_data = weather_data
payload = {
    "sessions": [{
        "year": 2023,
        "round": 14,
        "sessionKey": "race",
        "startsAtUtc": "2023-09-03T14:00:00Z",
        "apiPath": "/static/2023/2023-09-03_Italian_Grand_Prix/2023-09-03_Race/",
    }]
}
result = app.collect_payload(payload)
assert paths == [payload["sessions"][0]["apiPath"]], paths
assert result["sessions"] == [{
    "year": 2023,
    "round": 14,
    "sessionKey": "race",
    "status": "success",
    "sampleCount": 3,
    "tempC": 22.0,
    "trackTempC": 32.0,
    "humidityPct": 52.0,
    "pressureHpa": 1011.0,
    "windSpeedKph": 18.0,
    "windDirectionDeg": 0.0,
    "rainfall": True,
    "observedAtUtc": "2023-09-03T14:02:00Z",
    "weatherCode": "rain",
    "fetchedAt": result["sessions"][0]["fetchedAt"],
    "error": None,
}], result
assert result["fastf1Version"] == "3.8.3"
assert result["requestsVersion"] == "2.34.2"
`);
  });

  it("distinguishes empty payloads from retrieval failures", () => {
    runPython(`
from datetime import timedelta

payload = {
    "sessions": [{
        "year": 2023,
        "round": 14,
        "sessionKey": "race",
        "startsAtUtc": "2023-09-03T14:00:00Z",
        "apiPath": "/static/2023/2023-09-03_Italian_Grand_Prix/2023-09-03_Race/",
    }]
}
fastf1.api.weather_data = lambda path: {"AirTemp": [], "TrackTemp": [], "Rainfall": []}
empty = app.collect_payload(payload)
assert empty["sessions"][0]["status"] == "empty", empty
assert empty["sessions"][0]["sampleCount"] == 0, empty

def unavailable(path):
    raise RuntimeError("HTTP 403")
fastf1.api.weather_data = unavailable
failed = app.collect_payload(payload)
assert failed["sessions"][0]["status"] == "unavailable", failed
assert "HTTP 403" in failed["sessions"][0]["error"], failed
`);
  });

  it("keeps missing rainfall unknown instead of inferring dry weather", () => {
    runPython(`
from datetime import timedelta

payload = {
    "sessions": [{
        "year": 2023,
        "round": 14,
        "sessionKey": "race",
        "startsAtUtc": "2023-09-03T14:00:00Z",
        "apiPath": "/static/2023/2023-09-03_Italian_Grand_Prix/2023-09-03_Race/",
    }]
}
fastf1.api.weather_data = lambda path: {
    "AirTemp": [20],
    "TrackTemp": [30],
    "Humidity": [48],
    "Pressure": [1010],
    "Rainfall": [None],
    "WindDirection": [220],
    "WindSpeed": [4],
    "Time": [timedelta(minutes=1)],
}
result = app.collect_payload(payload)["sessions"][0]
assert result["rainfall"] is None, result
assert result["weatherCode"] is None, result
`);
  });

  it("rejects api paths outside the FastF1 static namespace", () => {
    runPython(`
payload = {
    "sessions": [{
        "year": 2023,
        "round": 14,
        "sessionKey": "race",
        "apiPath": "https://api.jolpi.ca/weather",
    }]
}
result = app.collect_payload(payload)
assert result["sessions"][0]["status"] == "mismatch", result
assert "api path" in result["sessions"][0]["error"], result
`);
  });

  it("rejects an invalid session start before fetching weather", () => {
    runPython(`
payload = {
    "sessions": [{
        "year": 2023,
        "round": 14,
        "sessionKey": "race",
        "startsAtUtc": "2023-09-03 14:00:00",
        "apiPath": "/static/2023/2023-09-03_Italian_Grand_Prix/2023-09-03_Race/",
    }]
}
def weather_data(path):
    raise AssertionError("invalid session start must not reach FastF1")
fastf1.api.weather_data = weather_data
result = app.collect_payload(payload)["sessions"][0]
assert result["status"] == "mismatch", result
assert "session start" in result["error"], result
`);
  });

  it("rejects authorization when the container secret is missing", () => {
    runPython(`
import os
os.environ.pop("WEATHER_CONTAINER_TOKEN", None)
assert not app.is_authorized("Bearer ")
os.environ["WEATHER_CONTAINER_TOKEN"] = "internal-secret"
assert app.is_authorized("Bearer internal-secret")
assert not app.is_authorized("Bearer wrong")
`);
  });
});
