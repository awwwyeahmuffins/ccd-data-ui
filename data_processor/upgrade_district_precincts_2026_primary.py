#!/usr/bin/env python3
"""upgrade_district_precincts_2026_primary.py — add the March 3 2026 primary's
U.S. Representative District 4 contests (DEM + REP) to the cd-4 district tree,
covering the district's out-of-county portion with real official results.

CD-4 changed shape for 2026: the primary ran under the mid-decade plan
PLANC2333 (HB 4, 89th Leg. 2nd C.S.), under which CD-4 is Collin (part),
Denton (part), Bowie (part), and Fannin, Grayson, Lamar, Red River (whole).
Delta, Hopkins, Hunt, Rains and Rockwall — CD-4 members under the previous
plan C2193 that the rest of this tree is built on — are OUT and get zero 2026
rows. Membership is proven three independent ways before any row is written:
(1) each source's own ballots — the D4 contest appears only in in-district
precincts; (2) the TX SOS canvass carries a D4 county line for exactly these
7 counties; (3) the 7 SOS county lines sum EXACTLY to the SOS statewide
totals for both parties (complete partition).

Sources (all official, fetched with a browser User-Agent):
  * denton  — Clarity portal, per-party elections 126053 (REP) / 126054 (DEM),
              reports/detailxml.zip (precinct detail XML).
  * lamar   — Clarity portal, combined election 126018 ("2026 Primaries"),
              contests prefixed "REP …"/"DEM …".
  * grayson — official "Precinct Summary Results Report" per-party PDFs
              (co.grayson.tx.us; digital text, parse_precinct_pdf.py).
  * bowie   — official Electionware "Pct X Pct" per-party PDFs
              (co.bowie.tx.us; digital text, parse_precinct_pdf.py).
  * fannin, red-river — no machine-readable precinct source exists (Fannin
              publishes only a countywide scan; Red River's precinct report is
              an image-only scan and OCR output is not evidence), so each gets
              one <county>:ALL row per candidate straight from the SOS canvass.
  * collin  — this repo's own official county data
              (data/tx/collin/2026/races/*.csv), filtered to the 101 precincts
              with CONG == 4 in the 2026 boundary set.

Verification gates (any failure demotes the county to its SOS-canvass :ALL
line; if even that is unavailable the county is left absent — never guessed):
  * Gate M (membership) — whole counties: every precinct in the source must
    carry the D4 contest; partial counties: a strict subset must. DEM and REP
    in-district precinct sets must agree.
  * Gate C (canvass)    — per-candidate county sums must equal the pinned SOS
    canvass numbers EXACTLY.
  * Gate L (local)      — the Collin rows copied into the tree must sum to the
    repo's full county file (all D4 votes live inside the CONG==4 precincts).
  * Gate D (district)   — grand totals across all written rows must equal the
    SOS statewide totals up to the pinned, documented Collin county-vs-state
    canvass delta (DEM −2/−2; REP exact).
  * Row gates           — no negative votes, no duplicate (precinct,party,
    candidate), no commas/quotes in any field (the frontend's district
    aggregate parser is a naive split(",")), and never :ALL + precinct rows
    for the same county.

Usage:
  python3 data_processor/upgrade_district_precincts_2026_primary.py --dry-run
  python3 data_processor/upgrade_district_precincts_2026_primary.py \
      [--cache-dir DIR]   # PDFs are cached/reused there; Clarity is re-fetched
"""
import argparse
import csv
import hashlib
import json
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fetch_clarity_results import current_ver, detail_xml, parse_contest  # noqa: E402
from parse_precinct_pdf import (  # noqa: E402
    extract_text, parse_grayson_layout, parse_bowie_layout, county_sums)

REPO = Path(__file__).parent.parent
ROOT = REPO / "data/tx/districts/cd-4/data"
COLLIN_RACES = REPO / "data/tx/collin/2026/races"
COLLIN_GEO = REPO / "data/tx/collin/boundaries/2026.geojson"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")

PARTIES = ["DEM", "REP"]
RACE_FILE = {p: f"races/{p}_US_Representative_District_4_2026.csv" for p in PARTIES}
CANDIDATES = {"DEM": ["Andrew L Rubell", "Jason Pearce"],
              "REP": ["Don Horn", "Pat Fallon"]}

