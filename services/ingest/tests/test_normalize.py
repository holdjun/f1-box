import asyncio
import json
from pathlib import Path

from f1box_ingest.client import FetchResult
from f1box_ingest.contracts import validate_season
from f1box_ingest.normalize import build_season


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


class FixtureClient:
    def __init__(self) -> None:
        self.calls: list[str] = []
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
            fetched_at="2026-03-10T00:00:00Z",
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
            "points": 25.0,
            "wins": 1,
        },
        {
            "position": 2,
            "name": "Oscar Piastri",
            "code": "PIA",
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
