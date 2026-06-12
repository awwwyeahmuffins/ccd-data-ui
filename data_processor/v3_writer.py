#!/usr/bin/env python3
"""
v3 Writer — shared emission helpers for the normalized election data format
(docs/DATA_LAYOUT_SPEC.md v3). Used by migrate_collin_v3.py and tx_etl.py.

A v3 boundary-set directory looks like:

  <setDir>/elections.json        object manifest {version:3, county, boundarySet, elections:[...]}
  <setDir>/races/<Base>.csv      long format: precinct,party,candidate,votes
  <setDir>/turnout/<key>.csv     precinct,registered,ballots_cast,blank

Race files may contain reserved pseudo-candidate rows (party empty):
  Write-in / Over Votes / Under Votes  -> contest-level special counts.

Placeholder policy: unknown values are written as EMPTY strings, never invented.
"""

import csv
import json
from pathlib import Path

RACE_HEADER = ["precinct", "party", "candidate", "votes"]
TURNOUT_HEADER = ["precinct", "registered", "ballots_cast", "blank"]

# Reserved pseudo-candidate rows (party must be empty)
RESERVED = {"Write-in", "Over Votes", "Under Votes"}


def write_race_csv(path: Path, long_rows):
    """long_rows: iterable of (precinct, party, candidate, votes) tuples.
    Values are written as given (strings or ints); empty string = honest gap."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(RACE_HEADER)
        for row in long_rows:
            w.writerow(list(row))


def write_turnout_csv(path: Path, turnout_rows):
    """turnout_rows: iterable of (precinct, registered, ballots_cast, blank)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(TURNOUT_HEADER)
        for row in turnout_rows:
            w.writerow(list(row))


def write_manifest(path: Path, county_slug: str, boundary_set: str, elections):
    """elections: list of dicts with keys id, displayName, office, district,
    year, date, category, raceFile, turnoutFile, sourceUrl (missing -> None)."""
    keys = ["id", "displayName", "office", "district", "year", "date",
            "category", "raceFile", "turnoutFile", "sourceUrl"]
    normalized = [{k: e.get(k) for k in keys} for e in elections]
    path.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": 3,
        "county": county_slug,
        "boundarySet": boundary_set,
        "elections": normalized,
    }
    with path.open("w") as f:
        json.dump(manifest, f, indent=2)
    return manifest
