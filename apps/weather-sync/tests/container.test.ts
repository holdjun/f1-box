import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const containerDir = fileURLToPath(
  new URL("../container", import.meta.url).toString(),
);

function runPython(source: string): void {
  execFileSync("python3", ["-c", source], {
    cwd: containerDir,
    stdio: "pipe",
  });
}

const fixtureEventSource = `
class FixtureEvent:
    def __init__(self, data):
        self.data = data
    def get(self, key, default=None):
        return self.data.get(key, default)
    def __getitem__(self, key):
        return self.data[key]
    def get_session(self, name):
        return types.SimpleNamespace(api_path="fixture")
`;

describe("FastF1 weather container", () => {
  it("summarizes available fields and records rain without filling zeros", () => {
    runPython(`
import importlib.util, pathlib, sys, types
fastf1 = types.ModuleType("fastf1")
fastf1.api = types.ModuleType("fastf1.api")
fastf1.Cache = types.SimpleNamespace(set_disabled=lambda: None)
fastf1.set_log_level = lambda level: None
fastf1.__version__ = "3.8.3"
sys.modules["fastf1"] = fastf1
sys.modules["fastf1.api"] = fastf1.api
spec = importlib.util.spec_from_file_location("app", pathlib.Path("app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

${fixtureEventSource}
event = FixtureEvent({
  "RoundNumber": 1,
  "EventDate": "2023-03-05",
  "Session3": "Qualifying",
  "Session3DateUtc": "2023-03-04T16:00:00Z",
})
schedule = types.SimpleNamespace(iterrows=lambda: [(0, event)])
backends = []
def get_event_schedule(year, backend, include_testing):
    backends.append(backend)
    return schedule
fastf1.get_event_schedule = get_event_schedule
def fail_get_session(*args, **kwargs):
    raise AssertionError("session must come from the event schedule")
fastf1.get_session = fail_get_session
fastf1.api.weather_data = lambda path: {
  "AirTemp": [20, None, 24],
  "TrackTemp": [30, 34],
  "Rainfall": [False, True],
}
payload = {
  "year": 2023,
  "sessions": [{"round": 1, "sessionKey": "qualifying", "raceDate": "2023-03-05"}],
  "sessionNames": {"Qualifying": "qualifying"},
}
result = app.collect_payload(payload)
assert backends == ["f1timing"], backends
assert result["sessions"] == [{
  "year": 2023, "round": 1, "sessionKey": "qualifying", "status": "success",
  "tempC": 22.0, "trackTempC": 32.0, "weatherCode": "rain",
  "fetchedAt": result["sessions"][0]["fetchedAt"], "error": None,
}], result
assert result["fastf1Version"] and result["requestsVersion"]
`);
  });

  it("treats HTTP failures and empty payloads differently", () => {
    runPython(`
import importlib.util, pathlib, sys, types
fastf1 = types.ModuleType("fastf1")
fastf1.api = types.ModuleType("fastf1.api")
fastf1.Cache = types.SimpleNamespace(set_disabled=lambda: None)
fastf1.set_log_level = lambda level: None
fastf1.__version__ = "3.8.3"
sys.modules["fastf1"] = fastf1
sys.modules["fastf1.api"] = fastf1.api
spec = importlib.util.spec_from_file_location("app", pathlib.Path("app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
${fixtureEventSource}
event = FixtureEvent({"RoundNumber": 1, "EventDate": "2023-03-05",
         "Session3": "Qualifying", "Session3DateUtc": "2023-03-04T16:00:00Z"})
schedule = types.SimpleNamespace(iterrows=lambda: [(0, event)])
fastf1.get_event_schedule = lambda year, backend, include_testing: schedule

def unavailable(path):
    app._REQUEST_LOG.append({"host": "livetiming.formula1.com", "status": 403})
    raise RuntimeError("HTTP 403")
fastf1.api.weather_data = unavailable
payload = {
  "year": 2023,
  "sessions": [{"round": 1, "sessionKey": "qualifying", "raceDate": "2023-03-05"}],
  "sessionNames": {"Qualifying": "qualifying"},
}
result = app.collect_payload(payload)
assert result["sessions"][0]["status"] == "unavailable", result
assert "HTTP 403" in result["sessions"][0]["error"], result

fastf1.api.weather_data = lambda path: {}
result = app.collect_payload(payload)
assert result["sessions"][0]["status"] == "no_data", result
assert result["sessions"][0]["tempC"] is None, result
`);
  });

  it("rejects race identity mismatches and banned hosts", () => {
    runPython(`
import importlib.util, pathlib, sys, types
fastf1 = types.ModuleType("fastf1")
fastf1.api = types.ModuleType("fastf1.api")
fastf1.Cache = types.SimpleNamespace(set_disabled=lambda: None)
fastf1.set_log_level = lambda level: None
fastf1.__version__ = "3.8.3"
sys.modules["fastf1"] = fastf1
sys.modules["fastf1.api"] = fastf1.api
spec = importlib.util.spec_from_file_location("app", pathlib.Path("app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
${fixtureEventSource}
event = FixtureEvent({"RoundNumber": 1, "EventDate": "2023-03-12",
         "Session3": "Qualifying", "Session3DateUtc": "2023-03-11T16:00:00Z"})
schedule = types.SimpleNamespace(iterrows=lambda: [(0, event)])
fastf1.get_event_schedule = lambda year, backend, include_testing: schedule
fastf1.api.weather_data = lambda path: {"AirTemp": [24]}
payload = {
  "year": 2023,
  "sessions": [{"round": 1, "sessionKey": "qualifying", "raceDate": "2023-03-05"}],
  "sessionNames": {"Qualifying": "qualifying"},
}
result = app.collect_payload(payload)
assert result["sessions"][0]["status"] == "mismatch", result

def schedule_with_banned(year, backend, include_testing):
    app._ALL_HOSTS.add("api.jolpi.ca")
    return schedule
fastf1.get_event_schedule = schedule_with_banned
try:
    app.collect_payload(payload)
except RuntimeError as exc:
    assert "banned host" in str(exc).lower(), exc
else:
    raise AssertionError("banned host accepted")
`);
  });
});
