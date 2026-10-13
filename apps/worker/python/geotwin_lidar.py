"""LAS/LAZ inspection and 3D Tiles conversion for the GeoTwin worker.

The Node worker runs this script as a child process and reads one JSON object per line on stdout:
  {"event": "progress", "stage": "inspecting" | "tiling", "fraction": 0.0-1.0}
  {"event": "result", ...}                      last line on success
  {"event": "error", "code": "...", "message": "...", "permanent": true|false}

Commands:
  inspect FILE [--crs-in EPSG:25830] [--grid-dir DIR]
  convert FILE OUT_DIR [--crs-in EPSG:25830] (--z-offset N | --exact-geoid --grid-dir DIR)
                       [--jobs N] [--color-scale S] [--cache-mb MB]
                       [--exclude-classes 7,12,18] [--dtm-cell 2]

convert first drops the excluded ASPRS classes (noise, PNOA overlap points) and, with --dtm-cell,
builds a ground model (DTM) from class 2 that the viewer uses as terrain: OUT_DIR/terrain/dtm.json
(metadata) and dtm.bin (heights, ellipsoidal, on a regular longitude/latitude grid).

Exit codes: 0 ok, 2 permanent problem with the input (do not retry), 1 anything else.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import os
import shutil
import struct
import sys
import time
from pathlib import Path
from typing import Any

# Geoid grids must never be fetched from the network behind our back: the result would depend
# on connectivity. A grid is used only when it is present in --grid-dir.
os.environ.setdefault("PROJ_NETWORK", "OFF")

import numpy as np  # noqa: E402

# ASPRS: LAS header offsets of Z offset, max Z and min Z (identical in LAS 1.0 to 1.4).
Z_OFFSET_AT, MAX_Z_AT, MIN_Z_AT = 171, 211, 219
GRID_FILE = "es_ign_egm08-rednap.tif"
VERTICAL_CRS = "EPSG:5782"  # Alicante height: REDNAP orthometric heights, mainland Spain
CHUNK = 1_000_000
GROUND = 2  # ASPRS ground class: the DTM is built from these points only
DTM_NODATA = 65535


class InputError(Exception):
    """A problem with the uploaded file. Retrying cannot fix it."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def emit(event: str, **data: Any) -> None:
    print(json.dumps({"event": event, **data}, allow_nan=False), flush=True)


class Progress:
    """Throttled progress lines (at most every 0.5 s or 5 %) that never go backwards.

    py3dtiles' own counters can drop mid-run (points move between tiling processes), so a
    lower estimate keeps the last value: a progress bar that goes back reads as a fault.
    """

    def __init__(self, stage: str) -> None:
        self.stage, self.last, self.at = stage, -1.0, 0.0

    def __call__(self, fraction: float, force: bool = False) -> None:
        fraction = max(0.0, min(1.0, fraction), self.last)
        if fraction == self.last and not force:
            return
        now = time.monotonic()
        if force or fraction - self.last >= 0.05 or now - self.at >= 0.5:
            self.last, self.at = fraction, now
            emit("progress", stage=self.stage, fraction=round(fraction, 4))


def open_las(path: Path):
    import laspy

    try:
        return laspy.open(path)
    except Exception as error:  # laspy raises several types for bad headers
        raise InputError(
            "INVALID_LAS", f"La cabecera LAS no es válida: {error}"
        ) from error


def horizontal_epsg(crs) -> int | None:
    """EPSG code of the horizontal part of a (possibly compound) CRS read from the file."""
    if crs is None:
        return None
    parts = crs.sub_crs_list or [crs]
    for part in parts:
        if part.is_projected or part.is_geographic:
            return part.to_epsg()
    return None


def setup_grid(grid_dir: str | None) -> Path | None:
    """Makes PROJ search `grid_dir` (child processes too). Returns the grid path if present."""
    if not grid_dir:
        return None
    grid = Path(grid_dir) / GRID_FILE
    if not grid.is_file():
        return None
    import pyproj

    # PROJ_DATA is inherited by the conversion's worker processes; keep pyproj's proj.db first.
    data_dir = pyproj.datadir.get_data_dir()
    os.environ["PROJ_DATA"] = os.pathsep.join([data_dir, str(grid.parent)])
    pyproj.datadir.set_data_dir(os.environ["PROJ_DATA"])
    return grid


