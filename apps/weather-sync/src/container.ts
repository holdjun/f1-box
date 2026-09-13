import { Container } from "@cloudflare/containers";

import {
  CONTAINER_API_VERSION,
  RESULTS_ADAPTER_VERSION,
  RESULTS_SCHEMA_VERSION,
} from "./contract";
import {
  type CollectRequest,
  type ContainerResponse,
  parseContainerResponse,
} from "./domain";

export interface ContainerHealth {
  ok: true;
  containerApiVersion: number;
  resultsAdapterVersion: string;
  resultsSchemaVersion: number;
}

export class WeatherContainer extends Container<Env> {
  defaultPort = 8080;
  pingEndpoint = "health";
  sleepAfter = "5m";
  envVars = {
    FASTF1_CACHE: "/tmp/fastf1",
    WEATHER_CONTAINER_TOKEN: this.env.WEATHER_CONTAINER_TOKEN,
  };

  async health(): Promise<ContainerHealth> {
    const response = await this.containerFetch("http://weather/health");
    if (!response.ok) {
      throw new Error(
        `weather container HTTP ${response.status}: ${await response.text()}`,
      );
    }
    const value = (await response.json()) as Record<string, unknown>;
    if (
      value.ok !== true ||
      value.containerApiVersion !== CONTAINER_API_VERSION ||
      value.resultsAdapterVersion !== RESULTS_ADAPTER_VERSION ||
      value.resultsSchemaVersion !== RESULTS_SCHEMA_VERSION
    ) {
      const expected = {
        containerApiVersion: CONTAINER_API_VERSION,
        resultsAdapterVersion: RESULTS_ADAPTER_VERSION,
        resultsSchemaVersion: RESULTS_SCHEMA_VERSION,
      };
      throw new Error(
        `weather container contract is invalid: expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`,
      );
    }
    return {
      ok: true,
      containerApiVersion: CONTAINER_API_VERSION,
      resultsAdapterVersion: RESULTS_ADAPTER_VERSION,
      resultsSchemaVersion: RESULTS_SCHEMA_VERSION,
    };
  }

  async collect(request: CollectRequest): Promise<ContainerResponse> {
    const response = await this.containerFetch("http://weather/collect", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.env.WEATHER_CONTAINER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(
        `weather container HTTP ${response.status}: ${await response.text()}`,
      );
    }
    return parseContainerResponse(await response.json(), request.sessions);
  }
}
