export interface Country {
  id: string;
  alpha2Code: string;
  alpha3Code: string;
  iocCode: string;
  name: string;
  demonym: string;
}

export interface Circuit {
  id: string;
  name: string;
  fullName: string | null;
  type: string | null;
  direction: string | null;
  placeName: string | null;
  countryId: string | null;
  latitude: number | null;
  longitude: number | null;
  lengthMetres: number | null;
  turns: number | null;
  totalRacesHeld: number | null;
  svgKey: string | null;
}

export interface DriverCareer {
  id: string;
  totals: {
    grandsPrix: number;
    wins: number;
    podiums: number;
    poles: number;
    fastestLaps: number;
    points: number;
    championships: number;
    bestChampionshipPosition: number | null;
  };
  seasons: { season: number; constructorId: string | null; position: number | null; points: number }[];
}

export interface ConstructorCareer {
  id: string;
  totals: {
    grandsPrix: number;
    wins: number;
    podiums: number;
    poles: number;
    points: number;
    championships: number;
  };
  chronology: { constructorId: string; yearFrom: number; yearTo: number | null }[];
}

export interface CareerData {
  schemaVersion: 1;
  generatedAt: string;
  sources: { name: string; url: string; license?: string }[];
  drivers: DriverCareer[];
  constructors: ConstructorCareer[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path}: expected object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path}: expected array`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${path}: expected string`);
  }
  return value;
}

function requireNullableString(value: unknown, path: string): string | null {
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`${path}: expected string or null`);
  }
  return value as string | null;
}

function requireInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${path}: expected integer`);
  }
  return value as number;
}

function requireNullableInteger(value: unknown, path: string): number | null {
  if (value !== null && !Number.isInteger(value)) {
    throw new TypeError(`${path}: expected integer or null`);
  }
  return value as number | null;
}

function requireNullableNumber(value: unknown, path: string): number | null {
  if (value !== null && typeof value !== "number") {
    throw new TypeError(`${path}: expected number or null`);
  }
  return value as number | null;
}

// ─── countries ───────────────────────────────────────────────────────────────

function parseCountry(value: unknown, path: string): Country {
  const r = requireObject(value, path);
  return {
    id: requireString(r.id, `${path}/id`),
    alpha2Code: requireString(r.alpha2Code, `${path}/alpha2Code`),
    alpha3Code: requireString(r.alpha3Code, `${path}/alpha3Code`),
    iocCode: requireString(r.iocCode, `${path}/iocCode`),
    name: requireString(r.name, `${path}/name`),
    demonym: requireString(r.demonym, `${path}/demonym`),
  };
}

export function parseCountries(value: unknown): Country[] {
  const arr = requireArray(value, "");
  return arr.map((item, i) => parseCountry(item, `/${i}`));
}

// ─── circuits ────────────────────────────────────────────────────────────────

function parseCircuit(value: unknown, path: string): Circuit {
  const r = requireObject(value, path);
  return {
    id: requireString(r.id, `${path}/id`),
    name: requireString(r.name, `${path}/name`),
    fullName: requireNullableString(r.fullName, `${path}/fullName`),
    type: requireNullableString(r.type, `${path}/type`),
    direction: requireNullableString(r.direction, `${path}/direction`),
    placeName: requireNullableString(r.placeName, `${path}/placeName`),
    countryId: requireNullableString(r.countryId, `${path}/countryId`),
    latitude: requireNullableNumber(r.latitude, `${path}/latitude`),
    longitude: requireNullableNumber(r.longitude, `${path}/longitude`),
    lengthMetres: requireNullableInteger(r.lengthMetres, `${path}/lengthMetres`),
    turns: requireNullableInteger(r.turns, `${path}/turns`),
    totalRacesHeld: requireNullableInteger(r.totalRacesHeld, `${path}/totalRacesHeld`),
    svgKey: requireNullableString(r.svgKey, `${path}/svgKey`),
  };
}

export function parseCircuits(value: unknown): Circuit[] {
  const arr = requireArray(value, "");
  return arr.map((item, i) => parseCircuit(item, `/${i}`));
}

// ─── career ──────────────────────────────────────────────────────────────────

function parseDriverTotals(
  value: unknown,
  path: string,
): DriverCareer["totals"] {
  const r = requireObject(value, path);
  return {
    grandsPrix: requireInteger(r.grandsPrix, `${path}/grandsPrix`),
    wins: requireInteger(r.wins, `${path}/wins`),
    podiums: requireInteger(r.podiums, `${path}/podiums`),
    poles: requireInteger(r.poles, `${path}/poles`),
    fastestLaps: requireInteger(r.fastestLaps, `${path}/fastestLaps`),
    points: requireInteger(r.points, `${path}/points`),
    championships: requireInteger(r.championships, `${path}/championships`),
    bestChampionshipPosition: requireNullableInteger(
      r.bestChampionshipPosition,
      `${path}/bestChampionshipPosition`,
    ),
  };
}

function parseDriverSeason(
  value: unknown,
  path: string,
): DriverCareer["seasons"][number] {
  const r = requireObject(value, path);
  return {
    season: requireInteger(r.season, `${path}/season`),
    constructorId: requireNullableString(r.constructorId, `${path}/constructorId`),
    position: requireNullableInteger(r.position, `${path}/position`),
    points: requireInteger(r.points, `${path}/points`),
  };
}

function parseDriverCareer(value: unknown, path: string): DriverCareer {
  const r = requireObject(value, path);
  const id = requireString(r.id, `${path}/id`);
  const totals = parseDriverTotals(r.totals, `${path}/totals`);
  const rawSeasons = requireArray(r.seasons, `${path}/seasons`);
  const seasons = rawSeasons.map((s, i) => parseDriverSeason(s, `${path}/seasons/${i}`));
  return { id, totals, seasons };
}

function parseConstructorTotals(
  value: unknown,
  path: string,
): ConstructorCareer["totals"] {
  const r = requireObject(value, path);
  return {
    grandsPrix: requireInteger(r.grandsPrix, `${path}/grandsPrix`),
    wins: requireInteger(r.wins, `${path}/wins`),
    podiums: requireInteger(r.podiums, `${path}/podiums`),
    poles: requireInteger(r.poles, `${path}/poles`),
    points: requireInteger(r.points, `${path}/points`),
    championships: requireInteger(r.championships, `${path}/championships`),
  };
}

function parseChronologyEntry(
  value: unknown,
  path: string,
): ConstructorCareer["chronology"][number] {
  const r = requireObject(value, path);
  return {
    constructorId: requireString(r.constructorId, `${path}/constructorId`),
    yearFrom: requireInteger(r.yearFrom, `${path}/yearFrom`),
    yearTo: requireNullableInteger(r.yearTo, `${path}/yearTo`),
  };
}

function parseConstructorCareer(value: unknown, path: string): ConstructorCareer {
  const r = requireObject(value, path);
  const id = requireString(r.id, `${path}/id`);
  const totals = parseConstructorTotals(r.totals, `${path}/totals`);
  const rawChronology = requireArray(r.chronology, `${path}/chronology`);
  const chronology = rawChronology.map((c, i) =>
    parseChronologyEntry(c, `${path}/chronology/${i}`),
  );
  return { id, totals, chronology };
}

export function parseCareer(value: unknown): CareerData {
  const r = requireObject(value, "");
  if (r.schemaVersion !== 1) {
    throw new TypeError("/schemaVersion: must be 1");
  }
  const generatedAt = requireString(r.generatedAt, "/generatedAt");
  const rawSources = requireArray(r.sources, "/sources");
  const sources = rawSources.map((s, i) => {
    const sr = requireObject(s, `/sources/${i}`);
    const result: CareerData["sources"][number] = {
      name: requireString(sr.name, `/sources/${i}/name`),
      url: requireString(sr.url, `/sources/${i}/url`),
    };
    if (Object.hasOwn(sr, "license")) {
      result.license = requireString(sr.license, `/sources/${i}/license`);
    }
    return result;
  });
  const rawDrivers = requireArray(r.drivers, "/drivers");
  const drivers = rawDrivers.map((d, i) => parseDriverCareer(d, `/drivers/${i}`));
  const rawConstructors = requireArray(r.constructors, "/constructors");
  const constructors = rawConstructors.map((c, i) =>
    parseConstructorCareer(c, `/constructors/${i}`),
  );

  return { schemaVersion: 1, generatedAt, sources, drivers, constructors };
}
