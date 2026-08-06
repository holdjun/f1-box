# 数据地基实施计划

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: 把展示元数据建成结构化数据库：ingest 从 f1db/Fast-F1/jolpica 合并生成 directory 与 global 产物，发布到 R2；contracts 提供类型与边界解析；最后回填 2024/2025 验证"加一年=自动适配"。

Architecture: f1db release zip（CC-BY-4.0）为元数据主源，Fast-F1 constants.json 提供按赛季车队色，jolpica 提供当季保鲜与校正；产物键 v1/seasons/{year}/directory.json 与 v1/global/*.json；manifest 与 SeasonPayload 不动。

Tech Stack: Python ingest（uv/pytest/ruff/httpx）、packages/contracts（TS 手写边界解析器）、R2（wrangler --remote 验证）。

## Global Constraints

- 分支 feat/data-foundation（已从 origin/main 切出）；不直推 main；PR 由用户合并。
- TDD：先失败测试再实现；提交前 uv run --project services/ingest pytest -q 与 ruff check；contracts 改动加 pnpm check/test。
- Commit：Conventional Commits 英文 ≤72 字符 + 末尾 Co-Authored-By: Claude <noreply@anthropic.com>；git add 具体文件。
- 上游只在 ingest 访问；下载物缓存 .data/raw（gitignore）。
- 每个产物带 sources 署名：f1db (CC-BY-4.0)、Fast-F1 (MIT)、Jolpica (CC-BY-NC-SA-4.0)。
- f1db 表字段以 year 为赛季键；id 为连字符形态；jolpica circuitId 下划线形态，join 时归一化（_→-）。
- 契约依据 docs/data-contracts.md 与 docs/superpowers/specs/2026-08-06-data-foundation-design.md；产物 schema 与契约文档逐字段一致。

---

### Task 1: contracts 新产物类型与解析器

Files:

- Create: packages/contracts/src/directory.ts、packages/contracts/src/global.ts
- Create: packages/contracts/tests/directory.test.ts、packages/contracts/tests/global.test.ts

- [ ] Step 1: 写失败测试

directory.test.ts 与 global.test.ts 各含：合法最小样本解析返回同对象；缺字段/错类型抛 TypeError 且消息含路径。样本 shape 与 docs/data-contracts.md 完全一致（schemaVersion: 1）。

- [ ] Step 2: 运行确认失败

Run: pnpm --filter @f1-box/contracts test
Expected: FAIL（模块不存在）

- [ ] Step 3: 实现

directory.ts：

```ts
export interface DirectorySource { name: string; url: string; license?: string }
export interface TeamEntry {
  id: string;
  name: string;
  fullName: string | null;
  countryId: string | null;
  color: string | null;
  logoKey: string | null;
}
export interface DriverEntry {
  id: string;
  code: string;
  name: string;
  firstName: string;
  lastName: string;
  number: number | null;
  countryId: string | null;
  dateOfBirth: string | null;
  wikipediaUrl: string | null;
}
export interface EntrantEntry {
  constructorId: string;
  name: string;
  drivers: { driverId: string; rounds: string | null; testDriver: boolean }[];
}
export interface SeasonDirectory {
  schemaVersion: 1;
  season: number;
  generatedAt: string;
  sources: DirectorySource[];
  teams: TeamEntry[];
  drivers: DriverEntry[];
  entrants: EntrantEntry[];
}
export function parseSeasonDirectory(value: unknown): SeasonDirectory { ... }
```

global.ts：Country / Circuit / DriverCareer / ConstructorCareer / CareerData 接口（字段同契约文档）+ parseCountries / parseCircuits / parseCareer。解析风格仿 season-index.ts：逐字段 typeof 检查，失败抛 TypeError(`/path: message`)。

- [ ] Step 4: 运行验证

Run: pnpm --filter @f1-box/contracts check && pnpm --filter @f1-box/contracts test
Expected: PASS

- [ ] Step 5: 提交

git commit -m "feat: add contracts types for directory and global data artifacts"

---

### Task 2: ingest f1db 客户端

Files:

- Create: services/ingest/src/f1box_ingest/f1db.py
- Test: services/ingest/tests/test_f1db.py

- [ ] Step 1: 写失败测试

test_f1db.py：用 zipfile 在 tmp_path 构造迷你 zip（含 f1db-drivers.json 两条、f1db-seasons-entrants-drivers.json 两条、f1db-countries.json 一条），F1dbClient(zip_path=...) 直接读本地 zip（测试不联网）：drivers()/countries() 返回列表；entrant_drivers(2026) 按 year 过滤；driver_standings(2026) 按 year 过滤；缺表抛 F1dbError。

- [ ] Step 2: 运行确认失败

Run: uv run --project services/ingest pytest tests/test_f1db.py -q
Expected: FAIL

- [ ] Step 3: 实现 f1db.py

```python
"""Read-only client for f1db release artifacts (CC-BY-4.0)."""

import json
import zipfile
from pathlib import Path

import httpx

RELEASE_URL = "https://github.com/f1db/f1db/releases/latest/download/f1db-json-splitted.zip"


class F1dbError(ValueError):
    """Raised when the f1db release artifact is unusable."""


class F1dbClient:
    """Reads f1db tables from a local zip, downloading+caching it when absent."""

    def __init__(self, zip_path: Path, max_age_days: int = 7) -> None:
        self._zip_path = zip_path
        self._max_age_days = max_age_days
        self._zip: zipfile.ZipFile | None = None

    def ensure_downloaded(self) -> None:
        import time
        if self._zip_path.exists() and (time.time() - self._zip_path.stat().st_mtime) < self._max_age_days * 86400:
            return
        self._zip_path.parent.mkdir(parents=True, exist_ok=True)
        with httpx.Client(follow_redirects=True, timeout=60.0, headers={"User-Agent": "f1-box-ingest/0.1"}) as client:
            response = client.get(RELEASE_URL)
            response.raise_for_status()
        self._zip_path.write_bytes(response.content)

    def _table(self, name: str) -> list[dict[str, object]]:
        if self._zip is None:
            if not self._zip_path.exists():
                raise F1dbError(f"f1db zip missing: {self._zip_path}")
            self._zip = zipfile.ZipFile(self._zip_path)
        entry = f"f1db-{name}.json"
        try:
            value = json.loads(self._zip.read(entry))
        except KeyError as error:
            raise F1dbError(f"f1db zip lacks {entry}") from error
        if not isinstance(value, list):
            raise F1dbError(f"{entry} must be a JSON array")
        return value

    def drivers(self) -> list[dict[str, object]]: return self._table("drivers")
    def countries(self) -> list[dict[str, object]]: return self._table("countries")
    def circuits(self) -> list[dict[str, object]]: return self._table("circuits")
    def constructors(self) -> list[dict[str, object]]: return self._table("constructors")
    def chronology(self) -> list[dict[str, object]]: return self._table("constructors-chronology")
    def entrant_drivers(self, year: int) -> list[dict[str, object]]:
        return [r for r in self._table("seasons-entrants-drivers") if r.get("year") == year]
    def driver_standings(self, year: int) -> list[dict[str, object]]:
        return [r for r in self._table("seasons-driver-standings") if r.get("year") == year]
```

（ensure_downloaded 的 time 导入放顶部；zip 缓存按 mtime 过期。）

- [ ] Step 4: 运行验证

Run: uv run --project services/ingest pytest tests/test_f1db.py -q && uv run --project services/ingest ruff check
Expected: PASS

- [ ] Step 5: 提交

git commit -m "feat: add f1db release client with local caching"

---

### Task 3: ingest 车队颜色客户端与别名表

Files:

- Create: services/ingest/src/f1box_ingest/colors.py
- Create: services/ingest/data/team-color-slugs.json
- Test: services/ingest/tests/test_colors.py

- [ ] Step 1: 写别名表

services/ingest/data/team-color-slugs.json（Fast-F1 slug → f1db constructor id，2018–2026 全量 20 条）：

```json
{
  "alfa romeo": "alfa-romeo",
  "alphatauri": "alphatauri",
  "alpine": "alpine",
  "aston martin": "aston-martin",
  "audi": "audi",
  "cadillac": "cadillac",
  "ferrari": "ferrari",
  "force india": "force-india",
  "haas": "haas",
  "kick sauber": "kick-sauber",
  "mclaren": "mclaren",
  "mercedes": "mercedes",
  "racing bulls": "racing-bulls",
  "racing point": "racing-point",
  "rb": "rb",
  "red bull": "red-bull",
  "renault": "renault",
  "sauber": "sauber",
  "toro rosso": "toro-rosso",
  "williams": "williams"
}
```

- [ ] Step 2: 写失败测试

test_colors.py：内联 constants 样本（{"2026": {"teams": {"red bull": {"short_name": "Red Bull", "colors": {"official": "#3671c6"}}}}}），TeamColorSource.from_constants(data) 后 color_for("2026", "red-bull") == "#3671c6"；未知 slug/id 返回 None；别名表所有 value 形如 kebab-case（防手写错）。

- [ ] Step 3: 实现 colors.py

```python
"""Per-season team colors from Fast-F1 plotting constants (MIT)."""

import json
from pathlib import Path

import httpx

CONSTANTS_URL = "https://raw.githubusercontent.com/theOehrly/Fast-F1/main/fastf1/plotting/constants.json"
ALIAS_PATH = Path(__file__).resolve().parent.parent / "data" / "team-color-slugs.json"


class TeamColorSource:
    def __init__(self, constants: dict[str, object], aliases: dict[str, str]) -> None:
        self._constants = constants
        self._aliases = aliases

    @classmethod
    def from_constants(cls, constants: dict[str, object]) -> "TeamColorSource":
        aliases = json.loads(ALIAS_PATH.read_text())
        return cls(constants, aliases)

    @staticmethod
    def fetch(raw_dir: Path, max_age_days: int = 7) -> dict[str, object]:
        import time
        path = raw_dir / "f1db" / "fastf1-constants.json"
        if path.exists() and (time.time() - path.stat().st_mtime) < max_age_days * 86400:
            return json.loads(path.read_text())
        path.parent.mkdir(parents=True, exist_ok=True)
        with httpx.Client(timeout=30.0, headers={"User-Agent": "f1-box-ingest/0.1"}) as client:
            response = client.get(CONSTANTS_URL)
            response.raise_for_status()
        path.write_text(response.text)
        return json.loads(response.text)

    def color_for(self, season: int, constructor_id: str) -> str | None:
        year = self._constants.get(str(season))
        if not isinstance(year, dict):
            return None
        teams = year.get("teams")
        if not isinstance(teams, dict):
            return None
        for slug, constructor in self._aliases.items():
            if constructor != constructor_id:
                continue
            entry = teams.get(slug)
            if not isinstance(entry, dict):
                return None
            colors = entry.get("colors")
            if not isinstance(colors, dict):
                return None
            official = colors.get("official")
            return official if isinstance(official, str) else None
        return None
```

- [ ] Step 4: 运行验证并提交

git commit -m "feat: add per-season team color source from fast-f1 constants"

---

### Task 4: directory 构建器

Files:

- Create: services/ingest/src/f1box_ingest/directory.py
- Test: services/ingest/tests/test_directory.py

- [ ] Step 1: 写失败测试

合成 fixture：f1db drivers 两条（george-russell/antonelli，含 abbreviation/permanentNumber/nationalityCountryId/dateOfBirth）、constructors 一条 mercedes、entrant_drivers 2026 两条（roundsText "1-11"、testDriver false）、colors color_for→"#27f4d2"、jolpica payload 最小 dict（driverStandings 含 RUS + 一名 f1db 没有的替补 NEW；raceClassification 行 constructorName "Mercedes"）。断言：

- teams 含 mercedes，color 为 "#27f4d2"，name 为 jolpica 的 "Mercedes"。
- drivers 含 russell（number 63、countryId united-kingdom）与兜底 NEW（identity 回退 jolpica 字段，countryId null）。
- entrants 一条 mercedes，drivers rounds 为 "1-11"。
- sources 含 f1db 与 Fast-F1 署名。

- [ ] Step 2: 运行确认失败

- [ ] Step 3: 实现 directory.py

```python
"""Build the per-season display directory from f1db, colors and jolpica."""

from typing import cast

from f1box_ingest.colors import TeamColorSource
from f1box_ingest.f1db import F1dbClient

SOURCES = [
    {"name": "f1db", "url": "https://github.com/f1db/f1db", "license": "CC-BY-4.0"},
    {"name": "Fast-F1", "url": "https://github.com/theOehrly/Fast-F1", "license": "MIT"},
]


def _str(record: dict[str, object], key: str) -> str | None:
    value = record.get(key)
    return value if isinstance(value, str) and value else None


def _int(record: dict[str, object], key: str) -> int | None:
    value = record.get(key)
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def build_directory(
    season: int,
    f1db: F1dbClient,
    colors: TeamColorSource,
    generated_at: str,
    jolpica_payload: dict[str, object] | None = None,
) -> dict[str, object]:
    entrant_rows = [r for r in f1db.entrant_drivers(season) if not r.get("testDriver")]
    constructor_ids = sorted({cast(str, r["constructorId"]) for r in entrant_rows})
    constructors = {cast(str, c["id"]): c for c in f1db.constructors()}
    drivers_by_id = {cast(str, d["id"]): d for d in f1db.drivers()}

    jolpica_team_name: dict[str, str] = {}
    jolpica_drivers: list[dict[str, object]] = []
    if jolpica_payload is not None:
        standings = cast(list[dict[str, object]], jolpica_payload.get("driverStandings", []))
        jolpica_drivers = standings
        code_to_constructor = {
            cast(str, r["driverId"]): cast(str, r["constructorId"]) for r in entrant_rows
        }
        # jolpica code -> team name from race rows; constructorId -> display name via f1db code join
        ...
```

（实现要点，非逐字：
- teams：constructor_ids 逐个生成 {id, name, fullName, countryId, color: colors.color_for(season, id), logoKey: id}；name 优先 jolpica 显示名（经 code↔abbreviation join：对 entrant_rows 的每个 driverId 取其 f1db abbreviation，与 jolpica standings/race rows 的 code 对齐，得到 constructorId→constructorName 多数票）；无 payload 或 join 不到回退 f1db name。
- drivers：entrants 引用的 f1db drivers 全量生成 DriverEntry（number=_int(permanentNumber)）；jolpica standings 中 abbreviation/code 不在 f1db 集合者，兜底生成 {id: slugify(name), code, name, firstName/lastName 拆名, number: jolpica number, countryId: null, dateOfBirth: null, wikipediaUrl: jolpica wikipediaUrl}。
- entrants：按 constructorId 分组，drivers [{driverId, rounds: roundsText, testDriver: false}]。
- 顶层 {schemaVersion: 1, season, generatedAt, sources: SOURCES + (jolpica 署名当 payload 提供时), teams, drivers, entrants}。）

- [ ] Step 4: 运行验证

Run: uv run --project services/ingest pytest tests/test_directory.py -q && ruff check
Expected: PASS

- [ ] Step 5: 提交

git commit -m "feat: build per-season directory from f1db with jolpica fallback"

---

### Task 5: global 构建器（countries/circuits/career）

Files:

- Create: services/ingest/src/f1box_ingest/globaldata.py
- Test: services/ingest/tests/test_globaldata.py

- [ ] Step 1: 写失败测试

- countries：样本两条 → 输出字段 id/alpha2Code/alpha3Code/iocCode/name/demonym。
- circuits：样本 adelaide（length 3.78、turns 16、totalRacesHeld 11）→ lengthMetres 3780、svgKey null。
- career：f1db driver_standings 2024 russell {positionNumber 2, points 120} + entrant_drivers 2024 mercedes + jolpica 2026 standings（RUS position 3 points 160）→ drivers[russell].totals 取自 f1db drivers 表 total* 字段；seasons 含 2024（constructorId mercedes）与 2026（jolpica 回退行）；constructors 含 chronology 按 parentConstructorId 分组。

- [ ] Step 2: 运行确认失败

- [ ] Step 3: 实现 globaldata.py

三个纯函数 build_countries(f1db) / build_circuits(f1db) / build_career(f1db, active_season_jolpica: dict[int, dict] | None)，字段映射：

- lengthMetres = round(length * 1000) 当 length 为 number。
- career drivers totals：totalRaceEntries→grandsPrix、totalRaceWins→wins、totalPodiums→podiums、totalPolePositions→poles、totalFastestLaps→fastestLaps、totalPoints→points、totalChampionshipWins→championships、bestChampionshipPosition。
- seasons 行：f1db driver_standings 逐年（position=positionNumber、points），constructorId 用同年 entrant_drivers 的 driverId→constructorId（多队则多行）；活跃赛季 jolpica 补充（position/points 来自 standings，constructorId 经 abbreviation join，join 不到 null）。
- constructors：totals 同名字段；chronology = 按 parentConstructorId 聚合 [{constructorId, yearFrom, yearTo}]。
- 每个产物带 schemaVersion 1、generatedAt、sources 署名。

- [ ] Step 4: 运行验证并分两次提交

git commit -m "feat: build countries and circuits global artifacts from f1db"
git commit -m "feat: build career aggregates from f1db with jolpica active season"

---

### Task 6: release/CLI 集成与本地端到端

Files:

- Modify: services/ingest/src/f1box_ingest/release.py、cli.py
- Test: services/ingest/tests/test_cli.py 增补

- [ ] Step 1: 写失败测试

test_cli：monkeypatch F1dbClient/TeamColorSource/jolpica 为本地 fixture，跑 season 子命令 → 输出目录含 v1/seasons/2026/directory.json（可被 contracts parseSeasonDirectory 解析——python 侧用 jsonschema? 仅断言关键字段）与 payload/manifest；global 子命令 → v1/global/{countries,circuits,career}.json。

- [ ] Step 2: 运行确认失败

- [ ] Step 3: 实现

release.py 增：

```python
def write_artifact(path: Path, value: dict[str, object]) -> None:
    _write_bytes_atomic(path, _encode_json(value))
```

cli.py：season 子命令在写完 release 后构建 directory（f1db.ensure_downloaded + TeamColorSource.fetch + 当季 payload）写 v1/seasons/{season}/directory.json；新增 global 子命令（--output，可选 --with-jolpica 2026 用于 career 活跃季）写三个 global 产物。网络客户端构造与 JolpicaClient 同 raw_dir。

- [ ] Step 4: 全量验证

Run: uv run --project services/ingest pytest -q && uv run --project services/ingest ruff check && pnpm check && pnpm test
Expected: PASS

- [ ] Step 5: 提交

git commit -m "feat: emit directory and global artifacts from ingest cli"

---

### Task 7: 回填 2024/2025/2026 并发布验证

Files: 无新增（操作任务）

- [ ] Step 1: 本地构建三年

uv run --project services/ingest f1box-ingest season --season 2024 --output .data/release
同 2025、2026；再 uv run --project services/ingest f1box-ingest global --output .data/release

- [ ] Step 2: 抽查产物

python 校验 .data/release/v1/seasons/2024/directory.json：teams 含 red-bull 且 color 非 null；drivers 数 ≥ 20；career.json drivers ≥ 800。

- [ ] Step 3: 发布到 R2

用 wrangler r2 object put --remote 逐键上传 .data/release/v1 下新产物（payload/manifest 走现有 release 流程或同法上传）；注意 --remote 必须。

- [ ] Step 4: 验证线上

wrangler r2 object list 或 get 抽查；curl https://f1-box.com/2024/racing 与 /2025/racing 期望 200（现有前端通用渲染，年份自动出现）。

- [ ] Step 5: 记录

把发布命令与验证输出追加到 docs/data-contracts.md 末尾"运维"小节（回填=重跑 season+global 并发布）。提交：git commit -m "docs: record backfill and publish runbook"