def grid_undulation(epsg: int, x: float, y: float, grid: Path) -> float | None:
    """N at (x, y) through the official compound CRS, or None if PROJ would not use the grid.

    PROJ silently falls back to a 'ballpark' transformation (N = 0) when a grid is missing, so
    the value is cross-checked against a direct lookup in the grid file.
    """
    from pyproj import CRS, Transformer

    compound = Transformer.from_crs(
        CRS(f"EPSG:{epsg}+5782"), CRS("EPSG:4937"), always_xy=True
    )
    _, _, h = compound.transform(x, y, 0.0)
    lon, lat = Transformer.from_crs(
        CRS(f"EPSG:{epsg}"), CRS("EPSG:4258"), always_xy=True
    ).transform(x, y)
    direct = Transformer.from_pipeline(
        f"+proj=vgridshift +grids={grid} +multiplier=1"
    ).transform(lon, lat, 0.0)[2]
    if not (math.isfinite(h) and math.isfinite(direct)) or abs(h - direct) > 0.01:
        return None
    return float(h)


def inspect(path: Path, crs_in: str, grid_dir: str | None) -> dict[str, Any]:
    from pyproj import CRS, Transformer

    progress = Progress("inspecting")
    with open_las(path) as reader:
        header = reader.header
        count = int(header.point_count)
        if count <= 0:
            raise InputError("EMPTY", "El fichero no contiene puntos.")
        try:
            file_crs = header.parse_crs()
        except Exception:
            file_crs = None
        file_epsg = horizontal_epsg(file_crs)
        epsg = file_epsg or int(crs_in.split(":")[1])
        names = set(header.point_format.dimension_names)
        has_rgb = {"red", "green", "blue"} <= names
        # Full pass in 1M-point chunks: proves the file decodes to the end (a truncated or corrupt
        # LAZ fails here with a clear message, before tiling) and measures real ranges.
        z_min, z_max = math.inf, -math.inf
        rgb_max = 0
        classes: dict[int, int] = {}
        read = 0
        try:
            for chunk in reader.chunk_iterator(CHUNK):
                if len(chunk) == 0:
                    break
                z = np.asarray(chunk.z)
                z_min, z_max = min(z_min, float(z.min())), max(z_max, float(z.max()))
                if has_rgb:
                    rgb_max = max(
                        rgb_max,
                        int(chunk.red.max()),
                        int(chunk.green.max()),
                        int(chunk.blue.max()),
                    )
                values, counts = np.unique(
                    np.asarray(chunk.classification), return_counts=True
                )
                for value, n in zip(values.tolist(), counts.tolist()):
                    classes[int(value)] = classes.get(int(value), 0) + int(n)
                read += len(chunk)
                progress(read / count)
        except InputError:
            raise
        except Exception as error:
            raise InputError(
                "CORRUPT",
                f"El fichero está dañado o incompleto: se leyeron {read} de {count} puntos ({error}).",
            ) from error
        if read < count:
            raise InputError(
                "TRUNCATED",
                f"El fichero está incompleto: la cabecera anuncia {count} puntos y solo hay {read}.",
            )
        mins, maxs = [float(v) for v in header.mins], [float(v) for v in header.maxs]
        if not all(math.isfinite(v) for v in mins + maxs + [z_min, z_max]):
            raise InputError("INVALID_BOUNDS", "Los límites del fichero no son válidos.")
        try:
            source = CRS(f"EPSG:{epsg}")
        except Exception as error:
            raise InputError("UNKNOWN_CRS", f"CRS desconocido: EPSG:{epsg}") from error
        to_wgs84 = Transformer.from_crs(source, CRS("EPSG:4326"), always_xy=True)
        west, south, east, north = to_wgs84.transform_bounds(
            mins[0], mins[1], maxs[0], maxs[1], densify_pts=21
        )
        cx, cy = (mins[0] + maxs[0]) / 2, (mins[1] + maxs[1]) / 2
        lon, lat = to_wgs84.transform(cx, cy)
        if not (-90 <= south <= north <= 90 and -180 <= west <= east <= 180):
            raise InputError(
                "OUT_OF_RANGE",
                f"Las coordenadas no encajan con EPSG:{epsg}. ¿Es otro sistema de referencia?",
            )
        grid = setup_grid(grid_dir)
        grid_n = grid_undulation(epsg, cx, cy, grid) if grid else None
        progress(1.0, force=True)
        return {
            "version": f"{header.version.major}.{header.version.minor}",
            "point_format": int(header.point_format.id),
            "point_count": count,
            "compressed": path.suffix.lower() == ".laz"
            or bool(header.point_format.id & 0x80),
            "crs_in": f"EPSG:{epsg}",
            "crs_source": "file" if file_epsg else "request",
            "file_crs_name": file_crs.name if file_crs is not None else None,
            "has_rgb": has_rgb,
            # PNOA stores 16-bit colour; some tools write 8-bit values, which tile almost black.
            "color_scale": 256 if has_rgb and 0 < rgb_max < 256 else None,
            "classes": {str(k): v for k, v in sorted(classes.items())},
            "bounds": {"min": mins, "max": maxs},
            "height_range": [z_min, z_max],
            "bbox": [west, south, east, north],
            "center": {"lng": lon, "lat": lat},
            "center_projected": [cx, cy],
            "grid_offset_m": grid_n,
            "system_identifier": header.system_identifier,
            "generating_software": header.generating_software,
        }


