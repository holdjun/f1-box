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
const syncScript = path.join(scriptsDir, "sync-session-times.py");
const workflowsDir = path.join(repoRoot, ".github/workflows");

function runPython(source: string): void {
  execFileSync("python3", [
    "-c",
    `
import importlib.util, pathlib, sys, types
sys.path.insert(0, ${JSON.stringify(scriptsDir)})
fastf1 = types.ModuleType("fastf1")
fastf1.api = types.ModuleType("fastf1.api")
sys.modules["fastf1"] = fastf1
sys.modules["fastf1.api"] = fastf1.api
spec = importlib.util.spec_from_file_location(
    "sync-session-times", pathlib.Path(${JSON.stringify(syncScript)})
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
${source}
`,
  ]);
}

describe("session-time sync boundary", () => {
  it("normalizes valid timestamps and rejects invalid values", () => {
    runPython(`
for value in (None, "NaT", "nan", "", "2023-02-30 12:00:00"):
    assert module.to_utc_iso(value) is None, value
assert module.to_utc_iso("2023-03-04 15:00:00") == "2023-03-04T15:00:00Z"
assert module.to_utc_iso("2023-03-04T18:00:00+03:00") == "2023-03-04T15:00:00Z"
`);
  });

  it("maps FastF1 session names and validates race dates", () => {
    runPython(`
assert module.session_key("Sprint Qualifying") == "sprint-qualifying"
assert module.session_key("Testing") is None
event = {
    "EventDate": "2023-11-18",
    "Session5": "Race",
    "Session5DateUtc": "2023-11-19T06:00:00Z",
}
assert module.matches_race_date(event, "2023-11-18")
assert module.matches_race_date(event, "2023-11-19")
assert not module.matches_race_date(event, "2023-11-20")
`);
  });

  it("keeps the sync script on declared FastF1 and f1db hosts", () => {
    const source = readFileSync(syncScript, "utf8");
    const allowedHosts = new Set([
      "github.com",
      "objects.githubusercontent.com",
      "raw.githubusercontent.com",
    ]);
    for (const match of source.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/gi)) {
      const host = match[1].toLowerCase().replace(/^www\./, "");
      expect(allowedHosts.has(host), `unexpected host: ${host}`).toBe(true);
    }
    expect(source).toContain('backend="fastf1"');
    expect(source).not.toContain("jolpi.ca");
    expect(source).not.toContain("ergast.com");
  });

  it("loads site tables before deploys and exposes the backfill workflow", () => {
    const ci = readFileSync(path.join(workflowsDir, "ci.yml"), "utf8");
    for (const job of ["preview", "production"]) {
      const start = ci.indexOf(`  ${job}:`);
      const end = job === "preview" ? ci.indexOf("  production:") : ci.length;
      const block = ci.slice(start, end);
      const schema = block.indexOf("--file scripts/site-tables.sql");
      const deploy = block.indexOf("wrangler deploy");
      expect(schema, `${job} must load site tables`).toBeGreaterThan(-1);
      expect(deploy, `${job} must deploy the web worker`).toBeGreaterThan(-1);
      expect(schema).toBeLessThan(deploy);
    }

    const siteData = readFileSync(
      path.join(workflowsDir, "site-data.yml"),
      "utf8",
    );
    expect(siteData).toContain("uv run scripts/sync-session-times.py");
    expect(siteData).toContain("--file scripts/site-tables.sql");
  });
});
