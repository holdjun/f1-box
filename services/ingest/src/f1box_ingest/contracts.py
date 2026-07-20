"""Validation for the shared F1 Box weekend contract."""

import json
from pathlib import Path
from typing import cast

from jsonschema import Draft202012Validator


SCHEMA_PATH = Path(__file__).resolve().parents[4] / "packages/contracts/weekend.schema.json"

with SCHEMA_PATH.open(encoding="utf-8") as schema_file:
    WEEKEND_VALIDATOR = Draft202012Validator(
        json.load(schema_file),
        format_checker=Draft202012Validator.FORMAT_CHECKER,
    )


def validate_weekend(value: object) -> dict[str, object]:
    """Validate a weekend payload against the repository's shared JSON Schema."""
    WEEKEND_VALIDATOR.validate(value)
    return cast(dict[str, object], value)
