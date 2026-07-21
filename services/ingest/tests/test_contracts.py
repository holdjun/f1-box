import json
from pathlib import Path

import pytest
from jsonschema import ValidationError

from f1box_ingest.contracts import (
    SEASON_SCHEMA_PATH,
    _find_schema_path,
    validate_season,
    validate_weekend,
)


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "weekend.json"
SEASON_FIXTURE_PATH = SEASON_SCHEMA_PATH.parent / "fixtures" / "season-2026.json"


def load_weekend() -> dict[str, object]:
    with FIXTURE_PATH.open() as fixture_file:
        value = json.load(fixture_file)

    assert isinstance(value, dict)
    return value


def load_season() -> dict[str, object]:
    with SEASON_FIXTURE_PATH.open() as fixture_file:
        value = json.load(fixture_file)

    assert isinstance(value, dict)
    return value


def test_returns_the_same_valid_weekend_payload() -> None:
    weekend = load_weekend()

    assert validate_weekend(weekend) is weekend


def test_rejects_an_unsupported_schema_version() -> None:
    weekend = load_weekend()
    weekend["schemaVersion"] = 2

    with pytest.raises(ValidationError) as error:
        validate_weekend(weekend)

    assert list(error.value.absolute_path) == ["schemaVersion"]


def test_rejects_an_unknown_session_state() -> None:
    weekend = load_weekend()
    sessions = weekend["sessions"]
    assert isinstance(sessions, list)
    assert isinstance(sessions[0], dict)
    sessions[0]["state"] = "running"

    with pytest.raises(ValidationError) as error:
        validate_weekend(weekend)

    assert list(error.value.absolute_path) == ["sessions", 0, "state"]


def test_rejects_a_payload_with_no_sources() -> None:
    weekend = load_weekend()
    weekend["sources"] = []

    with pytest.raises(ValidationError) as error:
        validate_weekend(weekend)

    assert list(error.value.absolute_path) == ["sources"]


def test_rejects_a_non_dictionary_payload() -> None:
    with pytest.raises(ValidationError) as error:
        validate_weekend([])

    assert list(error.value.absolute_path) == []


def test_schema_lookup_failure_names_the_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(Path, "is_file", lambda _path: False)

    with pytest.raises(RuntimeError, match="weekend.schema.json"):
        _find_schema_path()


def test_returns_the_same_valid_season_payload() -> None:
    season = load_season()

    assert validate_season(season) is season


def test_season_rejects_duplicate_rounds() -> None:
    season = load_season()
    events = season["events"]
    assert isinstance(events, list)
    assert isinstance(events[1], dict)
    events[1]["round"] = 1

    with pytest.raises(ValidationError) as error:
        validate_season(season)

    assert list(error.value.absolute_path) == ["events", 1, "round"]


def test_season_requires_classifications_for_complete_events() -> None:
    season = load_season()
    events = season["events"]
    assert isinstance(events, list)
    assert isinstance(events[0], dict)
    events[0]["state"] = "complete"

    with pytest.raises(ValidationError) as error:
        validate_season(season)

    assert list(error.value.absolute_path) == [
        "events",
        0,
        "qualifyingClassification",
    ]
