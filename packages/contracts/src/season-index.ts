export interface SeasonIndex {
  schemaVersion: 1;
  activeSeason: number;
  availableYears: number[];
}

const FIELDS = ["schemaVersion", "activeSeason", "availableYears"];

export function parseSeasonIndex(value: unknown): SeasonIndex {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid season index: expected object");
  }
  const record = value as Record<string, unknown>;
  if (!FIELDS.every((field) => Object.hasOwn(record, field))) {
    throw new TypeError(
      "Invalid season index: expected schemaVersion, activeSeason, availableYears",
    );
  }

  const { schemaVersion, activeSeason, availableYears } = record;
  if (schemaVersion !== 1) {
    throw new TypeError("Invalid season index: schemaVersion must be 1");
  }
  if (!Number.isInteger(activeSeason)) {
    throw new TypeError("Invalid season index: activeSeason must be an integer");
  }
  if (
    !Array.isArray(availableYears) ||
    availableYears.length === 0 ||
    !availableYears.every((year) => Number.isInteger(year))
  ) {
    throw new TypeError("Invalid season index: availableYears must be a non-empty integer array");
  }
  if (new Set(availableYears).size !== availableYears.length) {
    throw new TypeError("Invalid season index: availableYears must be unique");
  }
  if (!availableYears.includes(activeSeason as number)) {
    throw new TypeError("Invalid season index: activeSeason must be within availableYears");
  }

  return {
    schemaVersion: 1,
    activeSeason: activeSeason as number,
    availableYears: [...availableYears].sort((a, b) => a - b),
  };
}
