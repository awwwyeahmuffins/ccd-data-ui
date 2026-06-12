#!/usr/bin/env python3
"""
Texas County Election ETL

Parses precinct-level Texas county election results and converts them into
this project's v3 normalized layout (docs/DATA_LAYOUT_SPEC.md v3):

  data/tx/<slug>/<setDir>/races/<Race>.csv     long: precinct,party,candidate,votes
  data/tx/<slug>/<setDir>/turnout/<date>.csv   precinct,registered,ballots_cast,blank
  data/tx/<slug>/<setDir>/elections.json       v3 manifest (object wrapper)

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
    2022/counties/20221108__tx__general__bastrop__precinct.csv

PLACEHOLDER POLICY — values we don't have are left EMPTY, never invented:
turnout comes only from the source's "Registered Voters" / "Ballots Cast"
pseudo-office rows; absent those there is no turnout file and the app
shows N/A.

Usage:
  python3 data_processor/tx_etl.py INPUT --county bastrop [--year 2022]
      [--set-dir 2022] [--out-root data/tx] [--source-url URL] [--dry-run]

  INPUT may be a local CSV path or an http(s) URL. Year and election date are
  inferred from OpenElections filenames (YYYYMMDD__...) when omitted.

After a successful run, the county is NOT live yet — see
docs/ADDING_FEATURES.md Recipe F (you still need precinct boundaries, a
verified precinct-code join, and a registry flip in data/tx/counties.json).
"""

import argparse
import io
import logging
import re
import sys
import urllib.request
from pathlib import Path

import pandas as pd

# Reuse the project's canonical helpers
sys.path.insert(0, str(Path(__file__).parent))
from unified_parser import sanitize_filename, categorize_election_python  # noqa: E402
from manifest_generator import format_display_name  # noqa: E402
from v3_writer import write_race_csv, write_turnout_csv, write_manifest  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("tx_etl")

# OpenElections party labels -> canonical prefixes (DATA_LAYOUT_SPEC v3)
PARTY_MAP = {
    "REP": "REP", "REPUBLICAN": "REP", "R": "REP",
    "DEM": "DEM", "DEMOCRAT": "DEM", "DEMOCRATIC": "DEM", "D": "DEM",
    "LIB": "LIB", "LIBERTARIAN": "LIB", "L": "LIB", "LBT": "LIB",
    "GRN": "GRN", "GREEN": "GRN", "G": "GRN", "GRE": "GRN",
    "IND": "IND", "INDEPENDENT": "IND", "I": "IND",
    "CON": "CON", "CONSTITUTION": "CON",
}
WRITE_IN_PARTIES = {"W", "WI", "W-I", "WRITE-IN"}
WRITE_IN_NAMES = {"write-in", "write-ins", "writein", "write-in totals",
                  "write-in total", "total write-ins", "write in"}
# Ballot-accounting rows that some counties report as "candidates"
UNDER_NAMES = {"under votes", "undervotes", "under-votes", "under vote"}
OVER_NAMES = {"over votes", "overvotes", "over-votes", "over vote"}
# Officially rejected/unassigned write-in scribbles — not countable votes;
# certified canvass totals exclude them (audit gate proved this in Tarrant)
DISCARDED_NAMES = {"rejected write-ins", "rejected write-in", "unassigned write-ins",
                   "unassigned write-in", "uncertified write-ins", "not assigned"}

# Pseudo-offices that are turnout metadata, not races
TURNOUT_OFFICES = {
    "registered voters": "registered",
    "ballots cast": "ballots_cast",
    "blank ballots": "blank",
    "ballots cast blank": "blank",
    "ballots cast - blank": "blank",
}
# Election-level over/under pseudo-offices can't be attributed to a contest;
# v3 stores over/under only when they're per-contest. Skipped with a note.
SKIPPED_PSEUDO = {"over votes", "under votes", "straight party", "straight ticket"}

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
    if missing == {"county"}:
        # Some per-county files omit the county column entirely
        df["county"] = None
        missing = set()
    if missing:
        raise SystemExit(
            f"Input is missing required OpenElections columns: {sorted(missing)}. "
            f"Found: {list(df.columns)}"
        )
    return df


