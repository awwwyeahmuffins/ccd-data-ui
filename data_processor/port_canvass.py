"""
Port the per-precinct canvass-coverage CSV from one boundary set to another by
areal interpolation.

Collin's 2026 boundaries keep every 2024 precinct number (1–252) and ADD 21
new precincts (253–273) carved out of existing ones, so a preserved-number
precinct may have shrunk. A raw number-join would hand the full 2024 count to
a shrunken 2026 precinct and leave the carved-out child with nothing. This
tool instead distributes each SOURCE precinct's counts to the TARGET precincts
that cover its area:

    weight(O -> N) = area(O ∩ N) / area(O)
    dem_voters[N]       = Σ_O weight(O->N) · dem_voters[O]        (O with a known count)
    canvassed_voters[N] = Σ_O weight(O->N) · canvassed_voters[O]  (O with a known count)

For an UNSPLIT preserved precinct (O == N, weight 1, no other overlap) this
reproduces the source row exactly.

HONESTY CONTRACT:
  * "canvassed" is treated as UNKNOWN (not zero) wherever the source blanked it
    — 15 of the 2024 precincts have a Dem universe but no canvass count. The
    ported share is left blank (N/A) for any target precinct whose Dem universe
    is less than MIN_COVERAGE-covered by source precincts with a known count.
  * The share is always canvassed_voters / dem_voters (frontend-consistent),
    never invented; counts are apportioned, never fabricated.
  * Area is computed in the source CRS (WGS84 degrees). Within one small county
    the latitude scale factor is ~constant, so it cancels in the area RATIO —
    the interpolation weights are unbiased without reprojection. Area-weighting
    assumes uniform density within a precinct; a voter-weighted crosswalk would
    be better but needs the gitignored voter file.

Usage:
    python3 data_processor/port_canvass.py [--from 2024] [--to 2026]
                                           [--min-coverage 0.5] [--dry-run]
"""

import argparse
import csv
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data" / "tx" / "collin"
BOUNDARY = REPO / "data" / "tx" / "collin" / "boundaries"

# Fraction of a target precinct's Dem universe that must come from source
# precincts with a KNOWN canvass count before we report a ported share.
DEFAULT_MIN_COVERAGE = 0.5
EPS_AREA = 1e-12  # ignore sliver intersections below this share of source area


def num(v):
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return None


def load_canvass(path):
    """{ precinct: {dem, canvassed} } with None for blank cells."""
    out = {}
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[str(r["precinct"]).strip()] = {
                "dem": num(r.get("dem_voters")),
                "canvassed": num(r.get("canvassed_voters")),
            }
    return out


def load_polys(path):
    """{ precinct: shapely geometry } — invalid rings repaired via buffer(0)."""
    import json
    from shapely.geometry import shape

    doc = json.load(open(path, encoding="utf-8"))
    polys = {}
    for feat in doc["features"]:
        code = str(feat["properties"]["PRECINCT"]).strip()
        geom = shape(feat["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        polys[code] = geom
    return polys


def port(src_canvass, src_polys, dst_polys, min_coverage):
    from shapely.strtree import STRtree

    dst_codes = list(dst_polys)
    tree = STRtree([dst_polys[c] for c in dst_codes])

    # Accumulators per target precinct.
    dem = {c: 0.0 for c in dst_codes}          # full Dem universe (any known source)
    canv = {c: 0.0 for c in dst_codes}         # canvassed (known-count sources only)
    known_dem = {c: 0.0 for c in dst_codes}    # Dem universe backing the canvassed sum
    unmatched_area = 0.0

    for o_code, o_geom in src_polys.items():
        o_area = o_geom.area
        if o_area <= 0:
            continue
        rec = src_canvass.get(o_code, {})
        o_dem = rec.get("dem")
        o_canv = rec.get("canvassed")
        matched = 0.0
        for idx in tree.query(o_geom):
            n_code = dst_codes[idx]
            inter = o_geom.intersection(dst_polys[n_code])
            if inter.is_empty:
                continue
            w = inter.area / o_area
            if w < EPS_AREA:
                continue
            matched += w
            if o_dem is not None:
                dem[n_code] += w * o_dem
                if o_canv is not None:
                    canv[n_code] += w * o_canv
                    known_dem[n_code] += w * o_dem
        unmatched_area += max(0.0, 1.0 - matched) * (o_dem or 0)

    rows = []
    for n_code in sorted(dst_codes, key=lambda c: int(c) if c.isdigit() else c):
        d = dem[n_code]
        c = canv[n_code]
        kd = known_dem[n_code]
        dem_out = round(d) if d > 0 else ""
        # Report a share only when the known-count sources back enough of the
        # universe; otherwise coverage is genuinely unknown -> blank (N/A).
        if d > 0 and kd / d >= min_coverage and dem_out:
            share_out = f"{c / dem_out:.4f}"
            canv_out = round(c)
        else:
            share_out = ""
            canv_out = round(c) if kd > 0 else ""
        rows.append({
            "precinct": n_code,
            "dem_voters": dem_out,
            "canvassed_share": share_out,
            "canvassed_voters": canv_out,
            "generated_on": date.today().isoformat(),
        })
    return rows, unmatched_area


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--from", dest="src", default="2024", help="source boundary set")
    ap.add_argument("--to", dest="dst", default="2026", help="target boundary set")
    ap.add_argument("--min-coverage", type=float, default=DEFAULT_MIN_COVERAGE,
                    help="min known-count share of the Dem universe to report a share")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args()

    src_csv = DATA / args.src / "profile" / "canvass.csv"
    dst_csv = DATA / args.dst / "profile" / "canvass.csv"
    src_geo = BOUNDARY / f"{args.src}.geojson"
    dst_geo = BOUNDARY / f"{args.dst}.geojson"
    for p in (src_csv, src_geo, dst_geo):
        if not p.exists():
            sys.exit(f"ERROR: missing input {p.relative_to(REPO)}")
    if not dst_csv.parent.is_dir():
        sys.exit(f"ERROR: no profile dir for target set: {dst_csv.parent}")

    src_canvass = load_canvass(src_csv)
    src_polys = load_polys(src_geo)
    dst_polys = load_polys(dst_geo)
    print(f"Porting canvass {args.src} ({len(src_polys)} pcts) -> "
          f"{args.dst} ({len(dst_polys)} pcts) by areal interpolation...")

    rows, unmatched = port(src_canvass, src_polys, dst_polys, args.min_coverage)

    src_dem = sum(v["dem"] for v in src_canvass.values() if v["dem"])
    src_canv = sum(v["canvassed"] for v in src_canvass.values() if v["canvassed"])
    out_dem = sum(r["dem_voters"] for r in rows if r["dem_voters"] != "")
    out_canv = sum(r["canvassed_voters"] for r in rows if r["canvassed_voters"] != "")
    with_share = sum(1 for r in rows if r["canvassed_share"] != "")
    print(f"  Dem universe:  source {src_dem:,.0f} -> ported {out_dem:,.0f} "
          f"(unmatched area carried {unmatched:,.0f})")
    print(f"  Canvassed:     source {src_canv:,.0f} -> ported {out_canv:,.0f}")
    print(f"  Target precincts with a share: {with_share}/{len(rows)}")

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return

    with open(dst_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[
            "precinct", "dem_voters", "canvassed_share",
            "canvassed_voters", "generated_on",
        ])
        w.writeheader()
        w.writerows(rows)
    print(f"\nWrote {dst_csv.relative_to(REPO)} ({len(rows)} rows, "
          f"areal-ported from {args.src}).")


if __name__ == "__main__":
    main()
