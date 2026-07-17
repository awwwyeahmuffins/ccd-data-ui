#!/usr/bin/env python3
"""parse_precinct_pdf.py — extract one contest's per-precinct results from a
county's official precinct-canvass PDF.

Two Texas county report layouts are supported, both verified against the
March 3 2026 primary documents (see upgrade_district_precincts_2026_primary.py
for the pinned URLs):

  * "grayson" — Hart "Precinct Summary Results Report" (Grayson County).
    Sections open with a bare `Precinct <name>` line; candidate rows carry
    TOTAL then VOTE % then vote-method columns.
  * "bowie" — ES&S Electionware "Summary Results Report … Pct X Pct" (Bowie
    County). Each page repeats a 3-line report header whose last line ends
    with the county name; the next non-blank line names the precinct.
    Candidate rows carry TOTAL then vote-method columns (no percent).

Both parsers are FAIL-CLOSED: a section that contains the contest header but
cannot be fully parsed (no candidate rows, or no closing "Total Votes Cast")
raises instead of skipping, so a layout drift can never silently drop votes.

Text extraction shells out to poppler's `pdftotext -layout` (brew install
poppler). These PDFs are digital text — if extraction produces no text (e.g. a
scanned document), we refuse rather than OCR; OCR output is not evidence.
"""
import re
import subprocess
from collections import defaultdict

# Column-header fragments that appear between "Vote For 1" and the first
# candidate row; never candidate names.
_HEADER_NOISE = ("TOTAL", "VOTE %", "Election", "Day", "Absentee", "Early Voting")

# A candidate row: name, ≥2 spaces, first integer = TOTAL votes.
_CAND_ROW = re.compile(r"^\s*(\S(?:.*?\S)?)\s{2,}([\d,]+)")

_END_ROWS = ("Total Votes Cast", "Overvotes", "Undervotes", "Contest Totals")


def extract_text(pdf_path):
    """PDF -> layout-preserving text. Fails closed on empty output."""
    out = subprocess.run(["pdftotext", "-layout", str(pdf_path), "-"],
                         capture_output=True, check=True)
    text = out.stdout.decode("utf-8", "replace")
    if not text.strip():
        raise ValueError(f"{pdf_path}: pdftotext produced no text "
                         "(scanned/image PDF? refusing — no OCR)")
    return text


def _parse_contest_block(lines, i, source):
    """Parse candidate rows from lines[i:] (just past the contest header).
    Returns (candidates, next_index); raises if the block never closes."""
    cands = []
    n = len(lines)
    while i < n:
        line = lines[i].strip()
        i += 1
        if not line or line == "Vote For 1" or any(h in line for h in _HEADER_NOISE if line.startswith(h)):
            continue
        # column-header line fragments like "TOTAL   VOTE %  Absentee Early Voting"
        if any(h in line for h in _HEADER_NOISE) and not _CAND_ROW.match(line):
            continue
        if line.startswith("Total Votes Cast"):
            if not cands:
                raise ValueError(f"{source}: contest block closed with no candidate rows")
            return cands, i
        m = _CAND_ROW.match(line)
        if m and not any(line.startswith(e) for e in _END_ROWS):
            name = m.group(1).strip()
            if name in _HEADER_NOISE or name.startswith("Vote For"):
                continue
            cands.append((name, int(m.group(2).replace(",", ""))))
            continue
        if cands:
            # non-candidate, non-terminator noise inside a started block
            raise ValueError(f"{source}: unparseable line inside contest block: {line!r}")
    raise ValueError(f"{source}: contest block never closed with 'Total Votes Cast'")


def parse_grayson_layout(text, contest, source="grayson pdf"):
    """Hart Precinct Summary layout -> {precinct: [(candidate, total), ...]}.
    Also returns the full set of precinct-section names seen (for whole-county
    membership checks)."""
    lines = text.split("\n")
    results = {}
    sections = set()
    current = None
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        m = re.match(r"^Precinct\s+(\S+)$", line)
        if m:
            current = m.group(1)
            sections.add(current)
            i += 1
            continue
        if line == contest:
            if current is None:
                raise ValueError(f"{source}: contest header before any precinct section")
            cands, i = _parse_contest_block(lines, i + 1, f"{source} pct {current}")
            if current in results and results[current] != cands:
                raise ValueError(f"{source}: precinct {current} parsed twice with different rows")
            results[current] = cands
            continue
        i += 1
    if not results:
        raise ValueError(f"{source}: contest {contest!r} not found in any section")
    return results, sections


def parse_bowie_layout(text, contest, county_header="Bowie County", source="bowie pdf"):
    """Electionware Pct-X-Pct layout -> {precinct: [(candidate, total), ...]}
    plus the set of all precinct-section names. The precinct name is the first
    non-blank line after each page header (whose last line ends with the
    county name), unless that line is a continuation of the previous section
    (Electionware repeats the header on every page but only names the precinct
    at a section start; continuation pages re-print the name too)."""
    lines = text.split("\n")
    results = {}
    sections = set()
    current = None
    expect_name = False
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.endswith(county_header) and "March" in line:
            expect_name = True     # next non-blank line names the precinct
            i += 1
            continue
        if expect_name and line:
            if line != "STATISTICS":  # a section's own first page repeats name then STATISTICS
                current = line
                sections.add(current)
            expect_name = False
            i += 1
            continue
        if line == contest:
            if current is None:
                raise ValueError(f"{source}: contest header before any precinct name")
            cands, i = _parse_contest_block(lines, i + 1, f"{source} pct {current}")
            if current in results and results[current] != cands:
                raise ValueError(f"{source}: precinct {current} parsed twice with different rows")
            results[current] = cands
            continue
        i += 1
    if not results:
        raise ValueError(f"{source}: contest {contest!r} not found in any section")
    return results, sections


def county_sums(results):
    """{precinct: [(cand, votes)]} -> {cand: county_total}."""
    sums = defaultdict(int)
    for rows in results.values():
        for cand, votes in rows:
            sums[cand] += votes
    return dict(sums)
