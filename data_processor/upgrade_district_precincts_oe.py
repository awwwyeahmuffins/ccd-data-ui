#!/usr/bin/env python3
"""upgrade_district_precincts_oe.py — fill a district view's missing non-Collin
precinct-level results from OpenElections (free, official county canvass
transcriptions), for races the pre-reduction repo history never had (see
restore_district_precincts.py for the git-history restore that runs first).

For each member county of the district (from boundaries/other_precincts.geojson)
and each race already in the district's manifest for --year, this downloads the
county's OpenElections general-election precinct file (pinned commit), reuses
tx_etl.py's parsing policy verbatim (party canon, write-in/over/under handling,
turnout pseudo-offices), resolves which of the county's precincts are in the
district, and adds their rows to the existing race/turnout CSVs.

Membership resolution, per county x year (fail-closed):
  whole-county  — OE's own U.S. House rows prove EVERY precinct in the county
                  ballots in this district: all precincts are in-district by
                  definition, even where the county has renumbered/consolidated
                  since our boundary vintage (those codes simply don't join a
                  polygon and the map falls back per race — Hunt/CD-3 precedent;
                  the data itself is complete and official).
  partition     — split county: every geometry member precinct must appear in
                  OE's district-N U.S. House set; only member rows are inserted,
                  extra district-N codes (split precincts the partition assigned
                  elsewhere) are excluded and reported.
  failed        — a member precinct missing from OE's district-N set means the
                  county renumbered precincts across vintages (e.g. Denton
                  2020→2024): NO races are inserted for that county-year, since
                  even statewide code joins would attach votes to the wrong
                  polygons. Honest gap until a matching-vintage geometry lands.
  For 2020 (pre-2021 plans) there is no valid House cross-check: geometry
  members only, statewide races must cover 100% of them, and the old-plan
  district race inserts the intersection (partial by nature — the OLD district
  covered different ground; documented in the package provenance).

Row gates (fail-closed, per county x race):
  votes must be non-negative and >= the sum of any populated mode columns
  (absentee/early/election-day/provisional — a smaller total is impossible);
  aggregated rows unique per (precinct, party, candidate); statewide races must
  cover every resolved precinct (they are on every ballot); any remaining
  `<county>:ALL` aggregate must match the new sums exactly before being
  replaced. Existing rows are never overwritten; a county is never left with
  both :ALL and precinct rows in one file.

Counties whose OE file doesn't exist for the year (e.g. Rains 2024) are honest
gaps. Provenance records per-(county, race) outcomes and the pinned source.

Usage:
  python3 data_processor/upgrade_district_precincts_oe.py --slug cd-4 --year 2024 \
      [--county <slug>] [--cache data/cache/openelections] [--dry-run]
  python3 data_processor/upgrade_district_precincts_oe.py --slug cd-4 --verify
"""
import argparse
import csv
import datetime
import json
import re
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from statewide_canon import canonical_statewide_race  # noqa: E402
from tx_etl import load_input, transform, to_votes  # noqa: E402

REPO = Path(__file__).parent.parent

# Pinned openelections/openelections-data-tx commit (master, 2026-07-12)
OE_SHA = "6b8493e2f97aa9be4c089c611841259c39d090d9"
OE_RAW = "https://raw.githubusercontent.com/openelections/openelections-data-tx"
GENERAL_DATES = {2020: "20201103", 2022: "20221108", 2024: "20241105"}
OE_NAME = {"red-river": "red_river"}  # repo slug -> OE filename slug
MODE_COLS = ("absentee", "early_voting", "election_day", "provisional", "mail")
# County-report pseudo-precincts, not places
PSEUDO_PRECINCTS = {"ABSENTEE", "EARLY", "EARLYVOTING", "PROVISIONAL", "MAIL",
                    "TOTAL", "TOTALS", "CUMULATIVE"}

# A district's own congressional race, normalized office text (kept in sync
# with build_districts.py PLAN_RACE_RX["cd"] / race_plan — not imported because
# that module needs shapely at import time)
CD_RX = re.compile(r"\b(u s|united states)\b.*\b(representative|rep|house|congress\w*)\b")
US_HOUSE_RX = re.compile(r"\bu\.?\s?s\.?\s?(house|representative)|united states (house|representative)", re.I)
DIST_IN_OFFICE_RX = re.compile(r"\bdist\w*\s+(?:no\s+)?(\d+)\b")


def office_key(office):
    return re.sub(r"[^a-z0-9 ]", " ", str(office or "").lower()).strip()


