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
const ci = readFileSync(
  path.join(repoRoot, ".github/workflows/ci.yml"),
  "utf8",
);
const weatherPreviewJob = ci.slice(
  ci.indexOf("  weather-preview:"),
  ci.indexOf("\n  production:", ci.indexOf("  weather-preview:")),
);

describe("weather deployment configuration", () => {
  it("gives the FastF1 cache a writable container directory", () => {
    expect(dockerfile).toContain("FASTF1_CACHE=/tmp/fastf1");
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
    expect(
      weatherPreviewJob.indexOf("Apply preview session references"),
    ).toBeLessThan(resetIndex);
    expect(resetIndex).toBeLessThan(
      weatherPreviewJob.indexOf("Run one-session canary"),
    );
  });
});