# --- Pinned official verification totals -----------------------------------
# TX SOS official canvass (state canvass complete 2026-03-25), read from the
# SOS Civix results API on 2026-07-12:
#   https://goelect.txelections.civixapps.com/api-ivis-system/api/s3/enr/election/countyInfo/53813  (REP)
#   https://goelect.txelections.civixapps.com/api-ivis-system/api/s3/enr/election/countyInfo/53814  (DEM)
# (SOS candidate display names: "PAT FALLON (I)", "DON HORN", "ANDREW L
# RUBELL", "JASON PEARCE" — pinned here under the repo's canonical spellings.)
CANVASS_URL = ("https://goelect.txelections.civixapps.com/api-ivis-system/api/"
               "s3/enr/election/countyInfo/{53813 REP, 53814 DEM}")
CANVASS = {
    "collin":    {"DEM": {"Andrew L Rubell": 15746, "Jason Pearce": 15282},
                  "REP": {"Don Horn": 7208, "Pat Fallon": 25479}},
    "bowie":     {"DEM": {"Andrew L Rubell": 163, "Jason Pearce": 317},
                  "REP": {"Don Horn": 597, "Pat Fallon": 2268}},
    "denton":    {"DEM": {"Andrew L Rubell": 3151, "Jason Pearce": 3279},
                  "REP": {"Don Horn": 1594, "Pat Fallon": 7091}},
    "fannin":    {"DEM": {"Andrew L Rubell": 356, "Jason Pearce": 464},
                  "REP": {"Don Horn": 976, "Pat Fallon": 3779}},
    "grayson":   {"DEM": {"Andrew L Rubell": 1713, "Jason Pearce": 3121},
                  "REP": {"Don Horn": 2205, "Pat Fallon": 13864}},
    "lamar":     {"DEM": {"Andrew L Rubell": 487, "Jason Pearce": 853},
                  "REP": {"Don Horn": 1205, "Pat Fallon": 6068}},
    "red-river": {"DEM": {"Andrew L Rubell": 163, "Jason Pearce": 236},
                  "REP": {"Don Horn": 598, "Pat Fallon": 1279}},
}
# SOS statewide D4 totals — the 7 county lines above sum to these exactly.
STATEWIDE = {"DEM": {"Andrew L Rubell": 21779, "Jason Pearce": 23552},
             "REP": {"Don Horn": 14383, "Pat Fallon": 59828}}
# Known, documented delta between the repo's Collin county precinct canvass
# and the SOS state canvass (state canvass added 2 votes per DEM candidate;
# REP matches exactly). The tree keeps the county file's numbers so the
# district file can never disagree with the app's own Collin data.
COLLIN_SOS_DELTA = {"DEM": {"Andrew L Rubell": -2, "Jason Pearce": -2},
                    "REP": {"Don Horn": 0, "Pat Fallon": 0}}

# --- Per-county source jobs --------------------------------------------------
CLARITY_JOBS = {
    # county -> party -> (clarity county name, election id, contest match)
    "denton": {"DEM": ("Denton", "126054", "United States Representative, District 4"),
               "REP": ("Denton", "126053", "United States Representative, District 4")},
    "lamar":  {"DEM": ("Lamar", "126018", "DEM US Representative, District 4"),
               "REP": ("Lamar", "126018", "REP US Representative, District 4")},
}
PDF_JOBS = {
    # county -> party -> (url, layout)
    "grayson": {
        "DEM": ("https://www.co.grayson.tx.us/page/open/3828/0/Official_Dem_Party_Pct_Summ_Results_Report_2026.pdf", "grayson"),
        "REP": ("https://www.co.grayson.tx.us/page/open/3828/0/Official_Rep_Party_Pct_Summ_Results_Report_2026.pdf", "grayson"),
    },
    "bowie": {
        "DEM": ("https://www.co.bowie.tx.us/upload/page/11424/2026/3326%20Joint%20Primary%20Pct%20X%20Pct%20Democratic.pdf", "bowie"),
        "REP": ("https://www.co.bowie.tx.us/upload/page/11424/2026/3326%20Joint%20Primary%20Pct%20X%20Pct%20Republican.pdf", "bowie"),
    },
}
ALL_FALLBACK = ["fannin", "red-river"]          # SOS canvass :ALL only
WHOLE_COUNTIES = {"fannin", "grayson", "lamar", "red-river"}
PDF_CONTEST = {p: f"{p} US Representative, District 4" for p in PARTIES}


