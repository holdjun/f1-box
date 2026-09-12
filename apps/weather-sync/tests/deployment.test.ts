import { readFileSync } from "node:fs";
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
const weatherPreviewJob = ci.slice(
  ci.indexOf("  weather-preview:"),
  ci.indexOf("\n  production:", ci.indexOf("  weather-preview:")),
);

describe("weather deployment configuration", () => {
  it("gives the FastF1 cache a writable container directory", () => {
    expect(dockerfile).toContain("FASTF1_CACHE=/tmp/fastf1");
    expect(containerSource).toContain('FASTF1_CACHE: "/tmp/fastf1"');
    expect(dockerfile).toContain(
      "install -d -m 0700 -o nobody -g nogroup /tmp/fastf1",
    );
    expect(dockerfile).toContain("USER nobody");
  });

  it("clears preview weather state before the canary", () => {
    const resetIndex = weatherPreviewJob.indexOf("Reset preview weather state");
    const resetStep = weatherPreviewJob.slice(
      resetIndex,
      weatherPreviewJob.indexOf("Run one-session canary"),
    );
    expect(resetStep).toContain("DELETE FROM weather_sync_state;");
    expect(resetStep).toContain("DELETE FROM session_weather;");
    expect(resetStep).toContain("DELETE FROM weather_cache_outbox;");
    expect(resetStep).toContain("DELETE FROM weather_sync_lock;");
    expect(
      weatherPreviewJob.indexOf("Apply preview session references"),
    ).toBeLessThan(resetIndex);
    expect(resetIndex).toBeLessThan(
      weatherPreviewJob.indexOf("Run one-session canary"),
    );
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
    expect(weatherPreviewJob).toContain("result.requested !== 1");
    expect(weatherPreviewJob).toContain("result.success !== 1");
    expect(weatherPreviewJob).toContain(
      'readFileSync("/tmp/weather-status.json"',
    );
    expect(weatherPreviewJob).toContain("status.weatherRows !== 1");
    expect(weatherPreviewJob).toContain("success?.count !== 1");
  });
});
