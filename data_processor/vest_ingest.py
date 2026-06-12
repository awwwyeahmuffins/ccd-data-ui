#!/usr/bin/env python3
"""
Direct ingestion from VEST (Voting and Election Science Team) official 2020
precinct returns — the same officially-sourced dataset used as the audit
reference for the 2020 wave. Used for counties whose OpenElections files
failed reconciliation or whose precinct schemes couldn't be mapped: VEST
results and boundaries come from ONE file, so the join is intrinsic and no
cross-source audit is required (the source IS the reference).

Coverage: the 2020 statewide races VEST carries (President, US Senate,
Railroad Commissioner, 4 Supreme Court seats, 3 Court of Criminal Appeals
seats) — fewer races than a full OpenElections county, but every number is
official. Registered voters come from G20VR; ballots-cast is unknown and
stays empty (N/A).

Candidate display names and office titles are decoded by matching VEST's
candidate codes (G20<office><party><LAST3>) against races in the already
verified live counties — consensus naming, never invented.

Usage:
  python3 data_processor/vest_ingest.py [--county slug] [--dry-run]
  (no --county: ingest every placeholder county)
"""

import argparse
import csv
import json
import re
import sys
from collections import defaultdict, Counter
from pathlib import Path

import shapefile
from shapely.geometry import shape, mapping
from pyproj import CRS, Transformer

sys.path.insert(0, str(Path(__file__).parent))
from v3_writer import write_race_csv, write_turnout_csv, write_manifest  # noqa: E402
from unified_parser import sanitize_filename, categorize_election_python  # noqa: E402

ROOT = Path(__file__).parent.parent
SHP = "/tmp/tx_2020.shp"
REGISTRY_PATH = ROOT / "data/tx/counties.json"
REPORT_PATH = ROOT / "data/tx/AUDIT_REPORT.json"
SOURCE_URL = "https://doi.org/10.7910/DVN/K7760H"  # VEST 2020, Harvard Dataverse
LETTER_PARTY = {"R": "REP", "D": "DEM", "L": "LIB", "G": "GRN"}
SIMPLIFY_TOLERANCE_M = 15


def result_columns(fields):
    """[(column, office3, party_letter, cand3)] for G20 result columns."""
    out = []
    for f in fields:
        m = re.fullmatch(r"G20([A-Z]{3})([RDLGO])([A-Z]{3})", f)
        if m and f not in ("G20VR", "G20SSVR"):
            out.append((f, m.group(1), m.group(2), m.group(3)))
    return out


def build_name_index():
    """Scan verified live counties' 2020 sets: (party, LAST3) -> Counter of
    (full candidate name, office displayName). Consensus = most common."""
    registry = json.load(REGISTRY_PATH.open())
    index = defaultdict(Counter)
    for c in registry:
        if c["status"] != "live" or not c.get("boundarySets"):
            continue
        for set_cfg in c["boundarySets"].values():
            if set_cfg["dataDir"] != "2020":
                continue
            set_path = ROOT / c["dataRoot"] / "2020"
            mpath = set_path / "elections.json"
            if not mpath.exists():
                continue
            manifest = json.load(mpath.open())
            for e in manifest["elections"]:
                if e.get("district"):
                    continue
                seen = set()
                for r in csv.DictReader((set_path / e["raceFile"]).open()):
                    key = (r["party"].strip().upper(), r["candidate"].strip())
                    if key in seen or not r["party"].strip():
                        continue
                    seen.add(key)
                    head = r["candidate"].split("/")[0].strip()
                    words = [w for w in re.sub(r"[^A-Za-z ]", " ", head).split() if len(w) > 2]
                    if not words:
                        continue
                    last3 = words[-1][:3].upper()
                    index[(key[0], last3)][(r["candidate"].strip(), e["office"] or e["displayName"])] += 1
    return index


def decode_columns(cols, name_index):
    """Map each VEST result column to (race_key, office_name, party, candidate).
    Race grouping: columns share a race iff their decoded office matches."""
    decoded = []
    for col, off3, letter, cand3 in cols:
        party = LETTER_PARTY.get(letter, "")
        if party:
            consensus = name_index.get((party, cand3))
            if consensus:
                (full_name, office_name), _ = consensus.most_common(1)[0]
                decoded.append((col, off3, party, full_name, office_name))
                continue
            # official candidate with no name consensus — keep code visible
            decoded.append((col, off3, party, f"{party} candidate {cand3}", None))
        else:  # 'O' — write-ins
            decoded.append((col, off3, "", "Write-in", None))

    # group by office name (fill unknown office from groupmates sharing office3)
    by_off3 = defaultdict(list)
    for d in decoded:
        by_off3[d[1]].append(d)
    races = defaultdict(list)  # office_name -> [(col, party, candidate)]
    for off3, group in by_off3.items():
        named = [d for d in group if d[4]]
        # multi-race office codes (SSC/SCC): assign unnamed/write-in columns to
        # the race of the same off3 ONLY if that off3 has exactly one race
        offices_here = sorted({d[4] for d in named})
        for col, _o, party, cand, office_name in group:
            if office_name:
                races[office_name].append((col, party, cand))
            elif len(offices_here) == 1:
                races[offices_here[0]].append((col, party, cand))
            elif offices_here:
                # ambiguous (multi-seat court write-ins) — skip, recorded by caller
                races["__skipped__"].append((col, party, cand))
    return races


