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
const dockerfile = readFileSync(
  path.join(repoRoot, "apps/weather-sync/container/Dockerfile"),
  "utf8",
);
const containerSource = readFileSync(
  path.join(repoRoot, "apps/weather-sync/src/container.ts"),
  "utf8",
);
const workerSource = readFileSync(
  path.join(repoRoot, "apps/weather-sync/src/index.ts"),
  "utf8",
);
const ci = readFileSync(
  path.join(repoRoot, ".github/workflows/ci.yml"),
  "utf8",
);
const weatherData = readFileSync(
  path.join(repoRoot, ".github/workflows/weather-data.yml"),
  "utf8",
);
const siteTables = readFileSync(
  path.join(repoRoot, "scripts/site-tables.sql"),
  "utf8",
);
const weatherMigrationPath = path.join(
  repoRoot,
  "migrations/0001_session_weather_fields.sql",
);
const weatherMigration = readFileSync(weatherMigrationPath, "utf8");
const resultMigration = readFileSync(
  path.join(repoRoot, "migrations/0002_session_result_snapshots.sql"),
  "utf8",
);
const outboxCompatibilityMigration = readFileSync(
  path.join(repoRoot, "migrations/0003_restore_weather_cache_outbox.sql"),
  "utf8",
);
const weatherPreviewJob = ci.slice(
  ci.indexOf("  weather-preview:"),
  ci.indexOf("\n  production:", ci.indexOf("  weather-preview:")),
);
const weatherProductionJob = ci.slice(ci.indexOf("  weather-production:"));

