#!/usr/bin/env python3
"""
Statewide batch import: bring every Texas county with published precinct data
live, with three hard gates per county. No gate, no flip — failed counties
stay explicit placeholders and land in the report for manual review.

  GATE 1 — ETL: OpenElections precinct results parse cleanly into v3
           (data_processor/tx_etl.py; transcribed from official county
           canvasses, sourceUrl recorded).
  GATE 2 — CANVASS AUDIT: county totals for the major statewide races must
           reconcile EXACTLY against MEDSL's officially-sourced returns
           (github.com/MEDSL/<year>-elections-official). REP/DEM/LIB compared
           per office; all other candidates + write-ins compared as one OTHER
           bucket (taxonomies differ, e.g. GRN vs OTHER WRITE-IN); over/under
           votes excluded on both sides. Every vote must reconcile.
  GATE 3 — BOUNDARY JOIN: Texas Legislative Council election-vintage VTDs
           (already the precinct plan used in that election) must match 100%
           of vote-bearing precinct codes.

Boundaries are simplified at 15m tolerance in the TLC projected CRS
(preserve_topology), then reprojected to WGS84 and rounded to 6 decimals —
~7x smaller with no visual impact at county zoom.

Usage:
  python3 data_processor/batch_import.py --wave 2022 [--county bastrop] [--limit N]
  python3 data_processor/batch_import.py --wave 2020 ...

Outputs data/tx/AUDIT_REPORT.json (per-county gates, cells compared,
mismatches) and updates data/tx/counties.json for counties passing all gates.

When a county flips live, its boundary GeoJSON is shrunk (optimize_geojson) and a
per-precinct voting-history index is precomputed (build_precinct_history) so
precinct.html loads one small file per click instead of every race CSV. Both are
also runnable standalone via `make optimize-data`.
"""

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import shapefile  # pyshp
from shapely.geometry import shape, mapping
from pyproj import CRS, Transformer

sys.path.insert(0, str(Path(__file__).parent))
import tx_etl  # noqa: E402
import optimize_geojson  # noqa: E402
import build_precinct_history  # noqa: E402

ROOT = Path(__file__).parent.parent
REGISTRY_PATH = ROOT / "data/tx/counties.json"
REPORT_PATH = ROOT / "data/tx/AUDIT_REPORT.json"

WAVES = {
    "2022": {
        "oe_url": "https://raw.githubusercontent.com/openelections/openelections-data-tx/master/2022/counties/20221108__tx__general__{token}__precinct.csv",
        "oe_list": "/tmp/oe_unique.txt",
        "medsl_csv": "/tmp/TX-cleaned.csv",
        "shapefile": "/tmp/VTDs_22G.shp",
        "set_dir": "2022",
        "label": "2022 Precincts ({n})",
        "audit_offices": {
            "GOVERNOR": lambda o: "governor" in o and "lieutenant" not in o,
            "LIEUTENANT GOVERNOR": lambda o: "lieutenant governor" in o,
            "ATTORNEY GENERAL": lambda o: "attorney general" in o,
            "COMPTROLLER": lambda o: "comptroller" in o,
        },
    },
    "2020": {
        "oe_url": "https://raw.githubusercontent.com/openelections/openelections-data-tx/master/2020/counties/20201103__tx__general__{token}__precinct.csv",
        "oe_list": "/tmp/oe_2020.txt",
        "audit_source": "vest",
        "vest_shapefile": "/tmp/tx_2020.shp",
        "vest_offices": {"US PRESIDENT": "PRE", "US SENATE": "USS",
                         "RAILROAD COMMISSIONER": "RRC"},
        "shapefile": "/tmp/VTDs20G_2020.shp",
        "set_dir": "2020",
        "label": "2020 Precincts ({n})",
        "audit_offices": {
            "US PRESIDENT": lambda o: "president" in o,
            "US SENATE": lambda o: "senat" in o and "state senat" not in o and "district" not in o,
            "RAILROAD COMMISSIONER": lambda o: "railroad" in o,
        },
    },
}

