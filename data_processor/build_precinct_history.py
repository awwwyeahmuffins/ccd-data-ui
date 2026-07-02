#!/usr/bin/env python3
"""
build_precinct_history.py — precompute per-precinct election data for precinct.html.

precinct.html used to fetch ALL ~587 race CSVs (~14 MB) and pivot each on the
main thread (js/precinctHistory.js loadAllElectionDataForHistory), then slice out
one precinct's row from each. This does the pivot ONCE at build time and writes a
tiny per-precinct file the page fetches on click.

Every precinct-page consumer (buildVotingHistory, getPrecinctResult /
getPrecinctCandidateData for margin-trend, turnout-gap, PVI, drilldown) only ever
looks up THIS precinct's row. So each file stores this precinct's pivoted legacy
row for every race it participated in — a drop-in for the old
`allElectionData[raceFile]` array (a 1-element array on the client):

    <dataRoot>/<dataDir>/history/<safe-precinct>.json
    { "precinct": "<code>",
      "races": { "<raceFile>": { "PRECINCT CODE": code,
                                 "REGISTERED VOTERS TOTAL": r,
                                 "BALLOTS CAST TOTAL": b, "BALLOTS CAST BLANK": k,
                                 "<Party Candidate>": votes, ...,
                                 "Winning Candidate": winnerCol,
                                 "Winning Party": party }, ... } }

The one genuinely cross-precinct value — county-wide Dem share, used only by
computePVI — is emitted once per boundary set:

    <dataRoot>/<dataDir>/history/county_baselines.json
    { "<raceFile>": <county Dem share 0..1>, ... }

Pivot / winner / participation rules mirror js/v3Pivot.js and
js/precinctHistory.js exactly:
  - candidate columns = "<party> <candidate>" (bare candidate when party empty and
    the row isn't a reserved write-in/over/under row),
  - a precinct participated iff its candidate-vote sum > 0,
  - winner = alphabetically-first column holding the strict max (first-max),
    winningParty = first whitespace token of that column,
  - county Dem share = sum(Dem votes) / sum(candidate votes) over all precincts.

Precinct file stems are sanitized ([^A-Za-z0-9._-] -> "_"); precinctHistory.js
applies the identical rule when fetching.

Usage:
    python3 data_processor/build_precinct_history.py            # all live entries
    python3 data_processor/build_precinct_history.py collin     # one slug
"""

import csv
import json
import os
import re
import shutil
import sys

# Reserved pseudo-candidate rows (party empty) — mirror of v3Pivot RESERVED_ROWS.
RESERVED = {"write-in", "over votes", "under votes"}


def safe_name(code):
    """Filesystem/URL-safe precinct file stem. Mirrored in precinctHistory.js."""
    return re.sub(r"[^A-Za-z0-9._-]", "_", str(code))


