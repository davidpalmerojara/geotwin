"""Writes the SYNTHETIC test point clouds used by the worker tests.

These are not real measurements. They imitate the shape of a PNOA-LiDAR tile (ETRS89 / UTM 30N,
EPSG:25830, orthometric heights, RGB, ASPRS classes) over a 120 x 120 m patch near Laguna de Duero
(Valladolid), so tests can run a real conversion in a second. The header says SYNTHETIC too.

Usage:
  python make_synthetic_fixtures.py <output folder>
      the two small test fixtures (5,540 points, committed in apps/worker/tests/fixtures)
  python make_synthetic_fixtures.py <output folder> --points 12000000 --size 1000
      a tile-sized SYNTHETIC LAZ for benchmarks (1 x 1 km, ~5 pts/m2 like PNOA cob3; ~60 MB)
"""

import argparse
from pathlib import Path

import laspy
import numpy as np
from pyproj import CRS

CENTRE_X, CENTRE_Y, GROUND_Z = 356_700.0, 4_604_900.0, 700.0
HALF = 60.0
# ASPRS classes: 2 ground, 5 high vegetation, 6 building, 9 water.
COLOURS = {2: (150, 125, 90), 5: (60, 120, 50), 6: (190, 80, 60), 9: (50, 90, 160)}


def build(seed: int = 25830) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(seed)
    parts = []

    def add(x, y, z, cls):
        parts.append((x, y, z, np.full(x.shape, cls, dtype=np.uint8)))

    # Gently rolling ground with a shallow pond (the "laguna") in one corner.
    x = rng.uniform(-HALF, HALF, 3200)
    y = rng.uniform(-HALF, HALF, 3200)
    pond = (x + 30) ** 2 + (y + 30) ** 2 < 18**2
    z = GROUND_Z + 0.8 * np.sin(x / 25) + 0.5 * np.cos(y / 30)
    add(x[~pond], y[~pond], z[~pond], 2)
    add(x[pond], y[pond], np.full(pond.sum(), GROUND_Z - 1.5), 9)
    # Two flat-roofed buildings (roof and walls).
    for bx, by, w, d, h in ((20, 15, 18, 12, 7.5), (-10, 35, 10, 10, 10.0)):
        n = 500
        rx = rng.uniform(bx - w / 2, bx + w / 2, n)
        ry = rng.uniform(by - d / 2, by + d / 2, n)
        add(rx, ry, np.full(n, GROUND_Z + h) + rng.normal(0, 0.03, n), 6)
        wall = rng.uniform(0, 2 * (w + d), n // 2)
        wx = np.where(wall < w, bx - w / 2 + wall, np.where(wall < w + d, bx + w / 2, bx - w / 2))
        wy = np.where(wall < w, by - d / 2, by - d / 2 + np.clip(wall - w, 0, d))
        add(wx, wy, GROUND_Z + rng.uniform(0, h, n // 2), 6)
    # A row of trees (round crowns).
    for tx in np.linspace(-45, 45, 7):
        n = 120
        r = rng.uniform(0, 3.5, n)
        a = rng.uniform(0, 2 * np.pi, n)
        add(tx + r * np.cos(a), -45 + r * np.sin(a), GROUND_Z + 6 + rng.uniform(-2.5, 2.5, n), 5)

    xs, ys, zs, cls = (np.concatenate(v) for v in zip(*parts))
    return {"x": xs + CENTRE_X, "y": ys + CENTRE_Y, "z": zs, "classification": cls}


def build_large(count: int, size: float, seed: int = 4258) -> dict[str, np.ndarray]:
    """A big synthetic tile: rolling ground, scattered trees and flat-roofed blocks."""
    rng = np.random.default_rng(seed)
    half = size / 2
    x = rng.uniform(-half, half, count)
    y = rng.uniform(-half, half, count)
    z = GROUND_Z + 4 * np.sin(x / 150) + 3 * np.cos(y / 110)
    cls = np.full(count, 2, dtype=np.uint8)
    # Blocks on a 60 m grid (25 x 18 m footprints) and trees in a 37 m lattice of crowns.
    bx, by = np.mod(x, 60) - 30, np.mod(y, 60) - 30
    in_block = (np.abs(bx) < 12.5) & (np.abs(by) < 9)
    block = in_block & (np.mod(np.floor(x / 60) + np.floor(y / 60), 3) == 0)
    z[block] += 9 + rng.normal(0, 0.05, block.sum())
    cls[block] = 6
    tx, ty = np.mod(x, 37) - 18.5, np.mod(y, 37) - 18.5
    crown = ~block & (tx**2 + ty**2 < 16)
    z[crown] += 4 + rng.uniform(0, 6, crown.sum())
    cls[crown] = 5
    pond = (x + half / 2) ** 2 + (y + half / 2) ** 2 < 60**2
    z[pond] = GROUND_Z - 2
    cls[pond] = 9
    return {"x": x + CENTRE_X, "y": y + CENTRE_Y, "z": z, "classification": cls}


def write(points: dict[str, np.ndarray], path: Path) -> None:
    header = laspy.LasHeader(point_format=7, version="1.4")
    header.scales = np.array([0.01, 0.01, 0.01])
    header.offsets = np.array([356_000.0, 4_604_000.0, 0.0])
    header.system_identifier = "SYNTHETIC GEOTWIN"
    header.generating_software = "geotwin synthetic fixture"
    # Same shape as a PNOA tile: ETRS89 / UTM 30N + Alicante (REDNAP) orthometric heights.
    header.add_crs(CRS("EPSG:25830+5782"))
    las = laspy.LasData(header)
    las.x, las.y, las.z = points["x"], points["y"], points["z"]
    las.classification = points["classification"]
    palette = np.zeros((256, 3), dtype=np.uint16)
    for cls, colour in COLOURS.items():
        palette[cls] = colour
    rgb = palette[points["classification"]] * 256
    las.red, las.green, las.blue = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    las.gps_time = np.arange(len(points["x"]), dtype=np.float64)
    las.write(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path, nargs="?", default=Path("."))
    parser.add_argument("--points", type=int, help="write one big LAZ with this many points")
    parser.add_argument("--size", type=float, default=1000.0, help="tile side in metres")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.points:
        target = args.out / f"synthetic-laguna-duero-{args.points // 1_000_000}M.laz"
        write(build_large(args.points, args.size), target)
        print(f"{args.points} synthetic points written to {target}")
        return
    points = build()
    for suffix in ("las", "laz"):
        write(points, args.out / f"synthetic-laguna-duero.{suffix}")
    print(f"{len(points['x'])} synthetic points written to {args.out}")


if __name__ == "__main__":
    main()