def cd_number(office, district):
    """District number when office is a U.S. House race, else None."""
    if not CD_RX.search(office_key(office)):
        return None
    try:
        return int(str(district).strip())
    except (TypeError, ValueError):
        m = DIST_IN_OFFICE_RX.search(office_key(office))
        return int(m.group(1)) if m else None


def target_key(office, district, year):
    n = cd_number(office, district)
    if n:
        return ("own", n, year)
    c = canonical_statewide_race(office)
    return ("sw", c[0], year) if c else None


PCT_PREFIX_RX = re.compile(r"^(?:precinct|pct)[\s.]+", re.I)


def norm_code(code):
    """Join-normalize a precinct label: 'Precinct 101' -> '101',
    '17 So. Bonham' -> '17', '0101' -> '101', '1BA' stays '1BA'."""
    c = PCT_PREFIX_RX.sub("", str(code).strip())
    parts = c.split()
    if len(parts) > 1 and any(ch.isdigit() for ch in parts[0]):
        c = parts[0]
    c = re.sub(r"\s+", "", c).upper()
    return c.lstrip("0") or "0"


BASE_SPLIT_RX = re.compile(r"\s*[-–]\s*")


def base_precinct(code, member_norms, source_norms):
    """'101 - SBL' -> '101'. A trailing-letter suffix (214A) is treated as a
    ballot-style split ONLY when the base code is a member and the suffixed
    code is not (conservative: otherwise keep verbatim, the join decides)."""
    head = BASE_SPLIT_RX.split(str(code).strip())[0]
    n = norm_code(head)
    m = re.match(r"^(\d+)[A-Z]$", n)
    if m and n not in member_norms and m.group(1) in member_norms and m.group(1) not in source_norms:
        return m.group(1)
    return n


def member_codes(slug):
    """{county: {norm_code: verbatim_member_code}} from other_precincts.geojson."""
    p = REPO / f"data/tx/districts/{slug}/boundaries/other_precincts.geojson"
    if not p.exists():
        sys.exit(f"{p} missing — run restore_district_precincts.py first")
    out = defaultdict(dict)
    for ft in json.load(p.open())["features"]:
        pc = ft["properties"]["PRECINCT"]
        county, code = pc.split(":", 1)
        out[county][norm_code(code)] = code
    return dict(out)


def fetch_oe(county, year, cache_dir, statewide_cache):
    """(local path or None, source url or None) for the county's OE file."""
    date = GENERAL_DATES[year]
    name = OE_NAME.get(county, county)
    fname = f"{date}__tx__general__{name}__precinct.csv"
    url = f"{OE_RAW}/{OE_SHA}/{year}/counties/{fname}"
    dest = cache_dir / str(year) / fname
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urllib.request.urlopen(url, timeout=120) as resp:
                dest.write_bytes(resp.read())
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            if year == 2022:  # the statewide file covers many counties
                return fetch_oe_statewide(year, cache_dir, statewide_cache)
            return None, None
    return dest, url


def fetch_oe_statewide(year, cache_dir, statewide_cache):
    fname = f"{GENERAL_DATES[year]}__tx__general__precinct.csv"
    url = f"{OE_RAW}/{OE_SHA}/{year}/{fname}"
    dest = cache_dir / str(year) / fname
    if "path" not in statewide_cache:
        statewide_cache["path"] = None
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                with urllib.request.urlopen(url, timeout=300) as resp:
                    dest.write_bytes(resp.read())
            except urllib.error.HTTPError:
                return None, None
        statewide_cache["path"] = dest
    return statewide_cache["path"], (url if statewide_cache["path"] else None)


def county_display(slug):
    return slug.replace("-", " ").title()  # red-river -> Red River


def party_style(existing_parties):
    """Match the target file's existing party-case convention (Hunt precedent:
    2022-era files use REP/DEM, 2024-era Dem/Rep)."""
    if any(p != p.upper() for p in existing_parties if p):
        return lambda p: p.capitalize() if p else ""
    return lambda p: p or ""


def impossible_mode_races(rows_df):
    """(office, district) keys where any row's votes < sum of its populated
    mode columns — physically impossible, so that race is not trusted.
    (votes > the sum is fine: counties often omit e.g. provisional columns.)"""
    cols = [c for c in MODE_COLS if c in rows_df.columns]
    if not cols:
        return set()
    votes = to_votes(rows_df["votes"])
    modes = sum(to_votes(rows_df[c]) for c in cols)
    bad = rows_df[votes < modes]
    return {(str(r.get("office") or "").strip(),
             str(r.get("district") or "").strip())
            for _, r in bad.iterrows()}


