"""LAS/LAZ inspection and 3D Tiles conversion for the GeoTwin worker.

The Node worker runs this script as a child process and reads one JSON object per line on stdout:
  {"event": "progress", "stage": "inspecting" | "tiling", "fraction": 0.0-1.0}
  {"event": "result", ...}                      last line on success
  {"event": "error", "code": "...", "message": "...", "permanent": true|false}

Commands:
  inspect FILE [--crs-in EPSG:25830] [--grid-dir DIR]
  convert FILE OUT_DIR [--crs-in EPSG:25830] (--z-offset N | --exact-geoid --grid-dir DIR)
                       [--jobs N] [--color-scale S]

Exit codes: 0 ok, 2 permanent problem with the input (do not retry), 1 anything else.
"""

from __future__ import annotations

import argparse
import json
import math
import os
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


class InputError(Exception):
    """A problem with the uploaded file. Retrying cannot fix it."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def emit(event: str, **data: Any) -> None:
    print(json.dumps({"event": event, **data}, allow_nan=False), flush=True)


class Progress:
    """Throttled progress lines (at most every 0.5 s or 5 %)."""

    def __init__(self, stage: str) -> None:
        self.stage, self.last, self.at = stage, -1.0, 0.0

    def __call__(self, fraction: float, force: bool = False) -> None:
        fraction = max(0.0, min(1.0, fraction))
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


class ProgressTiler:
    """Factory for a py3dtiles PointTiler that reports how many points are already in tiles."""

    @staticmethod
    def create(**kwargs: Any):
        from py3dtiles.tilers.point.point_tiler import PointTiler

        progress = Progress("tiling")

        class Tiler(PointTiler):
            def process_message(self, message_type: bytes, message: list[bytes]) -> None:
                super().process_message(message_type, message)
                total = max(1, int(self.files_info["point_count"]))
                # Reading/sorting points is most of the work; writing .pnts is the rest.
                done = 0.7 * self.state.processed_points / total
                done += 0.3 * self.state.points_in_pnts / total
                progress(min(done, 0.99))

        return Tiler(**kwargs)


def convert(
    path: Path,
    out: Path,
    crs_in: str,
    z_offset: float | None,
    exact: bool,
    grid_dir: str | None,
    jobs: int,
    color_scale: float | None,
) -> dict[str, Any]:
    from py3dtiles.convert import Converter
    from pyproj import CRS

    if exact:
        if setup_grid(grid_dir) is None:
            raise RuntimeError(f"{GRID_FILE} not found in {grid_dir}")
        source = CRS(f"{crs_in}+5782")
    else:
        source = CRS(crs_in)
        if z_offset:
            shift_heights(path, z_offset)
    tiler = ProgressTiler.create(
        crs_in=source,
        crs_out=CRS("EPSG:4978"),
        force_crs_in=True,
        pyproj_always_xy=True,
        number_of_jobs=jobs,
        rgb=True,
        color_scale=color_scale,
        extra_fields=["classification"],
    )
    converter = Converter([tiler], jobs=jobs, crs_out=CRS("EPSG:4978"), crs_in=source)
    converter.convert([path], out, overwrite=True)
    files = sorted(p for p in out.rglob("*") if p.is_file())
    if not (out / "tileset.json").is_file():
        raise RuntimeError("py3dtiles finished without writing tileset.json")
    return {
        "tileset": "tileset.json",
        "files": [str(p.relative_to(out)) for p in files],
        "bytes": sum(p.stat().st_size for p in files),
    }


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
