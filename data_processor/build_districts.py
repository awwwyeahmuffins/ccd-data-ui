#!/usr/bin/env python3
"""
Cross-county district views: partition every live county's precincts into the
enacted federal/state district plans (TLC PLANC2193 congressional, PLANS2168
state senate, PLANH2316 state house) and emit one v3 data package per
district under data/tx/districts/<slug>/. Districts then appear in the app's
selector like counties — no new loader logic.

EXTRAPOLATION (documented, same spirit as the rest of the pipeline):
- Each precinct is assigned WHOLLY to the district containing its
  representative point. Precincts genuinely split by a district line are not
  apportioned — the whole precinct goes to one side (recorded in provenance).
- District packages carry the STATEWIDE races of their member counties
  (same offices the party-lean derivation uses). Member counties on
  different data vintages (2022 vs 2020) contribute different races; member
  precincts whose county lacks a given race render as no-data — never
  fabricated.
- Precinct codes are prefixed "<county-slug>:<code>" for uniqueness; profile
  data (party lean, racial) merges the same way. Collin's data is read,
  never modified.

Usage: python3 data_processor/build_districts.py [--plan cd|sd|hd] [--district N]
"""

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import shapefile
from shapely.geometry import shape
from shapely.strtree import STRtree
from pyproj import CRS, Transformer

sys.path.insert(0, str(Path(__file__).parent))
from v3_writer import write_race_csv, write_turnout_csv, write_manifest  # noqa: E402
from derive_profiles import is_statewide_office  # noqa: E402

ROOT = Path(__file__).parent.parent
OUT_ROOT = ROOT / "data/tx/districts"
COORD_DECIMALS = 5  # ~1.1m — district-zoom appropriate, keeps copies small

PLANS = {
    "cd": {"shp": "/tmp/planc2193/PLANC2193/PLANC2193.shp", "plan": "PLANC2193",
           "name": "Congressional District {n}", "group": "Congressional Districts"},
    "sd": {"shp": "/tmp/plans2168/PLANS2168/PLANS2168.shp", "plan": "PLANS2168",
           "name": "State Senate District {n}", "group": "State Senate Districts"},
    "hd": {"shp": "/tmp/planh2316/PLANH2316/PLANH2316.shp", "plan": "PLANH2316",
           "name": "State House District {n}", "group": "State House Districts"},
}


def load_plan(cfg):
    sf = shapefile.Reader(cfg["shp"])
    prj = Path(cfg["shp"]).with_suffix(".prj").read_text()
    tr = Transformer.from_crs(CRS.from_wkt(prj), CRS.from_epsg(4326), always_xy=True)
    geoms, ids = [], []
    from shapely.ops import transform as shp_transform
    for i in range(len(sf)):
        n = sf.record(i)["District"]
        g = shape(sf.shape(i).__geo_interface__)
        g = shp_transform(lambda x, y, z=None: tr.transform(x, y), g)
        geoms.append(g)
        ids.append(int(n))
    return STRtree(geoms), geoms, ids


def round_coords(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], COORD_DECIMALS), round(c[1], COORD_DECIMALS)]
    return [round_coords(x) for x in c]


