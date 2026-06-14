#!/usr/bin/env python3
"""
Full-Texas statewide view: one v3 data package under data/tx/texas/ where each
map unit ("precinct") is a COUNTY. Statewide races are aggregated per county
by pure summation of that county's official precinct rows — never fabricated.
The view registers via data/tx/texas.json (its own file so district rebuilds
never clobber it) and appears in the app's selector like any district view.

Aggregation rules (documented, same spirit as build_districts.py):
- Races: statewide contests only, merged across counties by CANONICAL contest
  identity (statewide_canon.py) so spelling variants ("Governor ( 1)",
  "Justice Supreme Court Pl 6") land in one file; regional courts-of-appeals
  races and impossible seat numbers are rejected. Counties on different data
  vintages (2022 vs 2020) contribute different races; counties lacking a given
  race render as no-data. Candidate name spellings are kept as each county
  recorded them — vote rows are never altered.
- Turnout: a county's registered/ballots/blank sums are emitted only when
  EVERY precinct row in that county carries a value for the column; partial
  sums would understate, so any gap renders the whole county cell empty (N/A).
- Profile: county-level party lean re-derived from this package's own merged
  races via derive_profiles.derive_party_lean (vote-derived ESTIMATE); racial
  counts summed per county from each county's racial.csv, pcts recomputed.

Usage: python3 data_processor/build_texas_view.py
"""

import csv
import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from v3_writer import write_race_csv, write_turnout_csv, write_manifest  # noqa: E402
from derive_profiles import derive_party_lean, write_lean  # noqa: E402
from statewide_canon import canonical_statewide_race  # noqa: E402

ROOT = Path(__file__).parent.parent
OUT = ROOT / "data/tx/texas"
DATA_DIR = OUT / "data"

# Contests carried by fewer counties than this stay out of the statewide view
# (still fully viewable in their counties' own views) — a 1-county "statewide"
# race renders as a near-blank state map.
MIN_COUNTIES = 25

# Reserved pseudo-candidates: over/undervotes, write-in tallies — not candidates
_RESERVED_CANDS = re.compile(
    r"^(over\s*votes?|under\s*votes?|write[-\s]in|overvotes?:|undervotes?:)",
    re.I,
)


_PARTY_PREFIXES = re.compile(r"^(REP|DEM|LIB|GRN|IND|NP)\s+", re.I)

def _normalize_cand(name):
    """Canonical candidate name for cross-county deduplication.

    Counties use many spellings for the same person: "Donald J. Trump",
    "Donald J Trump", "REP Donald J. Trump", "Donald J. Trump / M. R. Pence",
    "Donald J Trump Michael R Pence" (running mate joined without separator).
    Normalize so they collapse to one column in the aggregate race CSV:
    1. Strip party-code prefix embedded in name ("REP Donald J Trump" → "Donald J Trump")
    2. Drop running-mate suffix (separator: ' / ', ' AND ', ' & ')
    3. Drop running-mate joined without separator: detect by word-count + whether
       word[1] is an initial (≤2 chars → keep first 3 words) or a surname (>2 chars
       → keep first 2 words).  "Gloria La Riva Leonard Peltier": word[1]="La" (2)
       → keep 3 → "Gloria La Riva" ✓.  "Howie Hawkins Angela Walker": word[1]=
       "Hawkins" (7) → keep 2 → "Howie Hawkins" ✓.
    4. Remove periods after single initial letters (J. → J)
    5. Strip comma before generational suffix ("McClure, III" → "McClure III")
    6. Title-case all-caps names (JOSEPH R BIDEN → Joseph R Biden)
    7. Collapse whitespace
    """
    # 1. Strip party prefix embedded in name field
    name = _PARTY_PREFIXES.sub("", name).strip()
    # 2. Drop running-mate with separator
    name = re.split(r"\s*/\s*|\s+(?:and|&)\s+", name, flags=re.I)[0].strip()
    # 3. Drop running-mate joined without separator (4+ words)
    words = name.split()
    if len(words) >= 4:
        if len(words[1]) <= 2:   # "F I L  F …" — word[1] is an initial
            name = " ".join(words[:3])
        else:                     # "F L  F L" — word[1] is a surname
            name = " ".join(words[:2])
    # 4. Periods after single-letter initials
    name = re.sub(r"\b([A-Za-z])\.", r"\1", name)
    # 5. Comma before generational suffix
    name = re.sub(r",\s*(Jr|Sr|II|III|IV|V|VI)\b", r" \1", name, flags=re.I)
    # 6. Title-case all-uppercase names
    if name == name.upper() and len(name) > 3:
        name = name.title()
    # 7. Collapse spaces
    return re.sub(r"\s+", " ", name).strip()