def resolve_membership(races, member_map, own_n, year):
    """Decide which precincts of this county belong to the district.

    Returns (mode, allowed, verbatim, detail):
      mode      'whole-county' | 'partition' | 'partition-2020' | 'failed'
      allowed   set of normalized codes in the district
      verbatim  {norm: code to write} (geometry member code when it exists,
                so the map joins; the normalized OE code otherwise)
    """
    member_norms = set(member_map)
    all_codes, d4_codes = set(), set()
    for race in races:
        source_norms = {norm_code(p) for p, *_ in race["rows"]}
        codes = {base_precinct(p, member_norms, source_norms) for p, *_ in race["rows"]}
        codes -= PSEUDO_PRECINCTS
        all_codes |= codes
        n = cd_number(race["office"], race["district"])
        if n == own_n:
            d4_codes |= codes

    if year == 2020:
        verbatim = dict(member_map)
        return "partition-2020", member_norms, verbatim, ""

    if not d4_codes:
        return "failed", set(), {}, "no U.S. House rows in source to cross-check"
    if d4_codes == all_codes:
        verbatim = {n: member_map.get(n, n) for n in all_codes}
        return "whole-county", all_codes, verbatim, ""
    missing = member_norms - d4_codes
    if missing:
        return ("failed", set(), {},
                f"member precincts missing from the source's district-{own_n} set "
                f"(codes renumbered across vintages?): {sorted(missing)[:6]}"
                f"{'…' if len(missing) > 6 else ''}")
    return "partition", member_norms, dict(member_map), ""


def corroborate_2020(base, county, codes, races, member_map):
    """Old-plan 2020 own-race adds are single-source (no :ALL to reconcile), so
    require the SOURCE FILE to prove itself: its President rows must agree
    exactly, per precinct and major party, with the repo's already-verified
    2020 statewide rows for the same precincts. (Counties whose OE 2020 files
    previously failed the repo's reconciliation — the VEST counties — fail
    here and stay honest gaps.) Returns '' when corroborated, else the reason."""
    oe_pres = next((r for r in races
                    if (canonical_statewide_race(r["office"]) or ("",))[0] == "president"), None)
    if oe_pres is None:
        return "no President rows in source to corroborate against"
    member_norms = set(member_map)
    source_norms = {norm_code(p) for p, *_ in oe_pres["rows"]}
    oe = defaultdict(int)
    for pct, party, _cand, votes in oe_pres["rows"]:
        n = base_precinct(pct, member_norms, source_norms)
        if n in codes and str(party).upper() in ("DEM", "REP"):
            oe[(n, str(party).upper())] += votes
    repo_path = base / "races" / "President_Vice_President_2020.csv"
    if not repo_path.exists():
        return "no repo President 2020 file to corroborate against"
    repo = defaultdict(int)
    for r in csv.DictReader(repo_path.open()):
        pc = r["precinct"]
        if not pc.startswith(f"{county}:") or pc.endswith(":ALL"):
            continue
        n = norm_code(pc.split(":", 1)[1])
        if n in codes and str(r["party"]).upper() in ("DEM", "REP"):
            repo[(n, str(r["party"]).upper())] += int(r["votes"] or 0)
    if not repo:
        return "repo has no verified 2020 statewide rows for these precincts"
    if set(oe) != set(repo):
        return "President precinct/party coverage differs from the repo's verified rows"
    bad = [k for k in repo if repo[k] != oe[k]]
    if bad:
        k = bad[0]
        return (f"President votes disagree with the repo's verified rows, e.g. "
                f"{k}: repo={repo[k]} source={oe[k]} (+{len(bad) - 1} more)")
    return ""


def gate_a(existing_all, new_rows):
    """When a :ALL aggregate exists: exact per-(party,candidate) equality
    (case-insensitive party match — file conventions vary)."""
    def k(party, cand):
        return (str(party).upper(), str(cand).strip())
    want = defaultdict(int)
    for r in existing_all:
        want[k(r["party"], r["candidate"])] += int(r["votes"] or 0)
    got = defaultdict(int)
    for _, party, cand, votes in new_rows:
        got[k(party, cand)] += votes
    if set(want) != set(got):
        return (f"candidate sets differ (only-ALL={sorted(set(want) - set(got))[:2]}, "
                f"only-new={sorted(set(got) - set(want))[:2]})")
    bad = [key for key in want if want[key] != got[key]]
    return f"sum mismatch e.g. {bad[0]}: ALL={want[bad[0]]} new={got[bad[0]]}" if bad else ""


