export interface DirectorySource {
  name: string;
  url: string;
  license?: string;
}

export interface TeamEntry {
  id: string;
  name: string;
  fullName: string | null;
  countryId: string | null;
  color: string | null;
  logoKey: string | null;
}

export interface DriverEntry {
  id: string;
  code: string;
  name: string;
  firstName: string;
  lastName: string;
  number: number | null;
  countryId: string | null;
  dateOfBirth: string | null;
  wikipediaUrl: string | null;
}

export interface EntrantEntry {
  constructorId: string;
  name: string;
  drivers: { driverId: string; rounds: string | null; testDriver: boolean }[];
}

export interface SeasonDirectory {
  schemaVersion: 1;
  season: number;
  generatedAt: string;
  sources: DirectorySource[];
  teams: TeamEntry[];
  drivers: DriverEntry[];
  entrants: EntrantEntry[];
}

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

function requireNullableInteger(value: unknown, path: string): number | null {
  if (value !== null && !Number.isInteger(value)) {
    throw new TypeError(`${path}: expected integer or null`);
  }
  return value as number | null;
}

function parseSource(value: unknown, path: string): DirectorySource {
  const r = requireObject(value, path);
  const name = requireString(r.name, `${path}/name`);
  const url = requireString(r.url, `${path}/url`);
  const result: DirectorySource = { name, url };
  if (Object.hasOwn(r, "license")) {
    result.license = requireString(r.license, `${path}/license`);
  }
  return result;
}

function parseTeam(value: unknown, path: string): TeamEntry {
  const r = requireObject(value, path);
  return {
    id: requireString(r.id, `${path}/id`),
    name: requireString(r.name, `${path}/name`),
    fullName: requireNullableString(r.fullName, `${path}/fullName`),
    countryId: requireNullableString(r.countryId, `${path}/countryId`),
    color: requireNullableString(r.color, `${path}/color`),
    logoKey: requireNullableString(r.logoKey, `${path}/logoKey`),
  };
}

function parseDriver(value: unknown, path: string): DriverEntry {
  const r = requireObject(value, path);
  return {
    id: requireString(r.id, `${path}/id`),
    code: requireString(r.code, `${path}/code`),
    name: requireString(r.name, `${path}/name`),
    firstName: requireString(r.firstName, `${path}/firstName`),
    lastName: requireString(r.lastName, `${path}/lastName`),
    number: requireNullableInteger(r.number, `${path}/number`),
    countryId: requireNullableString(r.countryId, `${path}/countryId`),
    dateOfBirth: requireNullableString(r.dateOfBirth, `${path}/dateOfBirth`),
    wikipediaUrl: requireNullableString(r.wikipediaUrl, `${path}/wikipediaUrl`),
  };
}

function parseEntrantDriver(
  value: unknown,
  path: string,
): { driverId: string; rounds: string | null; testDriver: boolean } {
  const r = requireObject(value, path);
  const driverId = requireString(r.driverId, `${path}/driverId`);
  const rounds = requireNullableString(r.rounds, `${path}/rounds`);
  if (typeof r.testDriver !== "boolean") {
    throw new TypeError(`${path}/testDriver: expected boolean`);
  }
  return { driverId, rounds, testDriver: r.testDriver };
}

function parseEntrant(value: unknown, path: string): EntrantEntry {
  const r = requireObject(value, path);
  const constructorId = requireString(r.constructorId, `${path}/constructorId`);
  const name = requireString(r.name, `${path}/name`);
  const rawDrivers = requireArray(r.drivers, `${path}/drivers`);
  const drivers = rawDrivers.map((d, i) => parseEntrantDriver(d, `${path}/drivers/${i}`));
  return { constructorId, name, drivers };
}

export function parseSeasonDirectory(value: unknown): SeasonDirectory {
  const r = requireObject(value, "");
  if (r.schemaVersion !== 1) {
    throw new TypeError("/schemaVersion: must be 1");
  }
  if (!Number.isInteger(r.season)) {
    throw new TypeError("/season: expected integer");
  }
  const generatedAt = requireString(r.generatedAt, "/generatedAt");
  const rawSources = requireArray(r.sources, "/sources");
  const sources = rawSources.map((s, i) => parseSource(s, `/sources/${i}`));
  const rawTeams = requireArray(r.teams, "/teams");
  const teams = rawTeams.map((t, i) => parseTeam(t, `/teams/${i}`));
  const rawDrivers = requireArray(r.drivers, "/drivers");
  const drivers = rawDrivers.map((d, i) => parseDriver(d, `/drivers/${i}`));
  const rawEntrants = requireArray(r.entrants, "/entrants");
  const entrants = rawEntrants.map((e, i) => parseEntrant(e, `/entrants/${i}`));

  return {
    schemaVersion: 1,
    season: r.season as number,
    generatedAt,
    sources,
    teams,
    drivers,
    entrants,
  };
}
