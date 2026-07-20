import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import weekendSchema from "../weekend.schema.json";
import type { WeekendPayload } from "./weekend.generated.js";

export type { WeekendPayload } from "./weekend.generated.js";

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validateWeekendPayload = ajv.compile<WeekendPayload>(weekendSchema);

export function parseWeekendPayload(value: unknown): WeekendPayload {
  if (validateWeekendPayload(value)) {
    return value;
  }

  const errors = validateWeekendPayload.errors
    ?.map((error) => {
      const missingProperty =
        error.keyword === "required" && typeof error.params.missingProperty === "string"
          ? `/${escapeJsonPointer(error.params.missingProperty)}`
          : "";
      const path = `${error.instancePath}${missingProperty}` || "/";

      return `${path}: ${error.message ?? error.keyword}`;
    })
    .join("; ");

  throw new TypeError(`Invalid weekend payload: ${errors ?? "unknown validation error"}`);
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
