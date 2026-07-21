"""Command-line interface for F1 Box ingestion."""

import argparse
import asyncio
import json
import os
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from f1box_ingest.client import JolpicaClient
from f1box_ingest.normalize import build_season
from f1box_ingest.release import write_release


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="f1box-ingest")
    commands = parser.add_subparsers(dest="command", required=True)
    season = commands.add_parser("season", help="build a normalized season payload")
    season.add_argument("--season", type=int, required=True)
    season.add_argument("--output", type=Path, required=True)
    season.add_argument("--release-dir", type=Path)
    season.add_argument("--raw-dir", type=Path, default=Path(".data/raw"))
    return parser


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _write_json_atomic(output: Path, payload: dict[str, object]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=output.parent,
            prefix=f".{output.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            json.dump(payload, temporary_file, ensure_ascii=False, indent=2)
            temporary_file.write("\n")
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
            temporary_path = Path(temporary_file.name)
        os.replace(temporary_path, output)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


async def _build_and_write(
    *, season: int, output: Path, raw_dir: Path, release_dir: Path | None
) -> None:
    async with JolpicaClient(raw_dir=raw_dir) as client:
        payload = await build_season(
            season=season,
            client=client,
            generated_at=_utc_now(),
        )
    if release_dir is not None:
        write_release(payload, release_dir)
    _write_json_atomic(output, payload)


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        asyncio.run(
            _build_and_write(
                season=args.season,
                output=args.output,
                raw_dir=args.raw_dir,
                release_dir=args.release_dir,
            )
        )
    except Exception as error:
        print(f"f1box-ingest: {error}", file=sys.stderr)
        return 1
    return 0
