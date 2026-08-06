import asyncio
import copy
import json
from pathlib import Path

import pytest

from f1box_ingest.client import FetchResult
from f1box_ingest.contracts import validate_season
from f1box_ingest.normalize import NormalizationError, build_season


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "jolpica"
CALENDAR_PATH = "/ergast/f1/2026.json?limit=100"
DRIVERS_PATH = "/ergast/f1/2026/driverstandings.json?limit=100"
CONSTRUCTORS_PATH = "/ergast/f1/2026/constructorstandings.json?limit=100"
QUALIFYING_PATH = "/ergast/f1/2026/1/qualifying.json?limit=100"
RACE_PATH = "/ergast/f1/2026/1/results.json?limit=100"


def load_fixture(name: str) -> dict[str, object]:
    with (FIXTURE_DIR / name).open() as fixture_file:
        value = json.load(fixture_file)
    assert isinstance(value, dict)
    return value


def first_race(payload: dict[str, object]) -> dict[str, object]:
    mr_data = payload["MRData"]
    assert isinstance(mr_data, dict)
    race_table = mr_data["RaceTable"]
    assert isinstance(race_table, dict)
    races = race_table["Races"]
    assert isinstance(races, list)
    race = races[0]
    assert isinstance(race, dict)
    return race


class FixtureClient:
    def __init__(self, fetched_at_by_path: dict[str, str] | None = None) -> None:
        self.calls: list[str] = []
        self.fetched_at_by_path = fetched_at_by_path or {}
        self.payloads = {
            CALENDAR_PATH: load_fixture("calendar.json"),
            DRIVERS_PATH: load_fixture("driver_standings.json"),
            CONSTRUCTORS_PATH: load_fixture("constructor_standings.json"),
            QUALIFYING_PATH: load_fixture("qualifying.json"),
            RACE_PATH: load_fixture("race.json"),
        }

    async def fetch(self, path: str) -> FetchResult:
        self.calls.append(path)
        return FetchResult(
            url=f"https://api.jolpi.ca{path}",
            fetched_at=self.fetched_at_by_path.get(path, "2026-03-10T00:00:00Z"),
            payload=self.payloads[path],
            checksum="a" * 64,
        )