def load_manifest(data_dir):
    path = os.path.join(data_dir, "elections.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        m = json.load(f)
    elections = m.get("elections") if isinstance(m, dict) else m
    return elections if isinstance(elections, list) else None


def load_turnout(data_dir, turnout_file, cache):
    """precinct -> (registered, ballots_cast, blank) ints, cached per file."""
    if not turnout_file:
        return {}
    if turnout_file in cache:
        return cache[turnout_file]
    path = os.path.join(data_dir, turnout_file)
    out = {}
    if os.path.exists(path):
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                p = str(row.get("precinct", "")).strip()
                if not p:
                    continue
                out[p] = (
                    _int(row.get("registered")),
                    _int(row.get("ballots_cast")),
                    _int(row.get("blank")),
                )
    cache[turnout_file] = out
    return out


def _int(v):
    try:
        return int(float(v)) if v not in (None, "") else 0
    except (TypeError, ValueError):
        return 0


def race_by_precinct(race_path):
    """precinct -> {candidate_col: votes} accumulated from a long race CSV."""
    by_precinct = {}
    with open(race_path, newline="") as f:
        for row in csv.DictReader(f):
            precinct = str(row.get("precinct", "")).strip()
            if not precinct:
                continue
            party = str(row.get("party", "")).strip()
            candidate = str(row.get("candidate", "")).strip()
            if not party and candidate.lower() in RESERVED:
                continue  # write-in / over / under votes — excluded from candidate sum
            if not candidate:
                continue
            col = f"{party} {candidate}" if party else candidate
            cols = by_precinct.setdefault(precinct, {})
            cols[col] = cols.get(col, 0) + _int(row.get("votes"))
    return by_precinct


def winner_of(cols):
    """(winner_col, party) via alphabetically-first strict max — mirrors computeWinners."""
    winner, best = "", None
    for col in sorted(cols):
        v = cols[col]
        if best is None or v > best:
            best, winner = v, col
    return winner, (winner.split()[0] if winner else "")


def process_boundary_set(data_dir):
    """Build history/*.json + county_baselines.json for one dir. Returns file count."""
    manifest = load_manifest(data_dir)
    if not manifest:
        return 0

    turnout_cache = {}
    per_precinct = {}   # code -> { raceFile: row }
    baselines = {}      # raceFile -> county Dem share

    for entry in manifest:
        race_file = entry.get("raceFile")
        if not race_file:
            continue
        race_path = os.path.join(data_dir, race_file)
        if not os.path.exists(race_path):
            continue
        turnout = load_turnout(data_dir, entry.get("turnoutFile"), turnout_cache)
        county_dem = county_total = 0
        for precinct, cols in race_by_precinct(race_path).items():
            total = sum(cols.values())
            dem = sum(v for c, v in cols.items() if c.split()[0].upper() == "DEM")
            county_dem += dem
            county_total += total
            if total <= 0:
                continue  # did not participate — getPrecinctResult() returns null
            reg, ballots, blank = turnout.get(precinct, (0, 0, 0))
            winner, party = winner_of(cols)
            row = {
                "PRECINCT CODE": precinct,
                "REGISTERED VOTERS TOTAL": reg,
                "BALLOTS CAST TOTAL": ballots,
                "BALLOTS CAST BLANK": blank,
            }
            row.update(cols)  # candidate columns "<Party Candidate>": votes
            row["Winning Candidate"] = winner
            row["Winning Party"] = party
            per_precinct.setdefault(precinct, {})[race_file] = row
        if county_total > 0:
            baselines[race_file] = round(county_dem / county_total, 6)

    out_dir = os.path.join(data_dir, "history")
    # Rewrite cleanly so a precinct that loses all participation drops its file.
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    for precinct, races in per_precinct.items():
        out_path = os.path.join(out_dir, f"{safe_name(precinct)}.json")
        with open(out_path, "w") as f:
            json.dump({"precinct": precinct, "races": races}, f, separators=(",", ":"))
    with open(os.path.join(out_dir, "county_baselines.json"), "w") as f:
        json.dump(baselines, f, separators=(",", ":"))
    return len(per_precinct)


def registry_entries(only_slug=None):
    entries = []
    for reg_path in ("data/tx/counties.json", "data/tx/districts.json"):
        if not os.path.exists(reg_path):
            continue
        with open(reg_path) as f:
            for e in json.load(f):
                if e.get("status") != "live":
                    continue
                if only_slug and e.get("slug") != only_slug:
                    continue
                entries.append(e)
    return entries


def main(argv):
    only_slug = argv[1] if len(argv) > 1 else None
    entries = registry_entries(only_slug)
    if not entries:
        print("No matching live registry entries.", file=sys.stderr)
        return 1
    for entry in entries:
        data_root = entry["dataRoot"]
        for bset in (entry.get("boundarySets") or {}).values():
            data_dir = os.path.join(data_root, bset["dataDir"])
            n = process_boundary_set(data_dir)
            print(f"{entry['slug']}/{bset['dataDir']}: wrote {n} precinct history files")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
