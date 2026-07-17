#!/usr/bin/env python3
"""
Tests for data_processor/restore_district_precincts.py and
data_processor/upgrade_district_precincts_oe.py (pure helpers) — run directly:
    python3 tests/test_upgrade_district_precincts.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "data_processor"))
from restore_district_precincts import as_int, sums_match  # noqa: E402
from upgrade_district_precincts_oe import (  # noqa: E402
    base_precinct, cd_number, gate_a, norm_code, party_style,
    resolve_membership, target_key,
)

passed = 0


def check(name, cond):
    global passed
    if not cond:
        raise SystemExit(f"FAIL: {name}")
    passed += 1


# --- norm_code / base_precinct ------------------------------------------------
check("norm strips Precinct prefix", norm_code("Precinct 101") == "101")
check("norm strips trailing name", norm_code("17 So. Bonham") == "17")
check("norm strips leading zeros", norm_code("0101") == "101")
check("norm keeps letter codes", norm_code("1BA") == "1BA")
check("norm zero stays zero", norm_code("000") == "0")

members = {"101", "214", "1BA"}
check("split tail stripped", base_precinct("101 - SBL", members, {"101"}) == "101")
check("suffix folds to member base",
      base_precinct("214B", members, {"214B"}) == "214")
check("suffix kept when base also in source",
      base_precinct("214B", members, {"214B", "214"}) == "214B")
check("member suffix code kept verbatim", base_precinct("1BA", members, set()) == "1BA")

# --- race targeting -----------------------------------------------------------
check("US House by district col", cd_number("U.S. House", "4") == 4)
check("US Rep by office text", cd_number("United States Representative District 4", "") == 4)
check("statewide is not a CD race", cd_number("Governor", "") is None)
check("own target key", target_key("U.S. House", "4", 2024) == ("own", 4, 2024))
check("sw target key",
      target_key("Governor", "", 2022) == ("sw", "governor", 2022))
check("county race has no key", target_key("County Clerk", "", 2022) is None)

# --- membership resolution ------------------------------------------------------
member_map = {"1": "1", "2": "2"}


def race(office, district, precincts):
    return {"office": office, "district": district,
            "rows": [(p, "REP", "X", 1) for p in precincts]}


mode, allowed, verbatim, _ = resolve_membership(
    [race("U.S. House", "4", ["1", "2", "3"]),
     race("Governor", "", ["1", "2", "3"])], member_map, 4, 2024)
check("whole-county proven when every precinct is district-4",
      mode == "whole-county" and allowed == {"1", "2", "3"})
check("whole-county verbatim prefers member codes",
      verbatim == {"1": "1", "2": "2", "3": "3"})

mode, allowed, _, _ = resolve_membership(
    [race("U.S. House", "4", ["1", "2"]),
     race("U.S. House", "3", ["3"]),
     race("Governor", "", ["1", "2", "3"])], member_map, 4, 2024)
check("partition when split county covers all members",
      mode == "partition" and allowed == {"1", "2"})

mode, _, _, detail = resolve_membership(
    [race("U.S. House", "4", ["9"]),
     race("Governor", "", ["1", "2", "9"])], member_map, 4, 2024)
check("failed when member precincts missing from district set (renumbering)",
      mode == "failed" and "renumbered" in detail)

mode, allowed, _, _ = resolve_membership(
    [race("Governor", "", ["1", "2", "3"])], member_map, 4, 2020)
check("2020 skips the House cross-check, geometry members only",
      mode == "partition-2020" and allowed == {"1", "2"})

# --- gate A (aggregate equality, existing side summed) --------------------------
existing = [
    {"party": "DEM", "candidate": "A", "votes": "10"},
    {"party": "DEM", "candidate": "A", "votes": "5"},
    {"party": "REP", "candidate": "B", "votes": "20"},
]
check("gate A sums the existing side",
      gate_a(existing, [("c:1", "Dem", "A", 15), ("c:1", "Rep", "B", 20)]) == "")
check("gate A catches sum drift",
      "mismatch" in gate_a(existing, [("c:1", "Dem", "A", 14), ("c:1", "Rep", "B", 21)]))
check("gate A catches candidate drift",
      "differ" in gate_a(existing, [("c:1", "Dem", "A", 15)]))

# --- party style ---------------------------------------------------------------
check("upper style preserved", party_style({"DEM", "REP"})("DEM") == "DEM")
check("capitalized style matched", party_style({"Dem", "Rep"})("DEM") == "Dem")
check("empty party stays empty", party_style({"Dem"})("") == "")

# --- restore: sums_match ---------------------------------------------------------
old_rows = [
    {"precinct": "delta:1", "party": "DEM", "candidate": "A", "votes": "3"},
    {"precinct": "delta:2", "party": "DEM", "candidate": "A", "votes": "4"},
    {"precinct": "delta:1", "party": "REP", "candidate": "B", "votes": "9"},
]
all_rows = [
    {"precinct": "delta:ALL", "party": "DEM", "candidate": "A", "votes": "7"},
    {"precinct": "delta:ALL", "party": "REP", "candidate": "B", "votes": "9"},
]
ok, _ = sums_match(old_rows, all_rows, ["party", "candidate"], ["votes"])
check("restore gate passes on exact sums", ok)
ok, _ = sums_match(old_rows[:2], all_rows, ["party", "candidate"], ["votes"])
check("restore gate fails on missing candidate", not ok)
check("empty cells sum as zero (the reduction's coercion)", as_int("") == 0)
check("turnout empty-vs-0 equivalence",
      sums_match([{"precinct": "d:1", "registered": ""}],
                 [{"precinct": "d:ALL", "registered": "0"}],
                 [], ["registered"])[0])

# --- 2026 primary upgrade: PDF contest-block parsing ----------------------------
from parse_precinct_pdf import (  # noqa: E402
    county_sums, parse_bowie_layout, parse_grayson_layout)

GRAYSON_SAMPLE = """Precinct 101
REP US Representative, District 4
Vote For 1

                                         TOTAL        VOTE %       Absentee Early Voting
                                                                                             Day

