import json
from pathlib import Path

import pytest
from jsonschema import ValidationError

from f1box_ingest.contracts import validate_weekend


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "weekend.json"


def load_weekend() -> dict[str, object]:
    with FIXTURE_PATH.open() as fixture_file:
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
