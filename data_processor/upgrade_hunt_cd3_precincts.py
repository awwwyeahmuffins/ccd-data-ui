#!/usr/bin/env python3
"""upgrade_hunt_cd3_precincts.py — replace Hunt County's DERIVED CD-3 totals with
its REAL precinct-level results pulled live from Hunt County's official Clarity
Elections portal.

Background: CD-3 spans Collin + Hunt. Hunt's 2022/2024 U.S. Rep results were
never in our OpenElections source, so add_hunt_cd3.py originally folded Hunt in
as a single county-total `hunt:ALL` row DERIVED by subtraction (official full
district minus our Collin portion). Hunt County, however, publishes its actual
canvassed precinct results on Clarity — so this upgrades the estimate to the
county's own official precinct-level numbers (fetch_clarity_results.py).

Hunt reports split precincts (e.g. "101 - SBL" ballot styles); we sum each split
back to its base voting precinct ("101") — lossless — and write one
`hunt:<precinct>` row per candidate, replacing any prior `hunt:*` rows while
leaving Collin's precinct rows untouched.

NOTE ON THE MAP: these precinct codes are Hunt's own voting-precinct numbers,
which do NOT align with the TLC VTD geometry we carry for Hunt (VTD 210/211/214
vs county 110/111/214A…). So the data is now real precinct-level, but the command
center still draws Hunt as a single county outline (summed from these rows) until
Hunt precinct boundaries are sourced. No fabrication either way.

Usage: python3 data_processor/upgrade_hunt_cd3_precincts.py [--dry-run]
"""
import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fetch_clarity_results import current_ver, detail_xml, parse_contest  # noqa: E402

ROOT = Path(__file__).parent.parent / "data/tx/districts/cd-3/data"
COUNTY = "Hunt"

# (race file, Clarity election id, contest match, party-case formatter)
JOBS = [
    ("races/U_S_Representative_District_3_2022.csv", "115635",
     "United States Representative District 3", str.upper),
    ("races/United_States_Representative_District_3_2024.csv", "122429",
     "United States Representative District 3", str.capitalize),
]


def base_precinct(name):
    """'101 - SBL' -> '101'; '215B - CJO' -> '215B'. Strip the ballot-style tail."""
    return re.split(r"\s*-\s*", name.strip())[0]


def fetch_hunt_rows(eid, contest, party_fmt):
    ver = current_ver(COUNTY, eid)
    if not ver:
        raise SystemExit(f"could not resolve Clarity version for Hunt/{eid}")
    _found, rows = parse_contest(detail_xml(COUNTY, eid, ver), contest)
    if not rows:
        raise SystemExit(f"no contest matched '{contest}' in Hunt/{eid}")
    # sum split precincts back to base precinct, per (precinct, party, candidate)
    agg = defaultdict(int)
    for pct, party, cand, votes in rows:
        agg[(base_precinct(pct), party, cand)] += votes
    out = []
    for (pct, party, cand), votes in sorted(agg.items()):
        out.append([f"hunt:{pct}", party_fmt(party) if party else "", cand, votes])
    return out


def rewrite(rel, hunt_rows, dry):
    path = ROOT / rel
    with path.open(newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        kept = [r for r in reader if not (r and r[0].startswith("hunt:"))]
    total = sum(r[3] for r in hunt_rows)
    pcts = len({r[0] for r in hunt_rows})
    print(f"{rel}: {len(kept)} collin/other rows kept, replacing prior hunt rows "
          f"with {len(hunt_rows)} precinct rows ({pcts} precincts, {total} votes)")
    if dry:
        for r in hunt_rows[:4]:
            print("   e.g.", r)
        return
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(kept)
        w.writerows(hunt_rows)


def update_provenance(dry):
    p = ROOT / "profile" / "provenance.json"
    prov = json.load(p.open())
    prov.setdefault("amendments", []).append({
        "date": "2026-06-14",
        "what": "Replaced Hunt County's DERIVED CD-3 U.S. Representative totals (2022, 2024) "
                "with Hunt County's OFFICIAL precinct-level results from its Clarity Elections portal.",
        "method": "fetch_clarity_results.py → results.enr.clarityelections.com/TX/Hunt "
                  "(2022 election 115635, 2024 election 122429); split ballot-style precincts "
                  "summed to base voting precinct. Official Hunt totals: 2024 Self 31,457 / "
                  "Srivastava 8,721; 2022 Self 20,617 / Srivastava 5,396 / Claytor 495.",
        "note": "Supersedes the earlier subtraction-derived estimate (2024 had been 31,473 / 8,731). "
                "Precinct codes are Hunt's voting precincts; map still shows Hunt as a county outline "
                "(VTD geometry unaligned).",
    })
    if dry:
        print("provenance.json: would append Clarity-source amendment")
        return
    json.dump(prov, p.open("w"), indent=4)
    print("provenance.json: amendment recorded")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    for rel, eid, contest, fmt in JOBS:
        rewrite(rel, fetch_hunt_rows(eid, contest, fmt), args.dry_run)
    update_provenance(args.dry_run)


if __name__ == "__main__":
    main()
