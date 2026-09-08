import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const scriptsDir = fileURLToPath(new URL("../../../scripts", import.meta.url));

// 上游边界用固定样本替代网络，运行真正的脚本与 SQLite 写入。
function runPython(source: string): void {
  execFileSync(
    "python3",
    [
      "-c",
      `
import importlib.util, pathlib, sqlite3, sys, tempfile, types
from unittest.mock import Mock, patch
sys.path.insert(0, ${JSON.stringify(scriptsDir)})
fastf1 = types.ModuleType("fastf1")
fastf1.api = types.ModuleType("fastf1.api")
sys.modules["fastf1"] = fastf1
sys.modules["fastf1.api"] = fastf1.api
def load(name):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(sys.path[0]) / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
${source}
`,
    ],
    { stdio: "pipe" },
  );
}

describe("FastF1 同步边界", () => {
  it("缺失或无效时刻不写入，带偏移时刻转换为 UTC", () => {
    runPython(`
sync = load("sync-session-times")
for value in (None, "NaT", "nan", "", "2023-02-30 12:00:00"):
    assert sync.to_utc_iso(value) is None, value
assert sync.to_utc_iso("2023-03-04 15:00:00") == "2023-03-04T15:00:00Z"
assert sync.to_utc_iso("2023-03-04T18:00:00+03:00") == "2023-03-04T15:00:00Z"
assert sync.sessions_of({"Session1": "Practice 1", "Session1DateUtc": "NaT"}) == []
`);
  });

  it("比赛日期允许赛地日期或 UTC 日期，避免漏掉拉斯维加斯夜赛", () => {
    runPython(`
from f1_session_keys import matches_race_date
event = {"EventDate": "2023-11-18", "Session5": "Race", "Session5DateUtc": "2023-11-19T06:00:00Z"}
assert matches_race_date(event, "2023-11-18")
assert matches_race_date(event, "2023-11-19")
assert not matches_race_date(event, "2023-11-20")
assert not matches_race_date({}, "2023-11-19")
`);
  });

  it("天气只写可用字段，跳过已有、未结束、无数据和比赛日期不匹配的场次", () => {
    runPython(`
sync = load("sync-weather")
def event(round_no, date="2023-03-05"):
    return {"RoundNumber": round_no, "EventDate": date,
            "Session1": "Practice 1", "Session1DateUtc": "2023-03-03T12:00:00Z"}
events = [event(i) for i in range(1, 9)]
events[5]["Session1DateUtc"] = "2999-01-01T12:00:00Z"
events[7]["EventDate"] = "2023-03-12"
schedule = Mock()
schedule.iterrows.return_value = enumerate(events)
fastf1.set_log_level = Mock()
fastf1.get_event_schedule = Mock(return_value=schedule)
fastf1.get_session = Mock(return_value=types.SimpleNamespace(f1_api_support=True, api_path="fixture"))
fastf1.api.weather_data = Mock(side_effect=[
    {"AirTemp": [None, float("nan"), 20, 24], "Rainfall": [False]},
    {"TrackTemp": [30, 34], "Rainfall": [True]},
    {}, RuntimeError("unavailable"), {"Rainfall": [False]},
])
with tempfile.TemporaryDirectory() as tmp:
    db, out, have = [pathlib.Path(tmp) / name for name in ("f1db.db", "weather.sql", "have.txt")]
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE race (year INTEGER, round INTEGER, date TEXT)")
    con.executemany("INSERT INTO race VALUES (2023, ?, '2023-03-05')", [(i,) for i in range(1, 9)])
    con.commit()
    have.write_text("2023,5,practice-1")
    with patch.object(sys, "argv", ["sync", str(db), "--out", str(out), "--have", str(have)]):
        sync.main()
    con.executescript((pathlib.Path(sys.path[0]) / "site-tables.sql").read_text())
    con.executescript(out.read_text())
    rows = con.execute("SELECT round, temp_c, track_temp_c, weather_code FROM session_weather ORDER BY round").fetchall()
    assert rows == [(1, 22.0, None, None), (2, None, 32.0, "rain")], rows
    assert fastf1.get_session.call_count == 5, fastf1.get_session.call_count
    con.close()
`);
  });
});
