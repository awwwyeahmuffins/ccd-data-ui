#!/usr/bin/env python3
"""
Profile-layer generation for every live county EXCEPT Collin (whose profile
data comes from its voter file + ACS pipeline and is never touched here).

Two outputs per county, written to <dataRoot>/<setDir>/profile/:

1. racial.csv — OFFICIAL Census 2020 race data published by the Texas
   Legislative Council per VTD (VTDs_22G_Pop / VTDs20G_Pop), keyed to the
   exact boundary geography each county uses. Real data only; counties whose
   pop rows can't be keyed are skipped (app shows N/A).
   Columns: anglo->white, asian, black, hisp->hispanic,
   others = total - (anglo+asian+black+hisp).

2. dnc_scores.csv — party lean. Collin's file holds voter-file scores; no
   such data exists statewide, so this is a documented VOTE-DERIVED ESTIMATE
   (user-approved algorithm): for each precinct, average REP / DEM / everyone-
   else votes across the county's statewide races that field both a REP and a
   DEM candidate. Shares follow; Winning Party = max share; Party Strength
   from the two-party share gap: <0.10 -> 1, <0.30 -> 2, else 3 (calibrated
   to Collin's observed bands). Full provenance in profile/provenance.json.

Usage: python3 data_processor/derive_profiles.py [--county slug] [--dry-run]
"""

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent.parent
REGISTRY_PATH = ROOT / "data/tx/counties.json"
POP_FILES = {"2022": "/tmp/VTDs_22G_Pop.txt", "2020": "/tmp/VTDs20G_Pop.txt"}
GENERATED_ON = "2026-06-12"

STRENGTH_BANDS = ((0.10, 1), (0.30, 2), (9.9, 3))


def strength(gap):
    for cut, s in STRENGTH_BANDS:
        if gap < cut:
            return s
    return 3


def load_pop(path):
    """CNTY(int) -> { lstrip0(VTD): {white,asian,black,hispanic,others,total} }"""
    out = defaultdict(dict)
    with open(path) as f:
        for r in csv.DictReader(f):
            cnty = int(r["CNTY"])
            vtd = str(r["VTD"]).strip()
            key = vtd.lstrip("0") or vtd
            total = int(float(r["total"] or 0))
            anglo = int(float(r["anglo"] or 0))
            asian = int(float(r["asian"] or 0))
            black = int(float(r["black"] or 0))
            hisp = int(float(r["hisp"] or 0))
            out[cnty][key] = {
                "white": anglo, "asian": asian, "black": black, "hispanic": hisp,
                "others": max(total - (anglo + asian + black + hisp), 0),
                "total": total, "_vtd": vtd,
            }
    return out


def pop_for_boundary(county_pop, boundary_codes):
    """Match pop rows to boundary precincts; lettered sub-VTDs (0179A/B) are
    summed into their dissolved base when that's what the boundary carries."""
    matched = {}
    leftovers = []
    for key, vals in county_pop.items():
        if key in boundary_codes:
            matched.setdefault(key, []).append(vals)
        else:
            leftovers.append((key, vals))
    import re
    for key, vals in leftovers:
        m = re.fullmatch(r"0*(\d+)[A-Za-z]{1,2}", vals["_vtd"])
        if m and m.group(1) in boundary_codes:
            matched.setdefault(m.group(1), []).append(vals)
    out = {}
    for key, groups in matched.items():
        agg = {f: sum(g[f] for g in groups)
               for f in ("white", "asian", "black", "hispanic", "others", "total")}
        out[key] = agg
    return out


def write_racial(profile_dir, pop, dry_run):
    rows = []
    for prec in sorted(pop, key=lambda c: (len(c), c)):
        v = pop[prec]
        t = v["total"]
        def pct(n):
            return f"{(n / t * 100):.2f}%" if t else "0.00%"
        rows.append([prec, v["asian"], v["black"], v["hispanic"], v["others"],
                     v["white"], t, pct(v["asian"]), pct(v["black"]),
                     pct(v["hispanic"]), pct(v["others"]), pct(v["white"])])
    if not dry_run:
        profile_dir.mkdir(parents=True, exist_ok=True)
        with (profile_dir / "racial.csv").open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["precinct", "asian", "black", "hispanic", "others", "white",
                        "total", "pct_asian", "pct_black", "pct_hispanic",
                        "pct_others", "pct_white"])
            w.writerows(rows)
    return len(rows)


STATEWIDE_OFFICE_WORDS = (
    "governor", "attorney general", "comptroller", "land office",
    "agriculture", "railroad", "president", "senat",  # US senate (state senat excluded below)
    "supreme court", "court of criminal appeals", "chief justice",
)
STATEWIDE_EXCLUDES = ("state senat", "state rep", "district", "county", "justice of the peace")


def is_statewide_office(office):
    o = (office or "").lower()
    return any(w in o for w in STATEWIDE_OFFICE_WORDS) and not any(x in o for x in STATEWIDE_EXCLUDES)


