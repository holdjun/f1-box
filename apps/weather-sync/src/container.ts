import { Container } from "@cloudflare/containers";

import {
  type CollectRequest,
  type ContainerResponse,
  parseContainerResponse,
} from "./domain";

export class WeatherContainer extends Container<Env> {
  defaultPort = 8080;
  pingEndpoint = "health";
  sleepAfter = "5m";
  envVars = {
    WEATHER_CONTAINER_TOKEN: this.env.WEATHER_CONTAINER_TOKEN,
  };

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
