#!/usr/bin/env python3
"""
Missing-data audit: one structured inventory of every honest data gap across
all 254 county packages, 219 district views, and the full-Texas view.

Nothing here fixes anything — it FINDS. Gaps fall into known classes:
- vintage: county imported on the 2020 wave carries no 2022 races (and vice
  versa); VEST-direct counties carry only the 10 statewide 2020 races
- turnout: VEST counties have no ballots-cast/registered (render N/A);
  some OE turnout files have empty columns
- profile: dnc_scores / racial are optional extras; census_profiles.json
  exists only for Collin
- district coverage: district views mix vintages, so races are missing whole
  member counties; some packages lack the district's own race entirely
- within-race precinct gaps: boundary precincts with no rows in a race CSV

Output: data/tx/MISSING_DATA_REPORT.json + console summary.
Usage: python3 data_processor/audit_missing_data.py
"""

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent.parent
TX = ROOT / "data/tx"

sys.path.insert(0, str(Path(__file__).parent))
from build_districts import race_plan  # noqa: E402 — the canonical own-race matcher


def load_registry():
    counties = json.load((TX / "counties.json").open())
    districts = json.load((TX / "districts.json").open())
    texas = json.load((TX / "texas.json").open())
    return counties, districts, texas


def default_set(entry):
    return entry["boundarySets"][entry["defaultBoundarySet"]]


def package_paths(entry):
    s = default_set(entry)
    data_dir = ROOT / entry["dataRoot"] / s["dataDir"]
    geojson = ROOT / entry["dataRoot"] / s["geojson"]
    return data_dir, geojson


def race_precincts(data_dir, race_file):
    """Set of precinct codes with at least one candidate-vote row > 0."""
    voted = set()
    path = data_dir / race_file
    if not path.exists():
        return None
    for r in csv.DictReader(path.open()):
        cand = (r.get("candidate") or "").strip().lower()
        if cand in ("over votes", "under votes", "write-in"):
            continue
        try:
            v = int(r.get("votes") or 0)
        except ValueError:
            v = 0
        if v > 0:
            voted.add(str(r.get("precinct") or "").strip())
    return voted


def turnout_gaps(data_dir, turnout_file):
    """Count rows with empty registered / ballots_cast / blank columns."""
    if not turnout_file:
        return {"file": None}
    path = data_dir / turnout_file
    if not path.exists():
        return {"file": "MISSING"}
    rows = 0
    empty = {"registered": 0, "ballots_cast": 0, "blank": 0}
    for r in csv.DictReader(path.open()):
        rows += 1
        for col in empty:
            if not (r.get(col) or "").strip():
                empty[col] += 1
    gaps = {c: n for c, n in empty.items() if n > 0}
    return {"file": turnout_file, "rows": rows, "empty": gaps} if gaps else None


def geojson_precincts(geojson_path):
    g = json.load(geojson_path.open())
    return {str(f["properties"].get("PRECINCT", "")) for f in g["features"]}


def audit_county(entry, audit_report):
    slug = entry["slug"]
    data_dir, geojson = package_paths(entry)
    manifest = json.load((data_dir / "elections.json").open())
    elections = manifest.get("elections", manifest) or []
    boundary = geojson_precincts(geojson)

    years = sorted({e.get("year") for e in elections if e.get("year")})
    wave = audit_report.get(slug, {}).get("wave")

    races = []
    for e in elections:
        voted = race_precincts(data_dir, e["raceFile"])
        gap = {}
        if voted is None:
            gap["raceFile"] = "MISSING"
        else:
            absent = boundary - voted
            if absent:
                gap["precincts_without_votes"] = len(absent)
        t = turnout_gaps(data_dir, e.get("turnoutFile"))
        if t:
            gap["turnout"] = t
        if gap:
            gap["race"] = e.get("displayName") or e.get("id")
            races.append(gap)

    profile_dir = data_dir / "profile"
    # census_profiles.json is tracked separately: it exists only for Collin
    # (ACS fetch was Collin-only), so it's a known statewide gap, not noise
    profile_missing = [f for f in ("dnc_scores.csv", "racial.csv")
                       if not (profile_dir / f).exists()]

    return {
        "wave": wave,
        "years_carried": years,
        "race_count": len(elections),
        "boundary_precincts": len(boundary),
        "race_gaps": races,
        "profile_missing": profile_missing,
        "has_census_profiles": (profile_dir / "census_profiles.json").exists(),
    }


