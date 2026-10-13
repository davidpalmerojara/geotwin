"""Stand-in for geotwin_lidar.py in unit tests: same output protocol, no real conversion.

FAKE_LIDAR_MODE: ok (default) | corrupt (permanent input error) | crash (exit 1, no message)
| internal (non-permanent error) | slow (sleeps until killed)
| forked (like py3dtiles: forks a helper that keeps stdout open, then both sleep)
"""

import json
import os
import sys
import time
from pathlib import Path


def emit(event, **data):
    print(json.dumps({"event": event, **data}), flush=True)


mode = os.environ.get("FAKE_LIDAR_MODE", "ok")
command = sys.argv[1]
print("a py3dtiles warning that is not JSON", flush=True)
if mode == "forked":
    helper = os.fork()
    if helper == 0:
        time.sleep(60)
        os._exit(0)
    emit("progress", stage=f"helper:{helper}", fraction=0.1)
    time.sleep(60)
if mode == "slow":
    emit("progress", stage="inspecting", fraction=0.1)
    time.sleep(60)
if mode == "crash":
    print("Traceback: something exploded", file=sys.stderr)
    sys.exit(1)
if mode == "corrupt":
    emit("error", code="TRUNCATED", message="El fichero está incompleto.", permanent=True)
    sys.exit(2)
if mode == "internal":
    emit("error", code="INTERNAL", message="OSError: disk full", permanent=False)
    sys.exit(1)
if command == "inspect":
    for f in (0.5, 1.0):
        emit("progress", stage="inspecting", fraction=f)
    emit(
        "result",
        point_count=5540,
        point_format=0x87,
        crs_in="EPSG:25830",
        color_scale=None,
        bbox=[-4.7198, 41.5824, -4.7184, 41.5835],
        center={"lng": -4.719097, "lat": 41.582947},
        height_range=[698.5, 710.09],
        grid_offset_m=None,
        args=sys.argv[1:],
    )
else:
    out = Path(sys.argv[3])
    (out / "points").mkdir(parents=True)
    (out / "tileset.json").write_text('{"asset":{"version":"1.0"}}')
    (out / "points" / "r.pnts").write_bytes(b"pnts" + bytes(60))
    Path(os.environ["FAKE_LIDAR_ARGS"]).write_text(json.dumps(sys.argv[1:]))
    for f in (0.3, 0.9):
        emit("progress", stage="tiling", fraction=f)
    emit("result", tileset="tileset.json", files=["points/r.pnts", "tileset.json"], bytes=92)