def infer_date(source: str):
    """Infer (year, iso_date) from an OpenElections-style filename."""
    m = re.search(r"(\d{4})(\d{2})(\d{2})__", Path(source).name)
    if not m:
        return None, None
    y, mo, d = m.groups()
    return int(y), f"{y}-{mo}-{d}"


def canonical_party(raw):
    """Map a source party label to (party, is_write_in)."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return "", False
    key = str(raw).strip().upper()
    if key in WRITE_IN_PARTIES:
        return "", True
    return PARTY_MAP.get(key, ""), False


def to_votes(series: pd.Series) -> pd.Series:
    return pd.to_numeric(
        series.astype(str).str.replace(",", "", regex=False), errors="coerce"
    ).fillna(0).astype(int)


def transform(df: pd.DataFrame, county: str):
    """Group the source into races (long rows) + a turnout map.

    Returns (races, turnout, notes):
      races: [{office, district, race_name, rows: [(precinct,party,candidate,votes)]}]
      turnout: {precinct: {registered, ballots_cast, blank}}
    """
    if df["county"].isna().all():
        rows = df.copy()  # single-county file without a county column
    else:
        rows = df[df["county"].fillna("").str.strip().str.lower() == county.lower()].copy()
    if rows.empty:
        available = sorted(df["county"].dropna().str.strip().unique())[:20]
        raise SystemExit(
            f"No rows for county '{county}'. Counties present include: {available}"
        )

    rows["precinct"] = rows["precinct"].astype(str).str.strip()
    rows["office_norm"] = rows["office"].fillna("").astype(str).str.strip()
    rows["votes_n"] = to_votes(rows["votes"])
    office_lower = rows["office_norm"].str.lower()

    notes = []

    # 1) Turnout pseudo-offices -> per-precinct map
    turnout = {}
    for office_key, field in TURNOUT_OFFICES.items():
        sub = rows[office_lower == office_key]
        for pct, total in sub.groupby("precinct")["votes_n"].sum().items():
            turnout.setdefault(pct, {})[field] = str(int(total))

    skipped_pseudo = sorted(set(office_lower) & SKIPPED_PSEUDO)
    if skipped_pseudo:
        notes.append(f"skipped election-level pseudo-offices: {skipped_pseudo}")

    # 2) Real races
    is_meta = office_lower.isin(TURNOUT_OFFICES.keys()) | office_lower.isin(SKIPPED_PSEUDO)
    race_rows = rows[~is_meta & (rows["office_norm"] != "")].copy()
    district = race_rows.get("district")
    race_rows["district_norm"] = (
        district.fillna("").astype(str).str.strip() if district is not None else ""
    )

    races = []
    for (office, dist), grp in race_rows.groupby(["office_norm", "district_norm"]):
        race_name = f"{office} District {dist}" if dist else office
        grp = grp[grp["candidate"].notna()].copy()
        if grp.empty:
            notes.append(f"skipped (no candidate rows): {race_name}")
            continue

        # Some counties report BOTH a write-in total row and per-candidate
        # "Write-In: X" breakdown rows — keep only the total (else they
        # double count; the audit gate caught this in Blanco 2020)
        cand_lower = grp["candidate"].astype(str).str.strip().str.lower()
        has_wi_total = cand_lower.isin(WRITE_IN_NAMES).any()
        if has_wi_total:
            grp = grp[~cand_lower.str.startswith("write-in:")]

        # Aggregate duplicates (e.g. absentee/early/election-day rows) and
        # build normalized long rows
        agg = {}
        for _, r in grp.iterrows():
            party, is_wi = canonical_party(r.get("party"))
            cand = re.sub(r"\s+", " ", str(r["candidate"])).strip()
            if cand.lower() in DISCARDED_NAMES:
                continue
            if is_wi or cand.lower() in WRITE_IN_NAMES or cand.lower().startswith("write-in:"):
                party, cand = "", "Write-in"
            elif cand.lower() in UNDER_NAMES:
                party, cand = "", "Under Votes"
            elif cand.lower() in OVER_NAMES:
                party, cand = "", "Over Votes"
            agg[(r["precinct"], party, cand)] = (
                agg.get((r["precinct"], party, cand), 0) + int(r["votes_n"])
            )
        long_rows = [(p, party, cand, votes)
                     for (p, party, cand), votes in sorted(agg.items())]
        races.append({"office": office, "district": dist or None,
                      "race_name": race_name, "rows": long_rows})

    return races, turnout, notes


def run(source: str, county: str, year, set_dir, out_root: str,
        source_url, dry_run: bool) -> dict:
    df = load_input(source)
    inferred_year, iso_date = infer_date(source)
    year = year or inferred_year
    slug = re.sub(r"[^a-z0-9]+", "-", county.lower()).strip("-")
    set_dir = set_dir or (str(year) if year else "undated")
    out_dir = Path(out_root) / slug / set_dir

    races, turnout, notes = transform(df, county)
    logger.info(f"{county}: {len(races)} races, "
                f"turnout fields: {sorted({f for t in turnout.values() for f in t}) or 'NONE'}")
    for n in notes:
        logger.warning(n)

    # Turnout file (one per election date; absent if the source had none)
    turnout_rel = None
    if turnout:
        key = iso_date or (str(year) if year else "undated")
        turnout_rel = f"turnout/{key}.csv"
        if not dry_run:
            t_rows = sorted(
                ((p, t.get("registered", ""), t.get("ballots_cast", ""), t.get("blank", ""))
                 for p, t in turnout.items()),
                key=lambda r: (len(r[0]), r[0]))
            write_turnout_csv(out_dir / turnout_rel, t_rows)

    manifest_elections = []
    for race in races:
        base = sanitize_filename(race["race_name"])
        filename = f"{base}_{year}.csv" if year else f"{base}.csv"
        race_rel = f"races/{filename}"
        manifest_elections.append({
            "id": re.sub(r"[^a-z0-9]+", "-", Path(filename).stem.lower()).strip("-"),
            "displayName": format_display_name(filename, year),
            "office": race["office"],
            "district": race["district"],
            "year": year,
            "date": iso_date,
            "category": categorize_election_python(filename),
            "raceFile": race_rel,
            "turnoutFile": turnout_rel,
            "sourceUrl": source_url or (source if re.match(r"^https?://", source) else None),
        })
        if not dry_run:
            write_race_csv(out_dir / race_rel, race["rows"])

    if not dry_run:
        write_manifest(out_dir / "elections.json", slug, set_dir, manifest_elections)

    print(f"\n{'DRY RUN — nothing written' if dry_run else f'Wrote {len(races)} v3 race files + manifest to {out_dir}/'}")
    print(f"  precincts: {len(turnout) or 'unknown'}   races: {len(races)}")
    if not turnout:
        print("  NOTE: source had no turnout pseudo-offices — no turnout file (app shows N/A)")
    print("\nNext steps to bring the county live (docs/ADDING_FEATURES.md Recipe F):")
    print(f"  1. Fetch precinct boundaries: python3 data_processor/fetch_vtd_geojson.py --county {slug}")
    print("  2. Validate the precinct-code join (100% of vote-bearing precincts must match)")
    print(f"  3. Flip status to \"live\" + add boundarySets in data/tx/counties.json")
    return {"races": len(races), "precincts": len(turnout),
            "out_dir": str(out_dir), "turnout_file": turnout_rel}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="OpenElections precinct CSV (path or URL)")
    ap.add_argument("--county", required=True, help="County name, e.g. bastrop")
    ap.add_argument("--year", type=int, help="Election year (inferred from filename if omitted)")
    ap.add_argument("--set-dir", help="Boundary-set directory name (default: the year)")
    ap.add_argument("--out-root", default="data/tx", help="Output root (default data/tx)")
    ap.add_argument("--source-url", help="Provenance URL recorded in the manifest")
    ap.add_argument("--dry-run", action="store_true", help="Parse and report, write nothing")
    args = ap.parse_args()
    run(args.input, args.county, args.year, args.set_dir, args.out_root,
        args.source_url, args.dry_run)


if __name__ == "__main__":
    main()
