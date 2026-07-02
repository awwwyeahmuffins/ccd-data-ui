# Election Data Layout Specification v3.0

**Last Updated**: July 2, 2026
**Status**: Current Production Layout (normalized; shipped data covers Collin County + its overlapping districts)

This document specifies the data contract between the pipeline
(`data_processor/`) and the frontend. v3 replaced the legacy wide-CSV layout
on June 11, 2026 (see the appendix). Principles:

- **Normalized**: party is a data field, never a column-name convention.
  Turnout is stored once per election date, not duplicated into every race.
- **Derived values are computed, not stored**: per-precinct winners are
  recomputed at load time (`js/v3Pivot.js`) with a deterministic rule.
- **Honest gaps**: unknown values are EMPTY strings (the app shows N/A).
  Data is never fabricated; placeholder counties are explicitly labeled.

## 1. Registry

`data/tx/counties.json` — the county registry. **It contains exactly one
entry: Collin** (the frontend is Collin-only by decision — see
`docs/REDESIGN.md`; the registry shape stays county-agnostic because the
pipeline is):

```json
{
  "fips": "48085", "name": "Collin", "slug": "collin",
  "status": "live",
  "dataRoot": "data/tx/collin",
  "notes": null,
  "defaultBoundarySet": "2026",
  "boundarySets": {
    "original": { "label": "2024 Boundaries (252)", "geojson": "boundaries/2024.geojson", "dataDir": "2024" },
    "2026":     { "label": "2026 Boundaries (273)", "geojson": "boundaries/2026.geojson", "dataDir": "2026" }
  }
}
```

`data/tx/districts.json` lists 12 overlapping CD/SD/HD districts in the same
shape plus `kind: "district"` and `group`. Their `dataRoot` trees
(`data/tx/districts/<slug>/`) merge races across member counties and contain
out-of-county precinct rows (e.g. `hunt:…`, `denton:…`) that exist nowhere
else in the repo — do not delete them. `js/dataLoader.js` currently
concatenates both files into one registry so districts appear as extra
"counties"; the approved redesign replaces that masquerade with district
*scoping* (REDESIGN.md §5.2).

## 2. County data layout

```
data/tx/<slug>/
  boundaries/<set>.geojson       precinct polygons, WGS84, PRECINCT property per feature
  <setDir>/
    elections.json               v3 manifest (object wrapper, below)
    races/<RaceBase>.csv         one long-format file per race
    turnout/<key>.csv            one per election date (or per year[-n] when date unknown)
    profile/                     OPTIONAL extras — absent => app shows N/A
      dnc_scores.csv             party lean. Collin: voter-file scores. All other
                                 counties: VOTE-DERIVED ESTIMATE (avg REP/DEM/other
                                 votes across statewide races; Party Strength from
                                 |repShare-demShare|: <0.10=1, <0.30=2, else 3) —
                                 method + races recorded in provenance.json
      racial.csv                 demographics. Collin: county pipeline. All other
                                 counties: OFFICIAL Census 2020 race by VTD from
                                 TLC pop files (VTDs_22G_Pop / VTDs20G_Pop), keyed
                                 to the boundary geography; real rows only
      provenance.json            method/source record for generated profile files
      census_profiles.json       ACS profiles
      strategic_intelligence.json
      precinct_metadata.json     boundary-change metadata (Collin 2026 set)
  crosswalks/                    pipeline-only artifacts (app never fetches)
```

## 3. Race files (long format)

`races/<RaceBase>.csv` — header `precinct,party,candidate,votes`:

```csv
precinct,party,candidate,votes
1001,REP,Greg Abbott,512
1001,DEM,Beto O'Rourke,387
1001,,Write-in,2
1001,,Under Votes,4
```

- `party`: the party token (`REP`, `DEM`, `LIB`, `GRN`, `MOD`, `IND`, `CON`;
  legacy-migrated data may carry mixed case like `Dem`). EMPTY for
  nonpartisan candidates and propositions (`For` / `Against` are candidates).
- **Reserved pseudo-candidates** (party must be empty): `Write-in`,
  `Over Votes`, `Under Votes`. These are contest-level counts (over/under
  votes genuinely differ per contest) and pivot back to the legacy special
  columns at load.
- Office/district/year/date belong to the MANIFEST, not the rows.
- Vote values may be empty strings (honest gap), which the pivot preserves.

## 4. Turnout files

`turnout/<key>.csv` — header `precinct,registered,ballots_cast,blank`:

- `<key>` is the ISO election date (`2022-11-08`) when truly known (the ETL
  infers it from OpenElections filenames), else the year. Multiple same-year
  elections with conflicting turnout split into `<year>.csv`, `<year>-2.csv`, …
  by deterministic greedy clustering in manifest order — conflicts are
  reported, never averaged (Collin 2025 splits into 3: May / June runoff /
  November).
