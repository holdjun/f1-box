import type { SeasonPayload } from "@f1-box/contracts/season";

type SeasonEvent = SeasonPayload["events"][number];
type RaceRow = NonNullable<SeasonEvent["raceClassification"]>["rows"][number];

export interface DriverCard {
  code: string;
  name: string;
  team: string;
  position: number;
  points: number;
}

export interface TeamCard {
  name: string;
  position: number;
  points: number;
  drivers: string[];
}

export interface RoundPoint {
  round: number;
  label: string;
  value: number;
}

function completedEvents(season: SeasonPayload): SeasonEvent[] {
  return season.events.filter((event) => event.raceClassification !== null);
}

function rowsOf(event: SeasonEvent): RaceRow[] {
  return event.raceClassification?.rows ?? [];
}

export function driverGrid(season: SeasonPayload): DriverCard[] {
  const latest = completedEvents(season).at(-1);
  const teamByCode = new Map<string, string>();
  for (const row of latest ? rowsOf(latest) : []) {
    teamByCode.set(row.driverCode, row.constructorName);
  }

  return season.driverStandings.map((standing) => ({
    code: standing.code,
    name: standing.name,
    team: teamByCode.get(standing.code) ?? "—",
    position: standing.position,
    points: standing.points,
  }));
}

export function driverSeries(season: SeasonPayload, code: string): RoundPoint[] {
  return completedEvents(season)
    .map((event) => {
      const row = rowsOf(event).find((candidate) => candidate.driverCode === code);
      return {
        round: event.round,
        label: event.raceName,
        value: row ? row.position : 0,
      };
    })
    .filter((point) => point.value > 0);
}

export function teamGrid(season: SeasonPayload): TeamCard[] {
  const latest = completedEvents(season).at(-1);
  const driversByTeam = new Map<string, string[]>();
  for (const row of latest ? rowsOf(latest) : []) {
    const list = driversByTeam.get(row.constructorName) ?? [];
    list.push(row.driverName);
    driversByTeam.set(row.constructorName, list);
  }

  return season.constructorStandings.map((standing) => ({
    name: standing.name,
    position: standing.position,
    points: standing.points,
    drivers: driversByTeam.get(standing.name) ?? [],
  }));
}

export function teamSeries(season: SeasonPayload, team: string): RoundPoint[] {
  return completedEvents(season).map((event) => {
    const points = rowsOf(event)
      .filter((row) => row.constructorName === team)
      .reduce((sum, row) => sum + row.points, 0);
    return { round: event.round, label: event.raceName, value: points };
  });
}
