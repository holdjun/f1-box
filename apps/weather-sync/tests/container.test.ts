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
    raise AssertionError("session container must not discover schedules")
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

const session = {
  year: 2026,
  round: 9,
  sessionKey: "practice-1",
  startsAtUtc: "2026-09-11T11:30:00Z",
  apiPath: "/static/2026/2026-09-13_Spanish_Grand_Prix/2026-09-11_Practice_1/",
};

const drivers = {
  "1": {
    RacingNumber: "1",
    Reference: "max_verstappen",
    FullName: "Max Verstappen",
    Tla: "VER",
    TeamName: "Red Bull Racing",
  },
  "4": {
    RacingNumber: "4",
    Reference: "lando_norris",
    FullName: "Lando Norris",
    Tla: "NOR",
    TeamName: "McLaren",
  },
};

function installTiming(
  laps: object[],
  stream: object[] = [],
  splits: unknown[] = [],
) {
  return [
    `fastf1.api.driver_info = lambda path: ${JSON.stringify(drivers)}`,
    'fastf1.api.race_control_messages = lambda path: {"Message": []}',
    `fastf1.api._extended_timing_data = lambda path: (${JSON.stringify(laps)}, ${JSON.stringify(stream)}, ${JSON.stringify(splits)})`,
  ]
    .join("; ")
    .replaceAll('"IsAccurate":true', '"IsAccurate":True')
    .replaceAll('"IsAccurate":false', '"IsAccurate":False')
    .replaceAll('"GapToLeader":null', '"GapToLeader":None');
}