def _dedup_by_surname(votes_dict):
    """Merge same-party candidate variants that share their last word (surname).

    After _normalize_cand, "Donald J Trump" / "Donald Trump" / "Trump" all
    have last word "Trump" under REP — collapse them to the highest-vote name.
    Operates in-place on votes_dict whose keys are (slug, party, cand).
    """
    from collections import defaultdict

    # total votes per (party, last_word) across all counties
    total_by_key = defaultdict(lambda: defaultdict(int))  # (party, lw) → {name: votes}
    for (slug, party, cand), v in list(votes_dict.items()):
        if not party:
            continue
        lw = cand.split()[-1] if cand else cand
        total_by_key[(party, lw)][cand] += v

    # build name → canonical mapping
    remap = {}
    for (party, lw), name_votes in total_by_key.items():
        if len(name_votes) <= 1:
            continue
        canonical = max(name_votes, key=name_votes.__getitem__)
        for name in name_votes:
            if name != canonical:
                remap[(party, name)] = canonical

    if not remap:
        return
    # apply remap
    for key in list(votes_dict.keys()):
        slug, party, cand = key
        canon = remap.get((party, cand))
        if canon:
            canon_key = (slug, party, canon)
            votes_dict[canon_key] = votes_dict.get(canon_key, 0) + votes_dict.pop(key)


