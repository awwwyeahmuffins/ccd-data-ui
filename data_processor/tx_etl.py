#!/usr/bin/env python3
"""
Texas County Election ETL

Parses precinct-level Texas county election results and converts them into
this project's data layout (docs/DATA_LAYOUT_SPEC.md):

  data/tx/<county-slug>/<Race_Name>_<year>.csv   one CSV per race
  data/tx/<county-slug>/elections.json           manifest for those CSVs

INPUT FORMAT — OpenElections precinct files (https://openelections.net), the
de-facto standard cross-county source for Texas results. Their CSVs are long
format, one row per (precinct, office, candidate):

  county,precinct,office,district,party,candidate,votes
  Dallas,1001,Governor,,REP,Greg Abbott,512
  Dallas,1001,Governor,,DEM,Beto O'Rourke,387
  Dallas,1001,Registered Voters,,,,"2210"
  Dallas,1001,Ballots Cast,,,,"904"

GitHub raw URLs work directly, e.g.:
  https://raw.githubusercontent.com/openelections/openelections-data-tx/master/
    2022/counties/20221108__tx__general__dallas__precinct.csv

PLACEHOLDER POLICY — values we don't have are left EMPTY, never invented:
  * REGISTERED VOTERS TOTAL / BALLOTS CAST TOTAL come only from the source's
    "Registered Voters" / "Ballots Cast" pseudo-office rows; absent those,
    the columns are empty strings and the app shows N/A.
  * BALLOTS CAST BLANK / OVER VOTES / UNDER VOTES likewise.

Usage:
  python3 data_processor/tx_etl.py INPUT --county dallas [--year 2022]
      [--out-root data/tx] [--source-url URL] [--dry-run]

  INPUT may be a local CSV path or an http(s) URL. Year is inferred from
  OpenElections filenames (YYYYMMDD__...) when omitted.

After a successful run, the county is NOT live yet — see
docs/ADDING_FEATURES.md Recipe F (you still need precinct boundaries and a
registry flip in data/tx/counties.json).
"""

import argparse
import io
import json
import logging
import re
import sys
import urllib.request
from pathlib import Path

import pandas as pd

# Reuse the project's canonical parsing/manifest helpers
sys.path.insert(0, str(Path(__file__).parent))
from unified_parser import (  # noqa: E402
    compute_winning_candidate,
    ensure_canonical_columns,
    sanitize_filename,
)
from manifest_generator import format_display_name, generate_manifest  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("tx_etl")

# OpenElections party labels -> our canonical prefixes (DATA_LAYOUT_SPEC §3.2)
PARTY_MAP = {
    "REP": "REP", "REPUBLICAN": "REP", "R": "REP",
    "DEM": "DEM", "DEMOCRAT": "DEM", "DEMOCRATIC": "DEM", "D": "DEM",
    "LIB": "LIB", "LIBERTARIAN": "LIB", "L": "LIB",
    "GRN": "GRN", "GREEN": "GRN", "G": "GRN",
    "IND": "IND", "INDEPENDENT": "IND", "I": "IND",
    "CON": "CON", "CONSTITUTION": "CON",
    "W": "Write-in", "WI": "Write-in", "W-I": "Write-in", "WRITE-IN": "Write-in",
}

# Pseudo-offices in OpenElections data that are turnout metadata, not races
TURNOUT_OFFICES = {
    "registered voters": "REGISTERED VOTERS TOTAL",
    "ballots cast": "BALLOTS CAST TOTAL",
    "blank ballots": "BALLOTS CAST BLANK",
    "ballots cast blank": "BALLOTS CAST BLANK",
    "ballots cast - blank": "BALLOTS CAST BLANK",
    "over votes": "OVER VOTES",
    "under votes": "UNDER VOTES",
}
SKIP_OFFICES = {"straight party", "straight ticket"}

REQUIRED_INPUT_COLS = {"county", "precinct", "office", "candidate", "votes"}


