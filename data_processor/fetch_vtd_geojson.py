#!/usr/bin/env python3
"""
Fetch Texas precinct (VTD) boundaries for one county from the Texas
Legislative Council's Capitol Data Portal and write them as WGS84 GeoJSON in
the v3 layout: data/tx/<slug>/boundaries/<set>.geojson

The TLC VTD shapefiles are ELECTION-VINTAGE (e.g. VTDs_22G = the precincts
used in the 2022 general), unlike Census 2020 VTDs which go stale as counties
redraw. Each feature gets a PRECINCT property = the TLC VTD code with leading
zeros stripped (the one normalization rule applied, and reported), which is
the form OpenElections result files use.

Requires: pyshp, pyproj  (pip install pyshp pyproj; see requirements.txt)

Usage:
  python3 data_processor/fetch_vtd_geojson.py --county bastrop --set 2022 \
      [--shapefile /tmp/VTDs_22G.shp] [--vintage 22G] [--validate]

  Without --shapefile, downloads VTDs_<vintage>.zip from the Capitol Data
  Portal (≈46MB statewide) into /tmp and uses that.

  --validate compares the boundary PRECINCT codes against the county's v3
  race/turnout precinct codes and FAILS unless 100% of vote-bearing precincts
  match — below that, the county must stay a placeholder (never fuzzy-join).
"""

import argparse
import csv
import io
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

import shapefile  # pyshp
from pyproj import CRS, Transformer

ROOT = Path(__file__).parent.parent
CKAN_SEARCH = "https://data.capitol.texas.gov/api/3/action/package_search?q=vtds&rows=5"


def county_entry(slug):
    registry = json.load((ROOT / "data/tx/counties.json").open())
    entry = next((c for c in registry if c["slug"] == slug), None)
    if not entry:
        raise SystemExit(f"Unknown county slug: {slug}")
    return entry


def download_shapefile(vintage):
    with urllib.request.urlopen(CKAN_SEARCH, timeout=60) as resp:
        data = json.load(resp)
    url = None
    target = f"VTDs_{vintage}.zip"
    for r in data["result"]["results"]:
        for res in r["resources"]:
            if res["name"] == target:
                url = res["url"]
    if not url:
        raise SystemExit(f"Could not find {target} on the Capitol Data Portal")
    print(f"Downloading {url}")
    dest = Path(f"/tmp/VTDs_{vintage}.zip")
    urllib.request.urlretrieve(url, dest)
    with zipfile.ZipFile(dest) as z:
        z.extractall("/tmp")
    return Path(f"/tmp/VTDs_{vintage}.shp")


def convert(shp_path, fips, out_path, decimals=6):
    """Extract one county's VTDs, reproject to WGS84, write GeoJSON."""
    cnty_num = int(fips[2:])  # TLC CNTY = county FIPS suffix as integer
    sf = shapefile.Reader(str(shp_path))
    fields = [f[0] for f in sf.fields[1:]]

    prj = Path(str(shp_path)).with_suffix(".prj").read_text()
    transformer = Transformer.from_crs(CRS.from_wkt(prj), CRS.from_epsg(4326), always_xy=True)

    features = []
    for i in range(len(sf)):
        rec = dict(zip(fields, list(sf.record(i))))
        if rec.get("CNTY") != cnty_num:
            continue
        geom = sf.shape(i).__geo_interface__

        def reproject(coords):
            if isinstance(coords[0], (int, float)):
                x, y = transformer.transform(coords[0], coords[1])
                return [round(x, decimals), round(y, decimals)]
            return [reproject(c) for c in coords]

        vtd = str(rec["VTD"]).strip()
        precinct = vtd.lstrip("0") or vtd  # the single normalization rule
        features.append({
            "type": "Feature",
            "properties": {
                "PRECINCT": precinct,
                "VTD": vtd,
                "CNTYVTD": str(rec.get("CNTYVTD", "")).strip(),
            },
            "geometry": {"type": geom["type"], "coordinates": reproject(list(geom["coordinates"]))},
        })

    if not features:
        raise SystemExit(f"No VTDs found for CNTY={cnty_num} in {shp_path}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))
    stripped = sum(1 for ft in features if ft["properties"]["PRECINCT"] != ft["properties"]["VTD"])
    print(f"Wrote {len(features)} precinct features -> {out_path} "
          f"({out_path.stat().st_size // 1024} KB; leading zeros stripped on {stripped})")
    return features


def validate(entry, set_dir, features):
    """100% of vote-bearing precincts in the v3 data must have a boundary."""
    set_path = ROOT / entry["dataRoot"] / set_dir if entry.get("dataRoot") \
        else ROOT / f"data/tx/{entry['slug']}/{set_dir}"
    manifest = json.load((set_path / "elections.json").open())
    boundary_codes = {f["properties"]["PRECINCT"] for f in features}

    vote_bearing = set()
    all_codes = set()
    for e in manifest["elections"]:
        for r in csv.DictReader((set_path / e["raceFile"]).open()):
            code = r["precinct"].strip()
            all_codes.add(code)
            if r["candidate"].strip().lower() not in ("write-in", "over votes", "under votes") \
               and r["votes"].strip() not in ("", "0"):
                vote_bearing.add(code)

    missing_votes = sorted(vote_bearing - boundary_codes)
    extra_boundaries = sorted(boundary_codes - all_codes)
    print(f"\nJoin validation: {len(vote_bearing - set(missing_votes))}/{len(vote_bearing)} "
          f"vote-bearing precincts matched; {len(extra_boundaries)} boundary-only codes")
    if missing_votes:
        print(f"  UNMATCHED vote-bearing precincts: {missing_votes[:20]}")
        print("  GATE FAILED — county must stay placeholder (never fuzzy-join).")
        return False
    if extra_boundaries:
        print(f"  note: boundaries without results (legal — uncontested/no races): {extra_boundaries[:10]}")
    print("  GATE PASSED — safe to flip the county live.")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--county", required=True, help="county slug, e.g. bastrop")
    ap.add_argument("--set", dest="set_dir", required=True, help="boundary set dir, e.g. 2022")
    ap.add_argument("--vintage", default="22G", help="TLC VTD vintage (default 22G)")
    ap.add_argument("--shapefile", help="path to a local VTDs_*.shp (skips download)")
    ap.add_argument("--validate", action="store_true", help="validate precinct-code join")
    args = ap.parse_args()

    entry = county_entry(args.county)
    shp = Path(args.shapefile) if args.shapefile else download_shapefile(args.vintage)
    out = ROOT / f"data/tx/{args.county}/boundaries/{args.set_dir}.geojson"
    features = convert(shp, entry["fips"], out)

    if args.validate:
        ok = validate(entry, args.set_dir, features)
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
