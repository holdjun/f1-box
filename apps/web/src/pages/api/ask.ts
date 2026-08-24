import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { type AskDatabase, createD1AskDatabase } from "../../lib/ask/db.js";
import { createAskHandler } from "../../lib/ask/handler.js";

export const POST: APIRoute = async ({ request }) => {
  let db: AskDatabase;
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