def test_build_season_normalizes_fixed_jolpica_payloads() -> None:
    client = FixtureClient()

    payload = asyncio.run(
        build_season(
            season=2026,
            client=client,  # type: ignore[arg-type]
            generated_at="2026-03-10T00:00:00Z",
        )
    )

    assert validate_season(payload) is payload
    assert payload["schemaVersion"] == 1
    assert payload["freshness"] == "fresh"
    assert payload["currentRound"] == 1
    assert payload["nextRound"] == 2

    events = payload["events"]
    assert isinstance(events, list)
    assert len(events) == 2
    first, second = events
    assert first == {
        "round": 1,
        "slug": "australian-grand-prix",
        "raceName": "Australian Grand Prix",
        "startsAt": "2026-03-08T04:00:00Z",
        "state": "complete",
        "circuit": {
            "id": "albert_park",
            "name": "Albert Park Grand Prix Circuit",
            "locality": "Melbourne",
            "country": "Australia",
            "latitude": -37.8497,
            "longitude": 144.968,
        },
        "sessions": [
            {
                "key": "practice-1",
                "name": "Practice 1",
                "startsAt": "2026-03-06T01:30:00Z",
                "state": "complete",
            },
            {
                "key": "practice-2",
                "name": "Practice 2",
                "startsAt": "2026-03-06T05:00:00Z",
                "state": "complete",
            },
            {
                "key": "practice-3",
                "name": "Practice 3",
                "startsAt": "2026-03-07T01:30:00Z",
                "state": "complete",
            },
            {
                "key": "qualifying",
                "name": "Qualifying",
                "startsAt": "2026-03-07T05:00:00Z",
                "state": "complete",
            },
            {
                "key": "race",
                "name": "Race",
                "startsAt": "2026-03-08T04:00:00Z",
                "state": "complete",
            },
        ],
        "qualifyingClassification": {
            "sessionKey": "qualifying",
            "rows": [
                {
                    "position": 1,
                    "driverCode": "NOR",
                    "driverName": "Lando Norris",
                    "constructorName": "McLaren",
                    "q1": "1:16.003",
                    "q2": "1:15.812",
                    "q3": "1:15.096",
                },
                {
                    "position": 2,
                    "driverCode": "PIA",
                    "driverName": "Oscar Piastri",
                    "constructorName": "McLaren",
                    "q1": "1:16.062",
                    "q2": "1:15.864",
                    "q3": "1:15.180",
                },
            ],
        },
        "raceClassification": {
            "sessionKey": "race",
            "rows": [
                {
                    "position": 1,
                    "driverCode": "NOR",
                    "driverName": "Lando Norris",
                    "constructorName": "McLaren",
                    "laps": 58,
                    "status": "Finished",
                    "points": 25.0,
                    "time": "1:24:16.123",
                    "fastestLap": "1:19.813",
                    "fastestLapRank": 1,
                },
                {
                    "position": 2,
                    "driverCode": "PIA",
                    "driverName": "Oscar Piastri",
                    "constructorName": "McLaren",
                    "laps": 58,
                    "status": "+2.345",
                    "points": 18.0,
                    "time": "+2.345",
                    "fastestLap": "1:20.011",
                    "fastestLapRank": 2,
                },
            ],
        },
    }
    assert second["state"] == "scheduled"
    assert second["qualifyingClassification"] is None
    assert second["raceClassification"] is None

    assert payload["driverStandings"] == [
        {
            "position": 1,
            "name": "Lando Norris",
            "code": "NOR",
            "givenName": "Lando",
            "familyName": "Norris",
            "slug": "lando-norris",
            "number": 1,
            "nationality": "British",
            "wikipediaUrl": "https://en.wikipedia.org/wiki/Lando_Norris",
            "points": 25.0,
            "wins": 1,
        },
        {
            "position": 2,
            "name": "Oscar Piastri",
            "code": "PIA",
            "givenName": "Oscar",
            "familyName": "Piastri",
            "slug": "oscar-piastri",
            "number": 81,
            "nationality": "Australian",
            "wikipediaUrl": "https://en.wikipedia.org/wiki/Oscar_Piastri",
            "points": 18.0,
            "wins": 0,
        },
    ]
    assert payload["constructorStandings"] == [
        {"position": 1, "name": "McLaren", "points": 43.0, "wins": 1}
    ]
    assert len(payload["sources"]) == 5  # type: ignore[arg-type]


def test_build_season_does_not_request_future_round_results() -> None:
    client = FixtureClient()

    asyncio.run(
        build_season(
            season=2026,
            client=client,  # type: ignore[arg-type]
            generated_at="2026-03-10T00:00:00Z",
        )
    )

    assert "/ergast/f1/2026/2/qualifying.json?limit=100" not in client.calls
    assert "/ergast/f1/2026/2/results.json?limit=100" not in client.calls
    assert set(client.calls) == {
        CALENDAR_PATH,
        DRIVERS_PATH,
        CONSTRUCTORS_PATH,
        QUALIFYING_PATH,
        RACE_PATH,
    }


def test_build_season_marks_old_source_data_stale() -> None:
    client = FixtureClient()

    payload = asyncio.run(
        build_season(
            season=2026,
            client=client,  # type: ignore[arg-type]
            generated_at="2026-03-12T00:00:01Z",
        )
    )

    assert payload["freshness"] == "stale"


def test_build_season_uses_oldest_required_source_for_freshness() -> None:
    client = FixtureClient(
        fetched_at_by_path={
            CALENDAR_PATH: "2026-03-07T23:59:59Z",
            DRIVERS_PATH: "2026-03-10T00:00:00Z",
            CONSTRUCTORS_PATH: "2026-03-10T00:00:00Z",
            QUALIFYING_PATH: "2026-03-10T00:00:00Z",
            RACE_PATH: "2026-03-10T00:00:00Z",
        }
    )

    payload = asyncio.run(
        build_season(
            season=2026,
            client=client,  # type: ignore[arg-type]
            generated_at="2026-03-10T00:00:00Z",
        )
    )

    assert payload["freshness"] == "stale"


