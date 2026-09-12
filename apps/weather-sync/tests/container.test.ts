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
paths = []
def weather_data(path):
    paths.append(path)
    return {
        "AirTemp": [20, None, 24],
        "TrackTemp": [30, 34],
        "Rainfall": [False, True],
    }
fastf1.api.weather_data = weather_data
payload = {
    "sessions": [{
        "year": 2023,
        "round": 14,
        "sessionKey": "race",
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
payload = {
    "sessions": [{
        "year": 2023,
        "round": 14,
        "sessionKey": "race",
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