- Registered voters vary by election date; that's why turnout is per-date.
- Races whose source had no turnout have `turnoutFile: null` → N/A in the app.

## 5. Manifest (v3)

`<setDir>/elections.json` is an OBJECT (the `version` field is the format
detector — the legacy format was a bare array):

```json
{
  "version": 3,
  "county": "collin",
  "boundarySet": "original",
  "elections": [
    {
      "id": "governor-2022",
      "displayName": "Governor (2022)",
      "office": "Governor",
      "district": null,
      "year": 2022,
      "date": null,
      "category": "State",
      "raceFile": "races/Governor_2022.csv",
      "turnoutFile": "turnout/2022.csv",
      "sourceUrl": null
    }
  ]
}
```

- `id` is the stable race key (used in `#race=` deep links).
- `date` is filled only when truly known — never guessed.
- `category`: `Federal | State | County | City | ISD | MUD`.

## 6. Join keys

- Precinct codes are **strings**, compared by exact equality after
  `String(x).trim()`. Never zero-pad, case-fold, or numerically coerce.
- Every `precinct` in race/turnout/profile files must match a `PRECINCT`
  property in that set's boundary GeoJSON. The hard gate for any new dataset:
  **100% of vote-bearing precincts** must match
  (`data_processor/fetch_vtd_geojson.py --validate`); data that fails the join
  does not ship.
- Boundary sources: Texas Legislative Council VTD shapefiles
  (data.capitol.texas.gov, **election-vintage** — e.g. `VTDs_22G` for the
  2022 general). Census 2020 VTDs go stale as counties redraw (Bastrop:
  22 Census VTDs vs 26 actual 2022 precincts) — don't use them.

## 7. In-memory row contract (what the app consumes)

`js/dataLoader.js` pivots race+turnout files (`js/v3Pivot.js`) into one object
per precinct — the shape every consumer (simulator, margin view, exports,
profiles) was built on:

```
{ "PRECINCT CODE": "1001",
  "REGISTERED VOTERS TOTAL": "2210", "BALLOTS CAST TOTAL": "910",
  "BALLOTS CAST BLANK": "",
  "Write-in": "2",
  "REP Greg Abbott": "512", "DEM Beto O'Rourke": "387",   // "<party> <candidate>"
  "OVER VOTES": "0", "UNDER VOTES": "4",
  "Winning Candidate": "REP Greg Abbott", "Winning Party": "REP" }
```

- All values are strings; missing turnout is `""` (renders N/A).
- **Winner rule** (mirrors the historical `unified_parser.compute_winning_candidate`):
  candidate columns (everything except metadata and `Write-in`) in
  ALPHABETICAL order; winner = the FIRST maximum (ties break alphabetically);
  `Winning Party` = first whitespace token of the winning column.
- Candidate-vs-metadata detection: `js/electionSchema.js getCandidateColumns`.
- Participation gotcha: county-wide turnout means `BALLOTS CAST TOTAL > 0`
  even where a local race got zero votes — always check candidate votes
  (`precinctHasCandidateVotes`), not ballots cast.

## 8. Producing v3 data

- **New county results**: `data_processor/tx_etl.py` (OpenElections precinct
  CSVs → v3). Boundaries: `data_processor/fetch_vtd_geojson.py` (TLC VTDs →
  WGS84 GeoJSON + join validation). Full recipe: the pipeline appendix in
  `docs/ADDING_FEATURES.md`. (The frontend consumes only Collin data today —
  see `docs/REDESIGN.md`.)
- **Shared emission helpers**: `data_processor/v3_writer.py`.
- Manifests are generated, never hand-edited.

---

## Appendix: Legacy v2 layout (retired June 11, 2026)

One wide CSV per race in `data/` (2024 boundaries) and `data/2026/` (remap):
`COUNTY NUMBER, PRECINCT CODE, PRECINCT NAME, REGISTERED VOTERS TOTAL,
BALLOTS CAST TOTAL, BALLOTS CAST BLANK, <PARTY Candidate columns...>,
Write-in, OVER VOTES, UNDER VOTES, Winning Candidate, Winning Party` with a
bare-array `elections.json`. Flaws that motivated v3: party encoded in column
names, turnout duplicated into all ~450 race files per set, stored derived
winners (tie-breaks depended on pre-sort column order), fabricated precinct
names. Migrated value-faithfully by `data_processor/migrate_collin_v3.py`
(round-trip verified exactly equal on all 1,037 races by
`verify_v3_migration.py`); recover the old files from git history if needed.
