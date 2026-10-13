"""Tests for geotwin_lidar.py against the SYNTHETIC fixtures (real laspy, pyproj, py3dtiles)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import laspy
import numpy as np
import pytest
from pyproj import Transformer

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import geotwin_lidar as tool  # noqa: E402

FIXTURES = HERE.parent.parent / "tests" / "fixtures"
GRID_DIR = os.environ.get("GEOID_GRID_DIR")
HAS_GRID = bool(GRID_DIR) and (Path(GRID_DIR) / tool.GRID_FILE).is_file()


@pytest.fixture(params=["las", "laz"])
def fixture(request, tmp_path) -> Path:
    # Work on a copy: conversion edits the header in place.
    target = tmp_path / f"source.{request.param}"
    shutil.copy(FIXTURES / f"synthetic-laguna-duero.{request.param}", target)
    return target


def leaf_points(out: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """ECEF positions, RGB and classification of every source point.

    py3dtiles writes each point once in an ADD-refined tile; the REPLACE tiles near the root are
    subsampled previews that repeat some of them.
    """
    from py3dtiles.tileset.content import read_binary_tile_content

    tileset = json.loads((out / "tileset.json").read_text())

    def walk(tile, matrix):
        local = np.array(tile.get("transform", np.identity(4).ravel()), dtype=float)
        matrix = matrix @ local.reshape(4, 4).T
        if "content" in tile and tile.get("refine") == "ADD":
            yield tile["content"]["uri"], matrix
        for child in tile.get("children", []):
            yield from walk(child, matrix)

    positions, colours, classes = [], [], []
    for uri, matrix in walk(tileset["root"], np.identity(4)):
        content = read_binary_tile_content(out / uri)
        table = content.body.feature_table
        n = table.nb_points()
        local = np.array([table.get_feature_position_at(i) for i in range(n)], dtype=float)
        positions.append((np.c_[local, np.ones(n)] @ matrix.T)[:, :3])
        colours.append(np.array([table.get_feature_color_at(i) for i in range(n)]))
        classes.append(content.body.batch_table.get_binary_property("classification"))
    return np.vstack(positions), np.vstack(colours), np.concatenate(classes)


def ellipsoidal_heights(ecef: np.ndarray) -> np.ndarray:
    to_geodetic = Transformer.from_crs("EPSG:4978", "EPSG:4979", always_xy=True)
    return np.asarray(to_geodetic.transform(ecef[:, 0], ecef[:, 1], ecef[:, 2])[2])


def test_inspect_reads_the_synthetic_tile(fixture):
    info = tool.inspect(fixture, "EPSG:25830", None)
    assert info["point_count"] == 5540
    assert info["point_format"] == 7
    assert info["crs_in"] == "EPSG:25830" and info["crs_source"] == "file"
    assert info["classes"] == {"2": 2953, "5": 840, "6": 1500, "9": 247}
    assert info["height_range"] == pytest.approx([698.5, 710.09], abs=0.005)
    assert info["center"]["lat"] == pytest.approx(41.58295, abs=1e-4)
    assert info["center"]["lng"] == pytest.approx(-4.71910, abs=1e-4)
    west, south, east, north = info["bbox"]
    assert west < info["center"]["lng"] < east and south < info["center"]["lat"] < north
    assert info["grid_offset_m"] is None
    assert info["system_identifier"] == "SYNTHETIC GEOTWIN"


def test_inspect_uses_the_requested_crs_when_the_file_has_none(tmp_path):
    las = laspy.read(FIXTURES / "synthetic-laguna-duero.las")
    las.header.vlrs.clear()
    las.header.global_encoding.wkt = False
    plain = tmp_path / "nocrs.las"
    las.write(plain)
    info = tool.inspect(plain, "EPSG:25830", None)
    assert info["crs_source"] == "request" and info["crs_in"] == "EPSG:25830"


def test_truncated_file_fails_with_a_readable_message(tmp_path):
    data = (FIXTURES / "synthetic-laguna-duero.laz").read_bytes()
    broken = tmp_path / "broken.laz"
    broken.write_bytes(data[: len(data) // 2])
    with pytest.raises(tool.InputError) as error:
        tool.inspect(broken, "EPSG:25830", None)
    assert error.value.code in {"CORRUPT", "TRUNCATED"}
    assert "dañado" in str(error.value) or "incompleto" in str(error.value)


def test_not_a_las_file_is_a_permanent_error(tmp_path, capsys):
    junk = tmp_path / "junk.las"
    junk.write_bytes(b"LASF" + bytes(10))
    assert tool.main(["inspect", str(junk)]) == 2
    last = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert last["event"] == "error" and last["permanent"] is True


def test_wrong_crs_is_detected(tmp_path):
    las = laspy.read(FIXTURES / "synthetic-laguna-duero.las")
    las.header.vlrs.clear()
    las.header.global_encoding.wkt = False
    plain = tmp_path / "nocrs.las"
    las.write(plain)
    with pytest.raises(tool.InputError) as error:
        tool.inspect(plain, "EPSG:4326", None)  # UTM metres read as degrees
    assert error.value.code == "OUT_OF_RANGE"


def test_shift_heights_moves_every_point_without_rewriting_them(fixture):
    before = laspy.read(fixture)
    tool.shift_heights(fixture, 53.6)
    after = laspy.read(fixture)
    assert np.allclose(np.asarray(after.z) - np.asarray(before.z), 53.6, atol=1e-6)
    assert np.array_equal(np.asarray(after.X), np.asarray(before.X))
    assert after.header.maxs[2] == pytest.approx(before.header.maxs[2] + 53.6)


def test_convert_writes_3d_tiles_with_rgb_classes_and_ellipsoidal_heights(fixture, tmp_path):
    out = tmp_path / "tiles"
    result = tool.convert(fixture, out, "EPSG:25830", 53.6, False, None, 1, None)
    assert "tileset.json" in result["files"]
    assert any(name.endswith(".pnts") for name in result["files"])
    tileset = json.loads((out / "tileset.json").read_text())
    assert tileset["asset"]["version"] == "1.0"
    ecef, rgb, classes = leaf_points(out)
    assert len(ecef) == 5540
    heights = ellipsoidal_heights(ecef)
    # Orthometric 698.50-710.09 m plus N = 53.6 m, to the centimetre.
    assert heights.min() == pytest.approx(698.5 + 53.6, abs=0.02)
    assert heights.max() == pytest.approx(710.09 + 53.6, abs=0.02)
    assert set(np.unique(classes)) == {2, 5, 6, 9}
    assert (rgb.max(axis=0) > 0).all()


@pytest.mark.skipif(not HAS_GRID, reason="needs es_ign_egm08-rednap.tif in GEOID_GRID_DIR")
def test_exact_path_uses_the_official_grid_per_point(tmp_path):
    source = tmp_path / "source.las"
    shutil.copy(FIXTURES / "synthetic-laguna-duero.las", source)
    info = tool.inspect(source, "EPSG:25830", GRID_DIR)
    assert info["grid_offset_m"] == pytest.approx(53.106, abs=0.005)
    out = tmp_path / "tiles"
    tool.convert(source, out, "EPSG:25830", None, True, GRID_DIR, 1, None)
    heights = ellipsoidal_heights(leaf_points(out)[0])
    assert heights.min() == pytest.approx(698.5 + 53.106, abs=0.03)
    assert heights.max() == pytest.approx(710.09 + 53.106, abs=0.03)


def test_missing_grid_falls_back_cleanly(tmp_path):
    assert tool.setup_grid(None) is None
    assert tool.setup_grid(str(tmp_path)) is None  # folder without the grid file


def test_multi_chunk_laz_does_not_hang(tmp_path):
    """Regression: LAZ larger than one 50,000-point chunk hung py3dtiles' forked workers."""
    import make_synthetic_fixtures as fixtures

    source = tmp_path / "big.laz"
    fixtures.write(fixtures.build_large(120_000, 200), source)
    out = tmp_path / "tiles"
    script = Path(tool.__file__)
    done = subprocess.run(
        [sys.executable, "-I", str(script), "convert", str(source), str(out), "--z-offset", "53.6",
         "--jobs", "2"],
        capture_output=True, text=True, timeout=120,
    )
    assert done.returncode == 0, done.stdout[-500:] + done.stderr[-500:]
    assert json.loads(done.stdout.strip().splitlines()[-1])["event"] == "result"
    assert len(leaf_points(out)[0]) == 120_000


