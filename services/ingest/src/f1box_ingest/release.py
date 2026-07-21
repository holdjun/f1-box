"""Create deterministic, immutable files for a validated season release."""

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from f1box_ingest.contracts import validate_season


@dataclass(frozen=True)
class ReleaseFiles:
    """Paths and checksum produced for one local season release."""

    checksum: str
    payload_path: Path
    manifest_path: Path


def _encode_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _write_bytes_atomic(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "wb",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
            temporary_path = Path(temporary_file.name)
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def write_release(payload: dict[str, object], output_dir: Path) -> ReleaseFiles:
    """Write the immutable payload before atomically updating its latest manifest."""
    validated_payload = validate_season(payload)
    payload_bytes = _encode_json(validated_payload)
    checksum = hashlib.sha256(payload_bytes).hexdigest()
    season = cast(int, validated_payload["season"])
    release_dir = output_dir / "v1" / "seasons" / str(season)
    payload_path = release_dir / f"{checksum}.json"
    manifest_path = release_dir / "latest.json"
    manifest = {
        "schemaVersion": validated_payload["schemaVersion"],
        "season": season,
        "checksum": checksum,
        "payloadKey": f"v1/seasons/{season}/{checksum}.json",
        "generatedAt": validated_payload["generatedAt"],
    }

    _write_bytes_atomic(payload_path, payload_bytes)
    _write_bytes_atomic(manifest_path, _encode_json(manifest))
    return ReleaseFiles(checksum, payload_path, manifest_path)
