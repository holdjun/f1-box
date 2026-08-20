import { env } from "cloudflare:workers";

import { createSeasonRepository } from "./season-repository.js";

export function getIndex() {
  const repository = import.meta.env.DEV
    ? createSeasonRepository()
    : createSeasonRepository(env.F1_DATA);
  return repository.getIndex();
}