def load_input(source: str) -> pd.DataFrame:
    """Read the input CSV from a local path or URL into a DataFrame."""
    if re.match(r"^https?://", source):
        logger.info(f"Downloading {source}")
        with urllib.request.urlopen(source, timeout=120) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        df = pd.read_csv(io.StringIO(raw), dtype=str)
    else:
        df = pd.read_csv(source, dtype=str)
    df.columns = [c.strip().lower() for c in df.columns]
    missing = REQUIRED_INPUT_COLS - set(df.columns)
    if missing:
        raise SystemExit(
            f"Input is missing required OpenElections columns: {sorted(missing)}. "
            f"Found: {list(df.columns)}"
        )
    return df


def infer_year(source: str) -> int | None:
    """Infer the election year from an OpenElections-style filename."""
    m = re.search(r"(\d{4})\d{4}__", Path(source).name)
    return int(m.group(1)) if m else None


def canonical_party(raw) -> str | None:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    key = str(raw).strip().upper()
    return PARTY_MAP.get(key) if key else None


def candidate_column(party, candidate: str) -> str:
    """Build the '{PARTY} {Candidate}' column name; write-ins collapse to 'Write-in'."""
    abbrev = canonical_party(party)
    name = re.sub(r"\s+", " ", str(candidate)).strip()
    if abbrev == "Write-in" or name.lower() in ("write-in", "write-ins", "writein"):
        return "Write-in"
    return f"{abbrev} {name}" if abbrev else name


def county_number(county: str) -> str:
    """Short county tag, matching the existing 'COLL' convention for Collin."""
    return re.sub(r"[^A-Z]", "", county.upper())[:4]


def to_votes(series: pd.Series) -> pd.Series:
    return pd.to_numeric(
        series.astype(str).str.replace(",", "", regex=False), errors="coerce"
    ).fillna(0).astype(int)


def transform(df: pd.DataFrame, county: str, year: int | None):
    """Pivot the long-format results into one wide DataFrame per race.

    Returns (races, turnout, skipped) where races is a list of dicts:
    { office, district, race_name, df }.
    """
    rows = df[df["county"].str.strip().str.lower() == county.lower()].copy()
    if rows.empty:
        available = sorted(df["county"].dropna().str.strip().unique())[:20]
        raise SystemExit(
            f"No rows for county '{county}'. Counties present include: {available}"
        )

    rows["precinct"] = rows["precinct"].astype(str).str.strip()
    rows["office_norm"] = rows["office"].fillna("").astype(str).str.strip()
    rows["votes_n"] = to_votes(rows["votes"])

    # 1) Pull turnout pseudo-offices into a per-precinct frame
    office_lower = rows["office_norm"].str.lower()
    turnout = pd.DataFrame(index=sorted(rows["precinct"].unique()))
    turnout.index.name = "precinct"
    for office_key, col in TURNOUT_OFFICES.items():
        sub = rows[office_lower == office_key]
        if not sub.empty:
            turnout[col] = sub.groupby("precinct")["votes_n"].sum()

    # 2) Real races: everything that isn't turnout metadata or straight-party
    is_meta = office_lower.isin(TURNOUT_OFFICES.keys()) | office_lower.isin(SKIP_OFFICES)
    race_rows = rows[~is_meta & (rows["office_norm"] != "")].copy()

    races, skipped = [], []
    district = race_rows.get("district")
    race_rows["district_norm"] = (
        district.fillna("").astype(str).str.strip() if district is not None else ""
    )

    for (office, dist), grp in race_rows.groupby(["office_norm", "district_norm"]):
        race_name = f"{office} District {dist}" if dist else office
        grp = grp.copy()
        grp["col"] = [
            candidate_column(p, c)
            for p, c in zip(grp.get("party", pd.Series(index=grp.index)), grp["candidate"])
        ]
        grp = grp[grp["candidate"].notna()]
        if grp.empty:
            skipped.append((race_name, "no candidate rows"))
            continue

        wide = grp.pivot_table(
            index="precinct", columns="col", values="votes_n", aggfunc="sum", fill_value=0
        )
        if wide.shape[1] == 0:
            skipped.append((race_name, "no candidate columns"))
            continue
        races.append({
            "office": office, "district": dist, "race_name": race_name, "wide": wide,
        })

    return races, turnout, skipped


