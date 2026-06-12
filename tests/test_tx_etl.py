#!/usr/bin/env python3
"""
Tests for data_processor/tx_etl.py — run directly:
    python3 tests/test_tx_etl.py
(pytest-compatible too, but pytest isn't a project dependency.)
"""

import csv
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "data_processor"))
from tx_etl import run, candidate_column, county_number, infer_year  # noqa: E402

FIXTURE = """county,precinct,office,district,party,candidate,votes
Demo,101,Governor,,REP,Greg Abbott,512
Demo,101,Governor,,DEM,Beto O'Rourke,387
Demo,101,Governor,,LIB,Mark Tippetts,9
Demo,102,Governor,,REP,Greg Abbott,201
Demo,102,Governor,,DEM,Beto O'Rourke,455
Demo,102,Governor,,LIB,Mark Tippetts,3
Demo,101,State Representative,70,REP,Jane Doe,498
Demo,101,State Representative,70,DEM,John Roe,401
Demo,102,State Representative,70,REP,Jane Doe,180
Demo,102,State Representative,70,DEM,John Roe,470
Demo,101,Registered Voters,,,,2210
Demo,102,Registered Voters,,,,1804
Demo,101,Ballots Cast,,,,910
Demo,102,Ballots Cast,,,,661
Demo,101,Straight Party,,REP,Republican,300
Demo,101,Governor,,,Write-ins,2
Other,999,Governor,,REP,Greg Abbott,1
"""

# Same races but WITHOUT turnout pseudo-offices — gaps must stay empty
FIXTURE_NO_TURNOUT = "\n".join(
    line for line in FIXTURE.splitlines()
    if "Registered Voters" not in line and "Ballots Cast" not in line
)


def _run_fixture(text, tmp):
    src = Path(tmp) / "20221108__tx__general__demo__precinct.csv"
    src.write_text(text)
    return run(str(src), county="demo", year=None,
               out_root=str(Path(tmp) / "out"), source_url=None, dry_run=False)


def test_helpers():
    assert candidate_column("REP", "Greg  Abbott") == "REP Greg Abbott"
    assert candidate_column("Democratic", "Beto O'Rourke") == "DEM Beto O'Rourke"
    assert candidate_column(None, "Write-ins") == "Write-in"
    assert candidate_column("W-I", "Somebody") == "Write-in"
    assert candidate_column(None, "Jane Smith") == "Jane Smith"  # nonpartisan
    assert county_number("Demo") == "DEMO"
    assert county_number("El Paso") == "ELPA"
    assert infer_year("20221108__tx__general__demo__precinct.csv") == 2022


def test_full_etl():
    with tempfile.TemporaryDirectory() as tmp:
        result = _run_fixture(FIXTURE, tmp)
        out = Path(result["out_dir"])

        # Two races (Governor + State Rep D70); straight-party + turnout rows excluded
        assert result["races"] == 2, result
        assert result["precincts"] == 2

        gov = out / "Governor_2022.csv"
        rep70 = out / "State_Representative_District_70_2022.csv"
        assert gov.exists() and rep70.exists()

        rows = list(csv.DictReader(gov.open()))
        assert len(rows) == 2
        by_pct = {r["PRECINCT CODE"]: r for r in rows}

        # Spec columns present and ordered correctly at the front
        header = list(rows[0].keys())
        assert header[:6] == ["COUNTY NUMBER", "PRECINCT CODE", "PRECINCT NAME",
                              "REGISTERED VOTERS TOTAL", "BALLOTS CAST TOTAL",
                              "BALLOTS CAST BLANK"]

        # Real turnout values came through; blank ballots (absent in source) is empty
        assert by_pct["101"]["REGISTERED VOTERS TOTAL"] == "2210"
        assert by_pct["102"]["BALLOTS CAST TOTAL"] == "661"
        assert by_pct["101"]["BALLOTS CAST BLANK"] == ""

        # Candidate columns, write-in collapse, and per-precinct winners
        assert by_pct["101"]["REP Greg Abbott"] == "512"
        assert by_pct["101"]["Write-in"] == "2"
        assert by_pct["101"]["Winning Party"] == "REP"
        assert by_pct["102"]["Winning Candidate"] == "DEM Beto O'Rourke"
        assert by_pct["102"]["Winning Party"] == "DEM"

        # Other county's rows must not leak in
        assert "999" not in by_pct

        # Manifest: both races, year inferred from filename, category populated
        manifest = json.loads((out / "elections.json").read_text())
        assert {e["filename"] for e in manifest} == {gov.name, rep70.name}
        assert all(e["year"] == 2022 for e in manifest)
        assert all(e.get("displayName") for e in manifest)


def test_missing_turnout_stays_empty():
    with tempfile.TemporaryDirectory() as tmp:
        result = _run_fixture(FIXTURE_NO_TURNOUT, tmp)
        gov = Path(result["out_dir"]) / "Governor_2022.csv"
        rows = list(csv.DictReader(gov.open()))
        for r in rows:
            # Honest gaps: empty strings, never invented numbers
            assert r["REGISTERED VOTERS TOTAL"] == ""
            assert r["BALLOTS CAST TOTAL"] == ""


if __name__ == "__main__":
    test_helpers()
    test_full_etl()
    test_missing_turnout_stays_empty()
    print("OK — all tx_etl tests passed")