def derive_party_lean(set_path):
    """Vote-derived lean. Returns (rows, races_used) — rows keyed by precinct."""
    manifest = json.load((set_path / "elections.json").open())
    per_precinct = defaultdict(lambda: defaultdict(list))  # precinct -> bucket -> [votes/race]
    races_used = []
    for e in manifest["elections"]:
        if e.get("district"):
            continue
        if not is_statewide_office(e.get("office")):
            continue
        path = set_path / e["raceFile"]
        by_pct = defaultdict(lambda: {"rep": 0, "dem": 0, "mod": 0})
        parties = set()
        for r in csv.DictReader(path.open()):
            cand = r["candidate"].strip()
            if cand in ("Over Votes", "Under Votes"):
                continue
            party = r["party"].strip().upper()
            votes = int(r["votes"] or 0)
            parties.add(party)
            pct = r["precinct"].strip()
            if party == "REP":
                by_pct[pct]["rep"] += votes
            elif party == "DEM":
                by_pct[pct]["dem"] += votes
            else:
                by_pct[pct]["mod"] += votes
        if "REP" not in parties or "DEM" not in parties:
            continue  # props/uncontested races would skew the estimate
        races_used.append(e["id"])
        for pct, b in by_pct.items():
            for k in ("rep", "dem", "mod"):
                per_precinct[pct][k].append(b[k])

    rows = []
    for pct in sorted(per_precinct, key=lambda c: (len(c), c)):
        b = per_precinct[pct]
        rep = round(sum(b["rep"]) / len(b["rep"])) if b["rep"] else 0
        dem = round(sum(b["dem"]) / len(b["dem"])) if b["dem"] else 0
        mod = round(sum(b["mod"]) / len(b["mod"])) if b["mod"] else 0
        total = rep + dem + mod
        if total == 0:
            continue
        rs, ds, ms = rep / total, dem / total, mod / total
        winning = max((("Rep", rs), ("Dem", ds), ("Mod", ms)), key=lambda kv: kv[1])[0]
        rows.append([pct, rep, mod, dem, total,
                     f"{rs:.10f}", f"{ms:.10f}", f"{ds:.10f}",
                     winning, strength(abs(rs - ds))])
    return rows, races_used


def write_lean(profile_dir, rows, races_used, dry_run):
    if dry_run:
        return
    profile_dir.mkdir(parents=True, exist_ok=True)
    with (profile_dir / "dnc_scores.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Precinct", "Rep", "Mod", "Dem", "Total",
                    "Rep Share", "Mod Share", "Dem Share", "Winning Party", "Party Strength"])
        w.writerows(rows)
    prov_path = profile_dir / "provenance.json"
    prov = json.load(prov_path.open()) if prov_path.exists() else {}
    prov["dnc_scores.csv"] = {
        "method": "vote-derived-party-lean-v1",
        "description": ("ESTIMATE derived from election results, not voter-file scores: "
                        "per precinct, REP/DEM/other votes averaged across the county's "
                        "statewide races fielding both a REP and a DEM candidate. "
                        "Party Strength bands on |repShare-demShare|: <0.10=1, <0.30=2, else 3."),
        "races_used": races_used,
        "generated": GENERATED_ON,
    }
    json.dump(prov, prov_path.open("w"), indent=2)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--county", help="single county slug")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    registry = json.load(REGISTRY_PATH.open())
    pops = {tier: load_pop(path) for tier, path in POP_FILES.items()}

    done = skipped = 0
    for entry in registry:
        slug = entry["slug"]
        if slug == "collin" or entry["status"] != "live":
            continue  # Collin's profile pipeline is its own; never touched here
        if args.county and slug != args.county:
            continue
        set_cfg = entry["boundarySets"][entry["defaultBoundarySet"]]
        tier = set_cfg["dataDir"]
        set_path = ROOT / entry["dataRoot"] / tier
        profile_dir = set_path / "profile"
        boundary = json.load((ROOT / entry["dataRoot"] / set_cfg["geojson"]).open())
        boundary_codes = {f["properties"]["PRECINCT"] for f in boundary["features"]}

        cnty = int(entry["fips"][2:])
        county_pop = pops.get(tier, {}).get(cnty, {})
        pop = pop_for_boundary(county_pop, boundary_codes)
        racial_n = write_racial(profile_dir, pop, args.dry_run) if pop else 0

        lean_rows, races_used = derive_party_lean(set_path)
        # lean rows must key to boundary precincts (they do — same files)
        write_lean(profile_dir, lean_rows, races_used, args.dry_run)

        pcov = len(pop) / max(len(boundary_codes), 1)
        flag = "" if pcov >= 0.98 else f"  (racial coverage {pcov:.0%})"
        print(f"  {entry['name']:<14} tier {tier}: lean {len(lean_rows)} precincts "
              f"({len(races_used)} races) · racial {racial_n} precincts{flag}")
        done += 1

    print(f"\n{done} counties processed{' (dry run)' if args.dry_run else ''}")


if __name__ == "__main__":
    main()
