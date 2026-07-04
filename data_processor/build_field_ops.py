"""
Build per-precinct field-ops aggregates (suspense counts) from the local
voter registration file.

Reads the gitignored Collin County voter file (VoterRegistrationFile.txt at
the repo root — PII, never deployed, never committed) and emits ONLY
aggregate integer counts per base precinct to
data/tx/collin/<set>/profile/field_ops.csv, which the chair dashboard
(chair.html) reads for its Suspense Priority Tracker. When the voter file is
absent (every machine but the maintainer's), this prints a note and exits 0
without writing anything — the frontend renders N/A.

PII SAFETY CONTRACT (do not weaken):
  * The output contains ONLY aggregate integer counts and shares per
    precinct. No names, addresses, VUIDs, birth dates, or any other
    per-voter field may ever be written.
  * The voter file is streamed row-by-row and never copied.
  * Small-cell suppression: precincts with fewer than MIN_CELL voters total
    get a blank suspense count (the frontend treats blank as N/A, never 0).
  * The output lives under data/ and is safe to commit and deploy.

Status coding: only "ACT" is confirmed in this file's vintage (see
build_voter_crosswalk.py). Suspense is expected as "SUS"; because that is an
assumption, this script always prints every distinct Voter Status value it
saw with its count, and FAILS (exit 1) if it finds statuses outside the
expected set without --allow-unknown-status — surprises must be inspected,
not guessed at.

Usage:
    python3 data_processor/build_field_ops.py [--set 2026] [--dry-run]
                                              [--allow-unknown-status]
"""

import argparse
import csv
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
VOTER_FILE = REPO / "VoterRegistrationFile.txt"

ACTIVE_STATUS = "ACT"
SUSPENSE_STATUS = "SUS"
EXPECTED_STATUSES = {ACTIVE_STATUS, SUSPENSE_STATUS}
MIN_CELL = 10  # small-cell suppression threshold (active + suspense)


def base_precinct(raw):
    """Voter-file precinct "023.01" -> 23 (mirror build_voter_crosswalk.py)."""
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return int(raw.split(".")[0])
    except ValueError:
        return None


def aggregate(voter_file):
    """Stream the voter file into per-precinct status counters."""
    per_precinct = defaultdict(Counter)
    statuses_seen = Counter()
    with open(voter_file, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None or "Voter Status" not in reader.fieldnames:
            sys.exit("ERROR: voter file has no 'Voter Status' column — wrong file?")
        for row in reader:
            status = row.get("Voter Status", "").strip()
            statuses_seen[status] += 1
            pct = base_precinct(row.get("Precinct"))
            if pct is None:
                continue
            per_precinct[pct][status] += 1
    return per_precinct, statuses_seen


def build_rows(per_precinct, today):
    rows = []
    for pct in sorted(per_precinct):
        counts = per_precinct[pct]
        active = counts.get(ACTIVE_STATUS, 0)
        suspense = counts.get(SUSPENSE_STATUS, 0)
        total = active + suspense
        if total < MIN_CELL:
            suspense_out = ""
            share_out = ""
        else:
            suspense_out = suspense
            share_out = f"{suspense / total:.4f}" if total else ""
        rows.append({
            "precinct": pct,
            "active_voters": active,
            "suspense_voters": suspense_out,
            "suspense_share": share_out,
            "generated_on": today,
        })
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--set", default="2026", dest="boundary_set",
                        help="boundary set to write under (default: 2026 — the "
                             "voter file carries 2026 precinct codes)")
    parser.add_argument("--dry-run", action="store_true",
                        help="aggregate and report, write nothing")
    parser.add_argument("--allow-unknown-status", action="store_true",
                        help="proceed even if statuses beyond ACT/SUS appear "
                             "(they are reported but not counted)")
    args = parser.parse_args()

    if not VOTER_FILE.exists():
        print(f"Voter file not present ({VOTER_FILE.name} is gitignored PII); "
              "nothing to do. The dashboard renders N/A without field_ops.csv.")
        return

    output_path = (REPO / "data" / "tx" / "collin" / args.boundary_set /
                   "profile" / "field_ops.csv")
    if not output_path.parent.is_dir():
        sys.exit(f"ERROR: no such profile dir: {output_path.parent} "
                 f"(unknown boundary set '{args.boundary_set}'?)")

    print("Streaming voter registration file (aggregates only)...")
    per_precinct, statuses_seen = aggregate(VOTER_FILE)

    print("Distinct Voter Status values seen:")
    for status, n in statuses_seen.most_common():
        marker = "" if status in EXPECTED_STATUSES else "   <-- UNEXPECTED"
        print(f"  {status or '(blank)':>10}: {n:>9,}{marker}")

    unexpected = set(statuses_seen) - EXPECTED_STATUSES - {""}
    if unexpected and not args.allow_unknown_status:
        sys.exit(f"ERROR: unexpected status values {sorted(unexpected)} — "
                 "inspect the file, then rerun with --allow-unknown-status "
                 "if they should simply be ignored.")

    rows = build_rows(per_precinct, date.today().isoformat())
    total_active = sum(r["active_voters"] for r in rows)
    total_suspense = sum(r["suspense_voters"] for r in rows
                         if r["suspense_voters"] != "")
    suppressed = sum(1 for r in rows if r["suspense_voters"] == "")
    print(f"\n{len(rows)} precincts | active: {total_active:,} | "
          f"suspense: {total_suspense:,} | "
          f"small-cell suppressed: {suppressed}")

    top = sorted((r for r in rows if r["suspense_voters"] != ""),
                 key=lambda r: r["suspense_voters"], reverse=True)[:5]
    print("Top suspense precincts:")
    for r in top:
        print(f"  precinct {r['precinct']:>4}: {r['suspense_voters']:,} "
              f"({float(r['suspense_share']):.1%})")

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "precinct", "active_voters", "suspense_voters",
            "suspense_share", "generated_on",
        ])
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nWrote {output_path.relative_to(REPO)} ({len(rows)} rows, "
          "aggregate counts only).")


if __name__ == "__main__":
    main()
