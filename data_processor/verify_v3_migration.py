#!/usr/bin/env python3
"""
Round-trip verifier for the Collin v3 migration. For every race in both legacy
manifests, re-pivots the v3 long+turnout files (exact Python mirror of
js/v3Pivot.js, including the alphabetical first-max winner rule) and compares
against the original wide CSV with EXACT string equality on:

  PRECINCT CODE, REGISTERED VOTERS TOTAL, BALLOTS CAST TOTAL,
  BALLOTS CAST BLANK, every candidate column, Write-in, OVER/UNDER VOTES,
  and recomputed Winning Candidate / Winning Party vs the stored ones.

Exit code 0 only if every race round-trips exactly (winner mismatches are
listed separately — they indicate a stored-data discrepancy to investigate,
since the recompute rule mirrors unified_parser.compute_winning_candidate).
"""

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

META_STATIC = ["COUNTY NUMBER", "PRECINCT CODE", "PRECINCT NAME",
               "REGISTERED VOTERS TOTAL", "BALLOTS CAST TOTAL", "BALLOTS CAST BLANK"]
SPECIALS = {"write-in": "Write-in", "over votes": "OVER VOTES", "under votes": "UNDER VOTES"}
DROPPED = {"Winning Candidate", "Winning Party", "COUNTY NUMBER", "PRECINCT NAME"}
META_ALL = set(META_STATIC) | set(SPECIALS.values()) | {"Winning Candidate", "Winning Party"}

PAIRS = [
    (ROOT / "data", ROOT / "data/tx/collin/2024"),
    (ROOT / "data/2026", ROOT / "data/tx/collin/2026"),
]


def pivot(long_path, turnout_path):
    """Python mirror of js/v3Pivot.js pivotRace + computeWinners."""
    turnout = {}
    if turnout_path and turnout_path.exists():
        for r in csv.DictReader(turnout_path.open()):
            turnout[r["precinct"].strip()] = r

    by_pct = {}
    for r in csv.DictReader(long_path.open()):
        pct = r["precinct"].strip()
        if not pct:
            continue
        rec = by_pct.setdefault(pct, {"specials": {}, "candidates": {}})
        party, cand, votes = r["party"].strip(), r["candidate"].strip(), r["votes"].strip()
        reserved = SPECIALS.get(cand.lower()) if party == "" else None
        if reserved:
            rec["specials"][reserved] = votes
        elif cand:
            col = f"{party} {cand}" if party else cand
            rec["candidates"][col] = votes

    all_cols = sorted({c for rec in by_pct.values() for c in rec["candidates"]})
    has = {s: any(s in rec["specials"] for rec in by_pct.values())
           for s in ("Write-in", "OVER VOTES", "UNDER VOTES")}

    rows = []
    for pct, rec in by_pct.items():
        t = turnout.get(pct, {})
        row = {
            "PRECINCT CODE": pct,
            "REGISTERED VOTERS TOTAL": (t.get("registered") or "").strip(),
            "BALLOTS CAST TOTAL": (t.get("ballots_cast") or "").strip(),
            "BALLOTS CAST BLANK": (t.get("blank") or "").strip(),
        }
        if has["Write-in"]:
            row["Write-in"] = rec["specials"].get("Write-in", "0")
        for col in all_cols:
            row[col] = rec["candidates"].get(col, "0")
        for s in ("OVER VOTES", "UNDER VOTES"):
            if has[s]:
                row[s] = rec["specials"].get(s, "0")
        rows.append(row)

    # winners: alphabetical candidate columns, first maximum
    for row in rows:
        cand_cols = sorted(c for c in row if c not in META_ALL)
        if not cand_cols:
            row["Winning Candidate"] = ""
            row["Winning Party"] = ""
            continue
        winner, best = cand_cols[0], _num(row[cand_cols[0]])
        for c in cand_cols[1:]:
            v = _num(row[c])
            if v > best:
                best, winner = v, c
        row["Winning Candidate"] = winner
        row["Winning Party"] = winner.split()[0] if winner.split() else ""
    return {r["PRECINCT CODE"]: r for r in rows}


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def verify_race(legacy_path, v3_dir, entry):
    failures, winner_mismatches = [], []
    legacy_rows = {r["PRECINCT CODE"].strip(): r
                   for r in csv.DictReader(legacy_path.open()) if r.get("PRECINCT CODE", "").strip()}
    turnout_file = entry.get("turnoutFile")
    pivoted = pivot(v3_dir / entry["raceFile"],
                    v3_dir / turnout_file if turnout_file else None)

    if set(legacy_rows) != set(pivoted):
        failures.append(f"precinct sets differ: {len(legacy_rows)} legacy vs {len(pivoted)} pivoted "
                        f"(e.g. {sorted(set(legacy_rows) ^ set(pivoted))[:4]})")
        return failures, winner_mismatches

    for pct, lrow in legacy_rows.items():
        prow = pivoted[pct]
        for col, lval in lrow.items():
            if col in DROPPED and col not in ("Winning Candidate", "Winning Party"):
                continue
            lval = (lval or "").strip()
            if col in ("Winning Candidate", "Winning Party"):
                pval = prow.get(col, "")
                if pval != lval:
                    winner_mismatches.append(f"pct {pct} {col}: stored={lval!r} recomputed={pval!r}")
                continue
            if col in ("COUNTY NUMBER", "PRECINCT NAME"):
                continue
            pval = (prow.get(col, None))
            if pval is None:
                failures.append(f"pct {pct}: column {col!r} missing from pivot")
            elif pval != lval:
                failures.append(f"pct {pct} {col!r}: legacy={lval!r} pivot={pval!r}")
    return failures, winner_mismatches


def main():
    total = exact = 0
    all_winner_issues = []
    hard_failures = []
    for legacy_dir, v3_dir in PAIRS:
        manifest = json.load((v3_dir / "elections.json").open())
        assert manifest.get("version") == 3
        for entry in manifest["elections"]:
            total += 1
            legacy_path = legacy_dir / Path(entry["raceFile"]).name
            fails, winners = verify_race(legacy_path, v3_dir, entry)
            if fails:
                hard_failures.append((entry["raceFile"], fails[:5]))
            else:
                exact += 1
            if winners:
                all_winner_issues.append((entry["raceFile"], winners[:3]))

    print(f"\nRound-trip: {exact}/{total} races exactly equal on all data values")
    if hard_failures:
        print(f"\nHARD FAILURES ({len(hard_failures)}):")
        for f, msgs in hard_failures[:20]:
            print(f"  {f}")
            for m in msgs:
                print(f"    - {m}")
    if all_winner_issues:
        print(f"\nWINNER RECOMPUTE MISMATCHES ({len(all_winner_issues)} races) — stored vs recomputed:")
        for f, msgs in all_winner_issues[:20]:
            print(f"  {f}")
            for m in msgs:
                print(f"    - {m}")
    sys.exit(1 if hard_failures else 0)


if __name__ == "__main__":
    main()
