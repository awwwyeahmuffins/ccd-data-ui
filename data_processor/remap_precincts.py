"""
Remap Election Data to 2026 Precinct Boundaries

Uses areal interpolation (area-weighted redistribution) to remap historical
election CSVs, DNC scores, and racial demographics from the old 252-precinct
map to the new 273-precinct map.

Outputs remapped files to data/2026/ so both boundary sets are available.

Usage:
    python data_processor/remap_precincts.py              # remap all data
    python data_processor/remap_precincts.py --dry-run     # only compute crosswalk
    python data_processor/remap_precincts.py --crosswalk data/crosswalk_voter_based.csv
"""

import argparse
import json
import logging
import shutil
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OLD_GEOJSON = DATA_DIR / "Voting_Precincts.geojson"
NEW_GEOJSON = DATA_DIR / "Voting_Precincts_2026.geojson"
OUTPUT_DIR = DATA_DIR / "2026"
CROSSWALK_PATH = DATA_DIR / "crosswalk_old_to_new.csv"

# Texas State Plane North Central (feet) — accurate area computation for DFW
EPSG_PROJECTED = 2276

# Metadata columns in election CSVs that should NOT be interpolated
META_COLS = {
    "COUNTY NUMBER", "PRECINCT CODE", "PRECINCT NAME",
    "Winning Candidate", "Winning Party",
}

# Numeric columns to interpolate in election CSVs
ELECTION_NUMERIC_META = {
    "REGISTERED VOTERS TOTAL", "BALLOTS CAST TOTAL", "BALLOTS CAST BLANK",
    "OVER VOTES", "UNDER VOTES", "Write-in",
}


# ---------------------------------------------------------------------------
# Phase A: Build crosswalk table
# ---------------------------------------------------------------------------

def build_crosswalk(old_gdf, new_gdf):
    """Build area-weighted crosswalk between old and new precincts."""
    logger.info("Building crosswalk table...")

    # Reproject for accurate area measurement
    old_proj = old_gdf.to_crs(epsg=EPSG_PROJECTED)
    new_proj = new_gdf.to_crs(epsg=EPSG_PROJECTED)

    # Compute area of each old precinct
    old_proj["old_area"] = old_proj.geometry.area

    # Identify unchanged vs changed precincts by comparing geometries
    old_by_pct = {int(r.PRECINCT): r.geometry for _, r in old_proj.iterrows()}
    new_by_pct = {int(r.PRECINCT): r.geometry for _, r in new_proj.iterrows()}

    # Precincts that exist in both maps
    common_pcts = set(old_by_pct.keys()) & set(new_by_pct.keys())

    unchanged = set()
    changed = set()
    for pct in common_pcts:
        old_geom = old_by_pct[pct]
        new_geom = new_by_pct[pct]
        # Check if geometries are essentially the same (symmetric difference area < 0.1% of old)
        sym_diff_area = old_geom.symmetric_difference(new_geom).area
        if sym_diff_area < old_geom.area * 0.001:
            unchanged.add(pct)
        else:
            changed.add(pct)

    new_only = set(new_by_pct.keys()) - set(old_by_pct.keys())

    logger.info(f"  Unchanged precincts: {len(unchanged)}")
    logger.info(f"  Changed precincts: {len(changed)}")
    logger.info(f"  New precincts: {len(new_only)} ({sorted(new_only)})")

    rows = []

    # Identity mappings for unchanged precincts
    for pct in unchanged:
        rows.append({
            "new_precinct": pct,
            "old_precinct": pct,
            "weight": 1.0,
        })

    # Areal interpolation for changed + new precincts
    needs_interp = new_proj[new_proj["PRECINCT"].astype(int).isin(changed | new_only)].copy()
    if len(needs_interp) > 0:
        # Compute intersection overlay
        overlay = gpd.overlay(needs_interp, old_proj, how="intersection")
        overlay["intersection_area"] = overlay.geometry.area

        for _, row in overlay.iterrows():
            new_pct = int(row["PRECINCT_1"])
            old_pct = int(row["PRECINCT_2"])
            old_area = row["old_area"]
            if old_area <= 0:
                continue
            weight = row["intersection_area"] / old_area
            if weight < 0.001:
                continue  # Drop tiny slivers
            rows.append({
                "new_precinct": new_pct,
                "old_precinct": old_pct,
                "weight": round(weight, 6),
            })

    crosswalk = pd.DataFrame(rows)
    crosswalk = crosswalk.sort_values(["new_precinct", "old_precinct"]).reset_index(drop=True)

    # Save for inspection
    crosswalk.to_csv(CROSSWALK_PATH, index=False)
    logger.info(f"  Crosswalk saved to {CROSSWALK_PATH} ({len(crosswalk)} rows)")

    return crosswalk, unchanged


