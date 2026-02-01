# Agent Briefs: Year Filter, Trends, and Data Pipeline

Use the full plan at [year_filter_trends_and_data_pipeline_c21d0d50.plan.md](year_filter_trends_and_data_pipeline_c21d0d50.plan.md) for detail. Below are three self-contained briefs—paste **one** into each agent session.

---

## Agent 1: Data Pipeline (Lead Data Engineer)

**Persona:** Lead data engineer. You own the harvest and parse pipeline only. Do not edit any frontend or `js/` files.

**Shared contract you must implement:**
- Output manifest `data/elections.json` as an array of objects: `{ "filename": string, "year": number | null, "category": string, "displayName"?: string }`.
- `filename`: path relative to `data/` (e.g. `Governor_2024.csv` or `2024/Governor.csv`).
- `category`: one of Federal, State, County, City, ISD, MUD (align with `js/electionFilters.js` ELECTION_CATEGORIES).
- Canonical CSV schema per race: `COUNTY NUMBER`, `PRECINCT CODE`, `PRECINCT NAME`, `REGISTERED VOTERS TOTAL`, `BALLOTS CAST TOTAL`, `BALLOTS CAST BLANK`, candidate columns, `OVER VOTES`, `UNDER VOTES`, `Winning Candidate`, `Winning Party`.

**Your work:**

1. **Harvest engine** (e.g. `data_processor/collin_harvest.py`):
   - Complete the provided `CollinElectionDataEngine` class. Fix the empty placeholders: `election_links = []`, then in the loop append links where `href` contains segments like `election`, `results`, `2024`, `2022`, `general`, `primary`, `runoff`; `keywords = ['csv', 'export', 'all races', 'results', 'download', 'precinct']`; `downloaded_files = []` and `master_results = []` with proper appends.
   - `fetch_archive_pages()`: scrape `https://www.collincountytx.gov/Elections/election-results-archive`, collect election landing page URLs, return list.
   - `extract_parseable_files(election_page_url)`: on each page find links whose text matches keywords, download to `collin_elections_master/<election_name>/`, return list of `{ election, file_name, source_url, local_path }`.
   - `run(limit=None)`: call fetch, then for each page (capped by limit) call extract, aggregate into master_results, then `generate_master_index(all_data)`.
   - Infer **year** and **election_type** (federal/state/county/local) per file from URL or filename; add to master index.

2. **Unified parser** (e.g. `data_processor/unified_parser.py`):
   - Input: path to downloaded file + optional metadata (year, election name).
   - Support: (1) multi-row header CSV (like current `election_splitter.py` with `header=[0,1]`), (2) single-header CSV, (3) one-race-per-file.
   - Output: one CSV per race per election in canonical schema; filenames include year (e.g. `Governor_2024.csv`) or use subdirs `data/2024/Governor.csv`. Write to `data/` (or agreed subdir).
   - Compute `Winning Candidate` and `Winning Party` per precinct.

3. **Manifest generator:**
   - After parsing each harvested file, build the manifest array (filename, year, category, displayName). Write `data/elections.json` with that array.

4. **Sample run:**
   - Run harvest with `limit=10` (or similar) and document which pages were used. Ensure sample includes at least one federal, one county, one local race if available.

5. **Docs:**
   - Add or update `data_processor/README.md` with: how to run harvest → parse → manifest, and the canonical schema.

**Do not:** edit `js/`, `index.html`, or `styles.css`. Only touch `data_processor/` and `data/` (write CSVs and `elections.json`).

---

## Agent 2: Year Filter (Lead Engineer)

**Persona:** Lead frontend engineer. You own manifest consumption, year state, and year filter UI only. Do not add trends/compare logic; do not edit the data pipeline.

**Shared contract you must consume:**
- `data/elections.json` may be legacy (array of strings) or new (array of objects `{ filename, year, category?, displayName? }`). You must support both.
- `listElectionCSVs()` must return `Promise<Array<{ filename, year, category?, displayName? }>>`. Normalize legacy strings to `{ filename, year: null, category }` using `categorizeElection(filename)` from electionFilters.

**Your work:**

1. **Stub manifest (for development):**
   - If `data/elections.json` is still a flat list of filenames, create a one-time stub or normalize in code so the app sees objects. Stub shape: `[{ "filename": "Governor.csv", "year": 2024, "category": "State" }, ...]` for all current filenames (category from `categorizeElection`). This lets you and the Trends agent work before the pipeline runs.

2. **dataLoader.js:**
   - Change `listElectionCSVs()` to return the normalized list of objects (support both legacy string array and new object array from JSON). Ensure every consumer gets `{ filename, year, category?, displayName? }`.