Don Horn                                         24       13.56%           1         15               8

Pat Fallon                                      153       86.44%           5         79           69

Total Votes Cast                                177      100.00%           6         94           77

Precinct 102
REP US Representative, District 4
Vote For 1

Don Horn                                          6        60.00%          0          4               2

Pat Fallon                                        4        40.00%          0          2               2

Total Votes Cast                                 10      100.00%           0          6               4
"""
res, sections = parse_grayson_layout(GRAYSON_SAMPLE, "REP US Representative, District 4")
check("grayson: both precinct sections parsed", sorted(res) == ["101", "102"])
check("grayson: candidate totals read from TOTAL column",
      res["101"] == [("Don Horn", 24), ("Pat Fallon", 153)])
check("grayson: sections set covers all headers", sections == {"101", "102"})
check("grayson: county sums accumulate",
      county_sums(res) == {"Don Horn": 30, "Pat Fallon": 157})
try:
    parse_grayson_layout(GRAYSON_SAMPLE, "REP Governor")
    check("grayson: missing contest fails closed", False)
except ValueError:
    check("grayson: missing contest fails closed", True)
# a contest block that never closes must raise, not silently drop the precinct
try:
    parse_grayson_layout(GRAYSON_SAMPLE.replace("Total Votes Cast", "Total Vote Cast"),
                         "REP US Representative, District 4")
    check("grayson: unterminated block fails closed", False)
except ValueError:
    check("grayson: unterminated block fails closed", True)

BOWIE_SAMPLE = """Summary Results Report                              OFFICIAL RESULTS Pct X Pct Republican
TX Bowie County 260303 Primary 6110
March 3, 2026                                                          Bowie County

1A
 STATISTICS

REP US Representative, District 1
Vote For 1

Nathaniel Moran                                             20                   1         12              7

Total Votes Cast                                            20                   1         12              7

Summary Results Report                              OFFICIAL RESULTS Pct X Pct Republican
TX Bowie County 260303 Primary 6110
March 3, 2026                                                          Bowie County

13
 STATISTICS

REP US Representative, District 4
Vote For 1

Pat Fallon                                                  1,204                0          0              1

Don Horn                                                      1                  0          0              1

Total Votes Cast                                              2                  0          0              2
"""
res, sections = parse_bowie_layout(BOWIE_SAMPLE, "REP US Representative, District 4")
check("bowie: only the D4 precinct carries the contest", sorted(res) == ["13"])
check("bowie: sections include non-D4 precincts too", sections == {"1A", "13"})
check("bowie: comma thousands parsed",
      res["13"] == [("Pat Fallon", 1204), ("Don Horn", 1)])

print(f"OK — {passed} checks passed")
