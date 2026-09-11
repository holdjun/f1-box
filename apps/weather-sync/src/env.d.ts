declare global {
  interface Env {
    F1_DB: D1Database;
    WEATHER_CONTAINER: DurableObjectNamespace<
      import("./container").WeatherContainer
    >;
    WEATHER_SYNC_TOKEN: string;
    WEATHER_CONTAINER_TOKEN: string;
    CLOUDFLARE_API_TOKEN?: string;
    CLOUDFLARE_ZONE_NAME?: string;
  }
}

export {};