def shift_heights(path: Path, offset: float) -> None:
    """Adds `offset` metres to every Z by editing the header's Z offset (and min/max Z).

    LAS stores Z = stored integer * scale + offset, so this moves all points without rewriting
    them: O(1) even for a 15 M-point LAZ, whose compressed point data never contains the offset.
    """
    with open(path, "r+b") as f:
        for at in (Z_OFFSET_AT, MAX_Z_AT, MIN_Z_AT):
            f.seek(at)
            (value,) = struct.unpack("<d", f.read(8))
            f.seek(at)
            f.write(struct.pack("<d", value + offset))


def single_threaded_laz() -> None:
    """Makes laspy decode LAZ with lazrs' single-threaded backend in this process and its forks.

    py3dtiles reads the LAZ header in the parent and then fork()s its worker processes. lazrs'
    parallel backend runs on a Rayon thread pool, which does not survive fork(): with any LAZ of
    more than one chunk (50,000 points), the workers wait forever and the conversion hangs. Each
    worker already decodes its own slice of the file, so nothing is lost.
    """
    import laspy

    if laspy.LazBackend.Lazrs.is_available():
        laspy.LazBackend.detect_available = staticmethod(lambda: (laspy.LazBackend.Lazrs,))


class ProgressTiler:
    """Factory for a py3dtiles PointTiler that reports how many points are already in tiles."""

    @staticmethod
    def create(progress=None, **kwargs: Any):
        from py3dtiles.tilers.point.point_tiler import PointTiler

        progress = progress or Progress("tiling")

        class Tiler(PointTiler):
            def process_message(self, message_type: bytes, message: list[bytes]) -> None:
                super().process_message(message_type, message)
                total = max(1, int(self.files_info["point_count"]))
                # Reading/sorting points is most of the work; writing .pnts is the rest.
                done = 0.7 * self.state.processed_points / total
                done += 0.3 * self.state.points_in_pnts / total
                progress(min(done, 0.99))

        return Tiler(**kwargs)


class Prepared:
    """What one pass over the source leaves for the conversion: the file to tile and the DTM sums."""

    def __init__(self, source: Path, kept: int, excluded: dict[int, int], dtm: "GroundGrid | None"):
        self.source, self.kept, self.excluded, self.dtm = source, kept, excluded, dtm