SIMPLIFY_TOLERANCE_M = 15
PARTY_BUCKETS = {"REP": "REPUBLICAN", "DEM": "DEMOCRAT", "LIB": "LIBERTARIAN"}
SKIP_PSEUDO = {"Over Votes", "Under Votes"}


# ---------------------------------------------------------------------------
# MEDSL official aggregates
# ---------------------------------------------------------------------------
def load_medsl(path, audit_offices):
    """county_name(UPPER) -> office -> bucket -> votes (TOTAL mode preferred)."""
    per_mode = defaultdict(lambda: defaultdict(int))
    modes_seen = defaultdict(set)
    with open(path) as f:
        for r in csv.DictReader(f):
            office = r["office"]
            if office not in audit_offices:
                continue
            if (r.get("district") or "").strip() not in ("", "STATEWIDE"):
                continue
            cand = (r["candidate"] or "").upper()
            if any(p in cand for p in ("UNDERVOTE", "OVERVOTE", "UNDER VOTE", "OVER VOTE", "BLANK")):
                continue  # ballot-accounting pseudo rows, excluded on both sides
            party = r["party_simplified"]
            # empty party = candidate MEDSL couldn't classify (e.g. BARRIOS in
            # some counties) — still real votes, bucketed as OTHER
            bucket = party if party in ("REPUBLICAN", "DEMOCRAT", "LIBERTARIAN") else "OTHER"
            county = r["county_name"].upper()
            mode = r.get("mode", "TOTAL") or "TOTAL"
            modes_seen[(county, office)].add(mode)
            per_mode[(county, office, mode)][bucket] += int(r["votes"] or 0)

    out = defaultdict(lambda: defaultdict(dict))
    for (county, office), modes in modes_seen.items():
        use = ["TOTAL"] if "TOTAL" in modes else sorted(modes)
        agg = defaultdict(int)
        for m in use:
            for bucket, v in per_mode[(county, office, m)].items():
                agg[bucket] += v
        out[county][office] = dict(agg)
    return out


def load_vest(shp_path, vest_offices, fips_to_name):
    """VEST precinct shapefile -> county NAME -> office -> bucket -> votes.
    Column scheme: G20 + office(3) + party letter + candidate(3)."""
    sf = shapefile.Reader(shp_path)
    fields = [f[0] for f in sf.fields[1:]]
    letter_bucket = {"R": "REPUBLICAN", "D": "DEMOCRAT", "L": "LIBERTARIAN"}
    cols = []
    for f in fields:
        for office, code in vest_offices.items():
            if f.startswith("G20" + code) and len(f) > 6:
                bucket = letter_bucket.get(f[6], "OTHER")
                cols.append((f, office, bucket))
    out = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for i in range(len(sf)):
        rec = sf.record(i)
        d = dict(zip(fields, list(rec)))
        name = fips_to_name.get(int(d["CNTY"]))
        if not name:
            continue
        for f, office, bucket in cols:
            out[name.upper()][office][bucket] += int(d.get(f) or 0)
    return {c: {o: dict(b) for o, b in offices.items()} for c, offices in out.items()}


def load_vest_parties(shp_path, vest_offices):
    """(office, CANDCODE-3) -> party prefix, from VEST column names."""
    sf = shapefile.Reader(shp_path)
    fields = [f[0] for f in sf.fields[1:]]
    letter_prefix = {"R": "REP", "D": "DEM", "L": "LIB", "G": "GRN"}
    lookup = {}
    for f in fields:
        for office, code in vest_offices.items():
            if f.startswith("G20" + code) and len(f) >= 10:
                prefix = letter_prefix.get(f[6])
                if prefix:
                    lookup[(office, f[7:10].upper())] = prefix
    return lookup


