#!/usr/bin/env python3
"""add_hunt_cd3.py — fold Hunt County's portion of Congressional District 3 into
the CD-3 district view for the U.S. Representative District 3 races (2022, 2024).

CD-3 spans Collin (173 precincts) + Hunt (30 precincts) under the 2021 plan
(PLANC2193), but our Hunt source data was 2020-vintage only, so Hunt's 2022/2024
US-Rep results were never imported. We recover Hunt's county-level total as the
official full-district result minus our (official-sourced) Collin portion:

  Hunt = full_district(official) - collin(ours)

Source for full-district totals: official canvass via Wikipedia / Ballotpedia
(Texas SOS). VERIFICATION: the derived Hunt 2024 split is 78.3% Self / 21.7%
Srivastava, which matches the independently reported Hunt County 2024 result to
the tenth — so the subtraction is sound. Stored as a single "hunt:ALL" county
aggregate per candidate, matching the Collin-focus reduction's representation of
non-Collin counties (county totals, no precinct detail).
"""
import csv
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "data", "tx", "districts", "cd-3", "data")

# party prefix case differs per file (2022 uppercase, 2024 mixed) — match the file.
HUNT_ROWS = {
    "races/U_S_Representative_District_3_2022.csv": [
        ("REP", "Keith Self", 20617),
        ("DEM", "Sandeep Srivastava", 5396),
        ("LIB", "Christopher Claytor", 495),
    ],
    "races/United_States_Representative_District_3_2024.csv": [
        ("Rep", "Keith Self", 31473),
        ("Dem", "Sandeep Srivastava", 8731),
    ],
}


def add_rows(rel, rows):
    path = os.path.join(ROOT, rel)
    with open(path, newline="") as f:
        existing = list(csv.reader(f))
    have_hunt = any(r and r[0].startswith("hunt:") for r in existing)
    if have_hunt:
        print(f"  {rel}: already has hunt rows — skipping")
        return
    with open(path, "a", newline="") as f:
        w = csv.writer(f)
        for party, cand, votes in rows:
            w.writerow([f"hunt:ALL", party, cand, votes])
    print(f"  {rel}: added {len(rows)} hunt:ALL rows")


def update_provenance():
    p = os.path.join(ROOT, "profile", "provenance.json")
    prov = json.load(open(p))
    prov.setdefault("amendments", []).append({
        "date": "2026-06-14",
        "what": "Added Hunt County's CD-3 U.S. Representative results (2022, 2024) as county-level hunt:ALL aggregates.",
        "method": "Hunt = official full-district total (Texas SOS via Wikipedia/Ballotpedia) minus our Collin portion. Verified: derived Hunt 2024 = 78.3% Self / 21.7% Srivastava, matching the reported Hunt County 2024 result.",
        "values": {
            "2022": {"Keith Self (R)": 20617, "Sandeep Srivastava (D)": 5396, "Christopher Claytor (L)": 495},
            "2024": {"Keith Self (R)": 31473, "Sandeep Srivastava (D)": 8731},
        },
    })
    json.dump(prov, open(p, "w"), indent=4)
    print("  provenance.json: amendment recorded")


def main():
    for rel, rows in HUNT_ROWS.items():
        add_rows(rel, rows)
    update_provenance()


if __name__ == "__main__":
    main()
