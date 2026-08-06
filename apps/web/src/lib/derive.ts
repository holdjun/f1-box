import type { SeasonPayload } from "@f1-box/contracts/season";

type SeasonEvent = SeasonPayload["events"][number];
type RaceRow = NonNullable<SeasonEvent["raceClassification"]>["rows"][number];

export interface DriverCard {
  code: string;
  name: string;
  team: string;
  position: number;
  points: number;
  slug: string;
  givenName?: string;
  familyName?: string;
  number?: number | null;
  nationality?: string;
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
    slug: standing.slug ?? standing.code.toLowerCase(),
    givenName: standing.givenName,
    familyName: standing.familyName,
    number: standing.number,
    nationality: standing.nationality,
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

export interface DriverSeasonStats {
  position: number;
  points: number;
  wins: number;
  races: number;
  podiums: number;
  poles: number;
  top10s: number;
  fastestLaps: number | null;
  dnfs: number;
}

export interface CareerSeasonRow {
  year: number;
  team: string;
  position: number;
  points: number;
}

export interface DriverCareer {
  races: number;
  points: number;
  wins: number;
  podiums: number;
  poles: number;
  bestFinish: number | null;
  seasons: CareerSeasonRow[];
}

const CLASSIFIED_FINISH = /^(Finished|\+\d+ Lap)/;

export function driverSeasonStats(
  season: SeasonPayload,
  code: string,
): DriverSeasonStats | undefined {
  const standing = season.driverStandings.find((row) => row.code === code);
  if (!standing) return undefined;

  let races = 0;
  let podiums = 0;
  let top10s = 0;
  let dnfs = 0;
  let poles = 0;
  let fastestLaps = 0;
  let hasFastestRank = false;

  for (const event of season.events) {
    const raceRow = event.raceClassification?.rows.find(
      (row) => row.driverCode === code,
    );
    if (raceRow) {
      races += 1;
      if (raceRow.position <= 3) podiums += 1;
      if (raceRow.position <= 10) top10s += 1;
      if (!CLASSIFIED_FINISH.test(raceRow.status)) dnfs += 1;
      if (raceRow.fastestLapRank !== undefined) {
        hasFastestRank = true;
        if (raceRow.fastestLapRank === 1) fastestLaps += 1;
      }
    }
    const qualifyingRow = event.qualifyingClassification?.rows.find(
      (row) => row.driverCode === code,
    );
    if (qualifyingRow?.position === 1) poles += 1;
  }

  return {
    position: standing.position,
    points: standing.points,
    wins: standing.wins,
    races,
    podiums,
    poles,
    top10s,
    fastestLaps: hasFastestRank ? fastestLaps : null,
    dnfs,
  };
}

export function driverCareer(
  seasons: SeasonPayload[],
  code: string,
): DriverCareer {
  const career: DriverCareer = {
    races: 0,
    points: 0,
    wins: 0,
    podiums: 0,
    poles: 0,
    bestFinish: null,
    seasons: [],
  };

  for (const s of seasons) {
    const stats = driverSeasonStats(s, code);
    if (!stats) continue;

    career.races += stats.races;
    career.points += stats.points;
    career.wins += stats.wins;
    career.podiums += stats.podiums;
    career.poles += stats.poles;

    for (const event of s.events) {
      const row = event.raceClassification?.rows.find(
        (candidate) => candidate.driverCode === code,
      );
      if (row && (career.bestFinish === null || row.position < career.bestFinish)) {
        career.bestFinish = row.position;
      }
    }

    const team =
      completedEvents(s)
        .at(-1)
        ?.raceClassification?.rows.find((row) => row.driverCode === code)
        ?.constructorName ?? "—";
    career.seasons.push({
      year: s.season,
      team,
      position: stats.position,
      points: stats.points,
    });
  }

  return career;
}