def enrich_parties_vest(set_path, party_lookup, audit_offices):
    """Fill empty parties by matching the first 3 letters of the candidate's
    last name to VEST candidate codes (unique match required)."""
    manifest = json.load((set_path / "elections.json").open())
    filled = 0
    for e in manifest["elections"]:
        office_l = (e["office"] or "").lower()
        if e.get("district"):
            continue
        target = next((k for k, pred in audit_offices.items() if pred(office_l)), None)
        if not target:
            continue
        path = set_path / e["raceFile"]
        rows = list(csv.reader(path.open()))
        header, body = rows[0], rows[1:]
        pi, ci = header.index("party"), header.index("candidate")
        changed = False
        for row in body:
            cand = row[ci].strip()
            if row[pi].strip() == "" and cand not in ("Write-in", "Over Votes", "Under Votes") and cand:
                # ticket names may lack separators ("Donald J Trump Michael R
                # Pence") — test every word against the official candidate
                # codes; assign only when exactly one code matches
                words = ["".join(ch for ch in w if ch.isalpha()).upper()
                         for w in cand.replace("/", " ").split()]
                hits = {party_lookup[(target, w[:3])]
                        for w in words if len(w) >= 3 and (target, w[:3]) in party_lookup}
                prefix = next(iter(hits)) if len(hits) == 1 else None
                if prefix:
                    row[pi] = prefix
                    changed = True
                    filled += 1
        if changed:
            with path.open("w", newline="") as f:
                w = csv.writer(f)
                w.writerow(header)
                w.writerows(body)
    return filled


def load_medsl_parties(path, audit_offices):
    """(audited office, CANDIDATE LASTNAME) -> our party prefix, where the
    official source is unambiguous. Used to fill parties OE omitted."""
    simplified_to_prefix = {"REPUBLICAN": "REP", "DEMOCRAT": "DEM",
                            "LIBERTARIAN": "LIB", "GREEN": "GRN"}
    seen = defaultdict(set)
    with open(path) as f:
        for r in csv.DictReader(f):
            if r["office"] not in audit_offices:
                continue
            prefix = simplified_to_prefix.get(r["party_simplified"])
            cand = (r["candidate"] or "").strip().upper()
            if prefix and cand and "WRITE" not in cand:
                lastname = cand.split()[-1]
                seen[(r["office"], lastname)].add(prefix)
                # alpha-only full-surname key handles hyphen/space variants
                alpha = "".join(ch for ch in cand if ch.isalpha())
                seen[(r["office"], "~" + alpha)].add(prefix)
    return {k: next(iter(v)) for k, v in seen.items() if len(v) == 1}


def enrich_parties(set_path, county_name, party_lookup, audit_offices):
    """Fill empty parties in race files from the official lookup (statewide
    audited offices only; exact last-name match). Returns count filled."""
    manifest = json.load((set_path / "elections.json").open())
    filled = 0
    for e in manifest["elections"]:
        office_l = (e["office"] or "").lower()
        if e.get("district"):
            continue
        target = next((k for k, pred in audit_offices.items() if pred(office_l)), None)
        if not target:
            continue
        path = set_path / e["raceFile"]
        rows = list(csv.reader(path.open()))
        header, body = rows[0], rows[1:]
        pi, ci = header.index("party"), header.index("candidate")
        changed = False
        for row in body:
            if row[pi].strip() == "" and row[ci].strip() not in ("Write-in", "Over Votes", "Under Votes"):
                cand_u = row[ci].strip().upper()
                lastname = cand_u.split()[-1] if cand_u else ""
                prefix = party_lookup.get((target, lastname))
                if not prefix and cand_u:
                    # containment fallback: official alpha-only surname inside
                    # our alpha-only full name (unique key required)
                    our_alpha = "".join(ch for ch in cand_u if ch.isalpha())
                    hits = {v for (off, k), v in party_lookup.items()
                            if off == target and k.startswith("~")
                            and (k[1:] in our_alpha or our_alpha in k[1:])}
                    if len(hits) == 1:
                        prefix = next(iter(hits))
                if prefix:
                    row[pi] = prefix
                    changed = True
                    filled += 1
        if changed:
            with path.open("w", newline="") as f:
                w = csv.writer(f)
                w.writerow(header)
                w.writerows(body)
    return filled


