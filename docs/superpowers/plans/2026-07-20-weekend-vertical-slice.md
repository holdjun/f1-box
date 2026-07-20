# Race Weekend Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable F1 Box website that ingests one completed Jolpica race weekend, validates and publishes a stable page payload, and renders a home page plus canonical event page with schedule, results, standings, history, provenance, and freshness.

**Architecture:** A Python ingestion service owns upstream HTTP access and produces a versioned JSON page payload. An Astro 6 server application reads only the stable payload contract and renders the product; it never calls Jolpica from a visitor request. The first slice uses checked-in sample output and filesystem publication so product and data contracts can be proven before the separate D1/R2 deployment plan.

**Tech Stack:** Node.js 22+, pnpm 11.9.0, Astro 6.3.1, React, TypeScript, Python 3.12, uv, httpx, pytest, respx, Ruff, Vitest, Playwright.

## Global Constraints

- The first slice does not implement second-by-second live timing.
- Visitor requests must not call Jolpica or FastF1.
- Each published payload must include source URLs, fetch timestamps, generation timestamp, schema version, and freshness state.
- The sample event is the 2024 Belgian Grand Prix, round 14, with the 2023 and 2022 editions in its history.
- Datetimes are stored as UTC ISO 8601 strings and formatted in the visitor's browser timezone.
- No user accounts, news system, telemetry, D1, R2, or production deployment are included in this plan.
- The UI must identify F1 Box as an unofficial site and use no official F1, team, or driver imagery.

---

## Planned file map

```text
f1-box/
├── package.json                         # Root JavaScript commands and version floor
├── pnpm-workspace.yaml                  # JavaScript workspace membership
├── .python-version                      # Python 3.12 selection for uv
├── packages/contracts/
│   ├── package.json                     # Contract package metadata
│   └── src/weekend.ts                   # Stable TypeScript page-payload types
├── services/ingest/
│   ├── pyproject.toml                   # Python runtime and test dependencies
│   ├── src/f1box_ingest/
│   │   ├── __init__.py
│   │   ├── client.py                    # Jolpica HTTP adapter
│   │   ├── normalize.py                 # Upstream-to-canonical transformation
│   │   └── cli.py                       # Fetch, validate, and atomically publish payload
│   └── tests/
│       ├── fixtures/                    # Minimal pinned Jolpica responses
│       ├── test_client.py
│       ├── test_normalize.py
│       └── test_cli.py
├── apps/web/
│   ├── package.json                     # Astro app dependencies and commands
│   ├── astro.config.mjs                 # Astro Cloudflare-compatible server config
│   ├── tsconfig.json
│   ├── src/
│   │   ├── data/weekend.json            # Checked-in known-good sample payload
│   │   ├── components/
│   │   │   ├── EventHero.astro
│   │   │   ├── SessionTimeline.astro
│   │   │   ├── ResultsTable.astro
│   │   │   ├── StandingsPanel.astro
│   │   │   ├── HistoryStrip.astro
│   │   │   ├── SeasonSchedule.astro
│   │   │   └── FreshnessBadge.astro
│   │   ├── layouts/BaseLayout.astro
│   │   ├── lib/weekend.ts               # Payload loading and freshness derivation
│   │   ├── pages/index.astro
│   │   ├── pages/seasons/[year]/index.astro
│   │   ├── pages/seasons/[year]/races/[event].astro
│   │   └── styles/global.css
│   └── tests/
│       ├── weekend.test.ts
│       └── event.spec.ts
└── .github/workflows/ci.yml             # Python, web, build, and browser quality gates
```

