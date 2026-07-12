#!/usr/bin/env python3
"""restore_district_precincts.py — revert collin_focus_reduce.py's collapse for
one district view: replace each `<county>:ALL` aggregate row with the REAL
precinct-level rows it was summed from (recovered from this repo's git
history), and restore the non-Collin precinct polygons trimmed from
members.geojson as boundaries/other_precincts.geojson.

Background: the Collin-focus reduction (commit bff432ac) kept Collin precincts
and collapsed every other member county of each district into one
`<county>:ALL` row per candidate ("Everything is under git, so revert if
needed" — this is that revert, per county, per race, under a gate). The
pre-collapse rows were themselves ingested from official sources
(OpenElections via tx_etl.py; grayson/lamar/red-river from VEST 2020 via
vest_ingest.py) with verification at ingest time, so nothing here fabricates
data — it restores previously verified official data.

Gate (fail-closed, per county x file): the pre-collapse precinct rows must sum
EXACTLY to the current `:ALL` row(s) — races per (party, candidate) with both
directions matched, turnout per value column (empty cells sum as 0, exactly as
the reduction did). Any mismatch leaves that county's `:ALL` rows untouched
and is reported. A county is never left with both `:ALL` and precinct rows in
one file (the frontend would double-count).

Turnout note: the reduction summed empty cells as 0, so today's `:ALL` rows
show e.g. registered=0 where the source had no value. Restoring brings back
the honest empty cells (rendered N/A), which is a fix, not a loss.

Geometry: non-Collin features of the pre-collapse members.geojson are written
to boundaries/other_precincts.geojson (the layer js/data/districts.js draws
precinct-by-precinct), each with a `countySlug` property added — the map keys
its per-race precinct join on it. members.geojson (Collin-only) and
county_outlines.geojson (the per-county fallback) stay untouched.

Usage:
  python3 data_processor/restore_district_precincts.py --slug cd-4 \
      [--source-commit 'bff432ac^'] [--county <slug>] [--dry-run]
"""
import argparse
import csv
import datetime
import io
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).parent.parent

RACE_KEYS, RACE_VALS = ["party", "candidate"], ["votes"]
TURNOUT_KEYS, TURNOUT_VALS = [], ["registered", "ballots_cast", "blank"]


def git_show(commit, rel):
    """File content at commit, or None if it didn't exist there."""
    r = subprocess.run(["git", "show", f"{commit}:{rel}"],
                       capture_output=True, text=True, cwd=REPO)
    return r.stdout if r.returncode == 0 else None


def read_rows(text):
    reader = csv.DictReader(io.StringIO(text))
    return reader.fieldnames or [], list(reader)


def county_of(pc):
    return pc.split(":", 1)[0] if ":" in pc else pc


def as_int(v):
    """The reduction's coercion: empty/garbage sums as 0."""
    try:
        return int(float(v or 0))
    except (ValueError, TypeError):
        return 0


def sums_match(old_rows, all_rows, keys, vals):
    """Do the pre-collapse rows sum exactly to the current :ALL rows?
    Returns (ok, detail)."""
    want = {tuple(r.get(k, "") for k in keys): [as_int(r.get(v)) for v in vals]
            for r in all_rows}
    got = defaultdict(lambda: [0] * len(vals))
    for r in old_rows:
        gk = tuple(r.get(k, "") for k in keys)
        for i, v in enumerate(vals):
            got[gk][i] += as_int(r.get(v))
    if set(want) != set(got):
        return False, (f"group mismatch: only-current={sorted(set(want) - set(got))[:3]} "
                       f"only-restored={sorted(set(got) - set(want))[:3]}")
    bad = [k for k in want if want[k] != got[k]]
    if bad:
        k = bad[0]
        return False, f"sum mismatch for {k}: current={want[k]} restored={got[k]} (+{len(bad) - 1} more)"
    return True, ""


def restore_csv(rel, commit, keys, vals, only_county, dry):
    """Replace gated `<county>:ALL` rows in REPO/rel with the commit's precinct
    rows. Returns {county: outcome} for counties with :ALL rows."""
    cur_path = REPO / rel
    old_text = git_show(commit, rel)
    if old_text is None:
        return {}
    old_fields, old_rows = read_rows(old_text)
    with cur_path.open(newline="") as f:
        cur_fields, cur_rows = read_rows(f.read())
    if old_fields != cur_fields:
        return {"*": f"kept-ALL (header drift {old_fields} vs {cur_fields})"}

    all_by_county = defaultdict(list)
    for r in cur_rows:
        pc = r.get("precinct", "")
        if pc.endswith(":ALL"):
            all_by_county[county_of(pc)].append(r)

    old_by_county = defaultdict(list)
    for r in old_rows:
        pc = r.get("precinct", "")
        if ":" in pc and not pc.endswith(":ALL"):
            old_by_county[county_of(pc)].append(r)

    outcomes, restored = {}, set()
    for county, all_rows in sorted(all_by_county.items()):
        if only_county and county != only_county:
            outcomes[county] = "skipped (--county filter)"
            continue
        src = old_by_county.get(county)
        if not src:
            outcomes[county] = "kept-ALL (no pre-collapse rows at source commit)"
            continue
        ok, detail = sums_match(src, all_rows, keys, vals)
        if not ok:
            outcomes[county] = f"kept-ALL (gate fail: {detail})"
            continue
        restored.add(county)
        outcomes[county] = f"restored ({len({r['precinct'] for r in src})} precincts, {len(src)} rows)"

    if restored and not dry:
        out = [r for r in cur_rows
               if not (r.get("precinct", "").endswith(":ALL")
                       and county_of(r["precinct"]) in restored)]
        for county in sorted(restored):
            out.extend(old_by_county[county])
        with cur_path.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cur_fields)
            w.writeheader()
            w.writerows(out)
    return outcomes