def audit_county(set_path, county_name, medsl, audit_offices, official_cands=None):
    """Compare our v3 sums to official aggregates. Returns (passed, detail).
    official_cands: optional {(office, CODE3)} set of certified candidates —
    votes for unlisted no-party candidates count as uncertified write-ins."""
    manifest = json.load((set_path / "elections.json").open())
    ours = defaultdict(lambda: defaultdict(int))
    write_ins = defaultdict(int)
    for e in manifest["elections"]:
        office_l = (e["office"] or "").lower()
        if e.get("district"):
            continue  # statewide races only
        target = next((k for k, pred in audit_offices.items() if pred(office_l)), None)
        if not target:
            continue
        for r in csv.DictReader((set_path / e["raceFile"]).open()):
            cand = r["candidate"].strip()
            if r["party"].strip() == "" and cand.lower() in ("over votes", "under votes"):
                continue  # ballot accounting, excluded on both sides
            bucket = PARTY_BUCKETS.get(r["party"].strip().upper(), "OTHER")
            votes = int(r["votes"] or 0)
            ours[target][bucket] += votes
            if r["party"].strip() == "":
                if cand.lower() == "write-in":
                    write_ins[target] += votes
                elif official_cands is not None:
                    head = cand.split("/")[0].strip()
                    last = "".join(ch for ch in head.split()[-1] if ch.isalpha()).upper() if head else ""
                    if (target, last[:3]) not in official_cands:
                        # candidate not certified in the official accounting
                        write_ins[target] += votes

    official = medsl.get(county_name.upper(), {})
    cells = mismatches = 0
    detail = []
    offices_compared = 0
    for office, our_buckets in ours.items():
        if office not in official:
            detail.append(f"{office}: not in MEDSL for this county")
            continue
        offices_compared += 1
        buckets = set(our_buckets) | set(official[office])
        for b in sorted(buckets):
            a, o = our_buckets.get(b, 0), official[office].get(b, 0)
            cells += 1
            if a != o:
                # Tolerated ONLY when the gap is exactly our write-in tally —
                # i.e. every certified candidate vote reconciles and the
                # official accounting simply omits (uncertified) write-ins
                if b == "OTHER" and a - o == write_ins.get(office, 0) > 0:
                    detail.append(f"note {office}: {write_ins[office]} write-in votes "
                                  f"not carried in official accounting (all certified votes exact)")
                    continue
                mismatches += 1
                detail.append(f"{office}/{b}: ours={a} official={o} (diff {a - o:+d})")
    passed = offices_compared >= 2 and mismatches == 0
    if offices_compared < 2:
        detail.append(f"only {offices_compared} audited offices found — too few to certify")
    return passed, {"offices": offices_compared, "cells": cells,
                    "mismatches": mismatches, "detail": detail[:12]}


# ---------------------------------------------------------------------------
# Boundaries
# ---------------------------------------------------------------------------
class VTDSource:
    def __init__(self, shp_path):
        self.sf = shapefile.Reader(shp_path)
        self.fields = [f[0] for f in self.sf.fields[1:]]
        prj = Path(shp_path).with_suffix(".prj").read_text()
        self.transformer = Transformer.from_crs(CRS.from_wkt(prj), CRS.from_epsg(4326), always_xy=True)
        self.by_cnty = defaultdict(list)
        for i in range(len(self.sf)):
            self.by_cnty[self.sf.record(i)["CNTY"]].append(i)

    def county_features(self, fips):
        cnty = int(fips[2:])
        feats = []
        for i in self.by_cnty.get(cnty, []):
            rec = dict(zip(self.fields, list(self.sf.record(i))))
            geom = shape(self.sf.shape(i).__geo_interface__)
            geom = geom.simplify(SIMPLIFY_TOLERANCE_M, preserve_topology=True)
            gj = mapping(geom)

            def rp(c):
                if isinstance(c[0], (int, float)):
                    x, y = self.transformer.transform(c[0], c[1])
                    return [round(x, 6), round(y, 6)]
                return [rp(x) for x in c]
            vtd = str(rec["VTD"]).strip()
            feats.append({
                "type": "Feature",
                "properties": {"PRECINCT": vtd.lstrip("0") or vtd, "VTD": vtd},
                "geometry": {"type": gj["type"], "coordinates": rp(list(gj["coordinates"]))},
            })
        return feats