3. **electionFilters.js:**
   - Add `selectedYear` (null = "All years") to `ElectionFilterManager`.
   - Add `setYear(year)`, `getYear()`, and in `getFilteredElections()` apply year filter: if `selectedYear` is set, keep only entries where `entry.year === selectedYear`.
   - Derive list of available years from the manifest (unique `year` values, sorted desc).

4. **electionView.js (only the filter row / year UI):**
   - Add a **year** dropdown (or tabs) next to the existing category tabs and search. Options: "All years" plus one per available year.
   - When populating the main election `<select>`, use `filterManager.getFilteredElections()` (which now includes year).
   - If the app uses URL state, read/write a `year` param so links can restore the year filter.
   - Use comments `// YEAR FILTER:` where you add code so it’s clear this is your region.

5. **Styles:**
   - Add any CSS needed for the year dropdown/tabs (e.g. `.year-filter-*`). Do not style the compare/trend block.

**Do not:** add compare mode, second dropdown, or trend logic. Do not edit `electionTrends.js` or the trend sections of `electionView.js`. Do not edit `data_processor/` or write `data/elections.json`.

---

## Agent 3: Trends Between Elections (Lead Engineer)

**Persona:** Lead frontend engineer. You own the “compare two elections” and “show trend” feature only. Do not change how the year filter or manifest loading works; do not edit the data pipeline.

**Shared contract you rely on:**
- `listElectionCSVs()` returns array of `{ filename, year, category?, displayName? }` (provided by Year Filter or stub).
- You only **read** manifest and use existing `loadElectionData(filename)` to load a second election.

**Your work:**

1. **New file: js/electionTrends.js**
   - `getRaceKey(entry)`: given a manifest entry (or filename), return a normalized race key (e.g. "Governor", "President", "County_Commissioner_Precinct_4"). Normalize: lowercase, strip year/special chars, collapse spaces, map aliases (e.g. "President/Vice President" → "President").
   - `getElectionsByRaceKey(manifest)`: return a map or list of { raceKey, entries: [{ filename, year, ... }] } so the app can show "Governor: 2022, 2024".
   - `computePrecinctDeltas(electionData1, electionData2, candidates1, candidates2)`: for each precinct, compute margin or vote share for a chosen side (e.g. Dem) in each election; return deltas (year2 − year1) and optionally flipped (winner changed). Handle precinct alignment (same PRECINCT CODE); if a precinct is missing in one election, N/A or exclude.
   - Constants or helpers for trend map colors (e.g. swing to Dem = blue, swing to Rep = red, intensity by magnitude).

2. **electionView.js (only the compare / trend regions):**
   - Add a **Compare** block: second dropdown (“Compare to” / “Second election”), “Show trend” toggle, and a small legend for trend colors (Swing to Dem / Swing to Rep / No change).
   - When “Show trend” is on and two elections are selected: ensure both are the same race key (if not, show message “Select same race for trends” and do not compute trend). Load the second election via `loadElectionData(secondFilename)`, then call `computePrecinctDeltas` and store result.
   - **Map style:** In the layer style function, add a branch: if trend mode and two elections loaded, color precincts by delta (or flip); else keep existing winner-based coloring.
   - **Sidebar:** When in trend mode and a precinct is clicked, show both years’ results for that precinct plus the delta (and whether it flipped). Do not replace the single-election sidebar; add a conditional block for trend mode.
   - Use comments `// TRENDS:` where you add code so it’s clear this is your region.

3. **Styles:**
   - Add CSS for the compare block and trend legend (e.g. `.trend-*`). Do not change year filter styles.

**Do not:** edit `dataLoader.js` or change how `listElectionCSVs()` works. Do not add or change the year dropdown or year state in `electionFilters.js`. Do not edit `data_processor/` or `data/elections.json`. If you need the list of elections with year, use whatever the app already has after Year Filter work (filtered list with `year` on each entry).

---

## Execution order (optional)

- **Agent 1 (Pipeline)** can run anytime; it’s independent.
- **Agent 2 (Year Filter)** and **Agent 3 (Trends)** can run in parallel. Agent 2 should do the stub/manifest normalization and `listElectionCSVs()` first so Agent 3 has objects with `year`; if both run in parallel, Agent 3 can assume the contract and use a stub manifest that already has `year` (e.g. hand-written or from Agent 2’s stub).

After all three: run the app, pick a year, pick an election, optionally enable trend and pick a second election (same race), and verify map + sidebar.
