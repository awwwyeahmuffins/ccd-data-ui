#!/usr/bin/env python3
"""Import party-primary turnout by precinct from the county workbook.

Source: Collin County Elections official reports, compiled per precinct in
"2026 Primary by Precinct.xlsx" (sheet "Through ED" = complete through
Election Day; the other sheets are early-vote snapshots and are not imported).

Emits data/tx/collin/2026/profile/primary_turnout.csv in long format:

    precinct,year,dem_ballots,rep_ballots

Precinct codes are the 2026 boundary set (validated 273/273 against
boundaries/2026.geojson). Years where a precinct did not exist (new 2026
precincts have no 2022/2024 history) are omitted — absent rows render N/A,
never zeros. NEVER fabricate data.

Usage:
    python3 data_processor/import_primary_turnout.py "/path/to/2026 Primary by Precinct.xlsx"
"""

import csv
import json
import sys
from pathlib import Path

import openpyxl

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "data/tx/collin/2026/profile/primary_turnout.csv"
GEOJSON = REPO / "data/tx/collin/boundaries/2026.geojson"

# (year, dem column index, rep column index) in the "Through ED" sheet
YEAR_COLS = [(2026, 1, 2), (2024, 5, 6), (2022, 9, 10)]


def main(xlsx_path: str) -> None:
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["Through ED"]
    rows = list(ws.iter_rows(values_only=True))

    # Row 0 = year banner, 1 = TOT formulas, 2 = column headers, 3+ = precincts
    header = [str(c or "").strip() for c in rows[2]]
    assert header[0] == "PCT" and header[1] == "DEM" and header[2] == "REP", header

    geo_codes = {
        str(f["properties"]["PRECINCT"])
        for f in json.loads(GEOJSON.read_text())["features"]
    }

    out_rows = []
    seen = set()
    for r in rows[3:]:
        if r[0] is None:
            continue
        code = str(int(r[0]))
        if code in seen:
            raise SystemExit(f"duplicate precinct {code} in workbook")
        seen.add(code)
        for year, di, ri in YEAR_COLS:
            dem, rep = r[di], r[ri]
            if dem is None and rep is None:
                continue  # precinct didn't exist that cycle — stays N/A
            out_rows.append([code, year, int(dem or 0), int(rep or 0)])

    if seen != geo_codes:
        raise SystemExit(
            f"precinct mismatch vs 2026 boundaries: "
            f"workbook-only={sorted(seen - geo_codes)[:5]} "
            f"boundary-only={sorted(geo_codes - seen)[:5]}"
        )

    out_rows.sort(key=lambda r: (int(r[0]), -r[1]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["precinct", "year", "dem_ballots", "rep_ballots"])
        w.writerows(out_rows)

    by_year = {}
    for _, year, dem, rep in out_rows:
        d, r_ = by_year.get(year, (0, 0))
        by_year[year] = (d + dem, r_ + rep)
    print(f"wrote {OUT} — {len(seen)} precincts, {len(out_rows)} rows")
    for year in sorted(by_year, reverse=True):
        dem, rep = by_year[year]
        print(f"  {year}: DEM {dem:,}  REP {rep:,}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