# ---------------------------------------------------------------------------
# Precinct-code normalization ladder. Deterministic rules tried in order; a
# rule is accepted only if it maps 100% of vote-bearing codes onto boundary
# codes UNIQUELY. The accepted rule is recorded in the audit report and the
# race/turnout files are rewritten so on-disk codes match the boundaries
# exactly (spec rule). Never fuzzy.
# ---------------------------------------------------------------------------
import re as _re


def _first_integer(code):
    m = _re.match(r"\D*0*(\d+)", code)
    return m.group(1) if m else code


# (name, fn, merge) — merge rungs may map several source codes onto one
# boundary code; their rows are then SUMMED per mapped precinct (sub-precinct
# splits like "305 - C"/"305 - M" that share one VTD).
def _strip_part_suffix(code):
    """Remove a trailing split-part suffix after a separator:
    '1004-01'->'1004', '30A4-01'->'30A4', '1001 - L01'->'1001', '1004 K1'->'1004'."""
    base = _re.sub(r"[\s\-_]+[A-Za-z]{0,4}\d{0,3}$", "", code).strip()
    base = base or code
    return base.lstrip("0") or base


def _digit_onward(code):
    """Strip a leading word prefix, keep everything from the first digit:
    'Precinct 12'->'12', 'Precinct 13T'->'13T'."""
    out = _re.sub(r"^\D*0*", "", code).strip()
    return out or code


LADDER = [
    ("exact", lambda c: c, False),
    ("strip-leading-zeros", lambda c: c.lstrip("0") or c, False),
    ("digit-onward", _digit_onward, False),
    ("digit-onward-merge", _digit_onward, True),
    ("part-suffix", _strip_part_suffix, False),
    ("part-suffix-merge", _strip_part_suffix, True),
    ("first-integer", _first_integer, False),
    ("first-integer-merge", _first_integer, True),
]


