"""
Generate precinct metadata for the 2026 boundary set.

Reads the crosswalk CSV and classifies each new precinct by data quality:
- "exact": unchanged 1:1 mapping (weight=1.0, same precinct)
- "merged": multiple old precincts combined at full weight
- "estimated": area-interpolated (weight < 1.0)
- "low_confidence": sliver precincts with very small weights

Output: data/2026/precinct_metadata.json
"""

import csv
import json
from pathlib import Path
from collections import defaultdict

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CROSSWALK_VOTER = DATA_DIR / "crosswalk_voter_based.csv"
CROSSWALK_AREA = DATA_DIR / "crosswalk_old_to_new.csv"
# Prefer voter-based crosswalk if available, fall back to area-based
CROSSWALK_PATH = CROSSWALK_VOTER if CROSSWALK_VOTER.exists() else CROSSWALK_AREA
OUTPUT_PATH = DATA_DIR / "2026" / "precinct_metadata.json"

# Precincts with max weight below this are flagged as slivers
SLIVER_THRESHOLD = 0.10


def main():
    using_voter_file = (CROSSWALK_PATH == CROSSWALK_VOTER)
    print(f"Using crosswalk: {CROSSWALK_PATH.name} ({'voter-based' if using_voter_file else 'area-based'})")

    # Parse crosswalk: group by new_precinct
    precinct_sources = defaultdict(list)

    with open(CROSSWALK_PATH) as f:
        reader = csv.DictReader(f)
        for row in reader:
            new_pct = row["new_precinct"].strip()
            old_pct = row["old_precinct"].strip()
            weight = float(row["weight"].strip())
            precinct_sources[new_pct].append({
                "old": int(old_pct),
                "weight": round(weight, 6)
            })

    metadata = {}

    for new_pct in sorted(precinct_sources.keys(), key=lambda x: int(x)):
        sources = precinct_sources[new_pct]
        max_weight = max(s["weight"] for s in sources)
        all_full = all(s["weight"] == 1.0 for s in sources)
        is_new = int(new_pct) >= 253

        # Classify
        if all_full and len(sources) == 1 and sources[0]["old"] == int(new_pct):
            data_quality = "exact"
            interpolation_type = "unchanged"
        elif all_full and len(sources) > 1:
            data_quality = "exact"
            interpolation_type = "merged"
        elif max_weight < SLIVER_THRESHOLD:
            data_quality = "low_confidence"
            interpolation_type = "sliver"
        elif is_new:
            data_quality = "estimated"
            interpolation_type = "new_boundary"
        else:
            data_quality = "estimated"
            interpolation_type = "split"

        entry = {
            "dataQuality": data_quality,
            "interpolationType": interpolation_type,
            "maxWeight": round(max_weight, 4),
            "sources": sources,
        }

        # Tag voter-file-improved precincts
        if using_voter_file and interpolation_type in ("split", "new_boundary"):
            entry["crosswalkMethod"] = "voter_file"

        if interpolation_type == "sliver":
            entry["isSliver"] = True

        metadata[new_pct] = entry

    # Write output
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(metadata, f, indent=2)

    # Summary
    counts = defaultdict(int)
    for m in metadata.values():
        counts[m["interpolationType"]] += 1

    print(f"Wrote {len(metadata)} precinct metadata entries to {OUTPUT_PATH}")
    print(f"File size: {OUTPUT_PATH.stat().st_size / 1024:.1f} KB")
    print()
    print("Classification breakdown:")
    for typ, count in sorted(counts.items()):
        print(f"  {typ}: {count}")


if __name__ == "__main__":
    main()
