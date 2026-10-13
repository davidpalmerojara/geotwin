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
