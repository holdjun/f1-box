import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const scriptsDir = path.join(repoRoot, "scripts");
const script = path.join(scriptsDir, "sync-session-refs.py");

function runPython(source: string): void {
  execFileSync("python3", [
    "-c",
    `
import importlib.util, pathlib, sqlite3, sys, tempfile, types
sys.path.insert(0, ${JSON.stringify(scriptsDir)})
fastf1 = types.ModuleType("fastf1")
fastf1.api = types.ModuleType("fastf1.api")
fastf1.Cache = types.SimpleNamespace(set_disabled=lambda: None)
fastf1.set_log_level = lambda level: None
fastf1.__version__ = "3.8.3"
sys.modules["fastf1"] = fastf1
sys.modules["fastf1.api"] = fastf1.api
spec = importlib.util.spec_from_file_location(
    "sync-session-refs", pathlib.Path(${JSON.stringify(script)})
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
${source}
`,
  ]);
}

describe("session reference generation", () => {
  it("pins FastF1 and keeps the schedule backend explicit", () => {
    const source = readFileSync(script, "utf8");
    expect(source).toContain('dependencies = ["fastf1==3.8.3"]');
    expect(source).toContain('backend="fastf1"');
    expect(source).not.toContain("jolpi.ca");
    expect(source).not.toContain("ergast.com");
  });

  it("writes stable api paths for known sessions", () => {
    runPython(`
import pathlib, tempfile
work = pathlib.Path(tempfile.mkdtemp())
db_path = work / "f1db.db"
out_path = work / "refs.sql"
with sqlite3.connect(db_path) as connection:
    connection.execute("CREATE TABLE race (year INTEGER, round INTEGER, date TEXT)")
    connection.execute("INSERT INTO race VALUES (2023, 14, '2023-09-03')")

class Session:
    def __init__(self, api_path):
        self.api_path = api_path

class Row:
    def __init__(self, values):
        self.values = values
    def get(self, key):
        return self.values.get(key)
    def get_session(self, name):
        return Session(f"/static/2023/2023-09-03_Italian_Grand_Prix/{name}/")

row = Row({
    "RoundNumber": 14,
    "EventDate": "2023-09-03",
    "Session1": "Practice 1",
    "Session1DateUtc": "2023-09-01T11:30:00Z",
    "Session5": "Race",
    "Session5DateUtc": "2023-09-03T14:00:00Z",
})
fastf1.get_event_schedule = lambda year, backend, include_testing: types.SimpleNamespace(
    iterrows=lambda: [(0, row)]
)
sys.argv = ["sync-session-refs.py", str(db_path), "--out", str(out_path), "--years", "2023"]
module.main()
sql = out_path.read_text()
assert "INSERT OR REPLACE INTO session_source_ref" in sql, sql
assert "/static/2023/2023-09-03_Italian_Grand_Prix/Practice 1/" in sql, sql
assert "/static/2023/2023-09-03_Italian_Grand_Prix/Race/" in sql, sql
`);
  });
});
