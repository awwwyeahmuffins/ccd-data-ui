#!/usr/bin/env python3
"""
Tests for data_processor/tx_etl.py (v3 normalized output) — run directly:
    python3 tests/test_tx_etl.py
"""

import csv
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "data_processor"))
from tx_etl import run, canonical_party, infer_date  # noqa: E402

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

FIXTURE_NO_TURNOUT = "\n".join(
    line for line in FIXTURE.splitlines()
    if "Registered Voters" not in line and "Ballots Cast" not in line
)


def _run_fixture(text, tmp):
    src = Path(tmp) / "20221108__tx__general__demo__precinct.csv"
    src.write_text(text)
    return run(str(src), county="demo", year=None, set_dir=None,
               out_root=str(Path(tmp) / "out"), source_url=None, dry_run=False)


def test_helpers():
    assert canonical_party("REP") == ("REP", False)
    assert canonical_party("Democratic") == ("DEM", False)
    assert canonical_party("W-I") == ("", True)
    assert canonical_party(None) == ("", False)
    assert canonical_party("Nonpartisan-ish") == ("", False)
    assert infer_date("20221108__tx__general__demo__precinct.csv") == (2022, "2022-11-08")
    assert infer_date("results.csv") == (None, None)


def test_full_etl_v3():
    with tempfile.TemporaryDirectory() as tmp:
        result = _run_fixture(FIXTURE, tmp)
        out = Path(result["out_dir"])
        assert out.name == "2022"  # set dir defaults to the year

        # v3 manifest object wrapper
        manifest = json.loads((out / "elections.json").read_text())
        assert manifest["version"] == 3
        assert manifest["county"] == "demo"
        elections = manifest["elections"]
        assert len(elections) == 2  # straight party + turnout rows excluded

        gov = next(e for e in elections if e["office"] == "Governor")
        rep70 = next(e for e in elections if e["office"] == "State Representative")
        assert gov["date"] == "2022-11-08"
        assert gov["year"] == 2022
        assert rep70["district"] == "70"
        assert gov["turnoutFile"] == "turnout/2022-11-08.csv"
        assert gov["id"] == "governor-2022"

        # Long race file: precinct,party,candidate,votes with write-in pseudo-row
        rows = list(csv.DictReader((out / gov["raceFile"]).open()))
        assert {tuple(r.values()) for r in rows} >= {
            ("101", "REP", "Greg Abbott", "512"),
            ("101", "DEM", "Beto O'Rourke", "387"),
            ("101", "", "Write-in", "2"),
            ("102", "LIB", "Mark Tippetts", "3"),
        }
        # Other county's rows must not leak in
        assert not any(r["precinct"] == "999" for r in rows)

        # Turnout file holds real values
        t = {r["precinct"]: r for r in csv.DictReader((out / gov["turnoutFile"]).open())}
        assert t["101"]["registered"] == "2210"
        assert t["102"]["ballots_cast"] == "661"
        assert t["101"]["blank"] == ""  # absent in source -> empty, never invented


def test_missing_turnout_means_no_turnout_file():
    with tempfile.TemporaryDirectory() as tmp:
        result = _run_fixture(FIXTURE_NO_TURNOUT, tmp)
        out = Path(result["out_dir"])
        manifest = json.loads((out / "elections.json").read_text())
        assert all(e["turnoutFile"] is None for e in manifest["elections"])
        assert not (out / "turnout").exists()


def test_pivot_compatibility():
    """The emitted v3 files must pivot back into the legacy row shape the app
    expects (mirrors js/v3Pivot.js semantics for the fixture)."""
    with tempfile.TemporaryDirectory() as tmp:
        result = _run_fixture(FIXTURE, tmp)
        out = Path(result["out_dir"])
        manifest = json.loads((out / "elections.json").read_text())
        gov = next(e for e in manifest["elections"] if e["office"] == "Governor")

        long_rows = list(csv.DictReader((out / gov["raceFile"]).open()))
        turnout = {r["precinct"]: r for r in csv.DictReader((out / gov["turnoutFile"]).open())}

        pcts = {r["precinct"] for r in long_rows}
        pivoted = {}
        for p in pcts:
            row = {"PRECINCT CODE": p,
                   "REGISTERED VOTERS TOTAL": turnout.get(p, {}).get("registered", ""),
                   "BALLOTS CAST TOTAL": turnout.get(p, {}).get("ballots_cast", "")}
            for r in long_rows:
                if r["precinct"] != p:
                    continue
                col = f"{r['party']} {r['candidate']}" if r["party"] else r["candidate"]
                row[col] = r["votes"]
            pivoted[p] = row

        assert pivoted["101"]["REP Greg Abbott"] == "512"
        assert pivoted["101"]["REGISTERED VOTERS TOTAL"] == "2210"
        assert pivoted["102"]["BALLOTS CAST TOTAL"] == "661"
        assert pivoted["101"]["Write-in"] == "2"


if __name__ == "__main__":
    test_helpers()
    test_full_etl_v3()
    test_missing_turnout_means_no_turnout_file()
    test_pivot_compatibility()
    print("OK — all tx_etl v3 tests passed")