describe("weather deployment configuration", () => {
  it("keeps fresh schemas and existing databases on the same weather shape", () => {
    for (const column of [
      "humidity_pct",
      "pressure_hpa",
      "wind_speed_kph",
      "wind_direction_deg",
      "rainfall",
      "sample_count",
      "observed_at_utc",
    ]) {
      expect(siteTables).toContain(column);
      expect(weatherMigration).toContain(column);
    }
    expect(ci).toContain("d1 migrations apply f1db");
  });

  it("migrates existing weather rows without dropping measurements", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "f1box-weather-migration-"));
    const db = path.join(dir, "weather.db");
    const output = execFileSync("sqlite3", ["-json", db], {
      encoding: "utf8",
      input: `
        CREATE TABLE session_source_ref (
          year INTEGER NOT NULL,
          round INTEGER NOT NULL,
          session_key TEXT NOT NULL,
          api_path TEXT NOT NULL,
          race_date TEXT NOT NULL,
          starts_at_utc TEXT NOT NULL,
          source TEXT NOT NULL,
          PRIMARY KEY (year, round, session_key)
        );
        CREATE TABLE weather_sync_state (
          year INTEGER NOT NULL,
          round INTEGER NOT NULL,
          session_key TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL,
          last_error TEXT,
          last_attempt_at TEXT NOT NULL,
          next_attempt_at TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (year, round, session_key)
        );
        CREATE TABLE weather_cache_outbox (
          cache_tag TEXT PRIMARY KEY,
          created_at TEXT NOT NULL
        );
        INSERT INTO weather_cache_outbox VALUES
          ('weather:2026', '2026-09-12T12:00:00Z');
        CREATE TABLE session_weather (
          year INTEGER NOT NULL,
          round INTEGER NOT NULL,
          session_key TEXT NOT NULL,
          temp_c REAL,
          track_temp_c REAL,
          weather_code TEXT,
          source TEXT NOT NULL CHECK (source = 'fastf1'),
          fetched_at TEXT NOT NULL,
          PRIMARY KEY (year, round, session_key)
        );
        INSERT INTO session_weather VALUES
          (2026, 1, 'race', 24.6, 32.5, 'rain', 'fastf1', '2026-03-08T06:05:00Z');
        CREATE TRIGGER session_source_ref_changed
        AFTER UPDATE ON session_source_ref
        BEGIN
          DELETE FROM session_weather;
        END;
        ${weatherMigration}
        ${resultMigration}
        ${outboxCompatibilityMigration}
        SELECT temp_c, track_temp_c, humidity_pct, pressure_hpa, wind_speed_kph,
               wind_direction_deg, rainfall, sample_count, observed_at_utc,
               weather_code, source, fetched_at,
               (SELECT COUNT(*) FROM weather_cache_outbox) AS pending_purges,
               (SELECT json_group_array(json_object('name', name, 'sql', sql))
                  FROM sqlite_master WHERE type = 'trigger') AS triggers
        FROM session_weather;
      `,
    });
    const [row] = JSON.parse(output) as Array<
      Record<string, unknown> & { triggers: string }
    >;
    const { triggers, ...values } = row;
    expect(values).toEqual({
      temp_c: 24.6,
      track_temp_c: 32.5,
      humidity_pct: null,
      pressure_hpa: null,
      wind_speed_kph: null,
      wind_direction_deg: null,
      rainfall: null,
      sample_count: null,
      observed_at_utc: null,
      weather_code: "rain",
      source: "fastf1",
      fetched_at: "2026-03-08T06:05:00Z",
      pending_purges: 1,
    });
    const parsedTriggers = JSON.parse(triggers) as Array<{
      name: string;
      sql: string;
    }>;
    expect(parsedTriggers.map(({ name }) => name)).toEqual([
      "session_source_ref_changed",
      "session_source_ref_deleted",
    ]);
    for (const trigger of parsedTriggers) {
      expect(trigger.sql).toContain("weather_cache_outbox");
      expect(trigger.sql).not.toContain("session_cache_outbox");
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives the FastF1 cache a writable container directory", () => {
    expect(dockerfile).toContain("FASTF1_CACHE=/tmp/fastf1");
    expect(containerSource).toContain('FASTF1_CACHE: "/tmp/fastf1"');
    expect(dockerfile).toContain(
      "install -d -m 0700 -o nobody -g nogroup /tmp/fastf1",
    );
    expect(dockerfile).toContain("USER nobody");
  });

  it("gates both deployed environments on the shared container contract", () => {
    expect(containerSource).toContain("async health()");
    expect(workerSource).toContain('"/container-health"');
    expect(weatherPreviewJob).toContain("Verify preview container contract");
    expect(
      weatherPreviewJob.indexOf("Verify preview container contract"),
    ).toBeLessThan(weatherPreviewJob.indexOf("Run weather canary"));
    expect(weatherProductionJob).toContain(
      "Verify production container contract",
    );
    expect(weatherProductionJob).toContain("/container-health");
    for (const job of [weatherPreviewJob, weatherProductionJob]) {
      expect(job).toContain("--retry 30 --retry-delay 10 --retry-all-errors");
    }
  });

  it("runs a read-only production result canary", () => {
    expect(workerSource).toContain('"/canary"');
    expect(weatherProductionJob).toContain("Run production result canary");
    expect(weatherProductionJob).toContain('canary.status !== "success"');
    expect(weatherProductionJob).toContain(
      'adapter !== "fastf1-session-results"',
    );
    expect(weatherProductionJob).toContain(
      "canary.schemaVersion !== contract.resultsSchemaVersion",
    );
  });

  it("clears preview derived state before references and seeds result state", () => {
    const resetIndex = weatherPreviewJob.indexOf("Reset preview derived data");
    const applyIndex = weatherPreviewJob.indexOf(
      "Apply preview session references",
    );
    const seedIndex = weatherPreviewJob.indexOf("Seed preview result state");
    const deployIndex = weatherPreviewJob.indexOf("Deploy weather preview");
    const resetStep = weatherPreviewJob.slice(resetIndex, applyIndex);
    expect(resetStep).toContain("DELETE FROM weather_sync_state;");
    expect(resetStep).toContain("DELETE FROM session_weather;");
    expect(resetStep).toContain("DELETE FROM session_result_snapshot;");
    expect(resetStep).toContain("DELETE FROM weather_cache_outbox;");
    expect(resetStep).toContain("DELETE FROM weather_sync_lock;");
    expect(resetStep).toContain("CLOUDFLARE_API_TOKEN");
    expect(resetIndex).toBeLessThan(applyIndex);
    expect(applyIndex).toBeLessThan(seedIndex);
    expect(seedIndex).toBeLessThan(deployIndex);
  });

  it("keeps the existing outbox as the active cache invalidation queue", () => {
    expect(siteTables).toContain(
      "CREATE TABLE IF NOT EXISTS weather_cache_outbox",
    );
    expect(siteTables).not.toContain(
      "CREATE TABLE IF NOT EXISTS session_cache_outbox",
    );
    expect(workerSource).toContain("outboxInsertSql");
    expect(resultMigration).not.toContain("DROP TABLE weather_cache_outbox");
  });

  it("applies query indexes before preview and production web deploys", () => {
    expect(ci.match(/--file scripts\/f1db-d1-indexes\.sql/g)).toHaveLength(2);
  });

  it("runs a recent result canary and asserts snapshots and invalidation", () => {
    expect(weatherPreviewJob).toContain("date -u +%Y");
    expect(weatherPreviewJob).toContain("status.snapshotRows < 1");
    expect(weatherPreviewJob).toContain("status.pendingCachePurges < 1");
    expect(weatherPreviewJob).toContain("status.resultStatuses.find");
    expect(weatherPreviewJob).toContain("!row.lastError");
    expect(weatherPreviewJob).toContain("Run weather canary");
    expect(weatherPreviewJob).toContain("Run result canary");
  });

  it("serializes ingestion and only runs the canary for weather changes", () => {
    expect(workerSource).toContain("acquireIngestionLock");
    expect(workerSource).toContain("sessionReferences");
    expect(ci).toContain("weather_changes:");
    expect(ci).toContain('git merge-base "$BASE_SHA" "$HEAD_SHA"');
    expect(ci).toContain(".github/workflows/weather-data.yml");
    expect(weatherPreviewJob).toContain(
      "needs.weather_changes.outputs.changed",
    );
  });

  it("requires an exact full-reference readback", () => {
    expect(weatherData).toContain('[ "$actual" -eq "$expected" ]');
    expect(weatherData).not.toContain('[ "$actual" -ge "$expected" ]');
  });

  it("uses a stable container token and always removes the secrets file", () => {
    expect(ci).toContain(
      "secrets.WEATHER_CONTAINER_TOKEN || secrets.WEATHER_SYNC_TOKEN",
    );
    expect(weatherPreviewJob).not.toContain("openssl rand -hex 32");
    expect(weatherPreviewJob).toContain("secrets_file=$(mktemp)");
    expect(weatherPreviewJob).toContain('chmod 600 "$secrets_file"');
    expect(weatherPreviewJob).toContain("trap 'rm -f \"$secrets_file\"' EXIT");
  });

  it("requires the canary to request and persist exactly one session", () => {
    expect(weatherPreviewJob).toContain("result.sessions !== 1");
    expect(weatherPreviewJob).toContain("result.weather?.success !== 1");
    expect(weatherPreviewJob).toContain(
      'readFileSync("/tmp/weather-status.json"',
    );
    expect(weatherPreviewJob).toContain("status.weatherRows !== 1");
    expect(weatherPreviewJob).toContain("success?.count !== 1");
  });
});