def county_rows(sf, fields, cnty):
    rows = []
    for i in range(len(sf)):
        if sf.record(i)["CNTY"] != cnty:
            continue
        rec = dict(zip(fields, list(sf.record(i))))
        rows.append((i, rec))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--county", help="single county slug")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    registry = json.load(REGISTRY_PATH.open())
    report = json.load(REPORT_PATH.open()) if REPORT_PATH.exists() else {}

    sf = shapefile.Reader(SHP)
    fields = [f[0] for f in sf.fields[1:]]
    prj = Path(SHP).with_suffix(".prj").read_text()
    transformer = Transformer.from_crs(CRS.from_wkt(prj), CRS.from_epsg(4326), always_xy=True)
    cols = result_columns(fields)

    print("Building candidate-name consensus from verified live counties…")
    name_index = build_name_index()
    races_map = decode_columns(cols, name_index)
    skipped_cols = races_map.pop("__skipped__", [])
    print(f"  decoded {sum(len(v) for v in races_map.values())} columns into "
          f"{len(races_map)} races; skipped {len(skipped_cols)} ambiguous columns")
    for office, members in sorted(races_map.items()):
        print(f"    {office}: {[c for _, _, c in members]}")

    targets = [c for c in registry if c["status"] != "live"
               and (not args.county or c["slug"] == args.county)]
    print(f"\nIngesting {len(targets)} counties from VEST\n")

    done = 0
    for entry in targets:
        slug, name = entry["slug"], entry["name"]
        cnty = int(entry["fips"][2:])
        rows = county_rows(sf, fields, cnty)
        if not rows:
            print(f"  {name}: NOT in VEST — stays placeholder")
            continue

        set_path = ROOT / "data/tx" / slug / "2020"
        features = []
        race_long = defaultdict(list)   # office -> [(precinct, party, cand, votes)]
        turnout_rows = []
        for i, rec in rows:
            prec = str(rec["PREC"]).strip()
            precinct = prec.lstrip("0") or prec
            registered = rec.get("G20VR")
            turnout_rows.append((precinct, str(int(registered)) if registered not in (None, "") else "", "", ""))
            for office, members in races_map.items():
                for col, party, cand in members:
                    race_long[office].append((precinct, party, cand, int(rec.get(col) or 0)))
            if not args.dry_run:
                geom = shape(sf.shape(i).__geo_interface__).simplify(SIMPLIFY_TOLERANCE_M, preserve_topology=True)
                gj = mapping(geom)

                def rp(c):
                    if isinstance(c[0], (int, float)):
                        x, y = transformer.transform(c[0], c[1])
                        return [round(x, 6), round(y, 6)]
                    return [rp(x) for x in c]
                features.append({"type": "Feature",
                                 "properties": {"PRECINCT": precinct, "VTD": prec},
                                 "geometry": {"type": gj["type"], "coordinates": rp(list(gj["coordinates"]))}})

        manifest_elections = []
        for office, long_rows in sorted(race_long.items()):
            base = sanitize_filename(office)
            filename = f"{base}_2020.csv"
            manifest_elections.append({
                "id": re.sub(r"[^a-z0-9]+", "-", f"{base}-2020".lower()).strip("-"),
                "displayName": f"{office} (2020)",
                "office": office, "district": None,
                "year": 2020, "date": "2020-11-03",
                "category": categorize_election_python(filename),
                "raceFile": f"races/{filename}",
                "turnoutFile": "turnout/2020-11-03.csv",
                "sourceUrl": SOURCE_URL,
            })
            if not args.dry_run:
                write_race_csv(set_path / "races" / filename, sorted(long_rows))

        if not args.dry_run:
            write_turnout_csv(set_path / "turnout" / "2020-11-03.csv",
                              sorted(turnout_rows, key=lambda r: (len(r[0]), r[0])))
            write_manifest(set_path / "elections.json", slug, "2020", manifest_elections)
            out = ROOT / "data/tx" / slug / "boundaries" / "2020.geojson"
            out.parent.mkdir(parents=True, exist_ok=True)
            with out.open("w") as f:
                json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))

            entry["status"] = "live"
            entry["dataRoot"] = f"data/tx/{slug}"
            entry["defaultBoundarySet"] = "original"
            entry["boundarySets"] = {"original": {
                "label": f"2020 Precincts ({len(features)})",
                "geojson": "boundaries/2020.geojson", "dataDir": "2020"}}
            entry["notes"] = ("Statewide races only, ingested directly from VEST official "
                              "precinct returns (OpenElections data for this county failed "
                              "verification or could not be mapped — see AUDIT_REPORT)")
            prior = report.get(slug, {})
            report[slug] = {"wave": "vest-direct", "status": "live",
                            "gates": {"source": "VEST official precinct returns (intrinsic join)",
                                      "races": len(manifest_elections),
                                      "precincts": len(features)},
                            "prior_attempt": {"reason": prior.get("reason"), "wave": prior.get("wave")}}
            json.dump(registry, REGISTRY_PATH.open("w"), indent=2)
            json.dump(report, REPORT_PATH.open("w"), indent=2, sort_keys=True)
        done += 1
        print(f"  {name}: {'would ingest' if args.dry_run else 'LIVE'} — "
              f"{len(race_long)} races, {len(rows)} precincts")

    print(f"\n{done} counties ingested from VEST")


if __name__ == "__main__":
    main()