class GroundGrid:
    """Mean height of the ground points (ASPRS class 2) per cell of a square grid in the source CRS.

    Row 0 is the north edge. Cells are aligned to multiples of `cell` so neighbouring tiles share
    cell boundaries.
    """

    def __init__(self, mins: list[float], maxs: list[float], cell: float) -> None:
        self.cell = cell
        self.x0 = math.floor(mins[0] / cell) * cell
        self.y1 = math.ceil(maxs[1] / cell) * cell
        self.nx = max(1, math.ceil((maxs[0] - self.x0) / cell))
        self.ny = max(1, math.ceil((self.y1 - mins[1]) / cell))
        self.sums = np.zeros(self.nx * self.ny)
        self.counts = np.zeros(self.nx * self.ny, dtype=np.int64)
        self.points = 0

    def add(self, x: np.ndarray, y: np.ndarray, z: np.ndarray) -> None:
        if not len(x):
            return
        i = np.clip(((x - self.x0) / self.cell).astype(np.int64), 0, self.nx - 1)
        j = np.clip(((self.y1 - y) / self.cell).astype(np.int64), 0, self.ny - 1)
        index = j * self.nx + i
        size = self.nx * self.ny
        self.sums += np.bincount(index, weights=z, minlength=size)
        self.counts += np.bincount(index, minlength=size)
        self.points += len(x)

    def heights(self) -> tuple[np.ndarray, np.ndarray]:
        """(heights, measured): gaps (buildings, water, no returns) filled from their surroundings."""
        counts = self.counts.reshape(self.ny, self.nx)
        valid = counts > 0
        mean = np.where(valid, self.sums.reshape(self.ny, self.nx) / np.maximum(counts, 1), 0.0)
        return fill_gaps(mean, valid), valid


