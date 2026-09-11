import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { getContainer } from "@cloudflare/containers";
import type { WeatherContainer } from "./container";
import {
  buildPersistPlan,
  type ContainerResponse,
  candidateSql,
  coverageSql,
  MAX_ATTEMPTS,
  parseContainerResponse,
  SESSION_NAMES,
  SESSION_SETTLE_DELAY_MS,
  type SessionCandidate,
  type SyncSummary,
  stateUpsertSql,
  summarize,
  WEATHER_SINCE,
  type WorkflowParams,
  weatherUpsertSql,
  yearsSql,
} from "./domain";

const collectConfig = {
  retries: { limit: 3, delay: 30_000, backoff: "exponential" as const },
  timeout: 15 * 60 * 1000,
};
const d1Config = {
  retries: { limit: 3, delay: 10_000, backoff: "exponential" as const },
  timeout: 2 * 60 * 1000,
};

function combineSummaries(summaries: SyncSummary[]): SyncSummary {
  return summaries.reduce(
    (total, current) => ({
      requested: total.requested + current.requested,
      success: total.success + current.success,
      noData: total.noData + current.noData,
      mismatch: total.mismatch + current.mismatch,
      failed: total.failed + current.failed,
      exhausted: total.exhausted + current.exhausted,
    }),
    {
      requested: 0,
      success: 0,
      noData: 0,
      mismatch: 0,
      failed: 0,
      exhausted: 0,
    },
  );
}

export class WeatherSyncWorkflow extends WorkflowEntrypoint<
  Env,
  WorkflowParams
> {
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
    const years = await step.do("resolve years", async () => {
      const result = await this.env.F1_DB.prepare(yearsSql)
        .bind(WEATHER_SINCE)
        .all<{ year: number }>();
      const available = result.results.map((row) => row.year);
      const selected =
        event.payload.mode === "current"
          ? available.slice(-1)
          : event.payload.years === null
            ? available
            : available.filter((year) => event.payload.years?.includes(year));
      if (selected.length === 0)
        throw new NonRetryableError("no session_time years available");
      return selected;
    });

    const summaries: SyncSummary[] = [];
    for (const year of years) {
      const candidates = await step.do(`select ${year}`, async () => {
        const cutoff = new Date(
          Date.now() - SESSION_SETTLE_DELAY_MS,
        ).toISOString();
        const result = await this.env.F1_DB.prepare(candidateSql)
          .bind(year, cutoff, MAX_ATTEMPTS, new Date().toISOString())
          .all<SessionCandidate>();
        return result.results;
      });
      if (candidates.length === 0) {
        summaries.push({
          requested: 0,
          success: 0,
          noData: 0,
          mismatch: 0,
          failed: 0,
          exhausted: 0,
        });
        continue;
      }

      const response = (await step.do(
        `collect ${year}`,
        collectConfig,
        async () => {
          const raw = await getContainer<WeatherContainer>(
            this.env.WEATHER_CONTAINER,
            "weather-sync",
          ).collect({
            year,
            sessions: candidates.map(({ round, sessionKey, raceDate }) => ({
              round,
              sessionKey,
              raceDate,
            })),
            sessionNames: SESSION_NAMES,
          });
          return parseContainerResponse(raw, candidates);
        },
      )) as unknown as ContainerResponse;

      summaries.push(
        await step.do(`persist ${year}`, d1Config, async () => {
          const plan = buildPersistPlan(
            candidates,
            response.sessions,
            new Date(),
          );
          const statements = [
            ...plan.weather.map((row) =>
              this.env.F1_DB.prepare(weatherUpsertSql).bind(
                row.year,
                row.round,
                row.sessionKey,
                row.tempC,
                row.trackTempC,
                row.weatherCode,
                row.fetchedAt,
              ),
            ),
            ...plan.rows.map((row) =>
              this.env.F1_DB.prepare(stateUpsertSql).bind(
                row.state.year,
                row.state.round,
                row.state.sessionKey,
                row.state.status,
                row.state.attempts,
                row.state.lastError,
                row.state.lastAttemptAt,
                row.state.nextAttemptAt,
                row.state.updatedAt,
              ),
            ),
          ];
          await this.env.F1_DB.batch(statements);
          return plan.summary;
        }),
      );
    }

    const summary = combineSummaries(summaries);
    if (summary.success > 0) {
      await step.do("purge edge cache", d1Config, async () => {
        await this.purgeCache();
      });
    }

    const coverage = (await step.do("check coverage", d1Config, async () => {
      const result = await this.env.F1_DB.prepare(coverageSql(years.length))
        .bind(...years)
        .all<{ status: string; count: number }>();
      return result.results;
    })) as unknown as Array<{ status: string; count: number }>;
    const coverageSummary = summarize(coverage);
    const incomplete =
      event.payload.mode === "backfill"
        ? coverageSummary.failed +
          coverageSummary.exhausted +
          coverageSummary.mismatch
        : coverageSummary.exhausted + coverageSummary.mismatch;
    if (incomplete > 0) {
      throw new NonRetryableError(
        `weather sync incomplete: ${JSON.stringify(coverageSummary)}`,
      );
    }
    return { years, summary, coverage };
  }

  private async purgeCache(): Promise<void> {
    const headers = {
      authorization: `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
      "content-type": "application/json",
    };
    const zoneResponse = await fetch(
      `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(this.env.CLOUDFLARE_ZONE_NAME)}`,
      { headers },
    );
    const zoneJson = (await zoneResponse.json()) as {
      result?: Array<{ id?: string }>;
    };
    const zoneId = zoneJson.result?.[0]?.id;
    if (!zoneResponse.ok || zoneId === undefined) {
      throw new Error(
        `Cloudflare zone lookup failed: HTTP ${zoneResponse.status}`,
      );
    }
    const purgeResponse = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ tags: ["f1db"] }),
      },
    );
    if (!purgeResponse.ok) {
      throw new Error(
        `Cloudflare cache purge failed: HTTP ${purgeResponse.status}`,
      );
    }
  }
}
