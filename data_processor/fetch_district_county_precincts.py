#!/usr/bin/env python3
"""fetch_district_county_precincts.py — extract real precinct geometry for a
NON-Collin county of a district, from the TLC Capitol Data Portal VTD shapefile,
and write it as data/tx/districts/<slug>/boundaries/other_precincts.geojson.

This is the geometry half of "go all the way": once a county's official
precinct-level RESULTS are in the district race files (see
upgrade_hunt_cd3_precincts.py / fetch_clarity_results.py), this joins them to the
matching ELECTION-VINTAGE VTD polygons so the command center can draw that county
precinct-by-precinct instead of as one county outline.

Join key: TLC VTD code with leading zeros stripped (e.g. "0101"->"101", "214A")
equals Hunt County's Clarity precinct codes — verified 31/31 for Hunt CD-3 on the
2024 vintage (VTDs_24PG). Only VTDs whose code appears in the district's race
files (the county's portion of THIS district) are emitted; the rest belong to
other districts. Multiple counties accumulate into the same file.

Usage:
  python3 data_processor/fetch_district_county_precincts.py \
      --slug cd-3 --county Hunt --cnty 231 --shapefile /tmp/vtds24/VTDs_24PG.shp
"""
import argparse
import csv
import glob
import json
from pathlib import Path

import shapefile  # pyshp
from shapely.geometry import shape, mapping
from shapely.ops import transform as shp_transform
from shapely.validation import make_valid
from pyproj import CRS, Transformer

ROOT = Path(__file__).parent.parent
COORD_DECIMALS = 5


def round_coords(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], COORD_DECIMALS), round(c[1], COORD_DECIMALS)]
    return [round_coords(x) for x in c]


def norm(code):
    return str(code).strip().lstrip("0") or "0"


def district_county_codes(slug, county_slug):
    """Precinct codes for this county that appear in the district's race files."""
    codes = set()
    for f in glob.glob(str(ROOT / f"data/tx/districts/{slug}/data/races/*.csv")):
        with open(f, newline="") as fh:
            for r in csv.reader(fh):
                if r and r[0].startswith(f"{county_slug}:") and not r[0].endswith(":ALL"):
                    codes.add(r[0].split(":", 1)[1])
    return codes


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--slug", required=True, help="district slug, e.g. cd-3")
    ap.add_argument("--county", required=True, help="county display name, e.g. Hunt")
    ap.add_argument("--cnty", required=True, type=int, help="TLC CNTY number, e.g. 231 (Hunt)")
    ap.add_argument("--shapefile", required=True, help="path to VTDs_*.shp")
    args = ap.parse_args()

    county_slug = args.county.lower().replace(" ", "-")
    wanted = district_county_codes(args.slug, county_slug)
    if not wanted:
        raise SystemExit(f"No {county_slug}:<precinct> rows in {args.slug} race files — "
                         "ingest the county's precinct results first.")

    sf = shapefile.Reader(args.shapefile)
    flds = [f[0] for f in sf.fields[1:]]
    ci, vi = flds.index("CNTY"), flds.index("VTD")
    prj = Path(args.shapefile).with_suffix(".prj").read_text()
    tr = Transformer.from_crs(CRS.from_wkt(prj), CRS.from_epsg(4326), always_xy=True)

    out_path = ROOT / f"data/tx/districts/{args.slug}/boundaries/other_precincts.geojson"
    existing = {"type": "FeatureCollection", "features": []}
    if out_path.exists():
        existing = json.load(out_path.open())
    # drop any prior features for this county (idempotent re-runs)
    existing["features"] = [f for f in existing["features"]
                            if f["properties"].get("countySlug") != county_slug]

    matched = set()
    for i in range(len(sf)):
        rec = sf.record(i)
        if rec[ci] != args.cnty:
            continue
        code = norm(rec[vi])
        if code not in wanted:
            continue
        g = shape(sf.shape(i).__geo_interface__)
        g = shp_transform(lambda x, y, z=None: tr.transform(x, y), g)
        if not g.is_valid:
            g = make_valid(g)
        geom = mapping(g)
        geom["coordinates"] = round_coords(geom["coordinates"])
        existing["features"].append({
            "type": "Feature",
            "properties": {"PRECINCT": f"{county_slug}:{code}", "COUNTY": args.county,
                           "countySlug": county_slug},
            "geometry": geom,
        })
        matched.add(code)

    missing = wanted - matched
    with out_path.open("w") as fh:
        json.dump(existing, fh, separators=(",", ":"))
    print(f"{args.slug}/{county_slug}: wrote {len(matched)} precinct polygons "
          f"({len(existing['features'])} total in file)")
    if missing:
        print(f"  WARNING: {len(missing)} result codes had no VTD match: {sorted(missing)}")


if __name__ == "__main__":
    main()
