import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createAskHandler } from "../../lib/ask/handler.js";
import { createD1AskDatabase } from "../../lib/ask/db.js";

export const POST: APIRoute = async ({ request }) => {
  let db;
  if (import.meta.env.DEV) {
    const { createDevAskDatabase } = await import(
      "../../lib/ask/fixtures/ask-dev.js"
    );
    db = await createDevAskDatabase();
  } else {
    db = createD1AskDatabase(env.F1_DB);
  }
  return createAskHandler({
    ai: env.AI,
    db,
    limiter: env.RATE_LIMITER,
  })(request);
};