# ---------------------------------------------------------------------------
# Phase B: Remap election CSVs
# ---------------------------------------------------------------------------

def identify_numeric_cols(df):
    """Identify numeric columns that should be interpolated."""
    numeric_cols = []
    for col in df.columns:
        if col in META_COLS:
            continue
        if col in ELECTION_NUMERIC_META:
            numeric_cols.append(col)
            continue
        # Try to detect candidate vote columns (everything else that's numeric)
        try:
            pd.to_numeric(df[col], errors="raise")
            numeric_cols.append(col)
        except (ValueError, TypeError):
            pass
    return numeric_cols


def remap_election_csv(filepath, crosswalk, unchanged_pcts):
    """Remap a single election CSV using the crosswalk."""
    df = pd.read_csv(filepath)

    if "PRECINCT CODE" not in df.columns:
        logger.warning(f"  Skipping {filepath.name}: no PRECINCT CODE column")
        return None

    # Filter to valid geographic precincts (1-252, no LB/PB rows)
    df["PRECINCT CODE"] = df["PRECINCT CODE"].astype(str).str.strip()
    df = df[~df["PRECINCT CODE"].str.contains(r"[A-Za-z]", na=False)].copy()
    df["pct_int"] = pd.to_numeric(df["PRECINCT CODE"], errors="coerce")
    df = df.dropna(subset=["pct_int"])
    df["pct_int"] = df["pct_int"].astype(int)
    df = df[(df["pct_int"] >= 1) & (df["pct_int"] <= 252)].copy()

    if len(df) == 0:
        logger.warning(f"  Skipping {filepath.name}: no valid precinct rows")
        return None

    # Identify numeric columns to interpolate (exclude our helper column)
    numeric_cols = [c for c in identify_numeric_cols(df) if c != "pct_int"]
    if not numeric_cols:
        logger.warning(f"  Skipping {filepath.name}: no numeric columns found")
        return None

    # Ensure numeric columns are actually numeric
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    # Build old precinct lookup
    old_lookup = {}
    for _, row in df.iterrows():
        old_lookup[row["pct_int"]] = row

    # Get metadata from first row for defaults
    county_num = df["COUNTY NUMBER"].iloc[0] if "COUNTY NUMBER" in df.columns else "COLL"

    # Interpolate for each new precinct
    new_rows = []
    all_new_pcts = sorted(crosswalk["new_precinct"].unique())

    for new_pct in all_new_pcts:
        pct_xwalk = crosswalk[crosswalk["new_precinct"] == new_pct]

        interpolated = {}
        for col in numeric_cols:
            val = 0.0
            for _, xrow in pct_xwalk.iterrows():
                old_pct = xrow["old_precinct"]
                weight = xrow["weight"]
                if old_pct in old_lookup:
                    val += old_lookup[old_pct][col] * weight
            interpolated[col] = round(val)

        # Build the row
        new_row = {}
        if "COUNTY NUMBER" in df.columns:
            new_row["COUNTY NUMBER"] = county_num
        new_row["PRECINCT CODE"] = new_pct
        # Use original precinct name if unchanged, otherwise generate
        if new_pct in old_lookup:
            new_row["PRECINCT NAME"] = old_lookup[new_pct].get("PRECINCT NAME", f"PCT {new_pct:03d}")
        else:
            new_row["PRECINCT NAME"] = f"PCT {new_pct:03d}"

        for col in numeric_cols:
            new_row[col] = interpolated[col]

        # Recompute winning candidate/party from candidate columns
        candidate_cols = [c for c in numeric_cols if c not in ELECTION_NUMERIC_META]
        if candidate_cols:
            max_votes = -1
            winner = None
            for c in candidate_cols:
                if interpolated[c] > max_votes:
                    max_votes = interpolated[c]
                    winner = c
            new_row["Winning Candidate"] = winner if winner else ""
            new_row["Winning Party"] = winner.split()[0] if winner else ""
        else:
            new_row["Winning Candidate"] = ""
            new_row["Winning Party"] = ""

        new_row["OVER VOTES"] = new_row.get("OVER VOTES", 0)
        new_row["UNDER VOTES"] = new_row.get("UNDER VOTES", 0)

        new_rows.append(new_row)

    # Build output DataFrame with original column order
    result = pd.DataFrame(new_rows)

    # Reorder columns to match original
    orig_cols = [c for c in df.columns if c in result.columns and c != "pct_int"]
    extra_cols = [c for c in result.columns if c not in orig_cols]
    result = result[[c for c in orig_cols + extra_cols if c in result.columns]]

    return result


