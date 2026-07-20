"""Validation for the shared F1 Box weekend contract."""

import json
from pathlib import Path
from typing import cast

from jsonschema import Draft202012Validator


SCHEMA_RELATIVE_PATH = Path("packages/contracts/weekend.schema.json")


def _find_schema_path() -> Path:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / SCHEMA_RELATIVE_PATH
        if candidate.is_file():
            return candidate

    raise RuntimeError(
        f"Could not find {SCHEMA_RELATIVE_PATH.as_posix()} in any parent directory"
    )


SCHEMA_PATH = _find_schema_path()

with SCHEMA_PATH.open(encoding="utf-8") as schema_file:
    WEEKEND_VALIDATOR = Draft202012Validator(
        json.load(schema_file),
        format_checker=Draft202012Validator.FORMAT_CHECKER,
    )


def validate_weekend(value: object) -> dict[str, object]:
    """Validate a weekend payload against the repository's shared JSON Schema."""
    WEEKEND_VALIDATOR.validate(value)
    return cast(dict[str, object], value)
