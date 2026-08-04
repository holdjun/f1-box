import type { SeasonPayload } from "./season.generated.js";
import validateSeasonPayload from "./season.validator.generated.js";

export type { SeasonPayload } from "./season.generated.js";

export function parseSeasonPayload(value: unknown): SeasonPayload {
  if (!validateSeasonPayload(value)) {
    throw new TypeError(
      `Invalid season payload: ${formatSchemaErrors(validateSeasonPayload.errors)}`,
    );
  }

  const semanticErrors = validateSeasonSemantics(value);
  if (semanticErrors.length > 0) {
    throw new TypeError(`Invalid season payload: ${semanticErrors.join("; ")}`);
  }

  return value;
}

function validateSeasonSemantics(payload: SeasonPayload): string[] {
  const errors: string[] = [];
  const firstEventIndexByRound = new Map<number, number>();

  payload.events.forEach((event, eventIndex) => {
    const firstEventIndex = firstEventIndexByRound.get(event.round);
    if (firstEventIndex === undefined) {
      firstEventIndexByRound.set(event.round, eventIndex);
    } else {
      errors.push(
        `/events/${eventIndex}/round: must be unique (duplicates /events/${firstEventIndex}/round)`,
      );
    }

    if (event.state !== "complete") {
      return;
    }

    if (event.qualifyingClassification === null) {
      errors.push(
        `/events/${eventIndex}/qualifyingClassification: must be present when state is complete`,
      );
    }

    if (event.raceClassification === null) {
      errors.push(
        `/events/${eventIndex}/raceClassification: must be present when state is complete`,
      );
    }
  });

  return errors;
}

function formatSchemaErrors(errors: typeof validateSeasonPayload.errors): string {
  return (
    errors
      ?.map((error) => {
        const missingProperty =
          error.keyword === "required" && typeof error.params.missingProperty === "string"
            ? `/${escapeJsonPointer(error.params.missingProperty)}`
            : "";
        const path = `${error.instancePath}${missingProperty}` || "/";

        return `${path}: ${error.message ?? error.keyword}`;
      })
      .join("; ") ?? "unknown validation error"
  );
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
