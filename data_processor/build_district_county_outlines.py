#!/usr/bin/env python3
"""build_district_county_outlines.py — recover dissolved county outlines for the
non-Collin counties of each Collin-touching district.

The Collin-focus reduction (collin_focus_reduce.py) trimmed every district's
members.geojson down to Collin precincts and collapsed the other counties'
results into "<county>:ALL" aggregate rows — so the command center could show
the FULL district result in the dock but could only DRAW Collin on the map.

This recovers the geometry the reduction dropped: it reads the PRE-reduction
members.geojson out of git (the commit just before the reduction), groups every
non-Collin precinct by county, and dissolves each county's precincts into ONE
outline polygon — exactly the part of that county that lies in the district,
matching the "<county>:ALL" aggregate one-for-one. The result is written to
data/tx/districts/<slug>/boundaries/county_outlines.geojson with one feature per
non-Collin county, keyed "<county-slug>:ALL" so the app can join it to the
aggregate result and draw the county shaded by its winner.

No new data is invented: the outlines are the union of real precinct geometry we
already shipped (now in git history) and the votes are the aggregates already on
disk. Re-run after any district membership change.

Usage: python3 data_processor/build_district_county_outlines.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from shapely.validation import make_valid

ROOT = Path(__file__).parent.parent
# Commit holding the full member-county precinct geometry, immediately BEFORE
# "Collin-focus the data" (bff432ac) trimmed it to Collin only.
PRE_REDUCTION_COMMIT = "ef8823fa"
COORD_DECIMALS = 5         # ~1.1 m — plenty for a county-at-district-zoom outline
SIMPLIFY_TOL = 0.0008      # ~90 m — shrinks the union without visible loss

DISTRICTS = ["cd-3", "cd-32", "cd-4", "hd-33", "hd-61", "hd-66", "hd-67",
             "hd-70", "hd-89", "sd-2", "sd-30", "sd-8"]


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")


def round_coords(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], COORD_DECIMALS), round(c[1], COORD_DECIMALS)]
    return [round_coords(x) for x in c]


def pre_reduction_geojson(slug):
    """The district's members.geojson as it was before the Collin-focus trim."""
    path = f"data/tx/districts/{slug}/boundaries/members.geojson"
    out = subprocess.run(
        ["git", "show", f"{PRE_REDUCTION_COMMIT}:{path}"],
        cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        return None
    return json.loads(out.stdout)


def main():
    total = 0
    for slug in DISTRICTS:
        gj = pre_reduction_geojson(slug)
        if not gj:
            print(f"  {slug:8s} no pre-reduction geometry — skipped")
            continue

        # group non-Collin precinct geometries by county
        by_county = {}
        for f in gj["features"]:
            name = f["properties"].get("COUNTY")
            if not name or name == "Collin":
                continue
            g = shape(f["geometry"])
            if not g.is_valid:        # a few source precincts self-intersect
                g = make_valid(g)
            by_county.setdefault(name, []).append(g)

        features = []
        for name in sorted(by_county):
            dissolved = unary_union(by_county[name])
            if SIMPLIFY_TOL:
                dissolved = dissolved.simplify(SIMPLIFY_TOL, preserve_topology=True)
            cslug = slugify(name)
            geom = mapping(dissolved)
            geom["coordinates"] = round_coords(geom["coordinates"])
            features.append({
                "type": "Feature",
                "properties": {
                    "PRECINCT": f"{cslug}:ALL",
                    "COUNTY": name,
                    "countySlug": cslug,
                    "level": "county-total",
                },
                "geometry": geom,
            })

        if not features:
            print(f"  {slug:8s} single-county (Collin only) — no outlines")
            continue

        out_path = ROOT / "data/tx/districts" / slug / "boundaries" / "county_outlines.geojson"
        with out_path.open("w") as fh:
            json.dump({"type": "FeatureCollection", "features": features},
                      fh, separators=(",", ":"))
        total += len(features)
        print(f"  {slug:8s} {len(features)} county outline(s): "
              f"{', '.join(f['properties']['COUNTY'] for f in features)}")

    print(f"\nWrote {total} county outlines across {len(DISTRICTS)} districts.")


if __name__ == "__main__":
    main()