describe("session container", () => {
  it("prefers public FastF1 session results for qualifying", () => {
    runPython(`
class Duration:
    def __init__(self, seconds):
        self.seconds = seconds
    def total_seconds(self):
        return self.seconds

class Frame:
    def __init__(self, rows):
        self.rows = rows
    def to_dict(self, kind):
        return self.rows

def timing(path):
    raise AssertionError("public results must be preferred")
fastf1.api._extended_timing_data = timing
fastf1.api.race_control_messages = timing

session = types.SimpleNamespace(
    load=lambda **kwargs: None,
    results=Frame([
        {
            "DriverNumber": "1", "DriverId": "max_verstappen",
            "FullName": "Max Verstappen", "Abbreviation": "VER",
            "TeamId": "red_bull", "TeamName": "Red Bull Racing",
            "Position": 1.0, "ClassifiedPosition": "1",
            "Q1": Duration(90), "Q2": Duration(89), "Q3": Duration(88),
        },
        {
            "DriverNumber": "4", "DriverId": "lando_norris",
            "FullName": "Lando Norris", "Abbreviation": "NOR",
            "TeamId": "mclaren", "TeamName": "McLaren",
            "Position": 2.0, "ClassifiedPosition": "2",
            "Q1": Duration(91), "Q2": None, "Q3": None,
        },
    ]),
    laps=Frame([
        {"DriverNumber": "1", "LapTime": Duration(82), "Deleted": True, "NumberOfLaps": 3},
        {"DriverNumber": "1", "LapTime": Duration(84.123), "Deleted": False, "NumberOfLaps": 4},
    ]),
)
fastf1.get_session = lambda year, round_no, identifier: session
payload = {**${JSON.stringify(session)}, "sessionKey": "qualifying"}
result = app.collect_payload({
    "sessions": [{**payload, "weather": False, "results": True}]
})["sessions"][0]["results"]
assert result["adapter"] == "fastf1-session-results", result
assert result["schemaVersion"] == 1, result
assert result["rows"][0]["position"] == 1, result
assert result["rows"][0]["q1Ms"] == 90000, result
assert result["rows"][0]["q2Ms"] == 89000, result
assert result["rows"][0]["q3Ms"] == 88000, result
assert result["rows"][0]["driverSourceId"] == "max_verstappen", result
assert result["rows"][0]["constructorSourceId"] == "red_bull", result
assert result["rows"][0]["bestLapMs"] == 84123, result
assert result["rows"][1]["q2Ms"] is None, result
`);
  });

  it("uses public race classification without recomputing positions", () => {
    runPython(`
class Duration:
    def __init__(self, seconds):
        self.seconds = seconds
    def total_seconds(self):
        return self.seconds

class Frame:
    def __init__(self, rows):
        self.rows = rows
    def to_dict(self, kind):
        return self.rows

session = types.SimpleNamespace(
    load=lambda **kwargs: None,
    results=Frame([
        {
            "DriverNumber": "1", "DriverId": "max_verstappen",
            "FullName": "Max Verstappen", "Abbreviation": "VER",
            "TeamId": "red_bull", "TeamName": "Red Bull Racing",
            "Position": 1.0, "ClassifiedPosition": "1",
            "Time": Duration(4800), "Status": "Finished",
            "Points": 25.0, "Laps": 58.0,
        },
        {
            "DriverNumber": "4", "DriverId": "lando_norris",
            "FullName": "Lando Norris", "Abbreviation": "NOR",
            "TeamId": "mclaren", "TeamName": "McLaren",
            "Position": None, "ClassifiedPosition": "R",
            "Time": None, "Status": "Retired", "Points": 0.0, "Laps": 12.0,
        },
    ]),
    laps=Frame([]),
)
fastf1.get_session = lambda year, round_no, identifier: session
payload = {**${JSON.stringify(session)}, "sessionKey": "race"}
result = app.collect_payload({
    "sessions": [{**payload, "weather": False, "results": True}]
})["sessions"][0]["results"]
assert result["adapter"] == "fastf1-session-results", result
assert result["rows"][0]["positionText"] == "1", result
assert result["rows"][0]["totalTimeMs"] == 4800000, result
assert result["rows"][0]["status"] == "Finished", result
assert result["rows"][0]["points"] == 25.0, result
assert result["rows"][1]["position"] is None, result
assert result["rows"][1]["positionText"] == "R", result
assert result["rows"][1]["laps"] == 12, result
`);
  });

  it("marks timing fallback and rejects an unexpected timing schema", () => {
    runPython(`
fastf1.get_session = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("public adapter unavailable"))
fastf1.api.driver_info = lambda path: ${JSON.stringify(drivers)}
fastf1.api.race_control_messages = lambda path: {"Message": []}
fastf1.api._extended_timing_data = lambda path: ({"NotLaps": []}, [], [])
result = app.collect_payload({
    "sessions": [{**${JSON.stringify(session)}, "weather": False, "results": True}]
})["sessions"][0]["results"]
assert result["status"] == "unavailable", result
assert "timing schema" in result["error"], result
`);
  });

  it("collects weather and explicit api paths without schedule discovery", () => {
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
${installTiming([])}
payload = {
    "sessions": [{
        **${JSON.stringify(session)},
        "weather": True,
        "results": True,
    }]
}
result = app.collect_payload(payload)
assert paths == [payload["sessions"][0]["apiPath"]], paths
weather = result["sessions"][0]["weather"]
assert weather == {
    "status": "success",
    "sampleCount": 3,
    "tempC": 22.0,
    "trackTempC": 32.0,
    "humidityPct": 52.0,
    "pressureHpa": 1011.0,
    "windSpeedKph": 18.0,
    "windDirectionDeg": 0.0,
    "rainfall": True,
    "observedAtUtc": "2026-09-11T11:32:00Z",
    "weatherCode": "rain",
    "fetchedAt": weather["fetchedAt"],
    "error": None,
}, weather
assert result["fastf1Version"] == "3.8.3"
assert result["requestsVersion"] == "2.34.2"
`);
  });

  it("derives practice classification from timing data", () => {
    runPython(`
fastf1.api.weather_data = lambda path: {"AirTemp": [21]}
${installTiming([
  {
    DriverNumber: "1",
    LapTime: 83.5,
    LapStartTime: 600,
    Time: 660,
    NumberOfLaps: 5,
    IsAccurate: true,
  },
  {
    DriverNumber: "1",
    LapTime: 82.123,
    LapStartTime: 720,
    Time: 780,
    NumberOfLaps: 6,
    IsAccurate: true,
  },
  {
    DriverNumber: "4",
    LapTime: 82.5,
    LapStartTime: 600,
    Time: 660,
    NumberOfLaps: 4,
    IsAccurate: true,
  },
])}
result = app.collect_payload({
    "sessions": [{**${JSON.stringify(session)}, "weather": False, "results": True}]
})["sessions"][0]["results"]
assert result["status"] == "success", result
assert result["rowCount"] == 2, result
assert [row["driverNumber"] for row in result["rows"]] == ["1", "4"], result
assert result["rows"][0]["position"] == 1
assert result["rows"][0]["bestLapMs"] == 82123
assert result["rows"][0]["laps"] == 6
assert result["rows"][1]["position"] == 2
assert result["rows"][1]["gapMs"] == 377
assert result["rows"][1]["laps"] == 4
assert len(result["sourceRevision"]) == 64
assert "weather" not in result
`);
  });

  it("splits qualifying sessions and ranks by the deepest available lap", () => {
    runPython(`
fastf1.api.weather_data = lambda path: {"AirTemp": []}
${installTiming(
  [
    {
      DriverNumber: "1",
      LapTime: 90,
      LapStartTime: 300,
      Time: 360,
      NumberOfLaps: 1,
      IsAccurate: true,
    },
    {
      DriverNumber: "1",
      LapTime: 89,
      LapStartTime: 1500,
      Time: 1560,
      NumberOfLaps: 2,
      IsAccurate: true,
    },
    {
      DriverNumber: "1",
      LapTime: 88,
      LapStartTime: 2700,
      Time: 2760,
      NumberOfLaps: 3,
      IsAccurate: true,
    },
    {
      DriverNumber: "4",
      LapTime: 91,
      LapStartTime: 300,
      Time: 360,
      NumberOfLaps: 1,
      IsAccurate: true,
    },
    {
      DriverNumber: "4",
      LapTime: 90,
      LapStartTime: 1500,
      Time: 1560,
      NumberOfLaps: 2,
      IsAccurate: true,
    },
  ],
  [],
  [0, 1200, 2400],
)}
payload = {**${JSON.stringify(session)}, "sessionKey": "qualifying"}
result = app.collect_payload({
    "sessions": [{**payload, "weather": False, "results": True}]
})["sessions"][0]["results"]
assert result["rows"][0]["position"] == 1
assert result["rows"][0]["q1Ms"] == 90000
assert result["rows"][0]["q2Ms"] == 89000
assert result["rows"][0]["q3Ms"] == 88000
assert result["rows"][1]["position"] == 2
assert result["rows"][1]["q3Ms"] is None
assert result["rows"][1]["laps"] == 2
`);
  });

  it("does not guess qualifying segments when split boundaries are incomplete", () => {
    runPython(`
assert app.qualifying_segment({"LapStartTime": 100, "Time": 200, "PitOutTime": None}, []) is None
assert app.qualifying_segment({"LapStartTime": 100, "Time": 200, "PitOutTime": None}, [0, 150]) is None
assert app.qualifying_segment({"LapStartTime": 100, "Time": 200, "PitOutTime": None}, [0, 150, None]) is None
`);
  });

  it("keeps a deleted lap excluded only until it is reinstated", () => {
    runPython(`
laps = [
    {"DriverNumber": "1", "LapTime": 79, "Deleted": False},
    {"DriverNumber": "1", "LapTime": 78, "Deleted": False},
]
messages = [
    {"Message": "CAR 1 - LAP TIME 1:19.000 DELETED - TRACK LIMITS"},
    {"Message": "CAR 1 - LAP TIME 1:19.000 REINSTATED BY STEWARDS"},
    {"Message": "CAR 1 - LAP TIME 1:18.000 DELETED - TRACK LIMITS"},
]
app.mark_deleted_laps(laps, messages)
assert laps[0]["Deleted"] is False, laps
assert laps[1]["Deleted"] is True, laps
`);
  });

  it("uses non-deleted timed laps even when accuracy is false", () => {
    runPython(`
fastf1.api.weather_data = lambda path: {"AirTemp": []}
${installTiming([
  {
    DriverNumber: "1",
    LapTime: 83.5,
    LapStartTime: 600,
    Time: 660,
    NumberOfLaps: 5,
    IsAccurate: false,
  },
])}
result = app.collect_payload({
    "sessions": [{**${JSON.stringify(session)}, "weather": False, "results": True}]
})["sessions"][0]["results"]
assert result["rows"][0]["bestLapMs"] == 83500, result
`);
  });

  it("uses the final timing stream for provisional race classification", () => {
    runPython(`
fastf1.api.weather_data = lambda path: {"AirTemp": []}
${installTiming(
  [
    {
      DriverNumber: "1",
      LapTime: 80,
      LapStartTime: 600,
      Time: 660,
      NumberOfLaps: 58,
      IsAccurate: true,
    },
    {
      DriverNumber: "4",
      LapTime: 81,
      LapStartTime: 600,
      Time: 660,
      NumberOfLaps: 58,
      IsAccurate: true,
    },
  ],
  [
    {
      DriverNumber: "1",
      Position: 1,
      GapToLeader: null,
      Time: 4800,
    },
    {
      DriverNumber: "4",
      Position: 2,
      GapToLeader: "2.123",
      Time: 4800,
    },
  ],
)}
payload = {**${JSON.stringify(session)}, "sessionKey": "race"}
result = app.collect_payload({
    "sessions": [{**payload, "weather": False, "results": True}]
})["sessions"][0]["results"]
assert result["rows"][0]["position"] == 1
assert result["rows"][0]["laps"] == 58
assert result["rows"][1]["position"] == 2
assert result["rows"][1]["gapMs"] == 2123
assert result["rows"][1]["points"] is None
`);
  });

  it("keeps weather and result failures independent", () => {
    runPython(`
payload = {
    **${JSON.stringify(session)},
    "weather": True,
    "results": True,
}
fastf1.api.weather_data = lambda path: {"AirTemp": []}
fastf1.api.driver_info = lambda path: ${JSON.stringify(drivers)}
fastf1.api.race_control_messages = lambda path: {"Message": []}
fastf1.api._extended_timing_data = lambda path: ([], [], [])
empty = app.collect_payload({"sessions": [payload]})["sessions"][0]
assert empty["weather"]["status"] == "empty", empty
assert empty["results"]["status"] == "empty", empty

def unavailable(path):
    raise RuntimeError("HTTP 403")
fastf1.api.weather_data = unavailable
fastf1.api._extended_timing_data = unavailable
failed = app.collect_payload({"sessions": [payload]})["sessions"][0]
assert failed["weather"]["status"] == "unavailable", failed
assert "HTTP 403" in failed["weather"]["error"], failed
assert failed["results"]["status"] == "unavailable", failed
assert "HTTP 403" in failed["results"]["error"], failed
`);
  });

  it("keeps missing rainfall unknown instead of inferring dry weather", () => {
    runPython(`
from datetime import timedelta

payload = {
    **${JSON.stringify(session)},
    "weather": True,
    "results": False,
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
def timing(path):
    raise AssertionError("results were not requested")
fastf1.api._extended_timing_data = timing
result = app.collect_payload({"sessions": [payload]})["sessions"][0]["weather"]
assert result["rainfall"] is None, result
assert result["weatherCode"] is None, result
assert "results" not in app.collect_payload({"sessions": [payload]})["sessions"][0]
`);
  });

  it("rejects api paths outside the FastF1 static namespace", () => {
    runPython(`
payload = {
    **${JSON.stringify(session)},
    "apiPath": "https://api.jolpi.ca/weather",
    "weather": True,
    "results": True,
}
result = app.collect_payload({"sessions": [payload]})["sessions"][0]
assert result["weather"]["status"] == "mismatch", result
assert result["results"]["status"] == "mismatch", result
assert "api path" in result["weather"]["error"], result
`);
  });

  it("rejects an invalid session start before fetching session data", () => {
    runPython(`
payload = {
    **${JSON.stringify(session)},
    "startsAtUtc": "2026-09-11 11:30:00",
    "weather": True,
    "results": True,
}
def weather_data(path):
    raise AssertionError("invalid session start must not reach FastF1")
fastf1.api.weather_data = weather_data
result = app.collect_payload({"sessions": [payload]})["sessions"][0]
assert result["weather"]["status"] == "mismatch", result
assert result["results"]["status"] == "mismatch", result
assert "session start" in result["weather"]["error"], result
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
