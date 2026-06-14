# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Texas Elections Data Viewer — a vanilla JavaScript (ES Modules) web app for visualizing Texas election data at the precinct level: interactive maps, demographic analysis, turnout visualization, and election forecasting. No build step; served via Python's `http.server`.

**Statewide status: ALL 254 Texas counties are LIVE** with officially-sourced precinct data (`data/tx/counties.json`). Two tiers: **175 counties** carry the full ballot via the three-gate pipeline (`data_processor/batch_import.py`: OpenElections ETL → exact canvass audit vs MEDSL-2022/VEST-2020 official datasets → TLC election-vintage boundary join); **79 counties** (where OpenElections failed verification or could not be mapped) carry the 10 statewide 2020 races ingested directly from VEST official precinct returns (`data_processor/vest_ingest.py` — results and boundaries from one official file, intrinsic join; registry `notes` flags them, prior failure reasons preserved in `data/tx/AUDIT_REPORT.json`). NEVER fabricate data and never weaken a gate — upgrade VEST-tier counties by fixing their OE data per Recipe F. Unknown values (e.g. ballots-cast in VEST counties) stay empty and render N/A.

## Common Commands

```bash
make install        # npm install + playwright install
make start          # Kill port 3000, start server, open browser
make serve          # Start server on port 3000 (foreground)
make stop           # Kill port 3000 processes

make test           # Run all tests (unit + e2e)
make test-unit      # Jest unit tests only
make test-e2e       # Playwright e2e tests (headless)
make test-headed    # Playwright with visible browser
make test-debug     # Playwright debug mode
make test-mobile    # Mobile-specific e2e tests

make lint           # ESLint on js/*.js
make format         # Prettier on js/ and e2e/
```

**Running a single unit test:**
```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/dataLoader.test.js
```

**Running a single e2e test:**
```bash
npx playwright test e2e/core-functionality.spec.js
```

**Dev server URL:** `http://localhost:3000/index.html` (Command Center front door) and `http://localhost:3000/precinct.html` (precinct lookup)

On localhost the Cognito sign-in gate is bypassed; the deployed site requires sign-in. The auth bootstrap lives at the bottom of `js/commandCenter.js` (index.html) — it uses `auth.js`/`authUI.js` and needs the `amazon-cognito-identity-js` importmap in the HTML.

## Deployment

The live site is https://collincountyelections.com — S3 + CloudFront in AWS account 967254372913 (`ccd` profile), us-east-1. Shell-exported AWS env vars point at a different account, so the Makefile pins `--profile ccd` and `AWS_REGION=us-east-1`.

```bash
make cdk-diff       # Preview infra changes (Cognito, chat Lambda, CloudFront, budget)
make cdk-deploy     # Deploy CDK stack
make deploy-site    # Sync site content to S3 + invalidate CloudFront
```

`deploy-site` is allowlist-only (`js/`, `data/` minus cache, `index.html`, `precinct.html`, `elections.html`, `forecast.html`, `targets.html`, `styles.css`). NEVER run a bare `aws s3 sync .` — the repo root contains voter PII (`VoterRegistrationFile.txt`) and internal files that must not reach the public bucket.

## Architecture

### Tech Stack
- **Frontend:** Vanilla JS (ES Modules), Leaflet.js (maps), Chart.js (charts), D3.js (data processing)
- **Styling:** Custom CSS with CSS Variables, no preprocessor
- **Data pipeline:** Python 3 scripts in `data_processor/` (pandas, beautifulsoup4)
- **Tests:** Jest 29 + jsdom (unit), Playwright 1.40 (e2e)

### Architecture: self-contained pages

**Adding a feature? Start with `docs/ADDING_FEATURES.md`** — step-by-step recipes for new map views, panels, data sources, command-palette commands, and precinct-report sections, plus the verify checklist.

Each HTML page is self-contained: it loads ONE orchestrator module from `js/` and shares only the library modules. No page imports another page's orchestrator. (The old `js/app/` monolith + `classic.html` were deleted June 2026 — recover from git history if ever needed.)

