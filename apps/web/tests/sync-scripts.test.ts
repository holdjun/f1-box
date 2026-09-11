import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const scriptsDir = fileURLToPath(new URL("../../../scripts", import.meta.url));

// 上游边界用固定样本替代网络，运行真正的同步脚本。
function runPython(source: string): void {
  execFileSync(
    "python3",
    [
      "-c",
      `
import importlib.util, pathlib, sys, types
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
});