def restore_geometry(slug, commit, only_county, dry):
    rel = f"data/tx/districts/{slug}/boundaries/members.geojson"
    old_text = git_show(commit, rel)
    if old_text is None:
        print(f"  geometry: {rel} not found at {commit}")
        return {}
    feats = [ft for ft in json.loads(old_text)["features"]
             if not ft.get("properties", {}).get("PRECINCT", "").startswith("collin:")]
    if only_county:
        feats = [ft for ft in feats
                 if county_of(ft["properties"]["PRECINCT"]) == only_county]
    counties = defaultdict(int)
    for ft in feats:
        slug_c = county_of(ft["properties"]["PRECINCT"])
        ft["properties"]["countySlug"] = slug_c
        counties[slug_c] += 1

    out_path = REPO / f"data/tx/districts/{slug}/boundaries/other_precincts.geojson"
    merged = {"type": "FeatureCollection", "features": feats}
    if out_path.exists():
        existing = json.load(out_path.open())
        keep = [ft for ft in existing.get("features", [])
                if county_of(ft["properties"].get("PRECINCT", "")) not in counties]
        merged["features"] = keep + feats
    if not dry:
        json.dump(merged, out_path.open("w"), separators=(",", ":"))
    print(f"  geometry: {'would write' if dry else 'wrote'} {len(merged['features'])} features "
          f"to other_precincts.geojson ({dict(sorted(counties.items()))})")
    return dict(counties)


def update_provenance(slug, commit_sha, race_out, turnout_out, geo_counts, dry):
    p = REPO / f"data/tx/districts/{slug}/data/profile/provenance.json"
    prov = json.load(p.open())
    restored = sorted({c for by_file in race_out.values() for c, o in by_file.items()
                       if o.startswith("restored")})
    kept = sorted({f"{f}:{c}" for f, by_file in race_out.items()
                   for c, o in by_file.items() if o.startswith("kept-ALL")})
    prov.setdefault("amendments", []).append({
        "date": datetime.date.today().isoformat(),
        "what": ("Restored REAL precinct-level rows (races + turnout) and precinct polygons "
                 "for non-Collin member counties, replacing the <county>:ALL aggregates "
                 "the Collin-focus reduction had collapsed them into."),
        "method": (f"restore_district_precincts.py from this repo's pre-reduction commit "
                   f"{commit_sha}; per (county, file) gate: precinct rows must sum exactly "
                   f"to the current :ALL totals (races per party+candidate, turnout per column). "
                   f"Non-Collin polygons from that commit's members.geojson written to "
                   f"boundaries/other_precincts.geojson with countySlug properties."),
        "source": ("Originally ingested from official sources: OpenElections per-county files "
                   "via tx_etl.py; grayson/lamar/red-river statewide 2020 from VEST "
                   "(doi:10.7910/DVN/K7760H) via vest_ingest.py."),
        "note": (f"Counties restored: {restored}. Turnout cells the reduction had summed from "
                 f"empty sources return to honest empty (N/A) instead of 0."
                 + (f" Kept as :ALL (gate fail / no source): {kept}." if kept else "")),
    })
    if dry:
        print("  provenance.json: would append restore amendment")
        return
    json.dump(prov, p.open("w"), indent=1)
    print("  provenance.json: amendment recorded")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--slug", required=True, help="district slug, e.g. cd-4")
    ap.add_argument("--source-commit", default="bff432ac^",
                    help="commit holding the pre-collapse data (default: bff432ac^)")
    ap.add_argument("--county", help="restore only this county slug")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sha = subprocess.run(["git", "rev-parse", args.source_commit],
                         capture_output=True, text=True, cwd=REPO).stdout.strip()
    if not sha:
        sys.exit(f"cannot resolve --source-commit {args.source_commit}")
    base = REPO / "data/tx/districts" / args.slug / "data"
    if not base.is_dir():
        sys.exit(f"no such district: {args.slug}")

    race_out, turnout_out = {}, {}
    for kind, keys, vals, store in (("races", RACE_KEYS, RACE_VALS, race_out),
                                    ("turnout", TURNOUT_KEYS, TURNOUT_VALS, turnout_out)):
        for path in sorted((base / kind).glob("*.csv")):
            rel = path.relative_to(REPO).as_posix()
            out = restore_csv(rel, sha, keys, vals, args.county, args.dry_run)
            if out:
                store[path.name] = out

    print(f"{'DRY RUN — ' if args.dry_run else ''}restore report for {args.slug} @ {sha[:10]}")
    for label, store in (("races", race_out), ("turnout", turnout_out)):
        for fn, by_county in store.items():
            for county, outcome in by_county.items():
                print(f"  {label}/{fn}: {county}: {outcome}")
    geo_counts = restore_geometry(args.slug, sha, args.county, args.dry_run)
    if race_out or turnout_out or geo_counts:
        update_provenance(args.slug, sha, race_out, turnout_out, geo_counts, args.dry_run)
    n_restored = sum(o.startswith("restored") for s in (race_out, turnout_out)
                     for by in s.values() for o in by.values())
    n_kept = sum(o.startswith("kept-ALL") for s in (race_out, turnout_out)
                 for by in s.values() for o in by.values())
    print(f"summary: {n_restored} (county,file) restored, {n_kept} kept as :ALL")


if __name__ == "__main__":
    main()
