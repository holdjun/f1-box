import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
    connection.execute("""CREATE TABLE session_source_ref (
        year INTEGER, round INTEGER, session_key TEXT, api_path TEXT,
        race_date TEXT, starts_at_utc TEXT, source TEXT,
        PRIMARY KEY (year, round, session_key)
    )""")
    connection.execute("""INSERT INTO session_source_ref VALUES
        (2023, 1, 'race', '/static/stale/', '2023-03-05',
         '2023-03-05T15:00:00Z', 'fastf1-schedule')""")

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
assert "ON CONFLICT(year, round, session_key) DO UPDATE" in sql, sql
assert "DELETE FROM session_source_ref" in sql, sql
assert "/static/2023/2023-09-03_Italian_Grand_Prix/Practice 1/" in sql, sql
assert "/static/2023/2023-09-03_Italian_Grand_Prix/Race/" in sql, sql
with sqlite3.connect(db_path) as connection:
    connection.executescript(sql)
    keys = connection.execute(
        "SELECT round, session_key FROM session_source_ref ORDER BY session_key"
    ).fetchall()
assert keys == [(14, "practice-1"), (14, "race")], keys
`);
  });

  it("invalidates derived weather when a session reference changes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "weather-ref-trigger-"));
    const db = path.join(dir, "weather.db");
    const schema = readFileSync(
      path.join(repoRoot, "scripts/site-tables.sql"),
      "utf8",
    );
    const result = execFileSync("sqlite3", ["-json", db], {
      encoding: "utf8",
      input: `${schema}
        INSERT INTO session_source_ref VALUES
          (2026, 1, 'race', '/static/old/', '2026-03-08', '2026-03-08T04:00:00Z', 'fastf1-schedule');
        INSERT INTO session_weather VALUES
          (2026, 1, 'race', 20, 30, NULL, 'fastf1', '2026-03-08T08:00:00Z');
        INSERT INTO weather_sync_state VALUES
          (2026, 1, 'race', 'success', 1, NULL, '2026-03-08T08:00:00Z', NULL, '2026-03-08T08:00:00Z');
        UPDATE session_source_ref SET api_path = '/static/new/'
          WHERE year = 2026 AND round = 1 AND session_key = 'race';
        SELECT
          (SELECT COUNT(*) FROM session_weather) AS weather,
          (SELECT COUNT(*) FROM weather_sync_state) AS state,
          (SELECT COUNT(*) FROM weather_cache_outbox) AS outbox,
          (SELECT cache_tag FROM weather_cache_outbox) AS cacheTag;
      `,
    });
    expect(JSON.parse(result)).toEqual([
      { weather: 0, state: 0, outbox: 1, cacheTag: "weather:2026" },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails closed when FastF1 introduces an unknown session name", () => {
    runPython(`
work = pathlib.Path(tempfile.mkdtemp())
db_path = work / "f1db.db"
out_path = work / "refs.sql"
with sqlite3.connect(db_path) as connection:
    connection.execute("CREATE TABLE race (year INTEGER, round INTEGER, date TEXT)")
    connection.execute("INSERT INTO race VALUES (2026, 1, '2026-03-08')")

class Row:
    def get(self, key):
        return {
            "RoundNumber": 1,
            "EventDate": "2026-03-08",
            "Session1": "New Sprint Format",
            "Session2": "Race",
            "Session2DateUtc": "2026-03-08T04:00:00Z",
        }.get(key)
    def get_session(self, name):
        return types.SimpleNamespace(api_path="/static/2026/race/")

fastf1.get_event_schedule = lambda *args, **kwargs: types.SimpleNamespace(
    iterrows=lambda: [(0, Row())]
)
sys.argv = ["sync-session-refs.py", str(db_path), "--out", str(out_path), "--years", "2026"]
try:
    module.main()
except RuntimeError as exc:
    assert "unknown session" in str(exc), exc
else:
    raise AssertionError("unknown session name was silently pruned")
assert not out_path.exists()
`);
  });
});
