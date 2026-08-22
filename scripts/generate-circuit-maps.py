# /// script
# requires-python = ">=3.12"
# dependencies = ["fastf1>=3.5", "numpy", "pandas"]
# ///
"""生成注解赛道图 JSON（遥测中心线 + 弯角 + sector 分段 + DRS 激活点）。

数据源为 fastf1（官方计时 + MultiViewer 人工策展弯角坐标），离线跑、
结果入库 apps/web/src/data/circuit-maps.json；访客请求不碰上游。
无遥测的历史赛道不生成，前端回落 f1db 轮廓 SVG。

用法: uv run scripts/generate-circuit-maps.py [f1db.db 路径] [layout_id ...]
不带参数时下载 f1db 官方 SQLite release（与 f1db-d1-dump.sh 同源）；
带 layout_id 时只生成指定布局（已有的不跳过，便于重跑单站）。
"""

import json
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.request import urlretrieve

import numpy as np
import pandas as pd

import fastf1

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps/web/src/data/circuit-maps.json"
VIEW = 500.0
PAD = 30.0

# DRS channel >= 8 视为激活（8/10/12/14），<8 为关闭
DRS_ACTIVE = 8


def fetch_db() -> Path:
    work = Path(tempfile.mkdtemp())
    zip_path = work / "f1db-sqlite.zip"
    urlretrieve(
        "https://github.com/f1db/f1db/releases/latest/download/f1db-sqlite.zip",
        zip_path,
    )
    with zipfile.ZipFile(zip_path) as archive:
        archive.extract("f1db.db", work)
    return work / "f1db.db"


def transform(points_xy: np.ndarray, corners_xy: np.ndarray, rotation: float):
    """遥测坐标 → 500×500 屏幕坐标：按官方图方向旋转、Y 翻转、等比缩放居中。"""
    angle = np.radians(rotation)
    rot = np.array([[np.cos(angle), np.sin(angle)], [-np.sin(angle), np.cos(angle)]])
    all_xy = np.vstack([points_xy, corners_xy]) @ rot
    all_xy[:, 1] *= -1
    lo = all_xy.min(axis=0)
    hi = all_xy.max(axis=0)
    scale = (VIEW - 2 * PAD) / max(hi[0] - lo[0], hi[1] - lo[1])
    offset = (VIEW - (hi - lo) * scale) / 2

    def apply(xy: np.ndarray) -> np.ndarray:
        mapped = xy @ rot
        mapped[:, 1] *= -1
        return (mapped - lo) * scale + offset

    return apply


def round_pt(pt) -> list[float]:
    return [round(float(pt[0]), 1), round(float(pt[1]), 1)]


def build_map(year: int, round_no: int, circuit_id: str, layout_id: str):
    fastf1.set_log_level("WARNING")
    session = fastf1.get_session(year, round_no, "R")
    session.load()
    info = session.get_circuit_info()
    if info is None:
        return None

    lap = session.laps.pick_fastest()
    pos = lap.get_pos_data()
    corners = info.corners
    to_xy = lambda df: df[["X", "Y"]].to_numpy()
    apply = transform(to_xy(pos), to_xy(corners), info.rotation)

    # sector 分界：遥测 Time 相对单圈起点，用累计 sector 时长定位采样点
    s1 = lap["Sector1Time"]
    s2 = lap["Sector2Time"]
    marks = [s1, s1 + s2]
    bounds = []
    for value in marks:
        if pd.isna(value):
            continue
        idx = (pos["Time"] - value).abs().idxmin()
        bounds.append(pos.index.get_loc(idx))
    if len(bounds) != 2:
        return None

    mapped = apply(to_xy(pos))
    sectors = []
    for start, end in ((0, bounds[0]), (bounds[0], bounds[1]), (bounds[1], len(pos) - 1)):
        # 分段含共享边界点，保证视觉上连续
        sectors.append([round_pt(p) for p in mapped[start : end + 1]])

    corner_pts = apply(to_xy(corners))
    corner_marks = [
        {
            "x": round(float(p[0]), 1),
            "y": round(float(p[1]), 1),
            "n": int(row.Number),
            "letter": row.Letter if isinstance(row.Letter, str) else "",
        }
        for row, p in zip(corners.itertuples(), corner_pts)
    ]

    # DRS 激活点：channel 由关到开的跳变
    tel = lap.get_telemetry()
    drs = tel[["Time", "X", "Y", "DRS"]].dropna()
    active = (drs["DRS"] >= DRS_ACTIVE).to_numpy()
    drs_pts = []
    for i in range(1, len(active)):
        if active[i] and not active[i - 1]:
            row = drs.iloc[i]
            p = apply(np.array([[row.X, row.Y]]))[0]
            drs_pts.append(round_pt(p))

    return {
        "circuitId": circuit_id,
        "source": f"{year} R{round_no}",
        "sectors": sectors,
        "corners": corner_marks,
        "drs": drs_pts,
    }


def main():
    args = [arg for arg in sys.argv[1:] if arg.endswith(".db")]
    only = [arg for arg in sys.argv[1:] if not arg.endswith(".db")]
    db = Path(args[0]) if args else fetch_db()
    con = sqlite3.connect(db)
    races = con.execute(
        """
        SELECT year, round, circuit_id, circuit_layout_id
        FROM race
        WHERE year = (SELECT MAX(year) FROM race)
        ORDER BY round
        """,
    ).fetchall()

    existing = json.loads(OUT.read_text()) if OUT.exists() else {}
    for year, round_no, circuit_id, layout_id in races:
        if only and layout_id not in only:
            continue
        if not only and layout_id in existing:
            continue
        print(f"generating {layout_id} ({year} R{round_no})")
        try:
            result = build_map(year, int(round_no), circuit_id, layout_id)
        except Exception as exc:  # 单站失败不阻断整批
            print(f"  skipped: {exc}")
            continue
        if result is None:
            print("  skipped: no circuit info")
            continue
        existing[layout_id] = result

    OUT.write_text(json.dumps(existing, separators=(",", ":")) + "\n")
    print(f"wrote {len(existing)} maps to {OUT}")


if __name__ == "__main__":
    main()