def remap_all_elections(crosswalk, unchanged_pcts):
    """Remap all election CSVs listed in elections.json."""
    manifest_path = DATA_DIR / "elections.json"
    if not manifest_path.exists():
        logger.error("elections.json not found!")
        return 0

    with open(manifest_path) as f:
        elections = json.load(f)

    output_dir = OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    # Copy elections.json to output dir
    shutil.copy2(manifest_path, output_dir / "elections.json")

    success = 0
    warnings = 0

    for entry in elections:
        filename = entry["filename"]
        filepath = DATA_DIR / filename
        if not filepath.exists():
            logger.warning(f"  Missing: {filename}")
            warnings += 1
            continue

        result = remap_election_csv(filepath, crosswalk, unchanged_pcts)
        if result is not None:
            out_path = output_dir / filename
            out_path.parent.mkdir(parents=True, exist_ok=True)
            result.to_csv(out_path, index=False)
            success += 1
        else:
            warnings += 1

    logger.info(f"  Elections remapped: {success}, warnings: {warnings}")
    return success


# ---------------------------------------------------------------------------
# Phase C: Remap DNC Score CSV
# ---------------------------------------------------------------------------

def remap_dnc_scores(crosswalk):
    """Remap DNC Score By Precinct.csv."""
    filepath = DATA_DIR / "DNC Score By Precinct.csv"
    if not filepath.exists():
        logger.warning("DNC Score CSV not found, skipping")
        return

    logger.info("Remapping DNC scores...")
    df = pd.read_csv(filepath)

    count_cols = ["Rep", "Mod", "Dem"]
    for col in count_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    old_lookup = {}
    for _, row in df.iterrows():
        old_lookup[int(row["Precinct"])] = row

    new_rows = []
    for new_pct in sorted(crosswalk["new_precinct"].unique()):
        pct_xwalk = crosswalk[crosswalk["new_precinct"] == new_pct]

        interpolated = {}
        for col in count_cols:
            val = 0.0
            for _, xrow in pct_xwalk.iterrows():
                old_pct = xrow["old_precinct"]
                weight = xrow["weight"]
                if old_pct in old_lookup:
                    val += old_lookup[old_pct][col] * weight
            interpolated[col] = round(val)

        total = sum(interpolated.values())
        rep_share = interpolated["Rep"] / total if total > 0 else 0
        mod_share = interpolated["Mod"] / total if total > 0 else 0
        dem_share = interpolated["Dem"] / total if total > 0 else 0

        max_share = max(rep_share, mod_share, dem_share)
        if max_share < 0.40:
            strength = 1
        elif max_share < 0.55:
            strength = 2
        else:
            strength = 3

        shares = {"Rep": rep_share, "Mod": mod_share, "Dem": dem_share}
        winning = max(shares, key=shares.get)

        new_rows.append({
            "Precinct": new_pct,
            "Rep": interpolated["Rep"],
            "Mod": interpolated["Mod"],
            "Dem": interpolated["Dem"],
            "Total": total,
            "Rep Share": round(rep_share, 10),
            "Mod Share": round(mod_share, 10),
            "Dem Share": round(dem_share, 10),
            "Winning Party": winning,
            "Party Strength": strength,
        })

    result = pd.DataFrame(new_rows)
    out_path = OUTPUT_DIR / "DNC Score By Precinct.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(out_path, index=False)
    logger.info(f"  DNC scores saved ({len(result)} precincts)")


# ---------------------------------------------------------------------------
# Phase D: Remap Racial Demographics CSV
# ---------------------------------------------------------------------------

