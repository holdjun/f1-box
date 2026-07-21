import json
from pathlib import Path

import pytest

from f1box_ingest import cli


FIXTURE_PATH = Path(__file__).parents[3] / "packages/contracts/fixtures/season-2026.json"


class FakeClient:
    def __init__(self, *, raw_dir: Path) -> None:
        self.raw_dir = raw_dir

    async def __aenter__(self):  # type: ignore[no-untyped-def]
        return self

    async def __aexit__(self, *args):  # type: ignore[no-untyped-def]
        return None


def test_season_command_atomically_writes_built_payload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "season.json"
    replacements: list[tuple[Path, Path]] = []

    async def fake_build_season(*, season: int, client, generated_at: str):  # type: ignore[no-untyped-def]
        assert season == 2026
        assert isinstance(client, FakeClient)
        assert generated_at.endswith("Z")
        return {"season": season}

    real_replace = cli.os.replace

    def recording_replace(source: Path, destination: Path) -> None:
        assert not output.exists()
        replacements.append((Path(source), Path(destination)))
        real_replace(source, destination)

    monkeypatch.setattr(cli, "JolpicaClient", FakeClient)
    monkeypatch.setattr(cli, "build_season", fake_build_season)
    monkeypatch.setattr(cli.os, "replace", recording_replace)

    result = cli.main(
        [
            "season",
            "--season",
            "2026",
            "--output",
            str(output),
            "--raw-dir",
            str(tmp_path / "raw"),
        ]
    )

    assert result == 0
    assert json.loads(output.read_text()) == {"season": 2026}
    assert len(replacements) == 1
    assert replacements[0][1] == output
    assert replacements[0][0].parent == output.parent


def test_season_command_preserves_last_valid_output_on_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    output = tmp_path / "season.json"
    output.write_text('{"last":"valid"}\n')

    async def failing_build_season(**_kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("upstream unavailable")

    monkeypatch.setattr(cli, "JolpicaClient", FakeClient)
    monkeypatch.setattr(cli, "build_season", failing_build_season)

    result = cli.main(
        [
            "season",
            "--season",
            "2026",
            "--output",
            str(output),
            "--raw-dir",
            str(tmp_path / "raw"),
        ]
    )

    assert result == 1
    assert output.read_text() == '{"last":"valid"}\n'
    assert "upstream unavailable" in capsys.readouterr().err
    assert list(tmp_path.glob(".season.json.*.tmp")) == []


def test_season_command_optionally_writes_a_release(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "season.json"
    release_dir = tmp_path / "releases"
    payload = json.loads(FIXTURE_PATH.read_text())

    async def fake_build_season(**_kwargs):  # type: ignore[no-untyped-def]
        return payload

    monkeypatch.setattr(cli, "JolpicaClient", FakeClient)
    monkeypatch.setattr(cli, "build_season", fake_build_season)

    result = cli.main(
        [
            "season",
            "--season",
            "2026",
            "--output",
            str(output),
            "--release-dir",
            str(release_dir),
        ]
    )

    manifest = json.loads(
        (release_dir / "v1/seasons/2026/latest.json").read_text()
    )
    assert result == 0
    assert json.loads(output.read_text()) == payload
    assert manifest["payloadKey"] == f"v1/seasons/2026/{manifest['checksum']}.json"