def read_dtm(out: Path) -> tuple[dict, np.ndarray]:
    meta = json.loads((out / "terrain" / "dtm.json").read_text())
    raw = np.frombuffer((out / "terrain" / meta["data"]).read_bytes(), "<u2")
    grid = raw.reshape(meta["height"], meta["width"]).astype(float)
    return meta, np.where(grid == meta["nodata"], np.nan, meta["offset"] + grid * meta["scale"])


def test_fill_gaps_keeps_measured_cells_and_bridges_holes_smoothly():
    yy, xx = np.mgrid[0:64, 0:80].astype(float)
    plane = 700 + 0.05 * xx - 0.03 * yy
    valid = np.ones(plane.shape, bool)
    valid[20:45, 30:60] = False  # a "lake" of 25 x 30 cells with no ground returns
    valid[5, 5] = False
    filled = tool.fill_gaps(np.where(valid, plane, 0.0), valid)
    assert np.array_equal(filled[valid], plane[valid])
    # A tilted plane is rebuilt inside the hole to within 25 cm.
    assert np.abs(filled[~valid] - plane[~valid]).max() < 0.25
    assert np.isfinite(filled).all()


def test_ground_grid_averages_class_2_per_cell():
    grid = tool.GroundGrid([100.0, 200.0, 0], [110.0, 210.0, 0], 2.0)
    assert (grid.nx, grid.ny, grid.x0, grid.y1) == (5, 5, 100.0, 210.0)
    grid.add(np.array([100.5, 101.5, 109.9]), np.array([209.5, 208.5, 200.1]), np.array([1.0, 3.0, 7.0]))
    heights, measured = grid.heights()
    assert heights[0, 0] == 2.0  # mean of the two points in the north-west cell
    assert heights[4, 4] == 7.0 and measured.sum() == 2


