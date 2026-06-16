#!/usr/bin/env python3
"""fetch_clarity_results.py — pull official precinct-level results from a county's
Clarity Elections (Scytl) results portal.

Many Texas counties (Hunt, Rockwall, Kaufman, Ellis, Grayson, …) publish their
canvassed results through results.enr.clarityelections.com. Each election exposes
a machine-readable `reports/detailxml.zip` containing every choice's votes in
every precinct by vote type — the real, official precinct breakdown. This script
discovers a county's elections, finds one by date, downloads that detail XML, and
emits a long-format CSV (precinct,party,candidate,votes) for one contest — the
same shape the v3 pipeline ingests. No fabrication: it is the county's own data.

Clarity path model (discovered empirically):
  current version:   /TX/<County>/<electionId>/current_ver.txt        -> NNNNNN
  settings:          /TX/<County>/<electionId>/<ver>/json/en/electionsettings.json
  precinct detail:   /TX/<County>/<electionId>/<ver>/reports/detailxml.zip

Usage:
  # list a county's elections with dates (find the electionId you want)
  python3 fetch_clarity_results.py --county Hunt --list
  # dump one contest from one election to CSV
  python3 fetch_clarity_results.py --county Hunt --election 122429 \
      --contest "United States Representative District 3" --out /tmp/hunt_cd3_2024.csv
"""
import argparse
import csv
import io
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

BASE = "https://results.enr.clarityelections.com/TX/{county}/{eid}"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")


def _get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", "replace")


def current_ver(county, eid):
    try:
        return _get(f"{BASE.format(county=county, eid=eid)}/current_ver.txt").strip()
    except Exception:
        return None


def election_date(county, eid, ver):
    """Best-effort election date string from the settings JSON."""
    try:
        txt = _get(f"{BASE.format(county=county, eid=eid)}/{ver}/json/en/electionsettings.json")
    except Exception:
        return None
    m = re.search(r"(January|February|March|April|May|June|July|August|September|"
                  r"October|November|December)[, ]+\d{1,2},?\s+20\d{2}", txt, re.I)
    return m.group(0) if m else None


def detail_xml(county, eid, ver):
    raw = _get(f"{BASE.format(county=county, eid=eid)}/{ver}/reports/detailxml.zip", binary=True)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml"))
        return z.read(name).decode("utf-8", "replace")


def list_elections(county, ids):
    print(f"# {county} County — Clarity elections")
    for eid in ids:
        ver = current_ver(county, eid)
        if not ver:
            print(f"  {eid}: (unavailable)")
            continue
        print(f"  {eid} (ver {ver}): {election_date(county, eid, ver) or '?'}")


def parse_contest(xml_text, contest_match):
    """Sum vote types per precinct for the first contest whose text contains all
    whitespace-separated tokens of contest_match (case-insensitive). Yields
    (precinct, party, candidate, votes)."""
    root = ET.fromstring(xml_text)
    tokens = [t.lower() for t in contest_match.split()]
    for contest in root.iter("Contest"):
        text = contest.get("text", "")
        low = text.lower()
        if not all(t in low for t in tokens):
            continue
        rows = []
        for choice in contest.findall("Choice"):
            cand = choice.get("text", "")
            party = (choice.get("party", "") or "").upper()
            by_pct = {}
            for vt in choice.findall("VoteType"):
                for p in vt.findall("Precinct"):
                    by_pct[p.get("name")] = by_pct.get(p.get("name"), 0) + int(p.get("votes", 0))
            for pct, votes in by_pct.items():
                rows.append((pct, party, cand, votes))
        return text, rows
    return None, []


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--county", required=True, help="Clarity county name, e.g. Hunt")
    ap.add_argument("--ids", nargs="*", type=str, help="election ids to list")
    ap.add_argument("--list", action="store_true", help="list elections (with --ids)")
    ap.add_argument("--election", help="election id to extract")
    ap.add_argument("--contest", help="contest text to match (token subset)")
    ap.add_argument("--out", help="output CSV path (default: stdout)")
    args = ap.parse_args()

    if args.list:
        list_elections(args.county, args.ids or [])
        return

    if not (args.election and args.contest):
        ap.error("provide --election and --contest (or --list --ids ...)")

    ver = current_ver(args.county, args.election)
    if not ver:
        sys.exit(f"could not resolve current_ver for {args.county}/{args.election}")
    xml_text = detail_xml(args.county, args.election, ver)
    found, rows = parse_contest(xml_text, args.contest)
    if not rows:
        sys.exit(f"no contest matched '{args.contest}'")
    out = open(args.out, "w", newline="") if args.out else sys.stdout
    w = csv.writer(out)
    w.writerow(["precinct", "party", "candidate", "votes"])
    w.writerows(sorted(rows))
    if args.out:
        out.close()
    tot = sum(r[3] for r in rows)
    print(f"# matched contest: {found}", file=sys.stderr)
    print(f"# {len(rows)} rows across {len({r[0] for r in rows})} precincts, "
          f"{tot} total votes", file=sys.stderr)


if __name__ == "__main__":
    main()