def main():
    registry = json.load((ROOT / "data/tx/counties.json").open())
    counties = [c for c in registry if c["status"] == "live"]

    # Fully-generated dirs: clear before writing so renamed races leave no
    # stale files behind AND case-only renames take effect (macOS's
    # case-insensitive FS keeps the OLD directory-entry casing when a file is
    # rewritten under a new case — S3 then 404s the manifest's reference).
    for sub in ("races", "turnout", "profile"):
        shutil.rmtree(DATA_DIR / sub, ignore_errors=True)

    # ---- boundaries: 254 county outlines, PRECINCT = county slug ------------
    outlines = json.load((ROOT / "data/tx/county-boundaries.geojson").open())
    features = []
    for f in sorted(outlines["features"], key=lambda f: f["properties"]["SLUG"]):
        features.append({
            "type": "Feature",
            "properties": {"PRECINCT": f["properties"]["SLUG"],
                           "COUNTY": f["properties"]["NAME"]},
            "geometry": f["geometry"],
        })
    (OUT / "boundaries").mkdir(parents=True, exist_ok=True)
    with (OUT / "boundaries" / "counties.geojson").open("w") as fh:
        json.dump({"type": "FeatureCollection", "features": features},
                  fh, separators=(",", ":"))
    print(f"boundaries: {len(features)} county outlines")

    # ---- races: statewide offices aggregated per county ---------------------
    merged = defaultdict(lambda: {"votes": defaultdict(int), "turnout": {},
                                  "displayName": None, "office": None,
                                  "date": None, "category": None})
    racial_sums = {}
    for c in counties:
        slug = c["slug"]
        set_cfg = c["boundarySets"][c["defaultBoundarySet"]]
        set_path = ROOT / c["dataRoot"] / set_cfg["dataDir"]
        manifest = json.load((set_path / "elections.json").open())
        turnout_seen = set()
        for e in manifest["elections"]:
            if e.get("district"):
                continue
            canon = canonical_statewide_race(e.get("office"))
            if canon is None:
                continue
            ckey, cdisplay = canon
            key = (ckey, e.get("year"))
            m = merged[key]
            m["displayName"] = f"{cdisplay} ({e.get('year')})"
            m["office"] = cdisplay
            m["date"] = m["date"] or e.get("date")
            m["category"] = m["category"] or e.get("category")
            for r in csv.DictReader((set_path / e["raceFile"]).open()):
                cand = r["candidate"]
                # Skip over/undervote pseudo-rows — not actual candidates
                if _RESERVED_CANDS.match(cand):
                    continue
                votes = int(r["votes"] or 0)
                # Normalize name so variant spellings ("Donald J. Trump" vs
                # "Donald J Trump / M. Pence") land in the same column
                cand_key = _normalize_cand(cand)
                m["votes"][(slug, r["party"], cand_key)] += votes
            tf = e.get("turnoutFile")
            if tf and (key, tf) not in turnout_seen:
                turnout_seen.add((key, tf))
                sums, gaps = [0, 0, 0], [False, False, False]
                for r in csv.DictReader((set_path / tf).open()):
                    for i, col in enumerate(("registered", "ballots_cast", "blank")):
                        v = (r.get(col) or "").strip()
                        if v == "":
                            gaps[i] = True
                        else:
                            sums[i] += int(float(v))
                m["turnout"][slug] = tuple(
                    "" if gaps[i] else sums[i] for i in range(3))

        # racial: sum the county's precinct counts into one county row
        racial_path = set_path / "profile" / "racial.csv"
        if racial_path.exists():
            tot = defaultdict(int)
            for r in csv.DictReader(racial_path.open()):
                for col in ("asian", "black", "hispanic", "others", "white", "total"):
                    tot[col] += int(float(r[col] or 0))
            racial_sums[slug] = dict(tot)
        print(f"  aggregated {slug}")

    elections = []
    dropped = []
    for (okey, year), m in sorted(merged.items(),
                                  key=lambda kv: (-(kv[0][1] or 0), kv[0][0])):
        # Statewide-view curation: a contest carried by only a handful of
        # counties (e.g. Collin's 2024 ballot before other counties have 2024
        # data) renders as a near-blank state map and degenerate rankings.
        # Those races remain fully viewable in their counties' own views —
        # nothing is hidden, only not duplicated here. Threshold documented in
        # provenance.
        n_counties = len({slug for (slug, _p, _c) in m["votes"]})
        if n_counties < MIN_COUNTIES:
            dropped.append((m["displayName"], n_counties))
            continue
        # Final dedup: merge same-party candidates that differ only in spelling
        # ("Trump" / "Donald Trump" / "Donald J Trump" → all last word = "Trump")
        _dedup_by_surname(m["votes"])
        base = re.sub(r"[^A-Za-z0-9]+", "_", m["office"] or okey).strip("_")
        race_rel = f"races/{base}_{year}.csv"
        rows = [(slug, party, cand, votes)
                for (slug, party, cand), votes in sorted(m["votes"].items())]
        write_race_csv(DATA_DIR / race_rel, rows)
        turnout_rel = None
        if m["turnout"]:
            turnout_rel = f"turnout/{base}_{year}.csv"
            write_turnout_csv(DATA_DIR / turnout_rel,
                              [(slug, *vals) for slug, vals in sorted(m["turnout"].items())])
        elections.append({
            "id": re.sub(r"[^a-z0-9]+", "-", f"{base}-{year}".lower()).strip("-"),
            "displayName": m["displayName"] or f"{m['office']} ({year})",
            "office": m["office"], "district": None,
            "year": year, "date": m["date"], "category": m["category"],
            "raceFile": race_rel, "turnoutFile": turnout_rel, "sourceUrl": None,
        })
    write_manifest(DATA_DIR / "elections.json", "texas", "counties", elections)
    print(f"races: {len(elections)} statewide contests aggregated per county")
    for name, n in dropped:
        print(f"  dropped (only {n} counties, < {MIN_COUNTIES}): {name}")

    # ---- profile: party lean from this package's own races; racial sums -----
    profile_dir = DATA_DIR / "profile"
    lean_rows, races_used = derive_party_lean(DATA_DIR)
    write_lean(profile_dir, lean_rows, races_used, dry_run=False)
    print(f"profile: party lean for {len(lean_rows)} counties "
          f"from {len(races_used)} races")

    if racial_sums:
        with (profile_dir / "racial.csv").open("w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["precinct", "asian", "black", "hispanic", "others",
                        "white", "total", "pct_asian", "pct_black",
                        "pct_hispanic", "pct_others", "pct_white"])
            for slug in sorted(racial_sums):
                v = racial_sums[slug]
                t = v["total"]
                pct = lambda n: f"{(n / t * 100):.2f}%" if t else "0.00%"  # noqa: E731
                w.writerow([slug, v["asian"], v["black"], v["hispanic"],
                            v["others"], v["white"], t,
                            pct(v["asian"]), pct(v["black"]), pct(v["hispanic"]),
                            pct(v["others"]), pct(v["white"])])
        print(f"profile: racial demographics for {len(racial_sums)} counties")

    # package provenance: method + curation threshold + what was excluded
    prov_path = profile_dir / "provenance.json"
    prov = json.load(prov_path.open()) if prov_path.exists() else {}
    prov["package"] = {
        "method": "texas-county-aggregate-v1",
        "description": ("Full-Texas statewide view: each map unit is a county; "
                        "statewide contests aggregated per county by summation "
                        "of official precinct rows, merged across counties by "
                        "canonical contest identity (statewide_canon.py). "
                        f"Contests carried by fewer than {MIN_COUNTIES} counties "
                        "are not listed here (still viewable in their counties' "
                        "own views). Counties on different data vintages "
                        "contribute different races; counties lacking a race "
                        "render as no-data — never fabricated."),
        "minCounties": MIN_COUNTIES,
        "excluded": [{"contest": name, "counties": n} for name, n in dropped],
        "generated": "2026-06-12",
    }
    json.dump(prov, prov_path.open("w"), indent=2)

    # ---- registry entry (own file — district rebuilds never touch it) -------
    json.dump([{
        "slug": "texas",
        "name": "Texas — Statewide",
        "kind": "district",
        "group": "Statewide",
        "status": "live",
        "dataRoot": "data/tx/texas",
        "defaultBoundarySet": "original",
        "boundarySets": {"original": {
            "label": "254 counties",
            "geojson": "boundaries/counties.geojson",
            "dataDir": "data"}},
        "notes": ("Statewide view: each map unit is a county; statewide races "
                  "aggregated per county from official precinct data."),
    }], (ROOT / "data/tx/texas.json").open("w"), indent=2)
    print("Wrote data/tx/texas.json registry entry")


if __name__ == "__main__":
    main()
