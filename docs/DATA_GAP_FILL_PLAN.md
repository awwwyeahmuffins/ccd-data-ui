# Missing-Data Fill Plan (June 2026)

Companion to `data/tx/MISSING_DATA_REPORT.json` (regenerate with
`python3 data_processor/audit_missing_data.py`). Every fill path below uses
**official data only** and keeps the existing verification gates — nothing is
estimated, interpolated, or fabricated.

## Audit results (2026-06-12)

| Gap | Count | Cause |
|---|---|---|
| Counties without any 2022/2024 races | 165 | 86 imported on the 2020 OE wave + 79 VEST-direct (2020 statewide only) |
| Counties without 2020 races | 89 | 87 imported on the 2022 OE wave + bastrop/collin (own pipelines) |
| Counties with turnout gaps (registered/ballots empty) | 68 | VEST source carries no ballots-cast; some OE turnout files have empty columns |
| Counties without census profiles | 253 | `fetch_acs_profiles.py` was only ever run for Collin |
| District views where races miss whole member counties | 92 of 219 | members mixed across 2020/2022 vintages |
| District views missing their own district race | 61 of 219 | underlying counties' vintage lacks that year, or race uncontested |
| Texas statewide view races with county gaps | 22 of 22 | same vintage split, aggregated |

## Verified sources

1. **TLC VTD-level election returns** (Texas Legislative Council, Capitol Data
   Portal, dataset `comprehensive-election-datasets-compressed-format`):
   - `2022-general-vtds-election-data.zip` (69 MB) — verified 2026-06-12:
     contains `<year>_General_Election_Returns.csv` for **2012–2022** re-reported
     on 2022-general VTDs, **all 254 counties**, offices = all statewide +
     U.S. Rep + State Senate + State Rep + SBOE + COA + county offices.
     Joins intrinsically to `VTDs_22G.shp` (already in /tmp) via `cntyvtd`.
   - `<year>_General_Election_VRTO.csv` — **TotalVR (registered) and TotalTO
     (ballots cast) per VTD** for every county: fills the turnout N/A gap,
     including all 79 VEST counties.
   - Sibling zips exist for **2020-general VTDs** and **2024-general VTDs**
     (2024 GE returns on 2024 geography).
   - **Reconciliation proven**: TLC vs MEDSL Governor 2022 totals match
     **exactly in 254/254 counties** (checked 2026-06-12). Two independent
     official compilations agree to the vote, so the strict audit gate holds.

2. **MEDSL official precinct returns** (`/tmp/TX-cleaned.csv` = 2022,
   `/tmp/TX20-cleaned.csv` = 2020): precinct-level, all 254 counties.
   Already the audit reference; remains the independent cross-check.

3. **OpenElections 2022 statewide general file**
   (`20221108__tx__general__precinct.csv`): only 101 counties; just 26 of the
   165 gap counties. Useful for Recipe-F upgrades of specific counties, not
   for closing the statewide gap.

4. **Census ACS 5-year API** — `fetch_acs_profiles.py` already implements
   block-group → precinct aggregation; needs a statewide run per county
   boundary set to produce `census_profiles.json` beyond Collin.

## Fill plan (ordered)

1. **`tlc_ingest.py`** (new, modeled on `vest_ingest.py`): ingest TLC
   `2022_General_Election_Returns.csv` + VRTO joined to `VTDs_22G.shp` for the
   165 counties lacking 2022 races, as a new `2022` boundary set per county.
   Gate: per-county per-office totals must reconcile exactly against MEDSL
   2022 (proven above). Source URL recorded per race.
2. **Turnout backfill**: same script emits `registered`/`ballots_cast` from
   VRTO for every ingested election; separately backfill the 79 VEST
   counties' 2020 turnout from the 2020-general zip's VRTO.
3. **2020 backfill for 2022-wave counties**: the SAME 2022 zip carries
   `2020_General_Election_Returns.csv` on 22G geography — adds 2020 statewide
   races to the 87 counties' existing 22G boundaries with zero join work.
4. **2024 wave**: `2024-general-vtds-election-data.zip` + `VTDs_24G` → brings
   every county to 2024, eliminating the vintage split entirely.
5. **Rebuild views**: `build_districts.py` + `build_texas_view.py` — the 92
   districts with county gaps and all 22 texas-view gaps close automatically
   once members share vintages.
6. **Census profiles statewide**: run `fetch_acs_profiles.py` per county
   (ACS API, free; needs only boundary GeoJSONs). 253 counties.
7. **Residual**: races genuinely uncontested in a year stay absent — honest
   gaps, rendered as no-data.
