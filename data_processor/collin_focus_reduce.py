#!/usr/bin/env python3
"""collin_focus_reduce.py — narrow the Collin-touching district views to a
Collin-specific shape.

For each district that includes Collin, keep Collin precincts at full
precinct-level detail and collapse every non-Collin county into a single
aggregate row per (county, candidate) — so the FULL district race result is
preserved (Collin precincts + per-county totals for the rest) while no
non-Collin precinct-level rows remain. Profiles (lean / racial) and the
boundary geojson are trimmed to Collin precincts only (the rest aren't rendered
or scored).

Idempotent-ish: re-running collapses already-collapsed `<county>:ALL` rows back
onto themselves (same totals). Everything is under git, so revert if needed.
"""
import csv
import io
import json
import os
import sys

DISTRICTS = ["cd-3", "cd-32", "cd-4", "hd-33", "hd-61", "hd-66", "hd-67",
             "hd-70", "hd-89", "sd-2", "sd-30", "sd-8"]
ROOT = os.path.join(os.path.dirname(__file__), "..", "data", "tx", "districts")


def is_collin(pc):
    return str(pc).startswith("collin:")


def county_of(pc):
    s = str(pc)
    return s.split(":", 1)[0] if ":" in s else s


def reduce_csv(path, key_cols, val_cols):
    """Keep collin: rows; aggregate non-collin rows into <county>:ALL rows
    summing val_cols, grouped by (county, *key_cols)."""
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)
    if not fields or "precinct" not in fields:
        return 0
    kept, agg = [], {}
    for r in rows:
        pc = r.get("precinct", "")
        if is_collin(pc):
            kept.append(r)
            continue
        county = county_of(pc)
        gk = (county,) + tuple(r.get(k, "") for k in key_cols)
        a = agg.get(gk)
        if a is None:
            a = {fld: "" for fld in fields}
            a["precinct"] = f"{county}:ALL"
            for k in key_cols:
                a[k] = r.get(k, "")
            for v in val_cols:
                a[v] = 0
            agg[gk] = a
        for v in val_cols:
            try:
                a[v] += int(float(r.get(v, 0) or 0))
            except (ValueError, TypeError):
                pass
    out = kept + list(agg.values())
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields)
    w.writeheader()
    w.writerows(out)
    with open(path, "w", newline="") as f:
        f.write(buf.getvalue())
    return len(rows) - len(out)


def filter_profile(path, col):
    """Keep only collin: rows."""
    if not os.path.exists(path):
        return 0
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)
    if not fields or col not in fields:
        return 0
    kept = [r for r in rows if is_collin(r.get(col, ""))]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields)
    w.writeheader()
    w.writerows(kept)
    with open(path, "w", newline="") as f:
        f.write(buf.getvalue())
    return len(rows) - len(kept)


def trim_geojson(path):
    if not os.path.exists(path):
        return 0
    g = json.load(open(path))
    before = len(g.get("features", []))
    g["features"] = [ft for ft in g["features"]
                     if is_collin(ft.get("properties", {}).get("PRECINCT", ""))]
    json.dump(g, open(path, "w"))
    return before - len(g["features"])


def main():
    total = {"races": 0, "turnout": 0, "profile": 0, "geo": 0}
    for slug in DISTRICTS:
        base = os.path.join(ROOT, slug)
        if not os.path.isdir(base):
            print(f"  skip {slug}: not found")
            continue
        races = os.path.join(base, "data", "races")
        turn = os.path.join(base, "data", "turnout")
        prof = os.path.join(base, "data", "profile")
        dropped = {"races": 0, "turnout": 0, "profile": 0, "geo": 0}
        for fn in sorted(os.listdir(races)) if os.path.isdir(races) else []:
            if fn.endswith(".csv"):
                dropped["races"] += reduce_csv(os.path.join(races, fn),
                                               ["party", "candidate"], ["votes"])
        for fn in sorted(os.listdir(turn)) if os.path.isdir(turn) else []:
            if fn.endswith(".csv"):
                dropped["turnout"] += reduce_csv(os.path.join(turn, fn),
                                                 [], ["registered", "ballots_cast", "blank"])
        dropped["profile"] += filter_profile(os.path.join(prof, "dnc_scores.csv"), "Precinct")
        dropped["profile"] += filter_profile(os.path.join(prof, "racial.csv"), "precinct")
        dropped["geo"] += trim_geojson(os.path.join(base, "boundaries", "members.geojson"))
        for k in total:
            total[k] += dropped[k]
        print(f"  {slug:8s} collapsed rows — races:{dropped['races']} turnout:{dropped['turnout']} "
              f"profile:{dropped['profile']} geo-features:{dropped['geo']}")
    print(f"TOTAL non-collin rows collapsed/removed: {total}")


if __name__ == "__main__":
    main()