def read_csv_rows(path):
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames or [], list(reader)


def write_csv_rows(path, fields, rows):
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def upgrade_county(slug, county, year, members, targets, cache_dir,
                   statewide_cache, dry):
    """Process one county for one year.
    Returns ({race_file: outcome}, turnout {precinct: vals}, source_url)."""
    base = REPO / "data/tx/districts" / slug / "data"
    path, source_url = fetch_oe(county, year, cache_dir, statewide_cache)
    if path is None:
        return {"*": "absent (no OpenElections file for this county/year)"}, {}, False, None

    df = load_input(str(path))
    disp = county_display(county)
    if not df["county"].isna().all():
        present = df["county"].fillna("").str.strip().str.lower()
        if not (present == disp.lower()).any():
            return {"*": f"absent (county '{disp}' not in source file)"}, {}, False, source_url

    races, turnout, _notes = transform(df, disp)
    rows_df = df if df["county"].isna().all() else \
        df[df["county"].fillna("").str.strip().str.lower() == disp.lower()]
    bad_mode_races = impossible_mode_races(rows_df)

    member_map = members[county]
    own_n = next((k[1] for k in targets if k[0] == "own"), None)
    mode, allowed, verbatim, detail = resolve_membership(races, member_map, own_n, year)
    if mode == "failed":
        return {"*": f"kept (membership cross-check failed: {detail})"}, {}, False, source_url

    outcomes = {"~membership": f"{mode} ({len(allowed)} precincts)"}
    added_any = refined_any = False
    for race in races:
        key = target_key(race["office"], race["district"], year)
        if key is None or key not in targets:
            continue
        entry = targets[key]
        rel = entry["raceFile"]
        race_path = base / rel
        fields, cur_rows = read_csv_rows(race_path)

        cur_county = [r for r in cur_rows if r["precinct"].startswith(f"{county}:")]
        cur_all = [r for r in cur_county if r["precinct"] == f"{county}:ALL"]
        cur_pcts = {r["precinct"] for r in cur_county if not r["precinct"].endswith(":ALL")}
        if (str(race["office"]).strip(), str(race["district"] or "").strip()) in bad_mode_races:
            outcomes[rel] = "kept (gate fail: votes < sum of mode columns in source)"
            continue

        member_norms = set(member_map)
        source_norms = {norm_code(p) for p, *_ in race["rows"]}
        agg = defaultdict(int)
        for pct, party, cand, votes in race["rows"]:
            agg[(base_precinct(pct, member_norms, source_norms), party, cand)] += votes
        joined = {n for (n, _p, _c) in agg} & allowed
        excluded = sorted({n for (n, _p, _c) in agg} - allowed - PSEUDO_PRECINCTS)

        own_2020 = key[0] == "own" and year == 2020
        if not joined:
            outcomes[rel] = "kept (no in-district precincts in source race)"
            continue
        if not own_2020 and joined != allowed:
            outcomes[rel] = (f"kept (gate fail: in-district precincts missing from race: "
                             f"{sorted(allowed - joined)[:6]}{'…' if len(allowed - joined) > 6 else ''})")
            continue

        fmt = party_style({r["party"] for r in cur_rows})
        new_rows = sorted(
            (f"{county}:{verbatim[n]}", fmt(party), cand, votes)
            for (n, party, cand), votes in agg.items() if n in joined)
        if any(v < 0 for *_r, v in new_rows):
            outcomes[rel] = "kept (gate fail: negative votes)"
            continue

        write_mode = "added"
        if own_2020 and not cur_all and not cur_pcts:
            err = corroborate_2020(base, county, joined, races, member_map)
            if err:
                outcomes[rel] = f"kept (2020 corroboration fail: {err})"
                continue
        if cur_all:
            err = gate_a(cur_all, new_rows)
            if err:
                outcomes[rel] = f"kept-ALL (gate A fail: {err})"
                continue
            cur_rows = [r for r in cur_rows if r["precinct"] != f"{county}:ALL"]
            write_mode = "upgraded-from-ALL"
        elif cur_pcts:
            # Refine: the county already has precinct rows, but coarser than the
            # source (e.g. Rockwall's 4 commissioner super-precincts vs 26 real
            # precincts). Replace ONLY when the finer rows sum to the existing
            # ones exactly — same official totals, better resolution.
            if len({p for p, *_ in new_rows}) <= len(cur_pcts):
                outcomes[rel] = "skipped (already precinct-level)"
                continue
            err = gate_a([r for r in cur_county], new_rows)
            if err:
                outcomes[rel] = f"skipped (refine gate fail: {err})"
                continue
            cur_rows = [r for r in cur_rows if not r["precinct"].startswith(f"{county}:")]
            write_mode = "refined"

        cur_rows.extend(
            {"precinct": p, "party": party, "candidate": c, "votes": str(v)}
            for p, party, c, v in new_rows)
        if not dry:
            write_csv_rows(race_path, fields, cur_rows)
        added_any = True
        if write_mode == "refined":
            refined_any = True
        note = ""
        if excluded and key[0] == "own":
            note = f" (excluded non-member codes: {excluded[:4]})"
        elif own_2020:
            note = f" (old-plan race; {len(joined)}/{len(allowed)} member precincts had it)"
        outcomes[rel] = f"{write_mode} ({len(joined)} precincts, {len(new_rows)} rows){note}"

    # Turnout: only when the membership resolution earned trust (>=1 race added)
    turnout_out = {}
    if added_any:
        member_norms = set(member_map)
        source_norms = {norm_code(p) for p in turnout}
        for pct, vals in turnout.items():
            n = base_precinct(pct, member_norms, source_norms)
            if n in allowed:
                turnout_out[f"{county}:{verbatim[n]}"] = vals
    return outcomes, turnout_out, refined_any, source_url


