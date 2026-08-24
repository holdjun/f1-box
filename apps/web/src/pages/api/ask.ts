import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createAskHandler } from "../../lib/ask/handler.js";

export const POST: APIRoute = async ({ request, locals }) => {
  const { askDb } = locals.app;
  return createAskHandler({
    ai: env.AI,
    db: askDb,
    limiter: env.RATE_LIMITER,
  })(request);
};
