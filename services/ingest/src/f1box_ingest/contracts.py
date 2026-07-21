"""Validation for the shared F1 Box JSON contracts."""

import json
from collections import deque
from pathlib import Path
from typing import cast

from jsonschema import Draft202012Validator, ValidationError


SCHEMA_RELATIVE_PATH = Path("packages/contracts/weekend.schema.json")
SEASON_SCHEMA_RELATIVE_PATH = Path("packages/contracts/season.schema.json")


def _find_schema_path(
    relative_path: Path = SCHEMA_RELATIVE_PATH,
) -> Path:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / relative_path
        if candidate.is_file():
            return candidate

    raise RuntimeError(
        f"Could not find {relative_path.as_posix()} in any parent directory"
    )


SCHEMA_PATH = _find_schema_path()
SEASON_SCHEMA_PATH = _find_schema_path(SEASON_SCHEMA_RELATIVE_PATH)

with SCHEMA_PATH.open(encoding="utf-8") as schema_file:
    WEEKEND_VALIDATOR = Draft202012Validator(
        json.load(schema_file),
        format_checker=Draft202012Validator.FORMAT_CHECKER,
    )

with SEASON_SCHEMA_PATH.open(encoding="utf-8") as schema_file:
    SEASON_VALIDATOR = Draft202012Validator(
        json.load(schema_file),
        format_checker=Draft202012Validator.FORMAT_CHECKER,
    )


def validate_weekend(value: object) -> dict[str, object]:
    """Validate a weekend payload against the repository's shared JSON Schema."""
    WEEKEND_VALIDATOR.validate(value)
    return cast(dict[str, object], value)


def validate_season(value: object) -> dict[str, object]:
    """Validate a season payload with the shared Schema and semantic rules."""
    SEASON_VALIDATOR.validate(value)
    payload = cast(dict[str, object], value)
    events = cast(list[dict[str, object]], payload["events"])
    round_indexes: dict[int, int] = {}

    for index, event in enumerate(events):
        round_number = cast(int, event["round"])
        if round_number in round_indexes:
            raise ValidationError(
                f"round must be unique (duplicates events/{round_indexes[round_number]}/round)",
                path=deque(["events", index, "round"]),
            )
        round_indexes[round_number] = index

        if event["state"] != "complete":
            continue
        for classification in ("qualifyingClassification", "raceClassification"):
            if event[classification] is None:
                raise ValidationError(
                    f"{classification} must be present when state is complete",
                    path=deque(["events", index, classification]),
                )

    return payload