def resolve_precinct_codes(set_path, boundary_codes):
    """Find the first ladder rule joining all vote-bearing codes; rewrite files
    if the rule isn't 'exact'. Returns (rule_name, stats) or (None, stats)."""
    manifest = json.load((set_path / "elections.json").open())
    all_codes, vote_bearing = set(), set()
    for e in manifest["elections"]:
        for r in csv.DictReader((set_path / e["raceFile"]).open()):
            code = r["precinct"].strip()
            all_codes.add(code)
            if r["candidate"].strip() not in ("Write-in", "Over Votes", "Under Votes") \
               and (r["votes"].strip() or "0") != "0":
                vote_bearing.add(code)

    votes_by_code = defaultdict(int)
    for e in manifest["elections"]:
        for r in csv.DictReader((set_path / e["raceFile"]).open()):
            if r["candidate"].strip() not in ("Write-in", "Over Votes", "Under Votes"):
                votes_by_code[r["precinct"].strip()] += int(r["votes"] or 0)
    total_votes = sum(votes_by_code.values()) or 1

    # Pass 1 — strict: 100% of vote-bearing codes must join
    for rule_name, fn, merge in LADDER:
        mapping = {c: str(fn(c)) for c in all_codes}
        mapped_vb = {mapping[c] for c in vote_bearing}
        unique = len(mapped_vb) == len(vote_bearing)
        if (unique or merge) and mapped_vb <= boundary_codes:
            if rule_name != "exact":
                _rewrite_codes(set_path, manifest, mapping, aggregate=merge)
            return rule_name, {"vote_bearing": len(vote_bearing),
                               "merged_into": len(mapped_vb) if merge else None,
                               "unmatched": []}

    # Pass 2 — partial: precincts whose polygons postdate the TLC snapshot may
    # be missing. Accept when >=99% of vote-bearing precincts AND >=99.5% of
    # votes join; the gap is recorded. Unmatched rows keep their codes and
    # render as no-feature rows — the same tolerated pattern legacy Collin had.
    for rule_name, fn, merge in LADDER:
        mapping = {c: str(fn(c)) for c in all_codes}
        unmatched = sorted(c for c in vote_bearing if mapping[c] not in boundary_codes)
        matched_vb = {mapping[c] for c in vote_bearing if mapping[c] in boundary_codes}
        unique = len(matched_vb) == len(vote_bearing) - len(unmatched)
        pcov = 1 - len(unmatched) / max(len(vote_bearing), 1)
        vcov = 1 - sum(votes_by_code[c] for c in unmatched) / total_votes
        if (unique or merge) and unmatched and pcov >= 0.99 and vcov >= 0.995:
            _rewrite_codes(set_path, manifest, mapping, aggregate=merge)
            return rule_name + "~partial", {
                "vote_bearing": len(vote_bearing),
                "merged_into": len(matched_vb) if merge else None,
                "unmatched": unmatched[:20],
                "unmatched_votes": sum(votes_by_code[c] for c in unmatched),
                "coverage": round(pcov, 4)}

    missing = sorted({c for c in vote_bearing if c not in boundary_codes})[:10]
    return None, {"vote_bearing": len(vote_bearing), "unmatched": missing}


def _rewrite_codes(set_path, manifest, mapping, aggregate=False):
    paths = {set_path / e["raceFile"] for e in manifest["elections"]}
    paths |= {set_path / e["turnoutFile"] for e in manifest["elections"] if e.get("turnoutFile")}
    for p in paths:
        rows = list(csv.reader(p.open()))
        header, body = rows[0], rows[1:]
        idx = header.index("precinct")
        for row in body:
            row[idx] = mapping.get(row[idx].strip(), row[idx])
        if aggregate:
            # sum numeric columns across rows that collapsed onto one key
            agg = {}
            order = []
            for row in body:
                key = (row[idx],) + tuple(v for i, v in enumerate(row)
                                          if i != idx and not _is_num(v))
                if key not in agg:
                    agg[key] = [list(row)]
                    order.append(key)
                else:
                    agg[key].append(list(row))
            new_body = []
            for key in order:
                group = agg[key]
                merged = list(group[0])
                if len(group) > 1:
                    for i in range(len(header)):
                        if i != idx and all(_is_num(g[i]) for g in group):
                            merged[i] = str(sum(int(g[i]) for g in group))
                new_body.append(merged)
            body = new_body
        with p.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(header)
            w.writerows(body)


def _is_num(v):
    v = (v or "").strip()
    return bool(v) and (v.isdigit() or (v[0] == "-" and v[1:].isdigit()))


def dissolve_lettered(features, needed_codes):
    """Union lettered sub-VTD polygons (0179A+0179B -> 179) for codes the
    results need. Returns new feature list, or None if it wouldn't help."""
    from shapely.ops import unary_union
    base_of = {}
    for f in features:
        code = f["properties"]["PRECINCT"]
        m = _re.fullmatch(r"0*(\d+)[A-Za-z]{1,2}", f["properties"].get("VTD", code))
        if m:
            base_of.setdefault(m.group(1), []).append(f)
    if not any(code in base_of and len(base_of[code]) >= 1 for code in needed_codes):
        return None
    consumed = set()
    out = []
    for base, group in base_of.items():
        if base in needed_codes:
            geoms = [shape(f["geometry"]) for f in group]
            merged = unary_union(geoms)
            gj = mapping(merged)
            out.append({"type": "Feature",
                        "properties": {"PRECINCT": base,
                                       "VTD": "+".join(f["properties"]["VTD"] for f in group)},
                        "geometry": {"type": gj["type"],
                                     "coordinates": _round_coords(list(gj["coordinates"]))}})
            consumed |= {id(f) for f in group}
    for f in features:
        if id(f) not in consumed:
            out.append(f)
    return out