def audit_cross_county(entry, label):
    """District view or texas view: per-race member-county coverage."""
    data_dir, geojson = package_paths(entry)
    manifest = json.load((data_dir / "elections.json").open())
    elections = manifest.get("elections", manifest) or []
    boundary = geojson_precincts(geojson)

    is_texas = label == "texas"
    if is_texas:
        members = boundary  # each unit IS a county slug
    else:
        members = {p.split(":")[0] for p in boundary if ":" in p}

    race_gaps = []
    for e in elections:
        voted = race_precincts(data_dir, e["raceFile"])
        if voted is None:
            race_gaps.append({"race": e.get("displayName"), "raceFile": "MISSING"})
            continue
        if is_texas:
            covered = {p for p in voted if p in members}
            missing = sorted(members - covered)
        else:
            covered = {p.split(":")[0] for p in voted if ":" in p}
            missing = sorted(members - covered)
        if missing:
            race_gaps.append({
                "race": e.get("displayName") or e.get("id"),
                "year": e.get("year"),
                "counties_missing": missing,
                "precincts_covered": len(voted & boundary),
                "precincts_total": len(boundary),
            })

    result = {
        "member_counties": sorted(members) if not is_texas else len(members),
        "race_count": len(elections),
        "races_with_county_gaps": race_gaps,
    }

    # Does the package carry the district's own race? Use the SAME matcher
    # build_districts.py used to assemble it, so the audit can't disagree
    # with the builder about what counts as the district's own race.
    if not is_texas:
        slug = entry["slug"]
        kind, n = slug.split("-")[0], int(slug.split("-")[1])
        own = [e for e in elections
               if race_plan(e.get("office"), e.get("district")) == (kind, n)]
        result["own_race_years"] = sorted({e.get("year") for e in own})
        if not own:
            result["own_race_missing"] = True
    return result


def main():
    counties, districts, texas = load_registry()
    audit_report = json.load((TX / "AUDIT_REPORT.json").open())

    report = {"counties": {}, "districts": {}, "texas": None, "summary": {}}

    waves = defaultdict(list)
    no_2022, no_2020, turnout_na, profile_gaps = [], [], [], []
    for c in counties:
        if c["status"] != "live":
            continue
        a = audit_county(c, audit_report)
        report["counties"][c["slug"]] = a
        waves[a["wave"] or "custom"].append(c["slug"])
        if 2022 not in a["years_carried"] and 2024 not in a["years_carried"]:
            no_2022.append(c["slug"])
        if 2020 not in a["years_carried"]:
            no_2020.append(c["slug"])
        if any(g.get("turnout", {}).get("file") is None and "turnout" in g
               for g in a["race_gaps"]):
            turnout_na.append(c["slug"])
        if a["profile_missing"]:
            profile_gaps.append(c["slug"])
        print(f"  county {c['slug']}: {len(a['race_gaps'])} race gaps")

    districts_with_gaps, own_race_missing = [], []
    for d in districts:
        a = audit_cross_county(d, d["slug"])
        report["districts"][d["slug"]] = a
        if a["races_with_county_gaps"]:
            districts_with_gaps.append(d["slug"])
        if a.get("own_race_missing"):
            own_race_missing.append(d["slug"])
        print(f"  district {d['slug']}: {len(a['races_with_county_gaps'])}/{a['race_count']} races have county gaps")

    report["texas"] = audit_cross_county(texas[0], "texas")

    census_only = [s for s, a in report["counties"].items()
                   if a["has_census_profiles"]]
    report["summary"] = {
        "counties_live": len(report["counties"]),
        "by_wave": {w: len(v) for w, v in sorted(waves.items())},
        "counties_without_2022_or_2024_races": sorted(no_2022),
        "counties_without_2020_races": sorted(no_2020),
        "counties_missing_turnout_for_some_race": sorted(set(turnout_na)),
        "counties_missing_profile_files": sorted(set(profile_gaps)),
        "counties_with_census_profiles": census_only,
        "districts_total": len(report["districts"]),
        "districts_with_race_county_gaps": sorted(districts_with_gaps),
        "districts_missing_own_race": sorted(own_race_missing),
        "texas_races_with_gaps": len(report["texas"]["races_with_county_gaps"]),
    }

    out = TX / "MISSING_DATA_REPORT.json"
    json.dump(report, out.open("w"), indent=1)
    print(f"\nWrote {out}")

    s = report["summary"]
    print("\n===== MISSING DATA SUMMARY =====")
    print(f"Waves: {s['by_wave']}")
    print(f"Counties without any 2022/2024 races: {len(s['counties_without_2022_or_2024_races'])}")
    print(f"Counties without 2020 races: {len(s['counties_without_2020_races'])}")
    print(f"Counties with turnout gaps: {len(s['counties_missing_turnout_for_some_race'])}")
    print(f"Counties missing profile files: {len(s['counties_missing_profile_files'])}")
    print(f"Counties WITH census profiles: {s['counties_with_census_profiles']}")
    print(f"Districts with per-race county gaps: {len(s['districts_with_race_county_gaps'])}/{s['districts_total']}")
    print(f"Districts missing their own race: {len(s['districts_missing_own_race'])}")
    print(f"Texas view races with county gaps: {s['texas_races_with_gaps']}/{report['texas']['race_count']}")


if __name__ == "__main__":
    main()
