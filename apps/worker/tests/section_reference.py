"""Independent reference for GET /api/layers/:id/section, computed on the SOURCE LAS/LAZ.

The API reads the converted 3D Tiles; this script reads the original file with laspy and pyproj,
drops the excluded classes and applies the same slab definition (docs/api.md):

- A, B and every point go to their footprint on the WGS 84 ellipsoid (longitude, latitude, h = 0);
- the footprints are expressed in the east-north plane tangent at the middle of A–B;
- s is the distance from A along A→B, d the signed distance from the line (left positive);
- a point is in the slab when 0 <= s <= |AB| and |d| <= half.

Points within 1 mm of the slab border are reported apart ("border"), because float32 tile
positions may put them on either side.

Usage:
  python section_reference.py FILE --a X,Y --b X,Y [--crs-in EPSG:25830] [--half 1.5]
         [--exclude 7,12,18] [--geoid-n 53.1] [--lonlat] [--summary]

A and B are in the file's CRS unless --lonlat (then lon,lat in degrees, ETRS89/WGS 84).
Prints JSON: A and B in lon/lat, the length, the points (s, d, h = z + N, cls) and the border count.
"""

import argparse
import json
import sys

import laspy
import numpy as np
from pyproj import CRS, Transformer

BORDER_M = 0.001


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    parser.add_argument("--a", required=True)
    parser.add_argument("--b", required=True)
    parser.add_argument("--crs-in", default="EPSG:25830")
    parser.add_argument("--half", type=float, default=1.5)
    parser.add_argument("--exclude", default="")
    parser.add_argument("--geoid-n", type=float, default=0.0)
    parser.add_argument("--lonlat", action="store_true")
    parser.add_argument("--summary", action="store_true", help="counts only, no point columns")
    args = parser.parse_args(argv)

    source = CRS(args.crs_in)
    to_geo = Transformer.from_crs(source, CRS("EPSG:4258"), always_xy=True)
    to_src = Transformer.from_crs(CRS("EPSG:4258"), source, always_xy=True)
    to_ecef = Transformer.from_crs(CRS("EPSG:4979"), CRS("EPSG:4978"), always_xy=True)
    a = [float(v) for v in args.a.split(",")]
    b = [float(v) for v in args.b.split(",")]
    if args.lonlat:
        a_ll, b_ll = a, b
    else:
        a_ll = [round(v, 8) for v in to_geo.transform(*a)]
        b_ll = [round(v, 8) for v in to_geo.transform(*b)]
    a_src = np.array(to_src.transform(*a_ll))
    b_src = np.array(to_src.transform(*b_ll))

    lon0 = np.radians((a_ll[0] + b_ll[0]) / 2)
    lat0 = np.radians((a_ll[1] + b_ll[1]) / 2)
    origin = np.array(to_ecef.transform(np.degrees(lon0), np.degrees(lat0), 0.0))
    east = np.array([-np.sin(lon0), np.cos(lon0), 0.0])
    north = np.array([-np.sin(lat0) * np.cos(lon0), -np.sin(lat0) * np.sin(lon0), np.cos(lat0)])

    def plane(lon, lat):
        x, y, z = to_ecef.transform(lon, lat, np.zeros_like(np.asarray(lon, dtype=float)))
        v = np.stack([np.asarray(x) - origin[0], np.asarray(y) - origin[1], np.asarray(z) - origin[2]])
        return east @ v, north @ v

    ae, an = plane(np.array([a_ll[0]]), np.array([a_ll[1]]))
    be, bn = plane(np.array([b_ll[0]]), np.array([b_ll[1]]))
    length = float(np.hypot(be - ae, bn - an)[0])
    te, tn = float((be - ae)[0]) / length, float((bn - an)[0]) / length

    # Cheap pre-filter in the source CRS (a few metres of margin), exact test afterwards.
    axis = (b_src - a_src) / np.linalg.norm(b_src - a_src)
    exclude = {int(v) for v in args.exclude.split(",") if v.strip()}
    keep = {"s": [], "d": [], "h": [], "cls": []}
    border = 0
    with laspy.open(args.file) as reader:
        for chunk in reader.chunk_iterator(2_000_000):
            x, y, z = np.asarray(chunk.x), np.asarray(chunk.y), np.asarray(chunk.z)
            cls = np.asarray(chunk.classification)
            rel_x, rel_y = x - a_src[0], y - a_src[1]
            along = rel_x * axis[0] + rel_y * axis[1]
            across = rel_y * axis[0] - rel_x * axis[1]
            near = (along > -5) & (along < length + 5) & (np.abs(across) < args.half + 5)
            if exclude:
                near &= ~np.isin(cls, list(exclude))
            if not near.any():
                continue
            lon, lat = to_geo.transform(x[near], y[near])
            e, n = plane(np.asarray(lon), np.asarray(lat))
            e, n = e - ae[0], n - an[0]
            s = e * te + n * tn
            d = n * te - e * tn
            inside = (s >= 0) & (s <= length) & (np.abs(d) <= args.half)
            margin = np.minimum.reduce([s, length - s, args.half - np.abs(d)])
            border += int((np.abs(margin) <= BORDER_M).sum())
            sure = inside & (margin > BORDER_M)
            keep["s"].extend(np.round(s[sure], 3).tolist())
            keep["d"].extend(np.round(d[sure], 3).tolist())
            keep["h"].extend(np.round(z[near][sure] + args.geoid_n, 3).tolist())
            keep["cls"].extend(cls[near][sure].astype(int).tolist())

    out = {
        "a": a_ll,
        "b": b_ll,
        "length": length,
        "count": len(keep["s"]),
        "border": border,
        "classes": {str(c): keep["cls"].count(c) for c in sorted(set(keep["cls"]))},
    }
    if not args.summary:
        out.update(keep)
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