def build_race_csv(race, turnout: pd.DataFrame, county: str) -> pd.DataFrame:
    """Assemble one race's wide frame into the canonical CSV layout."""
    wide = race["wide"].copy()
    out = pd.DataFrame(index=wide.index)
    out["COUNTY NUMBER"] = county_number(county)
    out["PRECINCT CODE"] = out.index.astype(str)
    out["PRECINCT NAME"] = "PCT " + out.index.astype(str)

    # Turnout columns: real values when the source had them, otherwise EMPTY
    # (an honest gap the app renders as N/A — never a made-up number).
    for col in ("REGISTERED VOTERS TOTAL", "BALLOTS CAST TOTAL", "BALLOTS CAST BLANK"):
        if col in turnout.columns:
            out[col] = turnout[col].reindex(out.index).astype("Int64")
        else:
            out[col] = ""

    for col in wide.columns:
        out[col] = wide[col].astype(int)

    for col in ("OVER VOTES", "UNDER VOTES"):
        if col in turnout.columns:
            out[col] = turnout[col].reindex(out.index).astype("Int64")

    out = compute_winning_candidate(out)
    out = ensure_canonical_columns(out)
    return out.reset_index(drop=True)


def run(source: str, county: str, year: int | None, out_root: str,
        source_url: str | None, dry_run: bool) -> dict:
    df = load_input(source)
    year = year or infer_year(source)
    slug = re.sub(r"[^a-z0-9]+", "-", county.lower()).strip("-")
    out_dir = Path(out_root) / slug

    races, turnout, skipped = transform(df, county, year)
    logger.info(f"{county}: {len(races)} races, "
                f"turnout columns: {list(turnout.columns) or 'NONE (will be empty/N/A)'}")
    for name, why in skipped:
        logger.warning(f"skipped: {name} ({why})")

    manifest_entries = []
    for race in races:
        csv_df = build_race_csv(race, turnout, county)
        base = sanitize_filename(race["race_name"])
        filename = f"{base}_{year}.csv" if year else f"{base}.csv"
        entry = {"filename": filename, "year": year,
                 "displayName": format_display_name(filename, year)}
        if source_url or re.match(r"^https?://", source):
            entry["sourceUrl"] = source_url or source
        manifest_entries.append(entry)
        if not dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
            csv_df.to_csv(out_dir / filename, index=False)

    if not dry_run:
        # generate_manifest infers category (Federal/State/County/City/ISD/MUD)
        generate_manifest(manifest_entries, str(out_dir / "elections.json"))

    print(f"\n{'DRY RUN — nothing written' if dry_run else f'Wrote {len(races)} race CSVs + elections.json to {out_dir}/'}")
    print(f"  precincts: {len(turnout.index)}   races: {len(races)}   skipped: {len(skipped)}")
    missing = [c for c in ("REGISTERED VOTERS TOTAL", "BALLOTS CAST TOTAL")
               if c not in turnout.columns]
    if missing:
        print(f"  NOTE: source had no {missing} — those columns are EMPTY (app shows N/A)")
    print("\nNext steps to bring the county live (docs/ADDING_FEATURES.md Recipe F):")
    print(f"  1. Add precinct boundary GeoJSON for {county} under data/tx/{slug}/")
    print(f"  2. Flip status to \"live\" + set dataRoot in data/tx/counties.json")
    print("  3. Generalize dataLoader paths if this is the first non-Collin live county")
    return {"races": len(races), "precincts": len(turnout.index),
            "skipped": skipped, "out_dir": str(out_dir)}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="OpenElections precinct CSV (path or URL)")
    ap.add_argument("--county", required=True, help="County name, e.g. dallas")
    ap.add_argument("--year", type=int, help="Election year (inferred from filename if omitted)")
    ap.add_argument("--out-root", default="data/tx", help="Output root (default data/tx)")
    ap.add_argument("--source-url", help="Provenance URL recorded in the manifest")
    ap.add_argument("--dry-run", action="store_true", help="Parse and report, write nothing")
    args = ap.parse_args()
    run(args.input, args.county, args.year, args.out_root, args.source_url, args.dry_run)


if __name__ == "__main__":
    main()
