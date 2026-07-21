"""Normalize Jolpica payloads into the shared season contract."""

import asyncio
import re
import unicodedata
from datetime import UTC, datetime, timedelta
from typing import cast

from f1box_ingest.client import FetchResult, JolpicaClient
from f1box_ingest.contracts import validate_season


SESSION_FIELDS = (
    ("FirstPractice", "practice-1", "Practice 1"),
    ("SecondPractice", "practice-2", "Practice 2"),
    ("ThirdPractice", "practice-3", "Practice 3"),
    ("SprintShootout", "sprint-qualifying", "Sprint Qualifying"),
    ("SprintQualifying", "sprint-qualifying", "Sprint Qualifying"),
    ("Sprint", "sprint", "Sprint"),
    ("Qualifying", "qualifying", "Qualifying"),
)


class NormalizationError(ValueError):
    """Raised when an upstream payload does not have the expected shape."""


def _dict(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise NormalizationError(f"{label} must be an object")
    return cast(dict[str, object], value)


def _list(value: object, label: str) -> list[object]:
    if not isinstance(value, list):
        raise NormalizationError(f"{label} must be an array")
    return cast(list[object], value)


def _string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise NormalizationError(f"{label} must be a non-empty string")
    return value


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _integer(value: object, label: str) -> int:
    try:
        return int(_string(value, label))
    except ValueError as error:
        raise NormalizationError(f"{label} must be an integer") from error


def _number(value: object, label: str) -> float:
    try:
        return float(_string(value, label))
    except ValueError as error:
        raise NormalizationError(f"{label} must be a number") from error


def _parse_timestamp(value: str, label: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise NormalizationError(f"{label} must be an ISO timestamp") from error
    if parsed.tzinfo is None:
        raise NormalizationError(f"{label} must include a timezone")
    return parsed.astimezone(UTC)


def _timestamp(date: object, time: object, label: str) -> str:
    date_value = _string(date, f"{label}.date")
    time_value = _string(time, f"{label}.time")
    parsed = _parse_timestamp(f"{date_value}T{time_value}", label)
    return parsed.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _slug(value: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    )
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")


def _mr_data(result: FetchResult) -> dict[str, object]:
    return _dict(result.payload.get("MRData"), "MRData")


def _races(result: FetchResult) -> list[dict[str, object]]:
    table = _dict(_mr_data(result).get("RaceTable"), "MRData.RaceTable")
    races = _list(table.get("Races"), "MRData.RaceTable.Races")
    return [_dict(race, "race") for race in races]


def _first_race(result: FetchResult) -> dict[str, object] | None:
    races = _races(result)
    return races[0] if races else None


def _driver_name(driver: dict[str, object]) -> str:
    return f"{_string(driver.get('givenName'), 'Driver.givenName')} {_string(driver.get('familyName'), 'Driver.familyName')}"


def _qualifying_classification(result: FetchResult) -> dict[str, object] | None:
    race = _first_race(result)
    if race is None or "QualifyingResults" not in race:
        return None
    rows = []
    for raw_row in _list(race["QualifyingResults"], "QualifyingResults"):
        row = _dict(raw_row, "QualifyingResults row")
        driver = _dict(row.get("Driver"), "QualifyingResults.Driver")
        constructor = _dict(row.get("Constructor"), "QualifyingResults.Constructor")
        rows.append(
            {
                "position": _integer(row.get("position"), "QualifyingResults.position"),
                "driverCode": _string(driver.get("code"), "Driver.code"),
                "driverName": _driver_name(driver),
                "constructorName": _string(constructor.get("name"), "Constructor.name"),
                "q1": _optional_string(row.get("Q1")),
                "q2": _optional_string(row.get("Q2")),
                "q3": _optional_string(row.get("Q3")),
            }
        )
    return {"sessionKey": "qualifying", "rows": rows}


def _race_classification(result: FetchResult) -> dict[str, object] | None:
    race = _first_race(result)
    if race is None or "Results" not in race:
        return None
    rows = []
    for raw_row in _list(race["Results"], "Results"):
        row = _dict(raw_row, "Results row")
        driver = _dict(row.get("Driver"), "Results.Driver")
        constructor = _dict(row.get("Constructor"), "Results.Constructor")
        time = row.get("Time")
        fastest_lap = row.get("FastestLap")
        race_time = (
            _optional_string(_dict(time, "Results.Time").get("time"))
            if time is not None
            else None
        )
        fastest_time = None
        if fastest_lap is not None:
            fastest = _dict(fastest_lap, "Results.FastestLap")
            fastest_time_value = fastest.get("Time")
            if fastest_time_value is not None:
                fastest_time = _optional_string(
                    _dict(fastest_time_value, "Results.FastestLap.Time").get("time")
                )
        rows.append(
            {
                "position": _integer(row.get("position"), "Results.position"),
                "driverCode": _string(driver.get("code"), "Driver.code"),
                "driverName": _driver_name(driver),
                "constructorName": _string(constructor.get("name"), "Constructor.name"),
                "laps": _integer(row.get("laps"), "Results.laps"),
                "status": _string(row.get("status"), "Results.status"),
                "points": _number(row.get("points"), "Results.points"),
                "time": race_time,
                "fastestLap": fastest_time,
            }
        )
    return {"sessionKey": "race", "rows": rows}


def _sessions(
    race: dict[str, object], generated: datetime, complete: bool
) -> list[dict[str, object]]:
    sessions = []
    seen_keys: set[str] = set()
    for field, key, name in SESSION_FIELDS:
        raw_session = race.get(field)
        if raw_session is None or key in seen_keys:
            continue
        session = _dict(raw_session, field)
        starts_at = _timestamp(session.get("date"), session.get("time"), field)
        started = _parse_timestamp(starts_at, field) <= generated
        state = (
            "complete"
            if complete and started
            else "provisional"
            if started
            else "scheduled"
        )
        sessions.append(
            {"key": key, "name": name, "startsAt": starts_at, "state": state}
        )
        seen_keys.add(key)

    race_starts_at = _timestamp(race.get("date"), race.get("time"), "Race")
    race_started = _parse_timestamp(race_starts_at, "Race") <= generated
    sessions.append(
        {
            "key": "race",
            "name": "Race",
            "startsAt": race_starts_at,
            "state": "complete"
            if complete
            else "provisional"
            if race_started
            else "scheduled",
        }
    )
    return sessions


def _event(
    race: dict[str, object],
    generated: datetime,
    classifications: tuple[FetchResult, FetchResult] | None,
) -> dict[str, object]:
    qualifying = (
        _qualifying_classification(classifications[0]) if classifications else None
    )
    result = _race_classification(classifications[1]) if classifications else None
    complete = qualifying is not None and result is not None
    starts_at = _timestamp(race.get("date"), race.get("time"), "Race")
    started = _parse_timestamp(starts_at, "Race") <= generated
    circuit = _dict(race.get("Circuit"), "Circuit")
    location = _dict(circuit.get("Location"), "Circuit.Location")
    race_name = _string(race.get("raceName"), "raceName")

    return {
        "round": _integer(race.get("round"), "round"),
        "slug": _slug(race_name),
        "raceName": race_name,
        "startsAt": starts_at,
        "state": "complete" if complete else "provisional" if started else "scheduled",
        "circuit": {
            "id": _string(circuit.get("circuitId"), "Circuit.circuitId"),
            "name": _string(circuit.get("circuitName"), "Circuit.circuitName"),
            "locality": _string(location.get("locality"), "Circuit.Location.locality"),
            "country": _string(location.get("country"), "Circuit.Location.country"),
            "latitude": _number(location.get("lat"), "Circuit.Location.lat"),
            "longitude": _number(location.get("long"), "Circuit.Location.long"),
        },
        "sessions": _sessions(race, generated, complete),
        "qualifyingClassification": qualifying,
        "raceClassification": result,
    }


def _standings_list(result: FetchResult) -> dict[str, object] | None:
    table = _dict(_mr_data(result).get("StandingsTable"), "MRData.StandingsTable")
    standings = _list(
        table.get("StandingsLists"), "MRData.StandingsTable.StandingsLists"
    )
    return _dict(standings[0], "StandingsLists row") if standings else None


def _driver_standings(result: FetchResult) -> list[dict[str, object]]:
    standings = _standings_list(result)
    if standings is None:
        return []
    rows = []
    for raw_row in _list(standings.get("DriverStandings"), "DriverStandings"):
        row = _dict(raw_row, "DriverStandings row")
        driver = _dict(row.get("Driver"), "DriverStandings.Driver")
        rows.append(
            {
                "position": _integer(row.get("position"), "DriverStandings.position"),
                "name": _driver_name(driver),
                "code": _string(driver.get("code"), "Driver.code"),
                "points": _number(row.get("points"), "DriverStandings.points"),
                "wins": _integer(row.get("wins"), "DriverStandings.wins"),
            }
        )
    return rows


def _constructor_standings(result: FetchResult) -> list[dict[str, object]]:
    standings = _standings_list(result)
    if standings is None:
        return []
    rows = []
    for raw_row in _list(standings.get("ConstructorStandings"), "ConstructorStandings"):
        row = _dict(raw_row, "ConstructorStandings row")
        constructor = _dict(row.get("Constructor"), "ConstructorStandings.Constructor")
        rows.append(
            {
                "position": _integer(
                    row.get("position"), "ConstructorStandings.position"
                ),
                "name": _string(constructor.get("name"), "Constructor.name"),
                "points": _number(row.get("points"), "ConstructorStandings.points"),
                "wins": _integer(row.get("wins"), "ConstructorStandings.wins"),
            }
        )
    return rows


def _freshness(generated: datetime, results: list[FetchResult]) -> str:
    newest = max(
        _parse_timestamp(result.fetched_at, "fetched_at") for result in results
    )
    age = max(generated - newest, timedelta(0))
    if age <= timedelta(hours=2):
        return "fresh"
    if age <= timedelta(hours=24):
        return "delayed"
    return "stale"


def _source(result: FetchResult) -> dict[str, object]:
    return {
        "name": "Jolpica F1 API",
        "url": result.url,
        "fetchedAt": result.fetched_at,
    }


async def _fetch_round(
    client: JolpicaClient, season: int, round_number: int
) -> tuple[int, FetchResult, FetchResult]:
    qualifying, race = await asyncio.gather(
        client.fetch(f"/ergast/f1/{season}/{round_number}/qualifying.json?limit=100"),
        client.fetch(f"/ergast/f1/{season}/{round_number}/results.json?limit=100"),
    )
    return round_number, qualifying, race


async def build_season(
    *, season: int, client: JolpicaClient, generated_at: str
) -> dict[str, object]:
    """Fetch and normalize one season without synthesizing calendar events."""
    if season < 1:
        raise ValueError("season must be positive")
    generated = _parse_timestamp(generated_at, "generated_at")

    calendar, drivers, constructors = await asyncio.gather(
        client.fetch(f"/ergast/f1/{season}.json?limit=100"),
        client.fetch(f"/ergast/f1/{season}/driverstandings.json?limit=100"),
        client.fetch(f"/ergast/f1/{season}/constructorstandings.json?limit=100"),
    )
    races = sorted(
        _races(calendar), key=lambda race: _integer(race.get("round"), "round")
    )
    past_rounds = [
        _integer(race.get("round"), "round")
        for race in races
        if _parse_timestamp(
            _timestamp(race.get("date"), race.get("time"), "Race"), "Race"
        )
        <= generated
    ]
    round_results = await asyncio.gather(
        *(_fetch_round(client, season, round_number) for round_number in past_rounds)
    )
    classifications = {
        round_number: (qualifying, race)
        for round_number, qualifying, race in round_results
    }
    events = [
        _event(
            race,
            generated,
            classifications.get(_integer(race.get("round"), "round")),
        )
        for race in races
    ]
    completed_rounds = [
        cast(int, event["round"]) for event in events if event["state"] == "complete"
    ]
    next_round = next(
        (cast(int, event["round"]) for event in events if event["state"] != "complete"),
        None,
    )
    all_results = [calendar, drivers, constructors]
    for _, qualifying, race in round_results:
        all_results.extend((qualifying, race))

    payload: dict[str, object] = {
        "schemaVersion": 1,
        "generatedAt": generated.replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "freshness": _freshness(generated, all_results),
        "season": season,
        "currentRound": max(completed_rounds) if completed_rounds else None,
        "nextRound": next_round,
        "events": events,
        "driverStandings": _driver_standings(drivers),
        "constructorStandings": _constructor_standings(constructors),
        "sources": [_source(result) for result in all_results],
    }
    return validate_season(payload)
