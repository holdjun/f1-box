import asyncio
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from f1box_ingest.client import JolpicaClient, JolpicaResponseError


NOW = datetime(2026, 7, 21, 12, 0, tzinfo=UTC)


def run(coroutine):  # type: ignore[no-untyped-def]
    return asyncio.run(coroutine)


def test_fetch_returns_object_and_writes_content_addressed_snapshot(
    tmp_path: Path,
) -> None:
    body = b'{"MRData":{"limit":"100"}}'

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body, request=request)

    async def scenario():  # type: ignore[no-untyped-def]
        async with JolpicaClient(
            raw_dir=tmp_path,
            transport=httpx.MockTransport(handler),
            clock=lambda: NOW,
        ) as client:
            return await client.fetch("/ergast/f1/2026.json?limit=100")

    result = run(scenario())
    checksum = hashlib.sha256(body).hexdigest()

    assert result.payload == {"MRData": {"limit": "100"}}
    assert result.checksum == checksum
    assert result.fetched_at == "2026-07-21T12:00:00Z"
    assert result.url == "https://api.jolpi.ca/ergast/f1/2026.json?limit=100"

    raw_path = tmp_path / f"{checksum}.json"
    metadata_path = tmp_path / f"{checksum}.meta.json"

    assert raw_path.read_bytes() == body
    assert hashlib.sha256(raw_path.read_bytes()).hexdigest() == checksum
    assert json.loads(metadata_path.read_text()) == {
        "url": result.url,
        "fetchedAt": result.fetched_at,
        "checksum": checksum,
    }
    assert str(tmp_path) not in metadata_path.read_text()


def test_repeated_content_keeps_the_first_immutable_snapshot(tmp_path: Path) -> None:
    times = iter(
        [
            datetime(2026, 7, 21, 12, 0, tzinfo=UTC),
            datetime(2026, 7, 21, 12, 1, tzinfo=UTC),
        ]
    )
    body = b'{"MRData":{"same":"content"}}'

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body, request=request)

    async def scenario() -> str:
        async with JolpicaClient(
            raw_dir=tmp_path,
            transport=httpx.MockTransport(handler),
            clock=lambda: next(times),
        ) as client:
            first = await client.fetch("/ergast/f1/2026.json")
            await client.fetch("/ergast/f1/2026.json")
            return first.checksum

    checksum = run(scenario())
    raw = (tmp_path / f"{checksum}.json").read_bytes()
    metadata = json.loads((tmp_path / f"{checksum}.meta.json").read_text())

    assert raw == body
    assert metadata["fetchedAt"] == "2026-07-21T12:00:00Z"


@pytest.mark.parametrize("status_code", [429, 503])
def test_fetch_retries_only_bounded_transient_statuses(
    tmp_path: Path, status_code: int
) -> None:
    attempts = 0
    delays: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            return httpx.Response(status_code, request=request)
        return httpx.Response(200, json={"MRData": {}}, request=request)

    async def fake_sleep(delay: float) -> None:
        delays.append(delay)

    async def scenario():  # type: ignore[no-untyped-def]
        async with JolpicaClient(
            raw_dir=tmp_path,
            transport=httpx.MockTransport(handler),
            sleep=fake_sleep,
        ) as client:
            return await client.fetch("/ergast/f1/2026.json")

    run(scenario())

    assert attempts == 3
    assert delays == [5.0, 10.0]


def test_fetch_honors_retry_after_header_on_429(tmp_path: Path) -> None:
    attempts = 0
    delays: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(
                429, headers={"Retry-After": "7"}, request=request
            )
        return httpx.Response(200, json={"MRData": {}}, request=request)

    async def fake_sleep(delay: float) -> None:
        delays.append(delay)

    async def scenario():  # type: ignore[no-untyped-def]
        async with JolpicaClient(
            raw_dir=tmp_path,
            transport=httpx.MockTransport(handler),
            sleep=fake_sleep,
        ) as client:
            return await client.fetch("/ergast/f1/2026.json")

    run(scenario())

    assert attempts == 2
    assert delays == [7.0]


def test_fetch_stops_after_bounded_timeout_retries(tmp_path: Path) -> None:
    attempts = 0
    delays: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        raise httpx.ReadTimeout("upstream timed out", request=request)

    async def fake_sleep(delay: float) -> None:
        delays.append(delay)

    async def scenario() -> None:
        async with JolpicaClient(
            raw_dir=tmp_path,
            transport=httpx.MockTransport(handler),
            sleep=fake_sleep,
        ) as client:
            await client.fetch("/ergast/f1/2026.json")

    with pytest.raises(httpx.ReadTimeout, match="upstream timed out"):
        run(scenario())

    assert attempts == 3
    assert delays == [0.05, 0.1]


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (b"not-json", "valid JSON"),
        (b"[]", "JSON object"),
    ],
)
def test_fetch_rejects_invalid_json_responses(
    tmp_path: Path, body: bytes, message: str
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body, request=request)

    async def scenario() -> None:
        async with JolpicaClient(
            raw_dir=tmp_path,
            transport=httpx.MockTransport(handler),
        ) as client:
            await client.fetch("/ergast/f1/2026.json")

    with pytest.raises(JolpicaResponseError, match=message):
        run(scenario())

    assert list(tmp_path.iterdir()) == []


def test_fetch_does_not_retry_permanent_http_errors(tmp_path: Path) -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(404, request=request)

    async def scenario() -> None:
        async with JolpicaClient(
            raw_dir=tmp_path,
            transport=httpx.MockTransport(handler),
        ) as client:
            await client.fetch("/ergast/f1/2026.json")

    with pytest.raises(httpx.HTTPStatusError):
        run(scenario())

    assert attempts == 1


@pytest.mark.parametrize(
    "path",
    [
        "https://example.com/steal",
        "/ergast/f1/../admin",
        "//example.com/steal",
        "/ergast/f1/2026.json?api_key=secret",
    ],
)
def test_fetch_rejects_unsafe_paths(tmp_path: Path, path: str) -> None:
    async def scenario() -> None:
        async with JolpicaClient(raw_dir=tmp_path) as client:
            await client.fetch(path)

    with pytest.raises(ValueError, match="safe Jolpica path"):
        run(scenario())


def test_client_limits_total_concurrency_to_two(tmp_path: Path) -> None:
    active = 0
    maximum = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        await asyncio.sleep(0.01)
        active -= 1
        return httpx.Response(
            200,
            json={"MRData": {"url": str(request.url)}},
            request=request,
        )

    async def scenario() -> None:
        async with JolpicaClient(
            raw_dir=tmp_path,
            transport=httpx.MockTransport(handler),
        ) as client:
            await asyncio.gather(
                *(
                    client.fetch(f"/ergast/f1/2026/{round_number}.json")
                    for round_number in range(12)
                )
            )

    run(scenario())

    assert maximum == 2