def _upsample(coarse: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Bilinear 2x upsampling of cell values (cell centres), cropped to `shape`."""

    def axis(values: np.ndarray, n: int, along: int) -> np.ndarray:
        size = values.shape[along]
        pos = np.clip((np.arange(n) + 0.5) / 2 - 0.5, 0, size - 1)
        lo = np.floor(pos).astype(int)
        hi = np.minimum(lo + 1, size - 1)
        t = pos - lo
        a, b = np.take(values, lo, axis=along), np.take(values, hi, axis=along)
        t = t[:, None] if along == 0 else t[None, :]
        return a * (1 - t) + b * t

    return axis(axis(coarse, shape[0], 0), shape[1], 1)


def fill_gaps(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Fills cells without data by pull-push interpolation (an image pyramid of the valid cells).

    Each level averages the valid cells of 2 x 2 blocks; the gaps of a level take the bilinearly
    upsampled values of the coarser one. Holes of any size (a lake, a building) get a smooth
    surface that meets the measured ground at their edges; measured cells are never changed.
    """
    if valid.all() or not valid.any():
        return values.copy() if valid.all() else np.zeros_like(values)
    h, w = values.shape
    ph, pw = h + h % 2, w + w % 2
    v = np.zeros((ph, pw))
    m = np.zeros((ph, pw))
    v[:h, :w] = np.where(valid, values, 0.0)
    m[:h, :w] = valid
    sums = v.reshape(ph // 2, 2, pw // 2, 2).sum(axis=(1, 3))
    counts = m.reshape(ph // 2, 2, pw // 2, 2).sum(axis=(1, 3))
    coarse_valid = counts > 0
    coarse = fill_gaps(np.where(coarse_valid, sums / np.maximum(counts, 1), 0.0), coarse_valid)
    return np.where(valid, values, _upsample(coarse, (h, w)))


def prepare(
    path: Path, work: Path, exclude: set[int], dtm_cell: float, progress: "Progress | None" = None
) -> Prepared:
    """One pass over the points: drops the excluded classes and collects the ground for the DTM.

    PNOA-LiDAR marks strip-overlap points as class 12 (a quarter to a third of a tile) and noise as
    7; they duplicate or spoil the surface, so they are not tiled. With classes to exclude, the kept
    points are copied (same format and header) as they are read; when none of those classes turns
    out to be present the copy is discarded and the source is tiled as it is.
    """
    with open_las(path) as reader:
        header = reader.header
        total = int(header.point_count)
        present: dict[int, int] = {}
        grid = (
            GroundGrid([float(v) for v in header.mins], [float(v) for v in header.maxs], dtm_cell)
            if dtm_cell > 0
            else None
        )
        target = work / f"kept{path.suffix.lower() or '.laz'}"
        writer = None
        kept = 0
        done = 0
        try:
            for chunk in reader.chunk_iterator(CHUNK):
                if len(chunk) == 0:
                    break
                classes = np.asarray(chunk.classification)
                drop = np.isin(classes, list(exclude)) if exclude else np.zeros(len(chunk), bool)
                if drop.any():
                    values, counts = np.unique(classes[drop], return_counts=True)
                    for value, n in zip(values.tolist(), counts.tolist()):
                        present[int(value)] = present.get(int(value), 0) + int(n)
                if grid is not None:
                    ground = classes == GROUND
                    if ground.any():
                        grid.add(
                            np.asarray(chunk.x)[ground],
                            np.asarray(chunk.y)[ground],
                            np.asarray(chunk.z)[ground],
                        )
                if exclude:
                    if writer is None:
                        writer = laspy_writer(target, copy.deepcopy(header), path)
                    writer.write_points(chunk[~drop])
                kept += int((~drop).sum())
                done += len(chunk)
                if progress:
                    progress(done / max(total, 1))
        finally:
            if writer is not None:
                writer.close()
    if not present and target.exists():
        target.unlink()  # nothing was dropped: tile the source itself
    source = target if present else path
    return Prepared(source, kept, present, grid if grid is not None and grid.points else None)


def laspy_writer(target: Path, header, source: Path):
    import laspy

    return laspy.open(target, mode="w", header=header, do_compress=source.suffix.lower() == ".laz")


def write_dtm(
    grid: GroundGrid,
    out: Path,
    epsg: int,
    z_offset: float,
    exact: bool,
    grid_path: Path | None,
) -> dict[str, Any]:
    """Resamples the ground grid to longitude/latitude and writes it as the layer's terrain.

    Heights become ellipsoidal like the points (h = H + N; N per node from the official grid when
    `exact`). Nodes outside the source extent, which the rotated UTM square does not cover, are
    marked as no data so a neighbouring tile wins there. Heights are stored as little-endian
    uint16 steps of `scale` metres above `offset` (1 cm for a normal tile).
    """
    from pyproj import CRS, Transformer

    heights, measured = grid.heights()
    cell = grid.cell
    to_geo = Transformer.from_crs(CRS(f"EPSG:{epsg}"), CRS("EPSG:4326"), always_xy=True)
    to_src = Transformer.from_crs(CRS("EPSG:4326"), CRS(f"EPSG:{epsg}"), always_xy=True)
    x1, y0 = grid.x0 + grid.nx * cell, grid.y1 - grid.ny * cell
    corners = [(grid.x0, y0), (x1, y0), (x1, grid.y1), (grid.x0, grid.y1)]
    footprint = [list(to_geo.transform(x, y)) for x, y in corners]
    west, south, east, north = to_geo.transform_bounds(grid.x0, y0, x1, grid.y1, densify_pts=21)
    lat_c = math.radians((south + north) / 2)
    # About one node per DTM cell (metres per degree on the GRS80 ellipsoid at this latitude).
    m_lat = 111132.954 - 559.822 * math.cos(2 * lat_c)
    m_lon = 111412.84 * math.cos(lat_c)
    width = max(2, math.ceil((east - west) * m_lon / cell) + 1)
    height = max(2, math.ceil((north - south) * m_lat / cell) + 1)
    lons = np.linspace(west, east, width)
    lats = np.linspace(north, south, height)
    lon, lat = np.meshgrid(lons, lats)
    x, y = to_src.transform(lon.ravel(), lat.ravel())
    x, y = np.asarray(x), np.asarray(y)
    inside = (x >= grid.x0) & (x <= x1) & (y >= y0) & (y <= grid.y1)
    # Bilinear interpolation between cell centres.
    fx = np.clip((x - grid.x0) / cell - 0.5, 0, grid.nx - 1)
    fy = np.clip((grid.y1 - y) / cell - 0.5, 0, grid.ny - 1)
    ix, iy = np.minimum(np.floor(fx).astype(int), grid.nx - 2), np.minimum(
        np.floor(fy).astype(int), grid.ny - 2
    )
    ix, iy = np.maximum(ix, 0), np.maximum(iy, 0)
    tx, ty = np.clip(fx - ix, 0, 1), np.clip(fy - iy, 0, 1)
    h = heights
    if grid.nx == 1 or grid.ny == 1:
        sampled = h[np.clip(np.round(fy).astype(int), 0, grid.ny - 1), np.clip(np.round(fx).astype(int), 0, grid.nx - 1)]
    else:
        sampled = (
            h[iy, ix] * (1 - tx) * (1 - ty)
            + h[iy, ix + 1] * tx * (1 - ty)
            + h[iy + 1, ix] * (1 - tx) * ty
            + h[iy + 1, ix + 1] * tx * ty
        )
    if exact and grid_path is not None:
        geoid = Transformer.from_pipeline(f"+proj=vgridshift +grids={grid_path} +multiplier=1")
        n = np.asarray(geoid.transform(lon.ravel(), lat.ravel(), np.zeros(lon.size))[2])
        if not np.isfinite(n[inside]).all():
            raise RuntimeError("The geoid grid does not cover the DTM")
        sampled = sampled + np.where(np.isfinite(n), n, 0.0)
    else:
        sampled = sampled + z_offset
    valid = sampled[inside]
    low, high = float(valid.min()), float(valid.max())
    offset = math.floor(low) - 1.0
    scale = max(0.01, math.ceil((high - offset) / (DTM_NODATA - 1) * 1000) / 1000)
    steps = np.clip(np.round((sampled - offset) / scale), 0, DTM_NODATA - 1).astype("<u2")
    steps[~inside] = DTM_NODATA
    folder = out / "terrain"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "dtm.bin").write_bytes(steps.tobytes())
    meta = {
        "version": 1,
        "encoding": "uint16le",
        "heights": "ellipsoidal",
        "width": width,
        "height": height,
        "west": west,
        "south": south,
        "east": east,
        "north": north,
        "offset": offset,
        "scale": scale,
        "nodata": DTM_NODATA,
        "min": round(low, 3),
        "max": round(high, 3),
        "cell_m": cell,
        "footprint": footprint,
        "ground_points": int(grid.points),
        "measured_fraction": round(float(measured.mean()), 4),
        "data": "dtm.bin",
    }
    (folder / "dtm.json").write_text(json.dumps(meta))
    return {"key": "terrain/dtm.json", **{k: meta[k] for k in ("width", "height", "min", "max", "cell_m", "ground_points", "measured_fraction")}}


def convert(
    path: Path,
    out: Path,
    crs_in: str,
    z_offset: float | None,
    exact: bool,
    grid_dir: str | None,
    jobs: int,
    color_scale: float | None,
    cache_mb: int | None = None,
    exclude_classes: set[int] | None = None,
    dtm_cell: float = 0.0,
) -> dict[str, Any]:
    from py3dtiles.convert import Converter
    from pyproj import CRS

    exclude = set(exclude_classes or ())
    grid_path = setup_grid(grid_dir) if exact else None
    if exact and grid_path is None:
        raise RuntimeError(f"{GRID_FILE} not found in {grid_dir}")
    progress = Progress("tiling")
    work = out.parent / f"{out.name}-work"
    work.mkdir(parents=True, exist_ok=True)
    timings: dict[str, float] = {}
    started = time.monotonic()
    try:
        # Before py3dtiles forks: the multi-threaded LAZ backend is still safe here.
        prepared = prepare(path, work, exclude, dtm_cell, lambda f: progress(0.1 * f))
        if prepared.kept == 0:
            raise InputError(
                "NO_POINTS_LEFT",
                f"Todos los puntos son de clases descartadas ({', '.join(map(str, sorted(exclude)))}).",
            )
        timings["prepare_s"] = round(time.monotonic() - started, 1)
        single_threaded_laz()
        source_file = prepared.source
        if exact:
            source = CRS(f"{crs_in}+5782")
        else:
            source = CRS(crs_in)
            if z_offset:
                shift_heights(source_file, z_offset)
        # py3dtiles keeps up to cache_size MB of points per process before flushing to disk; its
        # default (a tenth of the machine's RAM) is too generous for a small container.
        cache = {"cache_size": cache_mb} if cache_mb else {}
        tiler = ProgressTiler.create(
            **cache,
            progress=lambda f: progress(0.1 + 0.9 * f),
            crs_in=source,
            crs_out=CRS("EPSG:4978"),
            force_crs_in=True,
            pyproj_always_xy=True,
            number_of_jobs=jobs,
            rgb=True,
            color_scale=color_scale,
            extra_fields=["classification"],
        )
        converter = Converter([tiler], jobs=jobs, crs_out=CRS("EPSG:4978"), crs_in=source, **cache)
        tiling = time.monotonic()
        converter.convert([source_file], out, overwrite=True)
        if not (out / "tileset.json").is_file():
            raise RuntimeError("py3dtiles finished without writing tileset.json")
        timings["tiling_s"] = round(time.monotonic() - tiling, 1)
        dtm = None
        if prepared.dtm is not None:
            terrain = time.monotonic()
            epsg = int(crs_in.split(":")[1])
            dtm = write_dtm(prepared.dtm, out, epsg, z_offset or 0.0, exact, grid_path)
            timings["dtm_s"] = round(time.monotonic() - terrain, 1)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    files = sorted(p for p in out.rglob("*") if p.is_file())
    return {
        "tileset": "tileset.json",
        "files": [str(p.relative_to(out)) for p in files],
        "bytes": sum(p.stat().st_size for p in files),
        "points": prepared.kept,
        "excluded": {str(k): v for k, v in sorted(prepared.excluded.items())},
        "dtm": dtm,
        "timings": timings,
    }


def parse_classes(text: str) -> set[int]:
    return {int(v) for v in text.replace(" ", "").split(",") if v}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p_inspect = sub.add_parser("inspect")
    p_inspect.add_argument("file", type=Path)
    p_inspect.add_argument("--crs-in", default="EPSG:25830")
    p_inspect.add_argument("--grid-dir")
    p_convert = sub.add_parser("convert")
    p_convert.add_argument("file", type=Path)
    p_convert.add_argument("out", type=Path)
    p_convert.add_argument("--crs-in", default="EPSG:25830")
    p_convert.add_argument("--z-offset", type=float)
    p_convert.add_argument("--exact-geoid", action="store_true")
    p_convert.add_argument("--grid-dir")
    p_convert.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    p_convert.add_argument("--color-scale", type=float)
    p_convert.add_argument("--cache-mb", type=int)
    p_convert.add_argument("--exclude-classes", default="", help="comma-separated ASPRS codes")
    p_convert.add_argument("--dtm-cell", type=float, default=0.0, help="DTM cell in metres; 0: none")
    args = parser.parse_args(argv)
    try:
        if args.command == "inspect":
            result = inspect(args.file, args.crs_in, args.grid_dir)
        else:
            result = convert(
                args.file,
                args.out,
                args.crs_in,
                args.z_offset,
                args.exact_geoid,
                args.grid_dir,
                args.jobs,
                args.color_scale,
                args.cache_mb,
                parse_classes(args.exclude_classes),
                args.dtm_cell,
            )
        emit("result", **result)
        return 0
    except InputError as error:
        emit("error", code=error.code, message=str(error), permanent=True)
        return 2
    except Exception as error:  # unexpected: let the queue retry
        emit("error", code="INTERNAL", message=f"{type(error).__name__}: {error}", permanent=False)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
