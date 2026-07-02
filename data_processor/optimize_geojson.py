#!/usr/bin/env python3
"""
optimize_geojson.py — shrink boundary GeoJSON for faster page loads.

The TLC/ArcGIS-sourced precinct boundary files carry ~15 decimal places of
coordinate precision (6 dp is ~11 cm — plenty for precinct polygons) and a set
of heavy editing/geometry-stat properties the app never reads. This rounds every
coordinate to 6 dp, drops those unused props, and rewrites the file MINIFIED.

Measured on data/tx/collin/boundaries/2026.geojson: 3.8 MB -> ~2.0 MB raw,
1.22 MB -> ~0.49 MB gzipped. No client change — only PRECINCT + semantic
district/name props are read (js/dataLoader.js merge), and all of those are kept.

Idempotent: re-running on an already-optimized file is a no-op (coords already
short, denylist props already gone).

Usage:
    python3 data_processor/optimize_geojson.py            # all boundary files
    python3 data_processor/optimize_geojson.py path.geojson [more.geojson ...]
"""

import glob
import json
import os
import sys

COORD_DECIMALS = 6

# Editing/geometry-stat props the app never reads (confirmed by grep over
# js/, e2e/, tests/). Everything else — PRECINCT, CONG, SEN, *_N names, etc. —
# is preserved.
DROP_PROPS = {
    "OBJECTID",
    "GlobalID",
    "GlobalID_2",
    "EditorName",
    "LastUpdate",
    "Version",
    "Tool",
    "Shape_STAr",
    "Shape_STLe",
    "Shape__Area",
    "Shape__Length",
}

# Default targets when no paths are passed on the command line.
DEFAULT_GLOBS = [
    "data/tx/collin/boundaries/*.geojson",
    "data/tx/districts/*/boundaries/*.geojson",
]


def round_coords(node):
    """Recursively round every number in a nested coordinate array to 6 dp."""
    if isinstance(node, list):
        return [round_coords(x) for x in node]
    if isinstance(node, float):
        return round(node, COORD_DECIMALS)
    if isinstance(node, int):
        return node
    return node


def optimize(path):
    with open(path) as f:
        gj = json.load(f)

    for feature in gj.get("features", []):
        props = feature.get("properties")
        if isinstance(props, dict):
            for key in list(props.keys()):
                if key in DROP_PROPS:
                    del props[key]
        geom = feature.get("geometry")
        if geom and "coordinates" in geom:
            geom["coordinates"] = round_coords(geom["coordinates"])

    before = os.path.getsize(path)
    with open(path, "w") as f:
        json.dump(gj, f, separators=(",", ":"))
    after = os.path.getsize(path)
    print(f"{path}: {before/1e6:.2f} MB -> {after/1e6:.2f} MB "
          f"({100*(before-after)/before:.0f}% smaller, {len(gj.get('features', []))} features)")


def main(argv):
    paths = argv[1:]
    if not paths:
        for pattern in DEFAULT_GLOBS:
            paths.extend(sorted(glob.glob(pattern)))
    if not paths:
        print("No GeoJSON files found to optimize.", file=sys.stderr)
        return 1
    for path in paths:
        optimize(path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