def test_build_season_generated_at_is_not_earlier_than_any_source() -> None:
    client = FixtureClient(
        fetched_at_by_path={
            DRIVERS_PATH: "2026-03-10T00:05:00Z",
            CONSTRUCTORS_PATH: "2026-03-10T00:03:00Z",
        }
    )

    payload = asyncio.run(
        build_season(
            season=2026,
            client=client,  # type: ignore[arg-type]
            generated_at="2026-03-10T00:00:00Z",
        )
    )

    assert payload["generatedAt"] == "2026-03-10T00:05:00Z"
    assert payload["freshness"] == "fresh"


@pytest.mark.parametrize(
    ("path", "field", "wrong_value"),
    [
        (QUALIFYING_PATH, "season", "2025"),
        (QUALIFYING_PATH, "round", "2"),
        (RACE_PATH, "season", "2025"),
        (RACE_PATH, "round", "2"),
    ],
)
def test_build_season_rejects_classification_for_another_event(
    path: str, field: str, wrong_value: str
) -> None:
    client = FixtureClient()
    first_race(client.payloads[path])[field] = wrong_value

    with pytest.raises(NormalizationError, match="classification identity mismatch"):
        asyncio.run(
            build_season(
                season=2026,
                client=client,  # type: ignore[arg-type]
                generated_at="2026-03-10T00:00:00Z",
            )
        )


def test_build_season_rejects_any_extra_race_with_the_wrong_identity() -> None:
    client = FixtureClient()
    payload = client.payloads[QUALIFYING_PATH]
    mr_data = payload["MRData"]
    assert isinstance(mr_data, dict)
    race_table = mr_data["RaceTable"]
    assert isinstance(race_table, dict)
    races = race_table["Races"]
    assert isinstance(races, list)
    extra_race = copy.deepcopy(races[0])
    assert isinstance(extra_race, dict)
    extra_race["round"] = "2"
    races.append(extra_race)

    with pytest.raises(NormalizationError, match="classification identity mismatch"):
        asyncio.run(
            build_season(
                season=2026,
                client=client,  # type: ignore[arg-type]
                generated_at="2026-03-10T00:00:00Z",
            )
        )


@pytest.mark.parametrize(
    ("path", "result_key", "classification_key"),
    [
        (QUALIFYING_PATH, "QualifyingResults", "qualifyingClassification"),
        (RACE_PATH, "Results", "raceClassification"),
    ],
)
def test_build_season_treats_empty_classification_as_unavailable(
    path: str, result_key: str, classification_key: str
) -> None:
    client = FixtureClient()
    first_race(client.payloads[path])[result_key] = []

    payload = asyncio.run(
        build_season(
            season=2026,
            client=client,  # type: ignore[arg-type]
            generated_at="2026-03-10T00:00:00Z",
        )
    )
    events = payload["events"]
    assert isinstance(events, list)
    first = events[0]
    assert isinstance(first, dict)

    assert first[classification_key] is None
    assert first["state"] == "provisional"


@pytest.mark.parametrize("path", [QUALIFYING_PATH, RACE_PATH])
def test_build_season_allows_empty_race_table_as_provisional(path: str) -> None:
    client = FixtureClient()
    mr_data = client.payloads[path]["MRData"]
    assert isinstance(mr_data, dict)
    race_table = mr_data["RaceTable"]
    assert isinstance(race_table, dict)
    race_table["Races"] = []

    payload = asyncio.run(
        build_season(
            season=2026,
            client=client,  # type: ignore[arg-type]
            generated_at="2026-03-10T00:00:00Z",
        )
    )
    events = payload["events"]
    assert isinstance(events, list)
    first = events[0]
    assert isinstance(first, dict)

    assert first["state"] == "provisional"
