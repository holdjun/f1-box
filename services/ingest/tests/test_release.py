import hashlib
import json
from pathlib import Path

import pytest
from jsonschema import ValidationError

import f1box_ingest.release as release
from f1box_ingest.release import write_release


FIXTURE_PATH = Path(__file__).parents[3] / "packages/contracts/fixtures/season-2026.json"


def test_write_release_is_deterministic_across_top_level_dict_order(
    tmp_path: Path,
) -> None:
    payload = json.loads(FIXTURE_PATH.read_text())
    reordered_payload = {key: payload[key] for key in reversed(payload)}

    first = write_release(payload, tmp_path)
    second = write_release(reordered_payload, tmp_path)

    assert first == second
    assert first.checksum == hashlib.sha256(first.payload_path.read_bytes()).hexdigest()
    assert first.payload_path == (
        tmp_path / "v1/seasons/2026" / f"{first.checksum}.json"
    )


def test_write_release_creates_a_latest_manifest_without_payload(
    tmp_path: Path,
) -> None:
    payload = json.loads(FIXTURE_PATH.read_text())

    release_files = write_release(payload, tmp_path)

    manifest = json.loads(release_files.manifest_path.read_text())
    assert manifest == {
        "schemaVersion": 1,
        "season": 2026,
        "checksum": release_files.checksum,
        "payloadKey": f"v1/seasons/2026/{release_files.checksum}.json",
        "generatedAt": payload["generatedAt"],
    }
    assert release_files.manifest_path == tmp_path / "v1/seasons/2026/latest.json"


def test_write_release_keeps_existing_immutable_payload_metadata(tmp_path: Path) -> None:
    payload = json.loads(FIXTURE_PATH.read_text())

    first = write_release(payload, tmp_path)
    before = first.payload_path.stat()
    second = write_release(payload, tmp_path)
    after = first.payload_path.stat()

    assert second == first
    assert after.st_ino == before.st_ino
    assert after.st_mtime_ns == before.st_mtime_ns
    assert sorted(path.name for path in first.payload_path.parent.iterdir()) == [
        f"{first.checksum}.json",
        "latest.json",
    ]


def test_write_release_rejects_tampered_immutable_payload(tmp_path: Path) -> None:
    payload = json.loads(FIXTURE_PATH.read_text())
    release_files = write_release(payload, tmp_path)
    release_files.payload_path.write_bytes(b"tampered")

    with pytest.raises(RuntimeError, match="immutable payload checksum mismatch"):
        write_release(payload, tmp_path)

    assert release_files.payload_path.read_bytes() == b"tampered"


def test_write_release_rejects_invalid_payload_before_creating_output(
    tmp_path: Path,
) -> None:
    with pytest.raises(ValidationError):
        write_release({"season": 2026}, tmp_path)

    assert not list(tmp_path.iterdir())


def test_write_release_cleans_temporary_manifest_file_after_replace_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = json.loads(FIXTURE_PATH.read_text())
    previous = write_release(payload, tmp_path)
    manifest_before = previous.manifest_path.read_bytes()
    payload["freshness"] = "stale"
    real_replace = release.os.replace

    def fail_manifest_replace(source: Path, destination: Path) -> None:
        if destination.name == "latest.json":
            raise OSError("manifest replace failed")
        real_replace(source, destination)

    monkeypatch.setattr(release.os, "replace", fail_manifest_replace)

    with pytest.raises(OSError, match="manifest replace failed"):
        write_release(payload, tmp_path)

    assert previous.manifest_path.read_bytes() == manifest_before
    assert not list(previous.manifest_path.parent.glob(".*.tmp"))