def apply_turnout(slug, year, turnout_by_county, refined_counties, dry):
    """Add missing precinct turnout rows to every turnout CSV of the year
    (turnout is per-precinct per-election-date, shared by that date's races —
    same convention as build_districts.py). Existing rows are never touched,
    except for counties whose races were REFINED: their coarse turnout rows are
    replaced by the finer ones, and only when ballots_cast sums agree exactly
    (mixed granularity in one file would double-count)."""
    base = REPO / "data/tx/districts" / slug / "data"
    manifest = json.load((base / "elections.json").open())
    results = {}
    for entry in manifest["elections"]:
        if entry["year"] != year or not entry.get("turnoutFile"):
            continue
        path = base / entry["turnoutFile"]
        if not path.exists():
            continue
        fields, cur = read_csv_rows(path)
        added = 0
        for county, tmap in sorted(turnout_by_county.items()):
            old = [r for r in cur if r["precinct"].startswith(f"{county}:")]
            if any(r["precinct"].endswith(":ALL") for r in old):
                continue  # aggregate row still present — don't mix
            if old and county in refined_counties:
                old_sum = sum(int(r.get("ballots_cast") or 0) for r in old)
                new_sum = sum(int(v.get("ballots_cast") or 0) for v in tmap.values())
                if old_sum != new_sum or len(tmap) <= len(old):
                    continue  # can't prove the finer rows equal the coarse ones
                cur = [r for r in cur if not r["precinct"].startswith(f"{county}:")]
                old = []
            have = {r["precinct"] for r in old}
            for pct, vals in sorted(tmap.items()):
                if pct in have:
                    continue
                row = {f: "" for f in fields}
                row["precinct"] = pct
                for f in ("registered", "ballots_cast", "blank"):
                    if f in fields and f in vals:
                        row[f] = vals[f]
                cur.append(row)
                added += 1
        if added and not dry:
            write_csv_rows(path, fields, cur)
        if added:
            results[entry["turnoutFile"]] = added
    return results


def update_provenance(slug, year, all_outcomes, turnout_added, urls, dry):
    p = REPO / f"data/tx/districts/{slug}/data/profile/provenance.json"
    prov = json.load(p.open())
    prov.setdefault("amendments", []).append({
        "date": datetime.date.today().isoformat(),
        "what": (f"Added official precinct-level {year} general-election results "
                 f"(races + turnout) for non-Collin member counties from OpenElections."),
        "method": (f"upgrade_district_precincts_oe.py --year {year}; tx_etl.py parsing "
                   f"policy; membership resolved per county (whole-county proven by the "
                   f"source's own U.S. House rows, or the geometry partition with a "
                   f"complete House cross-check) with fail-closed gates — see script "
                   f"docstring. Precincts the county renumbered/consolidated since our "
                   f"boundary vintage carry no polygon and render as county fallback on "
                   f"the map; the data rows are complete."),
        "source": (f"openelections/openelections-data-tx @ {OE_SHA} — official county "
                   f"canvass transcriptions. Files: "
                   + "; ".join(sorted({u.rsplit('/', 1)[-1] for u in urls if u}))),
        "outcomes": {county: outs for county, outs in sorted(all_outcomes.items())},
        "note": ("Counties/races not listed as added were kept unchanged (gate failure "
                 "or source gap) — honest gaps render N/A. Turnout rows added per "
                 f"file: {turnout_added or 'none'}."),
    })
    if dry:
        print("  provenance.json: would append OpenElections amendment")
        return
    json.dump(prov, p.open("w"), indent=1)
    print("  provenance.json: amendment recorded")