def _round_coords(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], 6), round(c[1], 6)]
    return [_round_coords(x) for x in c]


def validate_join(set_path, features):
    boundary_codes = {f["properties"]["PRECINCT"] for f in features}
    manifest = json.load((set_path / "elections.json").open())
    vote_bearing = set()
    for e in manifest["elections"]:
        for r in csv.DictReader((set_path / e["raceFile"]).open()):
            if r["candidate"].strip() not in ("Write-in", "Over Votes", "Under Votes") \
               and (r["votes"].strip() or "0") != "0":
                vote_bearing.add(r["precinct"].strip())
    missing = sorted(vote_bearing - boundary_codes)
    return not missing, {"vote_bearing": len(vote_bearing),
                         "matched": len(vote_bearing) - len(missing),
                         "unmatched": missing[:10]}


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--wave", required=True, choices=list(WAVES))
    ap.add_argument("--county", help="single county slug")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--redo", action="store_true", help="reprocess counties already live")
    args = ap.parse_args()
    cfg = WAVES[args.wave]

    registry = json.load(REGISTRY_PATH.open())
    by_slug = {c["slug"]: c for c in registry}
    oe_tokens = {line.strip().split("__")[3] for line in open(cfg["oe_list"]) if line.strip()}

    if cfg.get("audit_source") == "vest":
        print("Loading VEST official aggregates…")
        fips_to_name = {int(c["fips"][2:]): c["name"] for c in registry}
        medsl = load_vest(cfg["vest_shapefile"], cfg["vest_offices"], fips_to_name)
        party_lookup = load_vest_parties(cfg["vest_shapefile"], cfg["vest_offices"])
        vest_mode = True
    else:
        print("Loading MEDSL official aggregates…")
        medsl = load_medsl(cfg["medsl_csv"], cfg["audit_offices"])
        party_lookup = load_medsl_parties(cfg["medsl_csv"], cfg["audit_offices"])
        vest_mode = False
    print(f"  {len(medsl)} counties in official data; {len(party_lookup)} candidate-party keys")
    print("Indexing TLC VTD shapefile…")
    vtds = VTDSource(cfg["shapefile"])

    report = json.load(REPORT_PATH.open()) if REPORT_PATH.exists() else {}
    targets = []
    for c in registry:
        token = c["slug"].replace("-", "_")
        if token not in oe_tokens:
            continue
        if args.county and c["slug"] != args.county:
            continue
        if c["status"] == "live" and not args.redo:
            continue
        targets.append((c, token))
    if args.limit:
        targets = targets[:args.limit]
    print(f"Processing {len(targets)} counties (wave {args.wave})\n")

    flipped, failed = [], []
    for i, (entry, token) in enumerate(targets, 1):
        slug, name = entry["slug"], entry["name"]
        rep = {"wave": args.wave, "gates": {}}
        print(f"[{i}/{len(targets)}] {name}", flush=True)
        try:
            url = cfg["oe_url"].format(token=token)
            result = tx_etl.run(url, county=name, year=None, set_dir=cfg["set_dir"],
                                out_root=str(ROOT / "data/tx"), source_url=url, dry_run=False)
            set_path = ROOT / "data/tx" / slug / cfg["set_dir"]
            rep["gates"]["etl"] = {"ok": True, "races": result["races"],
                                   "precincts": result["precincts"]}

            if vest_mode:
                enriched = enrich_parties_vest(set_path, party_lookup, cfg["audit_offices"])
            else:
                enriched = enrich_parties(set_path, name, party_lookup, cfg["audit_offices"])
            if enriched:
                rep["gates"]["etl"]["parties_enriched_from_official"] = enriched

            official_cands = {(off, key[:3]) for (off, key) in party_lookup
                              if not key.startswith("~")} if vest_mode else None
            ok_audit, audit = audit_county(set_path, name, medsl, cfg["audit_offices"],
                                           official_cands=official_cands)
            rep["gates"]["audit"] = {"ok": ok_audit, **audit}
            if not ok_audit:
                raise RuntimeError(f"audit failed: {audit['detail'][:3]}")

            features = vtds.county_features(entry["fips"])
            boundary_codes = {f["properties"]["PRECINCT"] for f in features}
            rule, join = resolve_precinct_codes(set_path, boundary_codes)
            if rule is None and join["unmatched"]:
                # Boundary-side dissolve: TLC sometimes splits one results
                # precinct into lettered sub-VTDs (0179A/0179B). Union them.
                features2 = dissolve_lettered(features, set(join["unmatched"]))
                if features2 is not None:
                    features = features2
                    boundary_codes = {f["properties"]["PRECINCT"] for f in features}
                    rule, join = resolve_precinct_codes(set_path, boundary_codes)
                    if rule is not None:
                        rule = rule + "+boundary-dissolve"
            rep["gates"]["join"] = {"ok": rule is not None, "rule": rule, **join}
            if rule is None:
                raise RuntimeError(f"join failed: {join['unmatched'][:5]}")

            out = ROOT / "data/tx" / slug / "boundaries" / f"{cfg['set_dir']}.geojson"
            out.parent.mkdir(parents=True, exist_ok=True)
            with out.open("w") as f:
                json.dump({"type": "FeatureCollection", "features": features},
                          f, separators=(",", ":"))

            # Post-process for fast loading: strip/minify the boundary GeoJSON and
            # precompute the per-precinct voting-history index precinct.html loads
            # on click (see data_processor/build_precinct_history.py). Non-fatal —
            # a hiccup here must not un-flip a county that passed all three gates.
            try:
                optimize_geojson.optimize(str(out))
                build_precinct_history.process_boundary_set(str(set_path))
            except Exception as opt_err:  # noqa: BLE001
                print(f"    WARN: post-process optimize skipped: {opt_err}")

            entry["status"] = "live"
            entry["dataRoot"] = f"data/tx/{slug}"
            entry["defaultBoundarySet"] = entry.get("defaultBoundarySet") or "original"
            sets = entry.get("boundarySets") or {}
            set_id = "original" if "original" not in sets else cfg["set_dir"]
            sets[set_id] = {"label": cfg["label"].format(n=len(features)),
                            "geojson": f"boundaries/{cfg['set_dir']}.geojson",
                            "dataDir": cfg["set_dir"]}
            entry["boundarySets"] = sets
            entry["notes"] = None
            rep["status"] = "live"
            flipped.append(slug)
            print(f"    LIVE — {result['races']} races, {len(features)} precincts, "
                  f"audit {audit['cells']} cells exact")
        except (Exception, SystemExit) as e:  # gate failure or fetch/parse error
            rep["status"] = "placeholder"
            rep["reason"] = str(e)[:300]
            failed.append((slug, rep["reason"]))
            print(f"    STAYS PLACEHOLDER — {rep['reason'][:120]}")

        report[slug] = rep
        # persist incrementally for resume safety
        json.dump(registry, REGISTRY_PATH.open("w"), indent=2)
        json.dump(report, REPORT_PATH.open("w"), indent=2, sort_keys=True)

    print(f"\n=== wave {args.wave}: {len(flipped)} live, {len(failed)} held back ===")
    for slug, reason in failed:
        print(f"  HELD: {slug} — {reason[:140]}")


if __name__ == "__main__":
    main()