def base_precinct(name):
    """'101 - SBL' -> '101' (Clarity ballot-style splits sum to base)."""
    return re.split(r"\s*-\s*", name.strip())[0]


def check_field(value):
    v = str(value)
    if "," in v or '"' in v or "\n" in v:
        raise SystemExit(f"field {v!r} contains a comma/quote — frontend's naive "
                         "CSV split cannot carry it; refusing")
    return v


# --- Source readers: county -> {party: {precinct: {cand: votes}}} ------------

def clarity_precincts(county, party):
    cname, eid, contest = CLARITY_JOBS[county][party]
    ver = current_ver(cname, eid)
    if not ver:
        raise ValueError(f"{county}: could not resolve Clarity version for {cname}/{eid}")
    xml_text = detail_xml(cname, eid, ver)
    found, rows = parse_contest(xml_text, contest)
    if not rows:
        raise ValueError(f"{county}: no contest matched {contest!r} in {cname}/{eid}")
    if "district 4" not in found.lower():
        raise ValueError(f"{county}: matched wrong contest {found!r}")
    out = defaultdict(lambda: defaultdict(int))
    for pct, _party, cand, votes in rows:
        out[base_precinct(pct)][cand] += votes
    # all precincts in the file (from a statewide contest) for the membership gate
    _sen, sen_rows = parse_contest(xml_text, contest.replace(
        "US Representative, District 4", "US Senator").replace(
        "United States Representative, District 4", "United States Senator"))
    all_pcts = {base_precinct(r[0]) for r in sen_rows} if sen_rows else set()
    return {p: dict(c) for p, c in out.items()}, all_pcts, f"Clarity {cname}/{eid} ver {ver}"


def pdf_precincts(county, party, cache_dir):
    url, layout = PDF_JOBS[county][party]
    dest = cache_dir / f"{county}_{party.lower()}.pdf"
    if not dest.exists():
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            dest.write_bytes(r.read())
    sha = hashlib.sha256(dest.read_bytes()).hexdigest()
    text = extract_text(dest)
    parser = parse_grayson_layout if layout == "grayson" else parse_bowie_layout
    results, sections = parser(text, PDF_CONTEST[party], source=f"{county} {party} pdf")
    out = {pct: dict(rows) for pct, rows in results.items()}
    return out, sections, f"official county PDF sha256:{sha[:16]}… ({url})"


# --- Gates -------------------------------------------------------------------

def gate_membership(county, per_party_pcts, all_sections):
    """DEM and REP must agree on the in-district precinct set; whole counties
    must have the contest everywhere, partial counties on a strict subset."""
    sets = {p: set(per_party_pcts[p]) for p in PARTIES}
    if sets["DEM"] != sets["REP"]:
        raise ValueError(f"{county}: DEM/REP in-district precinct sets differ "
                         f"({sorted(sets['DEM'] ^ sets['REP'])})")
    pcts = sets["DEM"]
    if all_sections:
        if county in WHOLE_COUNTIES and pcts != all_sections:
            raise ValueError(f"{county}: whole county expected but contest missing from "
                             f"{sorted(all_sections - pcts)}")
        if county not in WHOLE_COUNTIES and not (pcts < all_sections):
            raise ValueError(f"{county}: partial county expected but contest covers "
                             "every precinct")
    return pcts


def gate_canvass(county, party, sums):
    exp = CANVASS[county][party]
    if sums != exp:
        raise ValueError(f"{county} {party}: source sums {sums} != SOS canvass {exp}")


# --- Collin ------------------------------------------------------------------