- **`index.html`** (the front door) loads `js/commandCenter.js` — the **Command Center** dashboard (left command rail · context strip · framed low-basemap precinct map with Lean/Margin/Diversity modes · live data dock · warm "Paper Command" ⇄ dark "War Room" theme toggle). Sits behind the Cognito gate (bypassed on localhost/e2e) — needs the `amazon-cognito-identity-js` importmap in its HTML. Smoke: `e2e/command-center.spec.js`.
- **`elections.html`** → `js/electionsPage.js` (race catalog), **`forecast.html`** → `js/forecastPage.js` (turnout scenarios), **`targets.html`** → `js/targetsPage.js` (precinct targeting), **`precinct.html`** → `js/precinctLookup.js` (lookup/report). Smoke: `e2e/new-pages.spec.js`, `e2e/targets.spec.js`.
- **Standalone-page rule:** orchestrators must NOT import deleted-monolith modules; include the d3 script; override styles.css's html/body flex lock; add new pages to the deploy allowlist.

**Data Layer:**
- `dataLoader.js` — fetches GeoJSON, CSV, demographic data; in-memory caching; boundary switching (`setActiveBoundary` for 2024 vs 2026 precincts)
- `electionSchema.js` — data schema definitions, validation, path building
- `constants.js` — centralized config (party colors — data encodings, do not change — category maps, map settings)
- `utils.js` — shared formatters, `escapeHtml`/`csvEscape` (use for any innerHTML/CSV output)

**Library Modules (root js/, consumed by the page orchestrators):**
- `turnoutSimulator.js` — turnout prediction/simulation (forecast page)
- `targeting.js` — precinct-targeting strategy engine (targets page, pure/tested)
- `talkingPointsBuilder.js` — precinct-chair talking points (precinct page, pure/tested)
- `electionFilters.js` — categorizes elections (Federal, State, County, City, ISD, MUD)
- `precinctHistory.js` (+ `electionTrends.js`) — per-precinct voting history
- `raceGrouping.js` — group elections by race family
- `precinctProfile.js`, `precinctExport.js`, `fieldOnePager.js` — precinct.html report features
- `geoLookup.js` — address→precinct (Nominatim) + point-in-polygon
- `themeManager.js`, `auth.js`/`authUI.js`/`authConfig.js`

History note: an earlier app.js-based architecture (22 modules) was deleted June 2026, and the `js/app/` Command-Center-era monolith + many map-only libs (competitiveRanker, marginView, demographicHeatmap, mapEnhancements, mapInitializer, boundaryChangesTable, universeBuilder, reverseCalculator, exportManager/exportCSV, urlStateManager, bookmarkManager, precinctChat/chatUI) were deleted with `classic.html` — recover from git history if ever needed.

### Data Contract (v3, normalized)

Election data lives under `data/tx/<county-slug>/` per boundary set: long-format race CSVs (`precinct,party,candidate,votes`), per-election-date turnout CSVs, an object manifest (`{version:3, elections:[...]}`), boundaries GeoJSON, and optional `profile/` extras (dnc_scores, racial, census_profiles — absent = N/A). `js/v3Pivot.js` pivots race+turnout into the legacy in-memory row shape at load and computes winners (alphabetical first-max rule); the app's consumers never see the file format. Full spec: `docs/DATA_LAYOUT_SPEC.md`. Manifests are generated, never hand-edited.

### Data Pipeline (`data_processor/`)

Python scripts for sourcing and converting election data:
- `tx_etl.py` — OpenElections precinct results → v3 county data (any Texas county)
- `fetch_vtd_geojson.py` — TLC election-vintage VTD boundaries → WGS84 GeoJSON + join validation
- `v3_writer.py` — shared v3 emission helpers
- `collin_harvest.py` / `unified_parser.py` / `pipeline.py` — Collin website scraper stack (legacy wide format; route new output through v3_writer)
- `migrate_collin_v3.py` / `verify_v3_migration.py` — one-shot historical migration tools (legacy dirs now live only in git history)

### Testing

- **Unit tests** (`tests/*.test.js`): Jest with jsdom environment. Uses `--experimental-vm-modules` for ES module support. Note: several test files test inline COPIES of source functions rather than importing the module — when changing a module, search tests for duplicated logic.
- **E2E tests** (`e2e/*.spec.js`): 8 files covering core functionality, command palette, accessibility, mobile, boundary switching, county switching, address lookup, and responsive screenshots. Playwright reuses the local server on port 3000. Run locally with `--workers=2` (the Python server is slow under parallel load).
- **Lint**: `make lint` runs ESLint (flat config in `eslint.config.js`) over js/, e2e/, tests/ and fails on errors.

### State Management

No framework state library. The map app's state object lives in `js/app/state.js` (a shared mutable singleton imported by every js/app module); precinctLookup.js holds the lookup page's state. URL hash syncs state for deep linking via `urlStateManager.js` (index) and a custom hash format (precinct.html). Data is cached after first load in `dataLoader.js`.
