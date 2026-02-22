"""
Build voter-file-based crosswalk weights for 2026 precinct remapping.

Reads the Collin County voter registration file to count active voters per
new (2026) precinct, then replaces area-weighted interpolation weights with
voter-count-based weights for all split precincts.

Usage:
    python data_processor/build_voter_crosswalk.py
"""

import csv
from collections import defaultdict
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
VOTER_FILE = Path(__file__).resolve().parent.parent / "VoterRegistrationFile.txt"
AREA_CROSSWALK = DATA_DIR / "crosswalk_old_to_new.csv"
OUTPUT_PATH = DATA_DIR / "crosswalk_voter_based.csv"


def count_voters_per_new_precinct(voter_file):
    """Count active voters per base precinct (strip .XX suffix)."""
    counts = defaultdict(int)
    with open(voter_file, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            status = row.get("Voter Status", "").strip()
            if status != "ACT":
                continue
            pct_raw = row.get("Precinct", "").strip()
            if not pct_raw:
                continue
            # Strip .XX suffix: "023.01" -> 23
            try:
                base_pct = int(pct_raw.split(".")[0])
            except ValueError:
                continue
            counts[base_pct] += 1
    return counts


def load_area_crosswalk(path):
    """Load the existing area-weighted crosswalk."""
    rows = []
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({
                "new_precinct": int(row["new_precinct"]),
                "old_precinct": int(row["old_precinct"]),
                "weight": float(row["weight"]),
            })
    return rows


def identify_splits(crosswalk_rows):
    """Find old precincts that split into multiple new precincts (weight < 1.0)."""
    old_to_new = defaultdict(list)
    for row in crosswalk_rows:
        old_to_new[row["old_precinct"]].append(row)

    splits = {}
    for old_pct, entries in old_to_new.items():
        fractional = [e for e in entries if e["weight"] < 1.0]
        if fractional:
            splits[old_pct] = entries
    return splits


def build_voter_crosswalk(crosswalk_rows, voter_counts, splits):
    """Replace area weights with voter-count weights for split precincts."""
    # Complex cases where we keep area weights for specific old->new mappings:
    # - old 77 -> new 85: tiny sliver (1.2% by area), keep area weight
    # - old 11 -> new 189: tiny sliver (~3% by area), keep area weight
    KEEP_AREA_WEIGHT = {(77, 85), (11, 189)}

    # Zero-voter slivers: these new precincts have essentially no voters
    # and receive negligible weight from an old precinct
    ZERO_VOTER_SLIVERS = {265, 268, 269}

    result = []

    # Build index of which entries are splits
    old_to_entries = defaultdict(list)
    for row in crosswalk_rows:
        old_to_entries[row["old_precinct"]].append(row)

    # Process each row
    processed_old = set()
    for row in crosswalk_rows:
        old_pct = row["old_precinct"]
        new_pct = row["new_precinct"]

        if old_pct not in splits:
            # Not a split — identity or merge, keep as-is
            result.append(dict(row))
            continue

        # Skip if we already processed this old precinct's split
        if old_pct in processed_old:
            continue

        # Process entire split group for this old precinct
        processed_old.add(old_pct)
        entries = old_to_entries[old_pct]

        # Separate entries into "keep area weight" and "reweight by voters"
        keep_area = []
        reweight = []
        for e in entries:
            if (e["old_precinct"], e["new_precinct"]) in KEEP_AREA_WEIGHT:
                keep_area.append(e)
            else:
                reweight.append(e)

        # Sum of area weights that are kept
        kept_weight = sum(e["weight"] for e in keep_area)
        remaining_weight = 1.0 - kept_weight

        # For the entries to reweight, look up voter counts
        voter_totals = {}
        for e in reweight:
            np_ = e["new_precinct"]
            if np_ in ZERO_VOTER_SLIVERS:
                voter_totals[np_] = 0
            else:
                voter_totals[np_] = voter_counts.get(np_, 0)

        total_voters = sum(voter_totals.values())

        # Emit kept-area entries
        for e in keep_area:
            result.append(dict(e))

        # Emit voter-weighted entries
        for e in reweight:
            np_ = e["new_precinct"]
            if total_voters > 0:
                voter_weight = (voter_totals[np_] / total_voters) * remaining_weight
            else:
                # Fallback to area weight if no voters found
                voter_weight = e["weight"]
            result.append({
                "new_precinct": np_,
                "old_precinct": old_pct,
                "weight": round(voter_weight, 6),
            })

    # Sort by new_precinct, then old_precinct
    result.sort(key=lambda r: (r["new_precinct"], r["old_precinct"]))
    return result


def print_comparison(area_rows, voter_rows):
    """Print a comparison table of area vs voter weights for splits."""
    # Build lookup by (new, old) pair
    area_lookup = {(r["new_precinct"], r["old_precinct"]): r["weight"] for r in area_rows}
    voter_lookup = {(r["new_precinct"], r["old_precinct"]): r["weight"] for r in voter_rows}

    print()
    print("=" * 80)
    print("CROSSWALK COMPARISON: Area-Weighted vs Voter-Weighted")
    print("=" * 80)
    print(f"{'Old→New':>12}  {'Area Wt':>10}  {'Voter Wt':>10}  {'Delta':>10}  {'Note'}")
    print("-" * 80)

    all_keys = sorted(set(area_lookup.keys()) | set(voter_lookup.keys()))
    changed_count = 0

    for key in all_keys:
        area_w = area_lookup.get(key, 0.0)
        voter_w = voter_lookup.get(key, 0.0)
        delta = voter_w - area_w

        if abs(delta) < 0.0001:
            continue  # Skip unchanged

        old_pct, new_pct = key[1], key[0]
        note = ""
        if abs(delta) > 0.10:
            note = "*** LARGE DELTA"
        elif abs(delta) > 0.05:
            note = "* notable"

        print(f"  {old_pct:>3}→{new_pct:<3}    {area_w:>10.6f}  {voter_w:>10.6f}  {delta:>+10.6f}  {note}")
        changed_count += 1

    print("-" * 80)
    print(f"Total changed mappings: {changed_count}")
    print()


def main():
    print("Loading voter registration file...")
    voter_counts = count_voters_per_new_precinct(VOTER_FILE)
    print(f"  Active voters counted across {len(voter_counts)} precincts")
    print(f"  Total active voters: {sum(voter_counts.values()):,}")

    print("Loading area-weighted crosswalk...")
    area_rows = load_area_crosswalk(AREA_CROSSWALK)
    print(f"  {len(area_rows)} crosswalk entries")

    splits = identify_splits(area_rows)
    print(f"  {len(splits)} old precincts with splits")

    print("Computing voter-weighted crosswalk...")
    voter_rows = build_voter_crosswalk(area_rows, voter_counts, splits)

    # Write output
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["new_precinct", "old_precinct", "weight"])
        writer.writeheader()
        writer.writerows(voter_rows)

    print(f"Voter-based crosswalk saved to {OUTPUT_PATH} ({len(voter_rows)} rows)")

    # Print comparison
    print_comparison(area_rows, voter_rows)


if __name__ == "__main__":
    main()
