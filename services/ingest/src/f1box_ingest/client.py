"""Bounded Jolpica HTTP client with traceable raw snapshots."""

import asyncio
import hashlib
import json
import os
import tempfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import cast
from urllib.parse import parse_qsl, unquote, urlsplit

import httpx


TRANSIENT_STATUS_CODES = frozenset({408, 429, 502, 503, 504})
ALLOWED_QUERY_PARAMETERS = frozenset({"limit", "offset"})


@dataclass(frozen=True)
class FetchResult:
    url: str
    fetched_at: str
    payload: dict[str, object]
    checksum: str


class JolpicaResponseError(ValueError):
    """Raised when Jolpica returns an unusable response body."""


def _utc_timestamp(value: datetime) -> str:
    return (
        value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    )


def _validate_path(path: str) -> None:
    parsed = urlsplit(path)
    decoded_path = unquote(parsed.path)
    query = parse_qsl(parsed.query, keep_blank_values=True)
    safe_query = all(
        key in ALLOWED_QUERY_PARAMETERS and value.isdigit() for key, value in query
    )

    if (
        parsed.scheme
        or parsed.netloc
        or parsed.fragment
        or not decoded_path.startswith("/ergast/f1/")
        or ".." in decoded_path.split("/")
        or "\\" in decoded_path
        or not safe_query
    ):
        raise ValueError("path must be a safe Jolpica path")


class JolpicaClient:
    """Fetch Jolpica resources with bounded retries and concurrency."""

    def __init__(
        self,
        *,
        raw_dir: Path = Path(".data/raw"),
        base_url: str = "https://api.jolpi.ca",
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        max_attempts: int = 3,
    ) -> None:
        if not 1 <= max_attempts <= 5:
            raise ValueError("max_attempts must be between 1 and 5")

        self._raw_dir = raw_dir
        self._clock = clock
        self._sleep = sleep
        self._max_attempts = max_attempts
        self._semaphore = asyncio.Semaphore(6)
        self._client = httpx.AsyncClient(
            base_url=base_url,
            transport=transport,
            timeout=httpx.Timeout(10.0),
            limits=httpx.Limits(max_connections=6, max_keepalive_connections=6),
            follow_redirects=False,
            headers={"User-Agent": "f1-box-ingest/0.1"},
        )

    async def __aenter__(self) -> "JolpicaClient":
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def fetch(self, path: str) -> FetchResult:
        _validate_path(path)

        response = await self._request_with_retries(path)
        try:
            value = response.json()
        except ValueError as error:
            raise JolpicaResponseError(
                "Jolpica response must contain valid JSON"
            ) from error

        if not isinstance(value, dict):
            raise JolpicaResponseError("Jolpica response must be a JSON object")

        payload = cast(dict[str, object], value)
        checksum = hashlib.sha256(response.content).hexdigest()
        fetched_at = _utc_timestamp(self._clock())
        url = str(response.url)
        self._write_snapshot(
            checksum=checksum,
            content=response.content,
            metadata={
                "url": url,
                "fetchedAt": fetched_at,
                "checksum": checksum,
            },
        )
        return FetchResult(
            url=url,
            fetched_at=fetched_at,
            payload=payload,
            checksum=checksum,
        )

    async def _request_with_retries(self, path: str) -> httpx.Response:
        for attempt in range(self._max_attempts):
            try:
                async with self._semaphore:
                    response = await self._client.get(path)
            except httpx.TransportError:
                if attempt + 1 == self._max_attempts:
                    raise
                await self._sleep(0.05 * (2**attempt))
                continue

            if (
                response.status_code in TRANSIENT_STATUS_CODES
                and attempt + 1 < self._max_attempts
            ):
                await response.aclose()
                await self._sleep(0.05 * (2**attempt))
                continue

            response.raise_for_status()
            return response

        raise RuntimeError("retry loop exhausted")

    def _write_snapshot(
        self,
        *,
        checksum: str,
        content: bytes,
        metadata: dict[str, object],
    ) -> None:
        self._raw_dir.mkdir(parents=True, exist_ok=True)
        self._write_immutable(self._raw_dir / f"{checksum}.json", content)
        metadata_bytes = (
            json.dumps(metadata, ensure_ascii=False, sort_keys=True) + "\n"
        ).encode()
        self._write_immutable(
            self._raw_dir / f"{checksum}.meta.json",
            metadata_bytes,
        )

    def _write_immutable(self, destination: Path, content: bytes) -> None:
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                "wb",
                dir=self._raw_dir,
                prefix=f".{destination.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_file.write(content)
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
                temporary_path = Path(temporary_file.name)
            try:
                os.link(temporary_path, destination)
            except FileExistsError:
                pass
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