def verify(slug):
    """Final-tree invariants; exits non-zero on violation."""
    base = REPO / "data/tx/districts" / slug / "data"
    errors = []
    for kind in ("races", "turnout"):
        for path in sorted((base / kind).glob("*.csv")):
            _fields, rows = read_csv_rows(path)
            per_county = defaultdict(lambda: {"all": 0, "pct": 0})
            seen = defaultdict(int)
            for r in rows:
                pc = r.get("precinct", "")
                county = pc.split(":", 1)[0]
                per_county[county]["all" if pc.endswith(":ALL") else "pct"] += 1
                if kind == "races":
                    seen[(pc, r.get("party", ""), r.get("candidate", ""))] += 1
                    if int(r.get("votes") or 0) < 0:
                        errors.append(f"{path.name}: negative votes at {pc}")
                else:
                    seen[pc] += 1
            for county, c in per_county.items():
                if c["all"] and c["pct"]:
                    errors.append(f"{path.name}: {county} has BOTH :ALL and precinct rows")
            dups = [k for k, n in seen.items() if n > 1]
            if dups:
                errors.append(f"{path.name}: duplicate rows e.g. {dups[0]}")
    geo = REPO / f"data/tx/districts/{slug}/boundaries/other_precincts.geojson"
    if geo.exists():
        feats = json.load(geo.open())["features"]
        codes = [f["properties"].get("PRECINCT") for f in feats]
        if len(codes) != len(set(codes)):
            errors.append("other_precincts.geojson: duplicate PRECINCT codes")
        if not all(f["properties"].get("countySlug") for f in feats):
            errors.append("other_precincts.geojson: feature missing countySlug")
    for e in errors:
        print(f"VERIFY FAIL: {e}")
    print(f"verify {slug}: {'OK' if not errors else f'{len(errors)} problem(s)'}")
    sys.exit(1 if errors else 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--year", type=int, choices=sorted(GENERAL_DATES))
    ap.add_argument("--county", help="only this county slug")
    ap.add_argument("--cache", default="data/cache/openelections")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verify", action="store_true",
                    help="run final-tree invariant checks and exit")
    args = ap.parse_args()

    if args.verify:
        verify(args.slug)
    if not args.year:
        ap.error("--year is required (unless --verify)")

    base = REPO / "data/tx/districts" / args.slug / "data"
    manifest = json.load((base / "elections.json").open())
    targets = {}
    for e in manifest["elections"]:
        if e["year"] != args.year:
            continue
        key = target_key(e["office"], e.get("district"), args.year)
        if key:
            targets[key] = e
    if not targets:
        sys.exit(f"no manifest races for {args.slug} year {args.year}")

    members = member_codes(args.slug)
    cache_dir = REPO / args.cache
    statewide_cache = {}
    all_outcomes, turnout_by_county, urls = {}, {}, []
    refined_counties = set()

    for county in sorted(members):
        if args.county and county != args.county:
            continue
        outs, tmap, refined, url = upgrade_county(args.slug, county, args.year,
                                                  members, targets, cache_dir,
                                                  statewide_cache, args.dry_run)
        all_outcomes[county] = outs
        if tmap:
            turnout_by_county[county] = tmap
        if refined:
            refined_counties.add(county)
        urls.append(url)
        for f, o in sorted(outs.items()):
            print(f"  {county}: {f}: {o}")

    turnout_added = apply_turnout(args.slug, args.year, turnout_by_county,
                                  refined_counties, args.dry_run)
    for f, n in sorted(turnout_added.items()):
        print(f"  turnout: {f}: +{n} precinct rows")

    acted = any(o.split(" ")[0] in ("added", "upgraded-from-ALL")
                for outs in all_outcomes.values() for o in outs.values())
    if acted or turnout_added:
        update_provenance(args.slug, args.year, all_outcomes, turnout_added,
                          urls, args.dry_run)
    print(f"{'DRY RUN — ' if args.dry_run else ''}done ({args.slug}, {args.year})")


if __name__ == "__main__":
    main()
