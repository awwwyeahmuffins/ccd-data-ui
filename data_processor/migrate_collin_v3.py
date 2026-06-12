#!/usr/bin/env python3
"""
Migrate Collin County's legacy wide-format election data to the v3 normalized
layout (docs/DATA_LAYOUT_SPEC.md v3). Value-faithful: every vote count, turnout
number, and empty cell is preserved exactly; only the SHAPE changes. Derived
columns (Winning Candidate/Party, PRECINCT NAME, COUNTY NUMBER) are dropped —
winners are recomputed at load time by js/v3Pivot.js with the identical rule.

  data/        (2024 boundaries) -> data/tx/collin/2024/{races,turnout,profile}
  data/2026/   (2026 remap)      -> data/tx/collin/2026/{races,turnout,profile}
  geojsons                       -> data/tx/collin/boundaries/{2024,2026}.geojson
  crosswalk CSVs                 -> data/tx/collin/crosswalks/

Only manifest-referenced CSVs migrate; orphans are reported and skipped (they
are invisible to the app today and retire with the legacy dirs).

Turnout extraction: races within one manifest year are clustered greedily in
manifest order — a race joins the first cluster whose shared precincts all
agree exactly on (registered, ballots_cast, blank), else starts a new cluster
(turnout/<year>.csv, turnout/<year>-2.csv, ...). Conflicts are REPORTED, never
averaged or guessed. Races with unknown year use the 'undated' key.

Run:  python3 data_processor/migrate_collin_v3.py [--dry-run]
"""

import argparse
import csv
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from v3_writer import write_race_csv, write_turnout_csv, write_manifest  # noqa: E402

ROOT = Path(__file__).parent.parent
OUT_ROOT = ROOT / "data/tx/collin"

META_STATIC = ["COUNTY NUMBER", "PRECINCT CODE", "PRECINCT NAME",
               "REGISTERED VOTERS TOTAL", "BALLOTS CAST TOTAL", "BALLOTS CAST BLANK"]
SPECIAL_COLS = {"Write-in": "Write-in", "OVER VOTES": "Over Votes", "UNDER VOTES": "Under Votes"}
DROPPED = {"Winning Candidate", "Winning Party"}
PARTY_TOKENS = {"rep", "dem", "lib", "grn", "mod", "ind", "con", "non"}

SETS = [
    {"set": "original", "dir": ROOT / "data", "out": OUT_ROOT / "2024",
     "geojson_src": ROOT / "data/Voting_Precincts.geojson", "geojson_dst": OUT_ROOT / "boundaries/2024.geojson"},
    {"set": "2026", "dir": ROOT / "data/2026", "out": OUT_ROOT / "2026",
     "geojson_src": ROOT / "data/Voting_Precincts_2026.geojson", "geojson_dst": OUT_ROOT / "boundaries/2026.geojson"},
]

PROFILE_FILES = [  # (legacy name, v3 name)
    ("DNC Score By Precinct.csv", "dnc_scores.csv"),
    ("Racial Numbers by Precinct.csv", "racial.csv"),
    ("precinct_census_profiles.json", "census_profiles.json"),
    ("strategic_intelligence.json", "strategic_intelligence.json"),
    ("precinct_metadata.json", "precinct_metadata.json"),
]

CROSSWALKS = ["crosswalk_old_to_new.csv", "crosswalk_voter_based.csv", "precinct_to_bg_crosswalk.csv"]


def split_party(col):
    """Return (party, candidate) for a wide candidate column, preserving case.
    Split is reversible: party + ' ' + candidate == col whenever party != ''."""
    if " " in col:
        tok, rest = col.split(" ", 1)
        if tok.lower() in PARTY_TOKENS:
            return tok, rest
    return "", col