def remap_racial_data(crosswalk):
    """Remap Racial Numbers by Precinct.csv."""
    filepath = DATA_DIR / "Racial Numbers by Precinct.csv"
    if not filepath.exists():
        logger.warning("Racial Numbers CSV not found, skipping")
        return

    logger.info("Remapping racial demographics...")
    df = pd.read_csv(filepath)

    count_cols = ["asian", "black", "hispanic", "others", "white"]
    for col in count_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    old_lookup = {}
    for _, row in df.iterrows():
        old_lookup[int(row["precinct"])] = row

    new_rows = []
    for new_pct in sorted(crosswalk["new_precinct"].unique()):
        pct_xwalk = crosswalk[crosswalk["new_precinct"] == new_pct]

        interpolated = {}
        for col in count_cols:
            val = 0.0
            for _, xrow in pct_xwalk.iterrows():
                old_pct = xrow["old_precinct"]
                weight = xrow["weight"]
                if old_pct in old_lookup:
                    val += old_lookup[old_pct][col] * weight
            interpolated[col] = round(val)

        total = sum(interpolated.values())

        row_data = {"precinct": new_pct}
        for col in count_cols:
            row_data[col] = interpolated[col]
        row_data["total"] = total
        for col in count_cols:
            pct = (interpolated[col] / total * 100) if total > 0 else 0
            row_data[f"pct_{col}"] = f"{pct:.2f}%"

        new_rows.append(row_data)

    result = pd.DataFrame(new_rows)
    out_path = OUTPUT_DIR / "Racial Numbers by Precinct.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(out_path, index=False)
    logger.info(f"  Racial data saved ({len(result)} precincts)")


# ---------------------------------------------------------------------------
# Phase E: Validation
# ---------------------------------------------------------------------------

def validate(crosswalk, unchanged_pcts):
    """Run validation checks on remapped data."""
    logger.info("Running validation...")
    errors = 0

    # Check crosswalk: weights for each new precinct should sum to ~1.0
    # (only for precincts that map entirely from old precincts)
    weight_sums = crosswalk.groupby("new_precinct")["weight"].sum()
    bad_weights = weight_sums[(weight_sums < 0.5) | (weight_sums > 1.5)]
    if len(bad_weights) > 0:
        logger.warning(f"  Precincts with unusual weight sums: {dict(bad_weights)}")

    # Check county total conservation for a sample election
    manifest_path = DATA_DIR / "elections.json"
    if manifest_path.exists():
        with open(manifest_path) as f:
            elections = json.load(f)

        # Pick a county-wide race to check
        for entry in elections:
            if "Governor" in entry.get("displayName", ""):
                old_df = pd.read_csv(DATA_DIR / entry["filename"])
                new_path = OUTPUT_DIR / entry["filename"]
                if new_path.exists():
                    new_df = pd.read_csv(new_path)

                    # Filter old to valid precincts
                    old_df["PRECINCT CODE"] = old_df["PRECINCT CODE"].astype(str).str.strip()
                    old_df = old_df[~old_df["PRECINCT CODE"].str.contains(r"[A-Za-z]", na=False)]
                    old_df["pct_int"] = pd.to_numeric(old_df["PRECINCT CODE"], errors="coerce")
                    old_df = old_df.dropna(subset=["pct_int"])
                    old_df["pct_int"] = old_df["pct_int"].astype(int)
                    old_df = old_df[(old_df["pct_int"] >= 1) & (old_df["pct_int"] <= 252)]

                    if "BALLOTS CAST TOTAL" in old_df.columns and "BALLOTS CAST TOTAL" in new_df.columns:
                        old_total = pd.to_numeric(old_df["BALLOTS CAST TOTAL"], errors="coerce").sum()
                        new_total = pd.to_numeric(new_df["BALLOTS CAST TOTAL"], errors="coerce").sum()
                        diff = abs(old_total - new_total)
                        pct_diff = diff / old_total * 100 if old_total > 0 else 0
                        logger.info(f"  Conservation check ({entry['filename']}): "
                                    f"old={int(old_total)}, new={int(new_total)}, "
                                    f"diff={int(diff)} ({pct_diff:.2f}%)")
                        if pct_diff > 1.0:
                            logger.warning(f"  Total conservation exceeds 1% tolerance!")
                            errors += 1
                break

    # Check for negative values in a sample output
    sample_files = list(OUTPUT_DIR.glob("*.csv"))[:5]
    for f in sample_files:
        df = pd.read_csv(f)
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        negatives = (df[numeric_cols] < 0).any().any()
        if negatives:
            logger.warning(f"  Negative values found in {f.name}")
            errors += 1

    # Check that unchanged precincts in election CSVs match originals
    if manifest_path.exists():
        with open(manifest_path) as f:
            elections = json.load(f)
        if elections:
            entry = elections[0]
            old_path = DATA_DIR / entry["filename"]
            new_path = OUTPUT_DIR / entry["filename"]
            if old_path.exists() and new_path.exists():
                old_df = pd.read_csv(old_path)
                new_df = pd.read_csv(new_path)
                old_df["PRECINCT CODE"] = pd.to_numeric(old_df["PRECINCT CODE"], errors="coerce")
                new_df["PRECINCT CODE"] = pd.to_numeric(new_df["PRECINCT CODE"], errors="coerce")
                for pct in list(unchanged_pcts)[:5]:
                    old_row = old_df[old_df["PRECINCT CODE"] == pct]
                    new_row = new_df[new_df["PRECINCT CODE"] == pct]
                    if len(old_row) > 0 and len(new_row) > 0:
                        if "BALLOTS CAST TOTAL" in old_row.columns:
                            old_val = pd.to_numeric(old_row["BALLOTS CAST TOTAL"].iloc[0], errors="coerce")
                            new_val = pd.to_numeric(new_row["BALLOTS CAST TOTAL"].iloc[0], errors="coerce")
                            if abs(old_val - new_val) > 1:
                                logger.warning(f"  Unchanged precinct {pct} differs: {old_val} vs {new_val}")
                                errors += 1

    if errors == 0:
        logger.info("  All validation checks passed!")
    else:
        logger.warning(f"  {errors} validation issue(s) found")

    return errors


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def derive_unchanged_pcts(crosswalk):
    """Derive unchanged precincts from crosswalk (1:1 identity mappings with weight=1.0)."""
    unchanged = set()
    grouped = crosswalk.groupby("new_precinct")
    for new_pct, group in grouped:
        if len(group) == 1:
            row = group.iloc[0]
            if row["old_precinct"] == new_pct and row["weight"] == 1.0:
                unchanged.add(int(new_pct))
    return unchanged