def collin_rows(party):
    """Repo Collin county file -> collin:-prefixed rows for the CONG==4
    precincts, preserving the county file's row order and its Over/Under rows."""
    geo = json.load(COLLIN_GEO.open())
    cd4 = {str(f["properties"]["PRECINCT"]) for f in geo["features"]
           if str(f["properties"].get("CONG")) == "4"}
    if len(cd4) != 101:
        raise SystemExit(f"expected 101 CONG==4 precincts in 2026 boundaries, got {len(cd4)}")
    src = COLLIN_RACES / f"{party}_US_Representative_District_4_2026.csv"
    rows, in_sums, out_sums = [], defaultdict(int), defaultdict(int)
    for r in csv.DictReader(src.open()):
        cand, votes = r["candidate"], int(r["votes"] or 0)
        tgt = in_sums if r["precinct"] in cd4 else out_sums
        if cand in CANDIDATES[party]:
            tgt[cand] += votes
        if r["precinct"] in cd4:
            rows.append([f"collin:{r['precinct']}", r["party"], cand, votes])
    # Gate L: every D4 vote in the county file must live inside the CONG==4 set
    if any(out_sums.values()):
        raise SystemExit(f"collin {party}: {dict(out_sums)} candidate votes found "
                         "OUTSIDE the CONG==4 precincts — boundary/race mismatch")
    exp_sos = CANVASS["collin"][party]
    delta = {c: in_sums[c] - exp_sos[c] for c in CANDIDATES[party]}
    if delta != COLLIN_SOS_DELTA[party]:
        raise SystemExit(f"collin {party}: county-file vs SOS delta {delta} is not the "
                         f"pinned {COLLIN_SOS_DELTA[party]} — investigate before writing")
    return rows, dict(in_sums)


# --- Assembly ----------------------------------------------------------------

def natural_key(pct):
    return [int(t) if t.isdigit() else t for t in re.findall(r"\d+|\D+", pct)]


def build_county_rows(county, party, pcts_votes):
    rows = []
    for pct in sorted(pcts_votes, key=natural_key):
        for cand in CANDIDATES[party]:
            votes = pcts_votes[pct].get(cand)
            if votes is None:
                raise SystemExit(f"{county} {party} pct {pct}: candidate {cand!r} missing")
            if votes < 0:
                raise SystemExit(f"{county} {party} pct {pct}: negative votes")
            rows.append([f"{county}:{pct}", party, cand, votes])
    return rows