def office_key(office):
    return re.sub(r"[^a-z0-9]+", " ", (office or "").lower()).strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--plan", choices=list(PLANS), help="single plan layer")
    ap.add_argument("--district", type=int, help="single district number")
    args = ap.parse_args()

    registry = json.load((ROOT / "data/tx/counties.json").open())
    counties = [c for c in registry if c["status"] == "live"]

    # ---- 1) Assign every precinct to a district per plan layer -------------
    plans = {k: load_plan(cfg) for k, cfg in PLANS.items()
             if not args.plan or k == args.plan}
    print(f"Loaded plans: {list(plans)}")

    # membership[plan][district] -> {county_slug: set(precinct codes)}
    membership = {k: defaultdict(lambda: defaultdict(set)) for k in plans}
    county_features = {}   # slug -> {code: feature}
    split_notes = defaultdict(int)

    for c in counties:
        set_cfg = c["boundarySets"][c["defaultBoundarySet"]]
        gj = json.load((ROOT / c["dataRoot"] / set_cfg["geojson"]).open())
        feats = {}
        for f in gj["features"]:
            # some county geojsons (Collin) store PRECINCT as a number
            code = str(f["properties"]["PRECINCT"]).strip()
            feats[code] = f
            pt = shape(f["geometry"]).representative_point()
            for k, (tree, geoms, ids) in plans.items():
                idxs = tree.query(pt)
                hit = None
                for idx in idxs:
                    if geoms[idx].contains(pt):
                        hit = ids[idx]
                        break
                if hit is not None:
                    membership[k][hit][c["slug"]].add(code)
        county_features[c["slug"]] = feats
        print(f"  assigned {c['slug']} ({len(feats)} precincts)")

    by_slug = {c["slug"]: c for c in counties}
    district_registry = []

    # ---- 2) Emit one package per district -----------------------------------
    for k, cfg in PLANS.items():
        if k not in plans:
            continue
        for dist, members in sorted(membership[k].items()):
            if args.district and dist != args.district:
                continue
            slug = f"{k}-{dist}"
            out = OUT_ROOT / slug
            data_dir = out / "data"
            n_precincts = sum(len(v) for v in members.values())

            # boundaries: member precinct features, prefixed codes
            features = []
            for cslug, codes in sorted(members.items()):
                for code in sorted(codes):
                    f = county_features[cslug][code]
                    features.append({
                        "type": "Feature",
                        "properties": {"PRECINCT": f"{cslug}:{code}",
                                       "COUNTY": by_slug[cslug]["name"]},
                        "geometry": {"type": f["geometry"]["type"],
                                     "coordinates": round_coords(f["geometry"]["coordinates"])},
                    })
            (out / "boundaries").mkdir(parents=True, exist_ok=True)
            with (out / "boundaries" / "members.geojson").open("w") as fh:
                json.dump({"type": "FeatureCollection", "features": features},
                          fh, separators=(",", ":"))

            # races: statewide offices across member counties, merged by office+year
            merged = defaultdict(lambda: {"rows": [], "turnout": [], "members": [],
                                          "displayName": None, "office": None, "year": None,
                                          "date": None, "category": None})
            for cslug, codes in members.items():
                c = by_slug[cslug]
                set_cfg = c["boundarySets"][c["defaultBoundarySet"]]
                set_path = ROOT / c["dataRoot"] / set_cfg["dataDir"]
                manifest = json.load((set_path / "elections.json").open())
                for e in manifest["elections"]:
                    if e.get("district") or not is_statewide_office(e.get("office")):
                        continue
                    key = (office_key(e.get("office")), e.get("year"))
                    m = merged[key]
                    m["displayName"] = m["displayName"] or e.get("displayName")
                    m["office"] = m["office"] or e.get("office")
                    m["year"] = e.get("year")
                    m["date"] = m["date"] or e.get("date")
                    m["category"] = m["category"] or e.get("category")
                    m["members"].append(cslug)
                    for r in csv.DictReader((set_path / e["raceFile"]).open()):
                        code = r["precinct"].strip()
                        if code in codes:
                            m["rows"].append((f"{cslug}:{code}", r["party"],
                                              r["candidate"], r["votes"]))
                    if e.get("turnoutFile"):
                        for r in csv.DictReader((set_path / e["turnoutFile"]).open()):
                            code = r["precinct"].strip()
                            if code in codes:
                                m["turnout"].append((f"{cslug}:{code}", r["registered"],
                                                     r["ballots_cast"], r["blank"]))

            elections = []
            for (okey, year), m in sorted(merged.items(), key=lambda kv: (-(kv[0][1] or 0), kv[0][0])):
                base = re.sub(r"[^A-Za-z0-9]+", "_", m["office"] or okey).strip("_")
                filename = f"{base}_{year}.csv"
                race_rel = f"races/{filename}"
                turnout_rel = f"turnout/{base}_{year}.csv" if m["turnout"] else None
                write_race_csv(data_dir / race_rel, m["rows"])
                if turnout_rel:
                    # dedupe turnout rows (several races share county turnout files)
                    seen = {}
                    for row in m["turnout"]:
                        seen[row[0]] = row
                    write_turnout_csv(data_dir / turnout_rel, sorted(seen.values()))
                elections.append({
                    "id": re.sub(r"[^a-z0-9]+", "-", f"{base}-{year}".lower()).strip("-"),
                    "displayName": m["displayName"] or f"{m['office']} ({year})",
                    "office": m["office"], "district": None,
                    "year": year, "date": m["date"], "category": m["category"],
                    "raceFile": race_rel, "turnoutFile": turnout_rel,
                    "sourceUrl": None,
                })
            write_manifest(data_dir / "elections.json", slug, "members", elections)

            # profile: merge party-lean + racial from member counties
            profile_dir = data_dir / "profile"
            for fname, key_field in (("dnc_scores.csv", "Precinct"), ("racial.csv", "precinct")):
                out_rows, header = [], None
                for cslug, codes in sorted(members.items()):
                    c = by_slug[cslug]
                    set_cfg = c["boundarySets"][c["defaultBoundarySet"]]
                    src = ROOT / c["dataRoot"] / set_cfg["dataDir"] / "profile" / fname
                    if not src.exists():
                        continue
                    rows = list(csv.reader(src.open()))
                    if not rows:
                        continue
                    header = header or rows[0]
                    ki = rows[0].index(key_field)
                    for row in rows[1:]:
                        if row[ki].strip() in codes:
                            row = list(row)
                            row[ki] = f"{cslug}:{row[ki].strip()}"
                            out_rows.append(row)
                if header and out_rows:
                    profile_dir.mkdir(parents=True, exist_ok=True)
                    with (profile_dir / fname).open("w", newline="") as fh:
                        w = csv.writer(fh)
                        w.writerow(header)
                        w.writerows(out_rows)

            profile_dir.mkdir(parents=True, exist_ok=True)
            json.dump({
                "package": {
                    "method": "district-partition-v1",
                    "plan": cfg["plan"],
                    "description": ("Cross-county district view. Precincts assigned wholly "
                                    "to the district containing their representative point "
                                    "(split precincts are not apportioned). Statewide races "
                                    "merged from member counties; counties on different data "
                                    "vintages contribute different races."),
                    "members": {cs: len(cd) for cs, cd in sorted(members.items())},
                    "generated": "2026-06-12",
                }
            }, (profile_dir / "provenance.json").open("w"), indent=2)

            district_registry.append({
                "slug": slug,
                "name": cfg["name"].format(n=dist),
                "kind": "district",
                "group": cfg["group"],
                "status": "live",
                "dataRoot": f"data/tx/districts/{slug}",
                "defaultBoundarySet": "original",
                "boundarySets": {"original": {
                    "label": f"{n_precincts} precincts · {len(members)} "
                             f"{'county' if len(members) == 1 else 'counties'}",
                    "geojson": "boundaries/members.geojson",
                    "dataDir": "data"}},
                "notes": f"District view across {len(members)} counties; "
                         f"races merged from member counties (see profile/provenance.json)",
            })
            print(f"  {slug}: {n_precincts} precincts, {len(members)} counties, "
                  f"{len(elections)} races")

    if not args.district and not args.plan:
        json.dump(district_registry, (ROOT / "data/tx/districts.json").open("w"), indent=2)
        print(f"\nWrote {len(district_registry)} district entries to data/tx/districts.json")
    else:
        print(f"\n(partial run — district registry NOT rewritten)")


if __name__ == "__main__":
    main()