def main():
    parser = argparse.ArgumentParser(description="Remap election data to 2026 precinct boundaries")
    parser.add_argument("--dry-run", action="store_true",
                        help="Only compute crosswalk, don't remap files")
    parser.add_argument("--crosswalk", type=str,
                        help="Path to pre-built crosswalk CSV (skips GeoJSON overlay)")
    args = parser.parse_args()

    if args.crosswalk:
        # Use pre-built crosswalk — skip GeoJSON loading and Phase A
        crosswalk_path = Path(args.crosswalk)
        if not crosswalk_path.exists():
            logger.error(f"Crosswalk file not found: {crosswalk_path}")
            sys.exit(1)
        logger.info(f"Loading pre-built crosswalk from {crosswalk_path}...")
        crosswalk = pd.read_csv(crosswalk_path)
        unchanged_pcts = derive_unchanged_pcts(crosswalk)
        logger.info(f"  {len(crosswalk)} crosswalk entries, {len(unchanged_pcts)} unchanged precincts")
    else:
        # Check dependencies
        if not OLD_GEOJSON.exists():
            logger.error(f"Old GeoJSON not found: {OLD_GEOJSON}")
            sys.exit(1)
        if not NEW_GEOJSON.exists():
            logger.error(f"New GeoJSON not found: {NEW_GEOJSON}")
            sys.exit(1)

        # Load GeoJSON files
        logger.info("Loading GeoJSON files...")
        old_gdf = gpd.read_file(OLD_GEOJSON)
        new_gdf = gpd.read_file(NEW_GEOJSON)
        logger.info(f"  Old: {len(old_gdf)} precincts, New: {len(new_gdf)} precincts")

        # Phase A: Build crosswalk
        crosswalk, unchanged_pcts = build_crosswalk(old_gdf, new_gdf)

    if args.dry_run:
        logger.info("Dry run complete. Inspect crosswalk at %s", CROSSWALK_PATH)
        return

    # Phase B: Remap election CSVs
    logger.info("Remapping election CSVs...")
    remap_all_elections(crosswalk, unchanged_pcts)

    # Phase C: Remap DNC scores
    remap_dnc_scores(crosswalk)

    # Phase D: Remap racial demographics
    remap_racial_data(crosswalk)

    # Copy the 2026 GeoJSON into the output dir for easy reference
    shutil.copy2(NEW_GEOJSON, OUTPUT_DIR / "Voting_Precincts_2026.geojson")

    # Phase E: Validation
    validate(crosswalk, unchanged_pcts)

    logger.info("Done! Remapped data written to %s", OUTPUT_DIR)


if __name__ == "__main__":
    main()