def validate_rows(party, rows):
    seen = set()
    per_county = defaultdict(set)
    for r in rows:
        for f in r[:3]:
            check_field(f)
        key = (r[0], r[1], r[2])
        if key in seen:
            raise SystemExit(f"duplicate row {key}")
        seen.add(key)
        county, pct = r[0].split(":", 1)
        per_county[county].add(pct == "ALL")
    for county, kinds in per_county.items():
        if kinds == {True, False}:
            raise SystemExit(f"{county}: mixes :ALL and precinct rows")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--cache-dir", default="/tmp/cd4_2026_primary_cache",
                    help="official PDFs are cached here (Clarity always re-fetched)")
    args = ap.parse_args()
    cache = Path(args.cache_dir)
    cache.mkdir(parents=True, exist_ok=True)

    outcomes = {}   # county -> {"granularity": ..., "source": ..., "note": ...}
    county_data = {}  # county -> {party: {pct: {cand: votes}}}

    # 1. Pull + gate each precinct-level county; demote to :ALL on any failure.
    for county, fetch in [("denton", "clarity"), ("lamar", "clarity"),
                          ("grayson", "pdf"), ("bowie", "pdf")]:
        try:
            per_party, all_sections, srcs = {}, None, []
            for party in PARTIES:
                if fetch == "clarity":
                    data, pcts_all, src = clarity_precincts(county, party)
                else:
                    data, pcts_all, src = pdf_precincts(county, party, cache)
                per_party[party] = data
                srcs.append(f"{party}: {src}")
                all_sections = pcts_all if all_sections is None else (all_sections | pcts_all)
                gate_canvass(county, party, county_sums(
                    {p: list(c.items()) for p, c in data.items()}))
            pcts = gate_membership(county, per_party, all_sections)
            county_data[county] = per_party
            outcomes[county] = {
                "granularity": "precinct", "precincts": len(pcts),
                "source": "; ".join(srcs),
                "gates": "membership + exact SOS canvass equality (both parties)"}
        except Exception as e:  # fail closed -> official county line only
            county_data[county] = {p: {"ALL": CANVASS[county][p]} for p in PARTIES}
            outcomes[county] = {
                "granularity": "county :ALL (SOS canvass)",
                "source": CANVASS_URL,
                "note": f"precinct source failed a gate: {e}"}
            print(f"!! {county}: demoted to :ALL — {e}", file=sys.stderr)

    # 2. Counties with no usable machine-readable precinct source at all.
    for county in ALL_FALLBACK:
        county_data[county] = {p: {"ALL": CANVASS[county][p]} for p in PARTIES}
        outcomes[county] = {
            "granularity": "county :ALL (SOS canvass)", "source": CANVASS_URL,
            "note": ("Fannin publishes only a countywide scanned PDF; Red River's "
                     "precinct report is an image-only scan (no OCR — not evidence).")}

    # 3. Assemble + write the two race files.
    grand_delta = {}
    for party in PARTIES:
        c_rows, c_sums = collin_rows(party)
        rows = list(c_rows)
        for county in sorted(county_data):
            rows += build_county_rows(county, party, county_data[county][party])
        validate_rows(party, rows)
        # Gate D: written totals vs SOS statewide, must equal the pinned Collin delta
        written = defaultdict(int)
        for r in rows:
            if r[2] in CANDIDATES[party]:
                written[r[2]] += r[3]
        delta = {c: written[c] - STATEWIDE[party][c] for c in CANDIDATES[party]}
        if delta != COLLIN_SOS_DELTA[party]:
            raise SystemExit(f"Gate D failed ({party}): district total delta {delta} "
                             f"!= pinned Collin delta {COLLIN_SOS_DELTA[party]}")
        grand_delta[party] = delta
        path = ROOT / RACE_FILE[party]
        print(f"{RACE_FILE[party]}: {len(rows)} rows "
              f"({len(c_rows)} collin, {len(rows) - len(c_rows)} out-of-county); "
              f"district totals {dict(written)} (SOS delta {delta})")
        if not args.dry_run:
            with path.open("w", newline="") as f:
                w = csv.writer(f)
                w.writerow(["precinct", "party", "candidate", "votes"])
                w.writerows(rows)

    # 4. Manifest entries (ids identical to Collin's so the picker dedupes).
    manifest_path = ROOT / "elections.json"
    manifest = json.load(manifest_path.open())
    have = {e["id"] for e in manifest["elections"]}
    added = []
    for party in PARTIES:
        eid = f"{party.lower()}-us-representative-district-4-2026"
        if eid in have:
            continue
        added.append(eid)
        manifest["elections"].append({
            "id": eid,
            "displayName": f"{party} US Representative District 4 (2026)",
            "office": f"{party} US Representative District 4",
            "district": "4",
            "year": 2026,
            "date": None,
            "category": "Federal",
            "raceFile": RACE_FILE[party],
            "turnoutFile": None,
            "sourceUrl": None,
        })
    print(f"elections.json: adding {added or 'nothing (already present)'}")
    if not args.dry_run and added:
        json.dump(manifest, manifest_path.open("w"), indent=4)

    # 5. Provenance amendment.
    prov_path = ROOT / "profile" / "provenance.json"
    prov = json.load(prov_path.open())
    tag = "2026 primary: US Rep District 4 (PLANC2333)"
    prov.setdefault("amendments", [])
    prov["amendments"] = [a for a in prov["amendments"] if a.get("tag") != tag]
    prov["amendments"].append({
        "tag": tag,
        "date": "2026-07-12",
        "what": ("Added the March 3 2026 primary's DEM + REP U.S. Representative "
                 "District 4 contests with real official out-of-county results."),
        "plan_note": ("The 2026 primary ran under PLANC2333 (HB 4 mid-decade "
                      "redistricting): CD-4 = Collin/Denton/Bowie (part) + "
                      "Fannin/Grayson/Lamar/Red River (whole). Delta, Hopkins, Hunt, "
                      "Rains and Rockwall left CD-4 and correctly have NO 2026 rows "
                      "(verified: their 2026 primaries carry no District 4 contest). "
                      "This tree's boundaries/other_precincts.geojson remains "
                      "PLANC2193-vintage; 2026 precinct codes that do not join old "
                      "polygons render as county outlines — never fabricated geometry."),
        "verification": ("Per-candidate county sums equal the TX SOS official canvass "
                         "exactly for every precinct-level county (source: "
                         f"{CANVASS_URL}); the 7 SOS county lines sum exactly to the "
                         "SOS statewide totals (complete partition, both parties). "
                         "Collin rows copy the repo's official county file; its known "
                         "state-canvass delta is DEM -2/-2, REP exact "
                         f"(district-file delta: {grand_delta})."),
        "outcomes": outcomes,
    })
    print("provenance.json: amendment " + ("(dry-run) " if args.dry_run else "") + "recorded")
    if not args.dry_run:
        json.dump(prov, prov_path.open("w"), indent=4)


if __name__ == "__main__":
    main()