def unpivot_csv(path):
    """Read a wide CSV; return (long_rows, turnout_map, report_notes)."""
    with path.open(newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        return [], {}, ["EMPTY FILE"]
    header = list(rows[0].keys())
    candidate_cols = [c for c in header
                      if c not in META_STATIC and c not in SPECIAL_COLS and c not in DROPPED]
    long_rows, turnout = [], {}
    for r in rows:
        pct = (r.get("PRECINCT CODE") or "").strip()
        if not pct:
            continue
        turnout[pct] = ((r.get("REGISTERED VOTERS TOTAL") or "").strip(),
                        (r.get("BALLOTS CAST TOTAL") or "").strip(),
                        (r.get("BALLOTS CAST BLANK") or "").strip())
        for col in candidate_cols:
            party, cand = split_party(col)
            long_rows.append((pct, party, cand, (r.get(col) or "").strip()))
        for col, pseudo in SPECIAL_COLS.items():
            if col in r and r.get(col) is not None:
                long_rows.append((pct, "", pseudo, (r.get(col) or "").strip()))
    return long_rows, turnout, []


def parse_office_district(display_name, year):
    """Conservative office/district extraction; never guesses beyond the
    obvious '... District <token> ...' pattern."""
    name = display_name or ""
    name = re.sub(r"\s*\(\d{4}\)\s*$", "", name).strip()
    m = re.search(r"\bDistrict\s+(?:No\.?\s*)?([\w-]+)", name, re.I)
    district = m.group(1) if m else None
    return (name or None), district


def cluster_turnout(races_in_year):
    """Greedy deterministic clustering: list of (race_id, turnout_map) ->
    list of clusters [{'map': merged, 'members': [ids]}] + conflict notes."""
    clusters, conflicts = [], []
    for race_id, tmap in races_in_year:
        placed = False
        for ci, cl in enumerate(clusters):
            clash = [p for p, t in tmap.items() if p in cl["map"] and cl["map"][p] != t]
            if not clash:
                cl["map"].update(tmap)
                cl["members"].append(race_id)
                placed = True
                break
            elif ci == 0:
                conflicts.append((race_id, clash[:5]))
        if not placed:
            clusters.append({"map": dict(tmap), "members": [race_id]})
    return clusters, conflicts


def migrate_set(cfg, dry_run):
    legacy_dir, out_dir, set_id = cfg["dir"], cfg["out"], cfg["set"]
    manifest_path = legacy_dir / "elections.json"
    entries = json.load(manifest_path.open())
    print(f"\n=== {legacy_dir} -> {out_dir}  ({len(entries)} manifest entries)")

    referenced = {e["filename"] for e in entries}
    orphans = sorted(p.name for p in legacy_dir.glob("*.csv")
                     if p.name not in referenced and p.name not in dict(PROFILE_FILES)
                     and p.name not in CROSSWALKS)
    if orphans:
        print(f"  orphan CSVs skipped (not in manifest): {len(orphans)}")

    per_year = {}        # year -> [(race_id, turnout_map)]
    race_outputs = []    # (entry, race_id, long_rows)
    for e in entries:
        src = legacy_dir / e["filename"]
        if not src.exists():
            print(f"  MISSING file referenced by manifest: {e['filename']}")
            continue
        long_rows, turnout, notes = unpivot_csv(src)
        race_id = re.sub(r"[^a-z0-9]+", "-", Path(e["filename"]).stem.lower()).strip("-")
        year = e.get("year")
        per_year.setdefault(year, []).append((race_id, turnout))
        race_outputs.append((e, race_id, long_rows))
        for n in notes:
            print(f"  note [{e['filename']}]: {n}")

    # Turnout clustering per year
    turnout_file_for_race = {}
    turnout_files = {}  # relpath -> merged map
    for year, items in per_year.items():
        clusters, conflicts = cluster_turnout(items)
        key = str(year) if year else "undated"
        for i, cl in enumerate(clusters):
            rel = f"turnout/{key}.csv" if i == 0 else f"turnout/{key}-{i+1}.csv"
            turnout_files[rel] = cl["map"]
            for rid in cl["members"]:
                turnout_file_for_race[rid] = rel
        if len(clusters) > 1:
            print(f"  year {key}: {len(clusters)} turnout clusters "
                  f"(sizes {[len(c['members']) for c in clusters]})")
        for rid, pcts in conflicts:
            print(f"    conflict: {rid} disagrees with cluster 1 on precincts {pcts}")

    # Emit
    manifest_elections = []
    for e, race_id, long_rows in race_outputs:
        base = Path(e["filename"]).stem
        race_rel = f"races/{base}.csv"
        office, district = parse_office_district(e.get("displayName"), e.get("year"))
        manifest_elections.append({
            "id": race_id,
            "displayName": e.get("displayName"),
            "office": office,
            "district": district,
            "year": e.get("year"),
            "date": None,  # unknowable from legacy data — never guessed
            "category": e.get("category"),
            "raceFile": race_rel,
            "turnoutFile": turnout_file_for_race.get(race_id),
            "sourceUrl": e.get("sourceUrl"),
        })
        if not dry_run:
            write_race_csv(out_dir / race_rel, long_rows)

    if not dry_run:
        for rel, tmap in turnout_files.items():
            rows = sorted(((p, *t) for p, t in tmap.items()),
                          key=lambda r: (len(r[0]), r[0]))
            write_turnout_csv(out_dir / rel, rows)
        write_manifest(out_dir / "elections.json", "collin", set_id, manifest_elections)

        # Profile extras
        for legacy_name, v3_name in PROFILE_FILES:
            src = legacy_dir / legacy_name
            if src.exists():
                dst = out_dir / "profile" / v3_name
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)

        # Boundary geojson
        if cfg["geojson_src"].exists():
            cfg["geojson_dst"].parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(cfg["geojson_src"], cfg["geojson_dst"])

    print(f"  races: {len(race_outputs)}  turnout files: {len(turnout_files)}  "
          f"profile files copied: {sum(1 for n, _ in PROFILE_FILES if (legacy_dir / n).exists())}")
    return len(race_outputs)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    total = 0
    for cfg in SETS:
        total += migrate_set(cfg, args.dry_run)

    if not args.dry_run:
        # Crosswalks (pipeline artifacts, app never fetches them)
        cw_dir = OUT_ROOT / "crosswalks"
        for name in CROSSWALKS:
            for legacy_dir in (ROOT / "data", ROOT / "data/2026"):
                src = legacy_dir / name
                if src.exists():
                    cw_dir.mkdir(parents=True, exist_ok=True)
                    suffix = "" if legacy_dir.name == "data" else "_2026"
                    stem, ext = name.rsplit(".", 1)
                    shutil.copy2(src, cw_dir / (f"{stem}{suffix}.{ext}"))

    print(f"\n{'DRY RUN — nothing written' if args.dry_run else f'Done: {total} races migrated to {OUT_ROOT}'}")
    print("Next: run data_processor/verify_v3_migration.py before flipping the registry.")


if __name__ == "__main__":
    main()