## Task 1: Establish the workspace and stable payload contract

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.python-version`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/weekend.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `WeekendPayload`, `SessionSummary`, `RaceResult`, `Standing`, `HistoricalEdition`, `SourceReference`, and `FreshnessState` exported by `@f1-box/contracts/weekend`.
- Consumes: no project interfaces.

- [ ] **Step 1: Add root workspace configuration**

```json
{
  "name": "f1-box",
  "private": true,
  "packageManager": "pnpm@11.9.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "pnpm --filter @f1-box/web dev",
    "build": "pnpm --filter @f1-box/web build",
    "test": "pnpm --filter @f1-box/web test",
    "test:e2e": "pnpm --filter @f1-box/web test:e2e",
    "check": "pnpm --filter @f1-box/web check"
  }
}
```

```yaml
packages:
  - apps/*
  - packages/*
```

Set `.python-version` to exactly:

```text
3.12
```

- [ ] **Step 2: Define the contract package metadata**

```json
{
  "name": "@f1-box/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./weekend": "./src/weekend.ts"
  }
}
```

- [ ] **Step 3: Define the complete TypeScript payload contract**

Create `packages/contracts/src/weekend.ts`:

```ts
export type FreshnessState = "fresh" | "stale" | "delayed" | "unavailable";
export type SessionState = "scheduled" | "complete" | "unavailable";

export interface SourceReference {
  name: "jolpica";
  url: string;
  fetchedAt: string;
}

export interface SessionSummary {
  key: "fp1" | "fp2" | "fp3" | "sprint" | "sprintQualifying" | "qualifying" | "race";
  name: string;
  startsAt: string;
  state: SessionState;
}

export interface RaceResult {
  position: number;
  driverCode: string;
  driverName: string;
  constructorName: string;
  laps: number;
  status: string;
  points: number;
  fastestLap?: string;
}

export interface Standing {
  position: number;
  name: string;
  code?: string;
  points: number;
  wins: number;
}

export interface HistoricalEdition {
  season: number;
  round: number;
  raceName: string;
  winnerName: string;
  winnerConstructor: string;
}

export interface SeasonEventSummary {
  round: number;
  raceName: string;
  slug: string;
  startsAt: string;
  circuitName: string;
  country: string;
}

export interface WeekendPayload {
  schemaVersion: 1;
  generatedAt: string;
  freshness: FreshnessState;
  event: {
    season: number;
    round: number;
    slug: string;
    raceName: string;
    startsAt: string;
    circuit: {
      id: string;
      name: string;
      locality: string;
      country: string;
      latitude: number;
      longitude: number;
    };
  };
  sessions: SessionSummary[];
  raceResults: RaceResult[];
  driverStandings: Standing[];
  constructorStandings: Standing[];
  history: HistoricalEdition[];
  seasonSchedule: SeasonEventSummary[];
  sources: SourceReference[];
}
```

- [ ] **Step 4: Extend ignored generated and local data paths**

Append:

```gitignore
.data/
services/ingest/.venv/
services/ingest/.coverage
apps/web/test-results/
apps/web/playwright-report/
```

- [ ] **Step 5: Install the workspace and verify contract resolution**

Run: `pnpm install && pnpm add -Dw typescript`

Expected: exit code 0 and a new `pnpm-lock.yaml`.

Run: `pnpm exec tsc --noEmit --strict --module preserve --moduleResolution bundler packages/contracts/src/weekend.ts`

Expected: exit code 0 with no type errors.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .python-version .gitignore packages/contracts
git commit -m "chore: establish workspace and weekend contract"
```

## Task 2: Normalize pinned Jolpica data into the page contract

**Files:**
- Create: `services/ingest/pyproject.toml`
- Create: `services/ingest/src/f1box_ingest/__init__.py`
- Create: `services/ingest/src/f1box_ingest/normalize.py`
- Create: `services/ingest/tests/fixtures/event.json`
- Create: `services/ingest/tests/fixtures/results.json`
- Create: `services/ingest/tests/fixtures/driver_standings.json`
- Create: `services/ingest/tests/fixtures/constructor_standings.json`
- Create: `services/ingest/tests/fixtures/history.json`
- Create: `services/ingest/tests/fixtures/schedule.json`
- Create: `services/ingest/tests/test_normalize.py`

**Interfaces:**
- Produces: `normalize_weekend(event_data, results_data, driver_standings_data, constructor_standings_data, history_data, schedule_data, generated_at, sources) -> dict[str, object]`.
- Consumes: semantic dictionaries extracted from Jolpica responses and ISO 8601 timestamps.

- [ ] **Step 1: Configure the Python package**

Create `services/ingest/pyproject.toml`:

```toml
[project]
name = "f1box-ingest"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = ["httpx>=0.28,<1"]

[project.optional-dependencies]
dev = ["pytest>=8,<9", "respx>=0.22,<1", "ruff>=0.12,<1"]

[project.scripts]
f1box-ingest = "f1box_ingest.cli:main"

[build-system]
requires = ["hatchling>=1.27"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py312"
```

Create `services/ingest/src/f1box_ingest/__init__.py` as an empty file so the package has an explicit import boundary.

- [ ] **Step 2: Add minimal pinned fixtures**

The fixtures must contain these exact semantic records:

```json
{
  "event": {"season": "2024", "round": "14", "raceName": "Belgian Grand Prix", "date": "2024-07-28", "time": "13:00:00Z", "circuitId": "spa", "circuitName": "Circuit de Spa-Francorchamps", "locality": "Spa", "country": "Belgium", "lat": "50.4372", "long": "5.97139"},
  "sessions": [{"key": "fp1", "name": "Free Practice 1", "date": "2024-07-26", "time": "11:30:00Z"}, {"key": "fp2", "name": "Free Practice 2", "date": "2024-07-26", "time": "15:00:00Z"}, {"key": "fp3", "name": "Free Practice 3", "date": "2024-07-27", "time": "10:30:00Z"}, {"key": "qualifying", "name": "Qualifying", "date": "2024-07-27", "time": "14:00:00Z"}, {"key": "race", "name": "Race", "date": "2024-07-28", "time": "13:00:00Z"}]
}
```

```json
{"results": [{"position": "1", "code": "HAM", "givenName": "Lewis", "familyName": "Hamilton", "constructor": "Mercedes", "laps": "44", "status": "Finished", "points": "25"}, {"position": "2", "code": "PIA", "givenName": "Oscar", "familyName": "Piastri", "constructor": "McLaren", "laps": "44", "status": "Finished", "points": "18"}]}
```

```json
{"standings": [{"position": "1", "name": "Max Verstappen", "code": "VER", "points": "265", "wins": "7"}, {"position": "2", "name": "Lando Norris", "code": "NOR", "points": "189", "wins": "1"}]}
```

```json
{"standings": [{"position": "1", "name": "Red Bull", "points": "389", "wins": "7"}, {"position": "2", "name": "McLaren", "points": "338", "wins": "2"}]}
```

```json
{"editions": [{"season": "2023", "round": "12", "raceName": "Belgian Grand Prix", "winnerName": "Max Verstappen", "winnerConstructor": "Red Bull"}, {"season": "2022", "round": "14", "raceName": "Belgian Grand Prix", "winnerName": "Max Verstappen", "winnerConstructor": "Red Bull"}]}
```

```json
{"events": [{"round": "13", "raceName": "Hungarian Grand Prix", "date": "2024-07-21", "time": "13:00:00Z", "circuitName": "Hungaroring", "country": "Hungary"}, {"round": "14", "raceName": "Belgian Grand Prix", "date": "2024-07-28", "time": "13:00:00Z", "circuitName": "Circuit de Spa-Francorchamps", "country": "Belgium"}, {"round": "15", "raceName": "Dutch Grand Prix", "date": "2024-08-25", "time": "13:00:00Z", "circuitName": "Circuit Zandvoort", "country": "Netherlands"}]}
```

Write the six JSON objects above exactly to `event.json`, `results.json`, `driver_standings.json`, `constructor_standings.json`, `history.json`, and `schedule.json`. They are normalized semantic fixtures; raw Jolpica nesting is covered independently by the CLI extraction tests.

- [ ] **Step 3: Write the failing normalizer test**

Create `services/ingest/tests/test_normalize.py`:

```python
import json
from pathlib import Path

from f1box_ingest.normalize import normalize_weekend

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def test_normalizes_belgian_gp_weekend() -> None:
    payload = normalize_weekend(
        event_data=load("event.json"),
        results_data=load("results.json"),
        driver_standings_data=load("driver_standings.json"),
        constructor_standings_data=load("constructor_standings.json"),
        history_data=load("history.json"),
        schedule_data=load("schedule.json"),
        generated_at="2026-07-20T10:00:00Z",
        sources=[{"name": "jolpica", "url": "https://api.jolpi.ca/ergast/f1/2024/14/results/", "fetchedAt": "2026-07-20T09:59:00Z"}],
    )

    assert payload["schemaVersion"] == 1
    assert payload["freshness"] == "fresh"
    assert payload["event"]["slug"] == "belgian-grand-prix"
    assert payload["event"]["circuit"]["id"] == "spa"
    assert next(session for session in payload["sessions"] if session["key"] == "race")["state"] == "complete"
    assert payload["raceResults"][0]["driverCode"] == "HAM"
    assert payload["driverStandings"][0]["code"] == "VER"
    assert [edition["season"] for edition in payload["history"]] == [2023, 2022]
    assert [event["round"] for event in payload["seasonSchedule"]] == [13, 14, 15]
```

- [ ] **Step 4: Run the test and verify failure**

Run: `cd services/ingest && uv sync --extra dev && uv run pytest tests/test_normalize.py -v`

Expected: FAIL with `ModuleNotFoundError` or missing `normalize_weekend`.

- [ ] **Step 5: Implement the minimal normalizer**

Create `services/ingest/src/f1box_ingest/normalize.py` with focused helpers for:

```python
from __future__ import annotations

import re
from typing import Any


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def _iso(date: str, time: str) -> str:
    return f"{date}T{time.removesuffix('Z')}Z"


def _standing(item: dict[str, str]) -> dict[str, Any]:
    result = {
        "position": int(item["position"]),
        "name": item["name"],
        "points": float(item["points"]),
        "wins": int(item["wins"]),
    }
    if item.get("code"):
        result["code"] = item["code"]
    return result


def normalize_weekend(
    *,
    event_data: dict[str, Any],
    results_data: dict[str, Any],
    driver_standings_data: dict[str, Any],
    constructor_standings_data: dict[str, Any],
    history_data: dict[str, Any],
    schedule_data: dict[str, Any],
    generated_at: str,
    sources: list[dict[str, str]],
) -> dict[str, Any]:
    event = event_data["event"]
    results = []
    for item in results_data["results"]:
        result = {
            "position": int(item["position"]),
            "driverCode": item["code"],
            "driverName": f"{item['givenName']} {item['familyName']}",
            "constructorName": item["constructor"],
            "laps": int(item["laps"]),
            "status": item["status"],
            "points": float(item["points"]),
        }
        if item.get("fastestLap"):
            result["fastestLap"] = item["fastestLap"]
        results.append(result)

    sessions = [
        {
            "key": session["key"],
            "name": session["name"],
            "startsAt": _iso(session["date"], session["time"]),
            "state": "complete" if _iso(session["date"], session["time"]) <= generated_at else "scheduled",
        }
        for session in event_data["sessions"]
    ]

    return {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "freshness": "fresh",
        "event": {
            "season": int(event["season"]),
            "round": int(event["round"]),
            "slug": _slug(event["raceName"]),
            "raceName": event["raceName"],
            "startsAt": _iso(event["date"], event["time"]),
            "circuit": {
                "id": event["circuitId"],
                "name": event["circuitName"],
                "locality": event["locality"],
                "country": event["country"],
                "latitude": float(event["lat"]),
                "longitude": float(event["long"]),
            },
        },
        "sessions": sessions,
        "raceResults": results,
        "driverStandings": [_standing(item) for item in driver_standings_data["standings"]],
        "constructorStandings": [_standing(item) for item in constructor_standings_data["standings"]],
        "history": [
            {
                "season": int(item["season"]),
                "round": int(item["round"]),
                "raceName": item["raceName"],
                "winnerName": item["winnerName"],
                "winnerConstructor": item["winnerConstructor"],
            }
            for item in history_data["editions"]
        ],
        "seasonSchedule": [
            {
                "round": int(item["round"]),
                "raceName": item["raceName"],
                "slug": _slug(item["raceName"]),
                "startsAt": _iso(item["date"], item["time"]),
                "circuitName": item["circuitName"],
                "country": item["country"],
            }
            for item in schedule_data["events"]
        ],
        "sources": sources,
    }
```

- [ ] **Step 6: Run tests and lint**

Run: `cd services/ingest && uv run pytest tests/test_normalize.py -v && uv run ruff check .`

Expected: one passing test and `All checks passed!`.

- [ ] **Step 7: Commit**

```bash
git add services/ingest
git commit -m "feat: normalize Jolpica weekend data"
```

## Task 3: Add a cached and bounded Jolpica HTTP adapter

**Files:**
- Create: `services/ingest/src/f1box_ingest/client.py`
- Create: `services/ingest/tests/test_client.py`

**Interfaces:**
- Produces: `JolpicaClient.fetch(path: str) -> FetchResult`; `FetchResult` contains `url`, `fetched_at`, and `payload`.
- Consumes: an `httpx.Client`, base URL `https://api.jolpi.ca/ergast/f1`, and a writable raw-cache directory.

- [ ] **Step 1: Write failing tests for success, retry, and cache reuse**

Create `services/ingest/tests/test_client.py`:

```python
import httpx
import pytest

from f1box_ingest.client import JolpicaClient, JolpicaError


def test_fetch_writes_and_reuses_raw_snapshot(tmp_path, respx_mock):
    route = respx_mock.get("https://api.jolpi.ca/ergast/f1/2024/14/results/").respond(
        200, json={"MRData": {"RaceTable": {"Races": []}}}
    )
    client = JolpicaClient(cache_dir=tmp_path, now=lambda: "2026-07-20T10:00:00Z")

    first = client.fetch("2024/14/results/")
    second = client.fetch("2024/14/results/")

    assert route.call_count == 1
    assert first.payload == second.payload
    assert first.url.endswith("/2024/14/results/")


def test_fetch_rejects_non_object_payload(tmp_path, respx_mock):
    respx_mock.get("https://api.jolpi.ca/ergast/f1/bad/").respond(200, json=[])
    client = JolpicaClient(cache_dir=tmp_path, now=lambda: "2026-07-20T10:00:00Z")

    with pytest.raises(JolpicaError, match="JSON object"):
        client.fetch("bad/")


def test_fetch_retries_transient_status(tmp_path, respx_mock):
    route = respx_mock.get("https://api.jolpi.ca/ergast/f1/retry/").mock(
        side_effect=[httpx.Response(503), httpx.Response(200, json={"MRData": {}})]
    )
    waits = []
    client = JolpicaClient(
        cache_dir=tmp_path,
        now=lambda: "2026-07-20T10:00:00Z",
        sleep=waits.append,
    )

    result = client.fetch("retry/")

    assert route.call_count == 2
    assert waits == [1]
    assert result.payload == {"MRData": {}}
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd services/ingest && uv run pytest tests/test_client.py -v`

Expected: FAIL because `JolpicaClient` does not exist.

- [ ] **Step 3: Implement the adapter**

Create `services/ingest/src/f1box_ingest/client.py`:

```python
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable

import httpx


class JolpicaError(RuntimeError):
    pass


@dataclass(frozen=True)
class FetchResult:
    url: str
    fetched_at: str
    payload: dict


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class JolpicaClient:
    def __init__(
        self,
        *,
        cache_dir: Path,
        base_url: str = "https://api.jolpi.ca/ergast/f1/",
        now: Callable[[], str] = utc_now,
        sleep: Callable[[float], None] = time.sleep,
        client: httpx.Client | None = None,
    ) -> None:
        self.cache_dir = cache_dir
        self.base_url = base_url.rstrip("/") + "/"
        self.now = now
        self.sleep = sleep
        self.client = client or httpx.Client(timeout=20, follow_redirects=True)

    def fetch(self, path: str) -> FetchResult:
        if path.startswith("/") or ".." in path.split("/"):
            raise JolpicaError(f"Unsafe Jolpica path: {path}")
        url = self.base_url + path
        cache_path = self.cache_dir / f"{hashlib.sha256(url.encode()).hexdigest()}.json"
        cached = self._read_cache(cache_path)
        if cached is not None:
            return cached

        response: httpx.Response | None = None
        for attempt in range(3):
            try:
                response = self.client.get(url)
            except httpx.HTTPError as error:
                if attempt == 2:
                    raise JolpicaError(f"Jolpica transport error for {url}: {error}") from error
                self.sleep(attempt + 1)
                continue
            if response.status_code not in {429, 502, 503, 504} or attempt == 2:
                break
            self.sleep(attempt + 1)

        if response is None or not response.is_success:
            status = response.status_code if response is not None else "unavailable"
            raise JolpicaError(f"Jolpica returned {status} for {url}")
        try:
            payload = response.json()
        except ValueError as error:
            raise JolpicaError(f"Jolpica returned invalid JSON for {url}") from error
        if not isinstance(payload, dict):
            raise JolpicaError(f"Jolpica response must be a JSON object: {url}")

        result = FetchResult(url=url, fetched_at=self.now(), payload=payload)
        self._write_cache(cache_path, result)
        return result

    def _read_cache(self, path: Path) -> FetchResult | None:
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text())
            if not isinstance(data["payload"], dict):
                return None
            return FetchResult(
                url=str(data["url"]),
                fetched_at=str(data["fetchedAt"]),
                payload=data["payload"],
            )
        except (KeyError, TypeError, ValueError, OSError):
            return None

    def _write_cache(self, path: Path, result: FetchResult) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(
                {"url": result.url, "fetchedAt": result.fetched_at, "payload": result.payload},
                indent=2,
                sort_keys=True,
            )
            + "\n"
        )
        temporary.replace(path)
```

- [ ] **Step 4: Run adapter tests and the full Python suite**

Run: `cd services/ingest && uv run pytest -v && uv run ruff check .`

Expected: all tests pass and Ruff reports no errors.

- [ ] **Step 5: Commit**

```bash
git add services/ingest/src/f1box_ingest/client.py services/ingest/tests/test_client.py
git commit -m "feat: add cached Jolpica client"
```

## Task 4: Publish the sample weekend atomically

**Files:**
- Create: `services/ingest/src/f1box_ingest/cli.py`
- Create: `services/ingest/tests/test_cli.py`
- Create: `apps/web/src/data/weekend.json`

**Interfaces:**
- Produces: CLI `f1box-ingest weekend --season 2024 --round 14 --output PATH`.
- Consumes: `JolpicaClient.fetch`, `normalize_weekend`, and the stable `WeekendPayload` JSON shape.

- [ ] **Step 1: Write a failing CLI publication test**

Create `services/ingest/tests/test_cli.py`:

```python
import json

from f1box_ingest.cli import _event, _results, _schedule, publish_weekend
from f1box_ingest.client import FetchResult


def test_publish_replaces_output_atomically(tmp_path, monkeypatch):
    output = tmp_path / "weekend.json"
    output.write_text('{"old": true}')
    monkeypatch.setattr("f1box_ingest.cli.build_weekend", lambda **_: {"schemaVersion": 1})

    publish_weekend(season=2024, round_number=14, output=output, cache_dir=tmp_path / "raw")

    assert json.loads(output.read_text()) == {"schemaVersion": 1}
    assert not output.with_suffix(".json.tmp").exists()


def test_extracts_raw_jolpica_race_shapes():
    event_source = FetchResult(
        url="https://api.jolpi.ca/ergast/f1/2024/14/",
        fetched_at="2026-07-20T10:00:00Z",
        payload={
            "MRData": {
                "RaceTable": {
                    "Races": [{
                        "season": "2024",
                        "round": "14",
                        "raceName": "Belgian Grand Prix",
                        "date": "2024-07-28",
                        "time": "13:00:00Z",
                        "Circuit": {
                            "circuitId": "spa",
                            "circuitName": "Circuit de Spa-Francorchamps",
                            "Location": {"locality": "Spa", "country": "Belgium", "lat": "50.4372", "long": "5.97139"},
                        },
                        "Qualifying": {"date": "2024-07-27", "time": "14:00:00Z"},
                    }]
                }
            }
        },
    )
    result_source = FetchResult(
        url="https://api.jolpi.ca/ergast/f1/2024/14/results/",
        fetched_at="2026-07-20T10:00:00Z",
        payload={
            "MRData": {
                "RaceTable": {
                    "Races": [{
                        "Results": [{
                            "position": "1",
                            "points": "25",
                            "laps": "44",
                            "status": "Finished",
                            "Driver": {"code": "HAM", "givenName": "Lewis", "familyName": "Hamilton"},
                            "Constructor": {"name": "Mercedes"},
                        }]
                    }]
                }
            }
        },
    )
    schedule_source = FetchResult(
        url="https://api.jolpi.ca/ergast/f1/2024/",
        fetched_at="2026-07-20T10:00:00Z",
        payload=event_source.payload,
    )

    event, sessions = _event(event_source)

    assert event["circuitId"] == "spa"
    assert [session["key"] for session in sessions] == ["qualifying", "race"]
    assert _results(result_source)["results"][0]["code"] == "HAM"
    assert _schedule(schedule_source)["events"][0]["country"] == "Belgium"
```

- [ ] **Step 2: Run the test and verify failure**

Run: `cd services/ingest && uv run pytest tests/test_cli.py -v`

Expected: FAIL because `publish_weekend` does not exist.

- [ ] **Step 3: Implement build and publication commands**

Create `services/ingest/src/f1box_ingest/cli.py`. `build_weekend` fetches these bounded endpoint forms:

```text
2024/14/
2024/
2024/14/results/
2024/13/driverStandings/
2024/13/constructorStandings/
circuits/spa/results/1/?limit=100
```

Use this complete implementation:

```python
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .client import FetchResult, JolpicaClient, utc_now
from .normalize import normalize_weekend


class IngestionError(RuntimeError):
    pass


SESSION_FIELDS = {
    "FirstPractice": ("fp1", "Free Practice 1"),
    "SecondPractice": ("fp2", "Free Practice 2"),
    "ThirdPractice": ("fp3", "Free Practice 3"),
    "SprintQualifying": ("sprintQualifying", "Sprint Qualifying"),
    "Sprint": ("sprint", "Sprint"),
    "Qualifying": ("qualifying", "Qualifying"),
}


def _races(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return payload.get("MRData", {}).get("RaceTable", {}).get("Races", [])


def _event(source: FetchResult) -> tuple[dict[str, Any], list[dict[str, str]]]:
    races = _races(source.payload)
    if not races:
        raise IngestionError("Target event is absent from Jolpica")
    race = races[0]
    circuit = race["Circuit"]
    location = circuit["Location"]
    event = {
        "season": race["season"],
        "round": race["round"],
        "raceName": race["raceName"],
        "date": race["date"],
        "time": race.get("time", "00:00:00Z"),
        "circuitId": circuit["circuitId"],
        "circuitName": circuit["circuitName"],
        "locality": location["locality"],
        "country": location["country"],
        "lat": location["lat"],
        "long": location["long"],
    }
    sessions = []
    for field, (key, name) in SESSION_FIELDS.items():
        if field in race:
            sessions.append(
                {
                    "key": key,
                    "name": name,
                    "date": race[field]["date"],
                    "time": race[field].get("time", "00:00:00Z"),
                }
            )
    sessions.append(
        {"key": "race", "name": "Race", "date": race["date"], "time": race.get("time", "00:00:00Z")}
    )
    return event, sessions


def _results(source: FetchResult) -> dict[str, list[dict[str, str]]]:
    races = _races(source.payload)
    if not races or not races[0].get("Results"):
        raise IngestionError("Race results are absent from Jolpica")
    normalized = []
    for item in races[0]["Results"]:
        driver = item["Driver"]
        result = {
            "position": item["position"],
            "code": driver.get("code", driver["familyName"][:3].upper()),
            "givenName": driver["givenName"],
            "familyName": driver["familyName"],
            "constructor": item["Constructor"]["name"],
            "laps": item["laps"],
            "status": item["status"],
            "points": item["points"],
        }
        fastest = item.get("FastestLap", {}).get("Time", {}).get("time")
        if fastest:
            result["fastestLap"] = fastest
        normalized.append(result)
    return {"results": normalized}


def _driver_standings(source: FetchResult) -> dict[str, list[dict[str, str]]]:
    lists = source.payload.get("MRData", {}).get("StandingsTable", {}).get("StandingsLists", [])
    items = lists[0].get("DriverStandings", []) if lists else []
    return {
        "standings": [
            {
                "position": item["position"],
                "name": f"{item['Driver']['givenName']} {item['Driver']['familyName']}",
                "code": item["Driver"].get("code", item["Driver"]["familyName"][:3].upper()),
                "points": item["points"],
                "wins": item["wins"],
            }
            for item in items
        ]
    }


def _constructor_standings(source: FetchResult) -> dict[str, list[dict[str, str]]]:
    lists = source.payload.get("MRData", {}).get("StandingsTable", {}).get("StandingsLists", [])
    items = lists[0].get("ConstructorStandings", []) if lists else []
    return {
        "standings": [
            {
                "position": item["position"],
                "name": item["Constructor"]["name"],
                "points": item["points"],
                "wins": item["wins"],
            }
            for item in items
        ]
    }


def _schedule(source: FetchResult) -> dict[str, list[dict[str, str]]]:
    return {
        "events": [
            {
                "round": race["round"],
                "raceName": race["raceName"],
                "date": race["date"],
                "time": race.get("time", "00:00:00Z"),
                "circuitName": race["Circuit"]["circuitName"],
                "country": race["Circuit"]["Location"]["country"],
            }
            for race in _races(source.payload)
        ]
    }


def _history(source: FetchResult, target_season: int) -> dict[str, list[dict[str, str]]]:
    editions = []
    for race in _races(source.payload):
        if int(race["season"]) >= target_season or not race.get("Results"):
            continue
        winner = race["Results"][0]
        editions.append(
            {
                "season": race["season"],
                "round": race["round"],
                "raceName": race["raceName"],
                "winnerName": f"{winner['Driver']['givenName']} {winner['Driver']['familyName']}",
                "winnerConstructor": winner["Constructor"]["name"],
            }
        )
    editions.sort(key=lambda item: int(item["season"]), reverse=True)
    return {"editions": editions[:2]}


def _source(result: FetchResult) -> dict[str, str]:
    return {"name": "jolpica", "url": result.url, "fetchedAt": result.fetched_at}


def build_weekend(*, season: int, round_number: int, cache_dir: Path) -> dict[str, Any]:
    client = JolpicaClient(cache_dir=cache_dir)
    event_source = client.fetch(f"{season}/{round_number}/")
    event, sessions = _event(event_source)
    schedule_source = client.fetch(f"{season}/")
    results_source = client.fetch(f"{season}/{round_number}/results/")
    driver_source = client.fetch(f"{season}/{round_number - 1}/driverStandings/")
    constructor_source = client.fetch(f"{season}/{round_number - 1}/constructorStandings/")
    history_source = client.fetch(f"circuits/{event['circuitId']}/results/1/?limit=100")
    sources = [event_source, schedule_source, results_source, driver_source, constructor_source, history_source]
    return normalize_weekend(
        event_data={"event": event, "sessions": sessions},
        results_data=_results(results_source),
        driver_standings_data=_driver_standings(driver_source),
        constructor_standings_data=_constructor_standings(constructor_source),
        history_data=_history(history_source, season),
        schedule_data=_schedule(schedule_source),
        generated_at=utc_now(),
        sources=[_source(source) for source in sources],
    )


def build_fixture_weekend(*, fixtures: Path) -> dict[str, Any]:
    def load(name: str) -> dict[str, Any]:
        return json.loads((fixtures / name).read_text())

    return normalize_weekend(
        event_data=load("event.json"),
        results_data=load("results.json"),
        driver_standings_data=load("driver_standings.json"),
        constructor_standings_data=load("constructor_standings.json"),
        history_data=load("history.json"),
        schedule_data=load("schedule.json"),
        generated_at="2026-07-20T10:00:00Z",
        sources=[
            {
                "name": "jolpica",
                "url": "https://api.jolpi.ca/ergast/f1/2024/14/results/",
                "fetchedAt": "2026-07-20T09:59:00Z",
            }
        ],
    )


def publish_weekend(
    *,
    season: int,
    round_number: int,
    output: Path,
    cache_dir: Path,
    fixtures: Path | None = None,
) -> dict[str, Any]:
    payload = (
        build_fixture_weekend(fixtures=fixtures)
        if fixtures is not None
        else build_weekend(season=season, round_number=round_number, cache_dir=cache_dir)
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    temporary.replace(output)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(prog="f1box-ingest")
    subparsers = parser.add_subparsers(dest="command", required=True)
    weekend = subparsers.add_parser("weekend")
    weekend.add_argument("--season", type=int, required=True)
    weekend.add_argument("--round", dest="round_number", type=int, required=True)
    weekend.add_argument("--output", type=Path, required=True)
    weekend.add_argument("--cache-dir", type=Path, default=Path("../../.data/raw"))
    weekend.add_argument("--fixtures", type=Path)
    arguments = parser.parse_args()
    payload = publish_weekend(
        season=arguments.season,
        round_number=arguments.round_number,
        output=arguments.output,
        cache_dir=arguments.cache_dir,
        fixtures=arguments.fixtures,
    )
    event = payload["event"]
    print(f"published {arguments.output}: {event['season']} round {event['round']}")
    return 0
```

- [ ] **Step 4: Run all ingestion tests**

Run: `cd services/ingest && uv run pytest -v && uv run ruff check .`

Expected: all tests pass and Ruff reports no errors.

- [ ] **Step 5: Generate the checked-in sample from pinned fixtures**

Add a `--fixtures services/ingest/tests/fixtures` CLI option that bypasses HTTP and exercises the same extraction, normalization, and publication path.

Run:

```bash
cd services/ingest
uv run f1box-ingest weekend --season 2024 --round 14 --fixtures tests/fixtures --output ../../apps/web/src/data/weekend.json
```

Expected: `apps/web/src/data/weekend.json` is valid formatted JSON with `schemaVersion: 1`, `freshness: "fresh"`, and two history entries.

- [ ] **Step 6: Commit**

```bash
git add services/ingest apps/web/src/data/weekend.json
git commit -m "feat: publish canonical weekend payload"
```

## Task 5: Render the weekend home page

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/astro.config.mjs`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/lib/weekend.ts`
- Create: `apps/web/src/layouts/BaseLayout.astro`
- Create: `apps/web/src/components/EventHero.astro`
- Create: `apps/web/src/components/SessionTimeline.astro`
- Create: `apps/web/src/components/FreshnessBadge.astro`
- Create: `apps/web/src/pages/index.astro`
- Create: `apps/web/src/styles/global.css`
- Create: `apps/web/tests/weekend.test.ts`

**Interfaces:**
- Produces: `loadWeekend(): Promise<WeekendPayload>` and `deriveFreshness(generatedAt: string, now: Date): FreshnessState`.
- Consumes: `src/data/weekend.json` and the types exported by `@f1-box/contracts/weekend`.

- [ ] **Step 1: Configure Astro 6 with React and Cloudflare compatibility**

Create the web package and install dependencies:

```json
{
  "name": "@f1-box/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@f1-box/contracts": "workspace:*",
    "astro": "6.3.1"
  }
}
```

Run:

```bash
pnpm --filter @f1-box/web add @astrojs/cloudflare @astrojs/react react react-dom
pnpm --filter @f1-box/web add -D @astrojs/check @playwright/test typescript vitest
```

Create `astro.config.mjs`:

```js
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://f1-box.com",
  output: "server",
  adapter: cloudflare(),
  integrations: [react()],
  trailingSlash: "never",
});
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 2: Write failing freshness and payload tests**

```ts
import { describe, expect, it } from "vitest";
import { deriveFreshness, parseWeekend } from "../src/lib/weekend";

describe("weekend payload", () => {
  it("marks data older than 30 minutes stale", () => {
    expect(deriveFreshness("2026-07-20T09:00:00Z", new Date("2026-07-20T10:00:01Z"))).toBe("stale");
  });

  it("rejects unsupported schemas", () => {
    expect(() => parseWeekend({ schemaVersion: 2 })).toThrow("Unsupported weekend schema");
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm --filter @f1-box/web test`

Expected: FAIL because `src/lib/weekend.ts` does not exist.

- [ ] **Step 4: Implement the payload loader**

Create `apps/web/src/lib/weekend.ts`:

```ts
import type { FreshnessState, WeekendPayload } from "@f1-box/contracts/weekend";
import weekendData from "../data/weekend.json";

export function parseWeekend(value: unknown): WeekendPayload {
  if (typeof value !== "object" || value === null) throw new Error("Weekend payload must be an object");
  const payload = value as Record<string, unknown>;
  if (payload.schemaVersion !== 1) throw new Error("Unsupported weekend schema");
  if (typeof payload.event !== "object" || payload.event === null) throw new Error("Weekend event is missing");
  for (const key of ["sessions", "raceResults", "driverStandings", "constructorStandings", "history", "seasonSchedule", "sources"]) {
    if (!Array.isArray(payload[key])) throw new Error(`Weekend ${key} must be an array`);
  }
  return payload as unknown as WeekendPayload;
}

export function deriveFreshness(generatedAt: string, now: Date): FreshnessState {
  const generated = new Date(generatedAt);
  if (Number.isNaN(generated.valueOf())) return "unavailable";
  return now.valueOf() - generated.valueOf() > 30 * 60 * 1000 ? "stale" : "fresh";
}

export async function loadWeekend(): Promise<WeekendPayload> {
  return parseWeekend(weekendData);
}
```

- [ ] **Step 5: Build the page shell and home components**

Create `apps/web/src/layouts/BaseLayout.astro`:

```astro
---
import "../styles/global.css";
interface Props { title: string }
const { title } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <meta name="description" content="F1 Box race weekend information and history" />
    <title>{title} · F1 Box</title>
  </head>
  <body>
    <header class="site-header">
      <a class="logo" href="/">F1 BOX</a>
      <nav aria-label="Primary"><a href="/">Weekend</a><a href="/seasons/2024">Archive</a></nav>
    </header>
    <main><slot /></main>
    <footer>Unofficial Formula 1 fan project. Not affiliated with Formula 1.</footer>
    <script is:inline>
      for (const element of document.querySelectorAll("[data-local-time]")) {
        const value = element.getAttribute("datetime");
        if (value) element.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
      }
    </script>
  </body>
</html>
```

Create `apps/web/src/components/EventHero.astro`:

```astro
---
import type { WeekendPayload } from "@f1-box/contracts/weekend";
interface Props { event: WeekendPayload["event"]; openHref?: string }
const { event, openHref } = Astro.props;
---
<section class="hero">
  <p class="eyebrow">Round {event.round} · {event.season}</p>
  <h1>{event.season} {event.raceName}</h1>
  <p class="circuit">{event.circuit.name}</p>
  <p>{event.circuit.locality}, {event.circuit.country}</p>
  <time datetime={event.startsAt} data-local-time>{event.startsAt}</time>
  {openHref && <a class="primary-action" href={openHref}>Open weekend</a>}
</section>
```

Create `apps/web/src/components/SessionTimeline.astro`:

```astro
---
import type { SessionSummary } from "@f1-box/contracts/weekend";
interface Props { sessions: SessionSummary[] }
const { sessions } = Astro.props;
---
<section aria-labelledby="schedule-heading">
  <div class="section-heading"><p class="eyebrow">Weekend</p><h2 id="schedule-heading">Session schedule</h2></div>
  <ol class="timeline">
    {sessions.map((session) => (
      <li>
        <div><strong>{session.name}</strong><span class={`state state-${session.state}`}>{session.state}</span></div>
        <time datetime={session.startsAt} data-local-time>{session.startsAt}</time>
      </li>
    ))}
  </ol>
</section>
```

Create `apps/web/src/components/FreshnessBadge.astro`:

```astro
---
import type { FreshnessState, SourceReference } from "@f1-box/contracts/weekend";
interface Props { generatedAt: string; freshness: FreshnessState; sources: SourceReference[] }
const { generatedAt, freshness, sources } = Astro.props;
---
<aside class={`freshness freshness-${freshness}`} aria-label="Data freshness">
  <strong>{freshness === "fresh" ? "Data current" : "Data may be stale"}</strong>
  <span>Generated <time datetime={generatedAt} data-local-time>{generatedAt}</time></span>
  <span>Source: {sources.map((source) => source.name).join(", ")}</span>
</aside>
```

Create `apps/web/src/pages/index.astro`:

```astro
---
import EventHero from "../components/EventHero.astro";
import FreshnessBadge from "../components/FreshnessBadge.astro";
import SessionTimeline from "../components/SessionTimeline.astro";
import BaseLayout from "../layouts/BaseLayout.astro";
import { deriveFreshness, loadWeekend } from "../lib/weekend";
const weekend = await loadWeekend();
const href = `/seasons/${weekend.event.season}/races/${weekend.event.round}-${weekend.event.slug}`;
const freshness = deriveFreshness(weekend.generatedAt, new Date());
---
<BaseLayout title="Race weekend">
  <EventHero event={weekend.event} openHref={href} />
  <div class="content-grid">
    <SessionTimeline sessions={weekend.sessions} />
    <FreshnessBadge generatedAt={weekend.generatedAt} freshness={freshness} sources={weekend.sources} />
  </div>
</BaseLayout>
```

Create `apps/web/src/styles/global.css`:

```css
:root { --bg:#0b0b0d; --surface:#151519; --text:#f7f7f8; --muted:#a7a7af; --border:#2a2a31; --accent:#ff3b30; --success:#4ade80; --warning:#fbbf24; font-family:Inter,ui-sans-serif,system-ui,sans-serif; color-scheme:dark; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); }
a { color:inherit; }
.site-header, main, footer { width:min(1120px,calc(100% - 32px)); margin-inline:auto; }
.site-header { height:72px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border); }
.logo { color:var(--text); font-weight:900; letter-spacing:.08em; text-decoration:none; }
nav { display:flex; gap:24px; } nav a { color:var(--muted); text-decoration:none; }
main { padding-block:48px 80px; }
.hero { padding:56px; border:1px solid var(--border); border-radius:24px; background:linear-gradient(135deg,#1d1d23,var(--surface)); }
.eyebrow { color:var(--accent); font-size:.75rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
h1 { max-width:800px; margin:.2em 0; font-size:clamp(2.5rem,8vw,6rem); line-height:.92; }
h2 { margin:.2em 0 1em; font-size:2rem; }
.circuit { margin-bottom:4px; font-size:1.25rem; font-weight:700; }
time, .hero p:not(.eyebrow):not(.circuit) { color:var(--muted); }
.primary-action { display:inline-block; margin-top:28px; padding:12px 18px; border-radius:999px; background:var(--accent); font-weight:800; text-decoration:none; }
.content-grid { display:grid; grid-template-columns:2fr 1fr; gap:24px; margin-top:32px; }
.content-grid > * { padding:28px; border:1px solid var(--border); border-radius:20px; background:var(--surface); }
.timeline { display:grid; gap:12px; padding:0; list-style:none; }
.timeline li { display:flex; justify-content:space-between; gap:16px; padding-block:14px; border-bottom:1px solid var(--border); }
.timeline strong { margin-right:12px; }
.state { color:var(--muted); font-size:.75rem; text-transform:uppercase; }
.state-complete { color:var(--success); }
.freshness { display:flex; flex-direction:column; gap:10px; align-self:start; }
.freshness-stale strong, .freshness-delayed strong { color:var(--warning); }
footer { padding-block:32px; border-top:1px solid var(--border); color:var(--muted); font-size:.875rem; }
@media (max-width:760px) { .site-header { height:60px; } main { padding-top:24px; } .hero { padding:28px; } .content-grid { grid-template-columns:1fr; } .timeline li { flex-direction:column; } }
```

- [ ] **Step 6: Run unit, type, and build checks**

Run:

```bash
pnpm --filter @f1-box/web test
pnpm --filter @f1-box/web check
pnpm --filter @f1-box/web build
```

Expected: all commands exit 0 and Astro produces `apps/web/dist/_worker.js/index.js`.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml apps/web packages/contracts
git commit -m "feat: render race weekend home page"
```

## Task 6: Add results, standings, history, and the canonical event route

**Files:**
- Create: `apps/web/src/components/ResultsTable.astro`
- Create: `apps/web/src/components/StandingsPanel.astro`
- Create: `apps/web/src/components/HistoryStrip.astro`
- Create: `apps/web/src/components/SeasonSchedule.astro`
- Create: `apps/web/src/pages/seasons/[year]/index.astro`
- Create: `apps/web/src/pages/seasons/[year]/races/[event].astro`
- Modify: `apps/web/src/pages/index.astro`
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/tests/event.spec.ts`

**Interfaces:**
- Produces: canonical event route `/seasons/2024/races/14-belgian-grand-prix`.
- Consumes: `loadWeekend()` and `WeekendPayload` lists.

- [ ] **Step 1: Write the failing browser test**

```ts
import { expect, test } from "@playwright/test";

test("shows a complete Belgian Grand Prix weekend", async ({ page }) => {
  await page.goto("/seasons/2024/races/14-belgian-grand-prix");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2024 Belgian Grand Prix");
  await expect(page.getByRole("table", { name: "Race results" })).toContainText("Lewis Hamilton");
  await expect(page.getByRole("heading", { name: "Championship entering the weekend" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Previous editions" })).toBeVisible();
  await expect(page.getByText("2023")).toBeVisible();
  await expect(page.getByText("Unofficial Formula 1 fan project.")).toBeVisible();
});

test("home links to the canonical event", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open weekend" }).click();
  await expect(page).toHaveURL(/\/seasons\/2024\/races\/14-belgian-grand-prix$/);
});

test("shows the season schedule", async ({ page }) => {
  await page.goto("/seasons/2024");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2024 season");
  await expect(page.getByText("Hungarian Grand Prix")).toBeVisible();
  await expect(page.getByText("Belgian Grand Prix")).toBeVisible();
  await expect(page.getByText("Dutch Grand Prix")).toBeVisible();
});
```

- [ ] **Step 2: Run the browser test and verify failure**

Run: `pnpm --filter @f1-box/web exec playwright install chromium && pnpm --filter @f1-box/web test:e2e`

Expected: FAIL with a 404 for the canonical event route.

- [ ] **Step 3: Implement focused presentation components**

Create `apps/web/src/components/ResultsTable.astro`:

```astro
---
import type { RaceResult } from "@f1-box/contracts/weekend";
interface Props { results: RaceResult[] }
const { results } = Astro.props;
---
<section class="panel" aria-labelledby="results-heading">
  <h2 id="results-heading">Race classification</h2>
  <div class="table-scroll">
    <table aria-label="Race results">
      <caption>Race results</caption>
      <thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th>Laps</th><th>Fastest</th><th>Pts</th></tr></thead>
      <tbody>{results.map((result) => <tr><td>{result.position}</td><td><strong>{result.driverCode}</strong> {result.driverName}</td><td>{result.constructorName}</td><td>{result.laps}</td><td>{result.fastestLap ?? "—"}</td><td>{result.points}</td></tr>)}</tbody>
    </table>
  </div>
</section>
```

Create `apps/web/src/components/StandingsPanel.astro`:

```astro
---
import type { Standing } from "@f1-box/contracts/weekend";
interface Props { drivers: Standing[]; constructors: Standing[] }
const { drivers, constructors } = Astro.props;
---
<section class="panel" aria-labelledby="standings-heading">
  <h2 id="standings-heading">Championship entering the weekend</h2>
  <div class="standings-grid">
    <div><h3>Drivers</h3><ol>{drivers.map((item) => <li><span>{item.position}. {item.code ?? item.name}</span><strong>{item.points}</strong></li>)}</ol></div>
    <div><h3>Constructors</h3><ol>{constructors.map((item) => <li><span>{item.position}. {item.name}</span><strong>{item.points}</strong></li>)}</ol></div>
  </div>
</section>
```

Create `apps/web/src/components/HistoryStrip.astro`:

```astro
---
import type { HistoricalEdition } from "@f1-box/contracts/weekend";
interface Props { editions: HistoricalEdition[] }
const { editions } = Astro.props;
---
<section class="panel" aria-labelledby="history-heading">
  <h2 id="history-heading">Previous editions</h2>
  <div class="history-grid">{editions.map((edition) => <article><strong>{edition.season}</strong><span>{edition.winnerName}</span><small>{edition.winnerConstructor}</small></article>)}</div>
</section>
```

Create `apps/web/src/components/SeasonSchedule.astro`:

```astro
---
import type { SeasonEventSummary } from "@f1-box/contracts/weekend";
interface Props { events: SeasonEventSummary[]; season: number; publishedRound: number }
const { events, season, publishedRound } = Astro.props;
---
<ol class="season-list">
  {events.map((event) => <li>
    <span class="round">Round {event.round}</span>
    {event.round === publishedRound ? <a href={`/seasons/${season}/races/${event.round}-${event.slug}`}><strong>{event.raceName}</strong></a> : <strong>{event.raceName}</strong>}
    <span>{event.circuitName} · {event.country}</span>
    <time datetime={event.startsAt} data-local-time>{event.startsAt}</time>
  </li>)}
</ol>
```

Create `apps/web/src/pages/seasons/[year]/index.astro`:

```astro
---
import SeasonSchedule from "../../../components/SeasonSchedule.astro";
import BaseLayout from "../../../layouts/BaseLayout.astro";
import { loadWeekend } from "../../../lib/weekend";
const weekend = await loadWeekend();
const matches = Astro.params.year === String(weekend.event.season);
if (!matches) Astro.response.status = 404;
---
<BaseLayout title={matches ? `${weekend.event.season} season` : "Season not found"}>
  <section class="panel">
    {matches ? <><p class="eyebrow">Archive</p><h1>{weekend.event.season} season</h1><SeasonSchedule events={weekend.seasonSchedule} season={weekend.event.season} publishedRound={weekend.event.round} /></> : <><h1>Season not found</h1><a href="/">Return to current weekend</a></>}
  </section>
</BaseLayout>
```

Create `apps/web/src/pages/seasons/[year]/races/[event].astro`:

```astro
---
import EventHero from "../../../../components/EventHero.astro";
import FreshnessBadge from "../../../../components/FreshnessBadge.astro";
import HistoryStrip from "../../../../components/HistoryStrip.astro";
import ResultsTable from "../../../../components/ResultsTable.astro";
import SessionTimeline from "../../../../components/SessionTimeline.astro";
import StandingsPanel from "../../../../components/StandingsPanel.astro";
import BaseLayout from "../../../../layouts/BaseLayout.astro";
import { deriveFreshness, loadWeekend } from "../../../../lib/weekend";

const weekend = await loadWeekend();
const canonicalEvent = `${weekend.event.round}-${weekend.event.slug}`;
const matches = Astro.params.year === String(weekend.event.season) && Astro.params.event === canonicalEvent;
if (!matches) Astro.response.status = 404;
const freshness = deriveFreshness(weekend.generatedAt, new Date());
---
<BaseLayout title={matches ? weekend.event.raceName : "Weekend not found"}>
  {matches ? (
    <>
      <EventHero event={weekend.event} />
      <div class="content-grid"><SessionTimeline sessions={weekend.sessions} /><FreshnessBadge generatedAt={weekend.generatedAt} freshness={freshness} sources={weekend.sources} /></div>
      <ResultsTable results={weekend.raceResults} />
      <StandingsPanel drivers={weekend.driverStandings} constructors={weekend.constructorStandings} />
      <HistoryStrip editions={weekend.history} />
    </>
  ) : <section class="panel"><h1>Weekend not found</h1><a href="/">Return to current weekend</a></section>}
</BaseLayout>
```

Append to `apps/web/src/styles/global.css`:

```css
.panel { margin-top:24px; padding:28px; border:1px solid var(--border); border-radius:20px; background:var(--surface); }
.table-scroll { overflow-x:auto; }
table { width:100%; border-collapse:collapse; }
caption { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
th, td { padding:14px 10px; border-bottom:1px solid var(--border); text-align:left; white-space:nowrap; }
th { color:var(--muted); font-size:.75rem; text-transform:uppercase; }
.standings-grid, .history-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; }
.standings-grid ol { margin:0; padding:0; list-style:none; }
.standings-grid li { display:flex; justify-content:space-between; padding:12px 0; border-bottom:1px solid var(--border); }
.history-grid article { display:flex; flex-direction:column; gap:6px; padding:20px; border:1px solid var(--border); border-radius:14px; }
.history-grid small { color:var(--muted); }
.season-list { display:grid; gap:12px; padding:0; list-style:none; }
.season-list li { display:grid; grid-template-columns:100px 1.2fr 1fr 1fr; gap:16px; align-items:center; padding:16px 0; border-bottom:1px solid var(--border); }
.season-list a { color:var(--text); }
.round { color:var(--accent); font-size:.75rem; font-weight:800; text-transform:uppercase; }
@media (max-width:760px) { .standings-grid, .history-grid { grid-template-columns:1fr; } .panel { padding:20px; } .season-list li { grid-template-columns:1fr; gap:6px; } }
```

- [ ] **Step 4: Configure Playwright**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    port: 4321,
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: "http://127.0.0.1:4321", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});
```

- [ ] **Step 5: Run full web verification**

Run:

```bash
pnpm --filter @f1-box/web test
pnpm --filter @f1-box/web check
pnpm --filter @f1-box/web build
pnpm --filter @f1-box/web test:e2e
```

Expected: unit tests, Astro checks, build, and both Playwright projects pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat: add complete weekend detail page"
```

## Task 7: Add repeatable quality gates and operator documentation

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `docs/runbooks/weekend-ingestion.md`
- Create: `docs/product/vertical-slice-acceptance.md`
- Modify: `README.md`

**Interfaces:**
- Produces: deterministic CI checks and operator commands.
- Consumes: root pnpm scripts, Python ingestion commands, and the generated sample payload.

- [ ] **Step 1: Add GitHub Actions quality gates**

Create `.github/workflows/ci.yml` with these jobs:

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  python:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: services/ingest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
        with:
          python-version: "3.12"
      - run: uv sync --extra dev --locked
      - run: uv run ruff check .
      - run: uv run pytest -v

  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.9.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @f1-box/web test
      - run: pnpm --filter @f1-box/web check
      - run: pnpm --filter @f1-box/web build
      - run: pnpm --filter @f1-box/web exec playwright install --with-deps chromium
      - run: pnpm --filter @f1-box/web test:e2e
```

- [ ] **Step 2: Document the operator path**

Create `docs/runbooks/weekend-ingestion.md`:

````markdown
# Weekend ingestion runbook

F1 Box publishes one canonical weekend payload. Raw HTTP snapshots are cached under `.data/raw`; the cache avoids repeat upstream requests and can be removed without deleting the last published payload.

## Publish

```bash
cd services/ingest
uv sync --extra dev
uv run f1box-ingest weekend --season 2024 --round 14 --output ../../apps/web/src/data/weekend.json
cd ../..
pnpm --filter @f1-box/web test
pnpm --filter @f1-box/web build
```

Publication writes a sibling temporary file and atomically replaces the canonical payload only after normalization succeeds. Transient 429, 502, 503, and 504 responses receive two bounded retries. The product target is publication within 30 minutes of upstream availability.

## Restore the committed payload

Do not reset the worktree. Read the committed version into a temporary file, inspect it, then copy it through the normal publication path:

```bash
git show HEAD:apps/web/src/data/weekend.json > /tmp/f1-box-weekend.json
python3 -m json.tool /tmp/f1-box-weekend.json >/dev/null
cp /tmp/f1-box-weekend.json apps/web/src/data/weekend.json
pnpm --filter @f1-box/web build
```

## Diagnose

- Upstream transport failure: preserve the current payload and inspect the latest ingestion log.
- Invalid upstream shape: preserve the current payload, add a pinned regression fixture, then update extraction code.
- Stale badge: compare `generatedAt` with the most recent successful ingestion run.
- Partial enrichment failure: publish valid structured results only when the contract remains valid.
````

- [ ] **Step 3: Document acceptance criteria**

Create `docs/product/vertical-slice-acceptance.md`:

```markdown
# Vertical slice acceptance

- [ ] `/` and `/seasons/2024/races/14-belgian-grand-prix` load without an upstream network call.
- [ ] The event URL is stable and canonical.
- [ ] Schedule, results, standings, two previous editions, provenance, and freshness are visible.
- [ ] The layout is usable in desktop and iPhone 13 Playwright projects.
- [ ] Invalid schema versions fail loudly during build or request handling.
- [ ] Missing upstream enrichments do not erase the last known-good payload.
- [ ] Python tests, Ruff, Vitest, Astro check, Astro build, and Playwright all pass.
```

- [ ] **Step 4: Write the project README**

Create `README.md`:

````markdown
# F1 Box

F1 Box is an unofficial Formula 1 race-weekend information hub. It combines the current weekend, session results, championship context, and previous editions without calling upstream data providers during visitor requests.

> Unofficial Formula 1 fan project. Not affiliated with Formula 1.

## Architecture

The Python service under `services/ingest` fetches and normalizes Jolpica data into `apps/web/src/data/weekend.json`. The Astro application under `apps/web` renders that stable contract. Cloudflare D1/R2 and FastF1 enrichment are separate delivery phases.

## Requirements

- Node.js 22 or newer
- pnpm 11.9.0
- Python 3.12
- uv

## Setup

```bash
pnpm install
cd services/ingest
uv sync --extra dev
cd ../..
```

## Run

```bash
pnpm dev
```

## Verify

```bash
cd services/ingest && uv run ruff check . && uv run pytest -v
cd ../.. && pnpm test && pnpm build && pnpm test:e2e
```

## Documentation

- [Product and system design](docs/superpowers/specs/2026-07-20-f1-box-design.md)
- [Vertical-slice implementation plan](docs/superpowers/plans/2026-07-20-weekend-vertical-slice.md)
- [Weekend ingestion runbook](docs/runbooks/weekend-ingestion.md)
- [Acceptance checklist](docs/product/vertical-slice-acceptance.md)
````

- [ ] **Step 5: Run final verification**

Run:

```bash
cd services/ingest && uv sync --extra dev --locked && uv run ruff check . && uv run pytest -v
cd ../.. && pnpm install --frozen-lockfile && pnpm test && pnpm build && pnpm test:e2e
git status --short
```

Expected: all checks pass; `git status --short` lists only the task-seven documentation and CI files before commit.

- [ ] **Step 6: Commit**

```bash
git add .github README.md docs/runbooks docs/product
git commit -m "ci: verify weekend vertical slice"
```

## Plan boundaries and following plans

This plan ends with a locally runnable, fully tested product slice. Two separately reviewable plans follow it:

1. **Cloudflare deployment:** create preview and production Workers, D1 databases, R2 buckets, bindings, migrations, secrets, custom domain, and rollback runbook.
2. **FastF1 enrichment:** cache and process post-session timing, tyre, weather, position, and car telemetry into versioned R2 assets and comparison views.

These boundaries keep upstream ingestion, product validation, infrastructure provisioning, and telemetry processing independently reversible.