def test_convert_drops_overlap_points_and_writes_a_dtm(tmp_path):
    las = laspy.read(FIXTURES / "synthetic-laguna-duero.las")
    classes = np.asarray(las.classification).copy()
    classes[classes == 5] = 12  # pretend the vegetation were PNOA strip-overlap points
    las.classification = classes
    source = tmp_path / "overlap.las"
    las.write(source)
    out = tmp_path / "tiles"
    result = tool.convert(
        source, out, "EPSG:25830", 53.6, False, None, 1, None, exclude_classes={7, 12}, dtm_cell=2.0
    )
    assert result["points"] == 5540 - 840
    assert result["excluded"] == {"12": 840}
    ecef, _, tiled = leaf_points(out)
    assert len(ecef) == 4700 and 12 not in set(np.unique(tiled))
    assert "terrain/dtm.json" in result["files"] and result["dtm"]["ground_points"] == 2953
    meta, heights = read_dtm(out)
    assert meta["heights"] == "ellipsoidal" and meta["cell_m"] == 2.0
    # The synthetic ground is 700 m +- 1.3 m orthometric (the pond is class 9, not ground).
    inner = heights[np.isfinite(heights)]
    assert inner.min() > 698.6 + 53.6 and inner.max() < 701.4 + 53.6
    # Node next to a ground point: the DTM is that point's ellipsoidal height within ~10 cm.
    ground = classes == 2
    to_geo = Transformer.from_crs("EPSG:25830", "EPSG:4326", always_xy=True)
    lon, lat = to_geo.transform(np.asarray(las.x)[ground], np.asarray(las.y)[ground])
    col = np.round((np.asarray(lon) - meta["west"]) / (meta["east"] - meta["west"]) * (meta["width"] - 1)).astype(int)
    row = np.round((meta["north"] - np.asarray(lat)) / (meta["north"] - meta["south"]) * (meta["height"] - 1)).astype(int)
    diff = heights[row, col] - (np.asarray(las.z)[ground] + 53.6)
    assert np.nanmedian(np.abs(diff)) < 0.1
    # The source file itself is left untouched (the dropped points went to a temporary copy).
    assert laspy.read(source).header.point_count == 5540
    assert not (tmp_path / "tiles-work").exists()


def test_convert_without_ground_writes_no_dtm(tmp_path):
    las = laspy.read(FIXTURES / "synthetic-laguna-duero.las")
    las.classification = np.ones(len(las.points), np.uint8)  # all "unclassified"
    source = tmp_path / "flat.las"
    las.write(source)
    out = tmp_path / "tiles"
    result = tool.convert(source, out, "EPSG:25830", 53.6, False, None, 1, None, dtm_cell=2.0)
    assert result["dtm"] is None and result["excluded"] == {}
    assert not (out / "terrain").exists()


def test_everything_excluded_is_a_permanent_error(tmp_path):
    las = laspy.read(FIXTURES / "synthetic-laguna-duero.las")
    las.classification = np.full(len(las.points), 12, np.uint8)
    source = tmp_path / "all-overlap.las"
    las.write(source)
    with pytest.raises(tool.InputError) as error:
        tool.convert(source, tmp_path / "tiles", "EPSG:25830", 53.6, False, None, 1, None, exclude_classes={12})
    assert error.value.code == "NO_POINTS_LEFT"


@pytest.mark.skipif(not HAS_GRID, reason="needs es_ign_egm08-rednap.tif in GEOID_GRID_DIR")
def test_dtm_uses_the_official_grid_like_the_points(tmp_path):
    source = tmp_path / "source.las"
    shutil.copy(FIXTURES / "synthetic-laguna-duero.las", source)
    out = tmp_path / "tiles"
    tool.convert(source, out, "EPSG:25830", None, True, GRID_DIR, 1, None, dtm_cell=2.0)
    meta, heights = read_dtm(out)
    inner = heights[np.isfinite(heights)]
    # Same correction as the points: N = 53.106 m here.
    assert inner.min() > 698.6 + 53.08 and inner.max() < 701.4 + 53.13


def test_progress_never_goes_backwards(capsys, monkeypatch):
    clock = iter(range(0, 100))
    monkeypatch.setattr(tool.time, "monotonic", lambda: float(next(clock)))
    progress = tool.Progress("tiling")
    # What py3dtiles' counters gave on a 6 M point tile: up, down for a while, then up again.
    for fraction in (0.58, 0.59, 0.60, 0.57, 0.53, 0.47, 0.37, 0.49, 0.75, 1.0):
        progress(fraction)
    progress(0.9, force=True)
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    fractions = [line["fraction"] for line in lines]
    assert fractions == sorted(fractions)
    assert fractions[0] == 0.58 and fractions[-1] == 1.0
    assert 0.57 not in fractions and 0.37 not in fractions
