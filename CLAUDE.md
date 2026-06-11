# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Texas Elections Data Viewer — a vanilla JavaScript (ES Modules) web app for visualizing Texas election data at the precinct level: interactive maps, demographic analysis, turnout visualization, and election forecasting. No build step; served via Python's `http.server`.

**Statewide status:** all 254 Texas counties are selectable (`data/tx/counties.json` registry + `data/tx/county-boundaries.geojson`), but **only Collin County has real data**. The other 253 are explicit PLACEHOLDERS: their county outline renders as a single `PRECINCT: "PLACEHOLDER"` feature, the election list is empty, and a banner says so. NEVER fabricate data for a placeholder county — `docs/ADDING_FEATURES.md` Recipe F describes how to bring a county live with real data.

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

**Dev server URL:** `http://localhost:3000/index.html` (map viewer) and `http://localhost:3000/precinct.html` (precinct lookup)

On localhost the Cognito sign-in gate is bypassed (see the auth bootstrap at the bottom of `js/app/main.js`); the deployed site requires sign-in.

## Deployment

The live site is https://collincountyelections.com — S3 + CloudFront in AWS account 967254372913 (`ccd` profile), us-east-1. Shell-exported AWS env vars point at a different account, so the Makefile pins `--profile ccd` and `AWS_REGION=us-east-1`.

```bash
make cdk-diff       # Preview infra changes (Cognito, chat Lambda, CloudFront, budget)
make cdk-deploy     # Deploy CDK stack
make deploy-site    # Sync site content to S3 + invalidate CloudFront
```

`deploy-site` is allowlist-only (`js/`, `data/` minus cache, `index.html`, `precinct.html`, `styles.css`). NEVER run a bare `aws s3 sync .` — the repo root contains voter PII (`VoterRegistrationFile.txt`) and internal files that must not reach the public bucket.

## Architecture

### Tech Stack
- **Frontend:** Vanilla JS (ES Modules), Leaflet.js (maps), Chart.js (charts), D3.js (data processing)
- **Styling:** Custom CSS with CSS Variables, no preprocessor
- **Data pipeline:** Python 3 scripts in `data_processor/` (pandas, beautifulsoup4)
- **Tests:** Jest 29 + jsdom (unit), Playwright 1.40 (e2e)

### Architecture: two self-contained pages

**Adding a feature? Start with `docs/ADDING_FEATURES.md`** — step-by-step recipes for new map views, panels, data sources, command-palette commands, and precinct-report sections, plus the verify checklist.

- **`index.html`** (map viewer) loads `js/app/main.js`, the page orchestrator. The map app is split across `js/app/` modules (extracted from a former 3,000-line inline script in June 2026):
  - `state.js` — THE shared mutable state object; every app module imports it
  - `main.js` — entry: initializeMap, init(), auth-gated startup
  - `viewMode.js` — `setViewMode` (the ONLY view-flip path) + map toolbar
  - `mapRendering.js` — 5 render paths + legend · `precinctPanel.js` — click/info card/profile · `search.js` — precinct search · `panels.js` — panel toggle/FAB/mobile tabs/ranker · `electionPanel.js` — Browse/Forecast/Saved rendering · `electionWorkflow.js` — loadElections/selectElection/URL sync · `boundary.js` — 2024↔2026 switching (Collin-only) · `county.js` — statewide county selector + placeholder handling · `uiChrome.js` — toasts/breadcrumbs/welcome/header · `commandPalette.js` — ⌘K + global shortcuts (side-effect import)
  - **Rule:** a `js/app/` module must never CALL an imported binding at module top level (declare, grab DOM, register listeners with local handlers only) — the function-level import cycles depend on it. Also preserve which listeners register at module top level (once) vs inside `init()` (re-registered on the deployed auth path where init can run twice).
- **`precinct.html`** (lookup/report) loads `js/precinctLookup.js`, which orchestrates that entire page.
- Root-level `js/*.js` modules are **libraries** consumed by both orchestrators; they hold no page state.

**Data Layer:**
- `dataLoader.js` — fetches GeoJSON, CSV, demographic data; in-memory caching; boundary switching (`setActiveBoundary` for 2024 vs 2026 precincts)
- `electionSchema.js` — data schema definitions, validation, path building
- `constants.js` — centralized config (party colors — data encodings, do not change — category maps, map settings)
- `utils.js` — shared formatters, `escapeHtml`/`csvEscape` (use for any innerHTML/CSV output)

**Library Modules (root js/, consumed by js/app/ unless noted):**
- `turnoutSimulator.js` — turnout prediction/simulation engine
- `universeBuilder.js` / `reverseCalculator.js` — forecast-tab tools
- `competitiveRanker.js` — swing-precinct ranking panel
- `electionFilters.js` — categorizes elections (Federal, State, County, City, ISD, MUD)
- `precinctHistory.js` (+ `electionTrends.js`) — per-precinct voting history
- `raceGrouping.js` — group elections by race family
- `exportManager.js` / `exportCSV.js` — CSV export
- `marginView.js`, `demographicHeatmap.js`, `mapEnhancements.js`, `mapInitializer.js`, `boundaryChangesTable.js` — map rendering helpers
- `precinctProfile.js`, `precinctLookup.js`, `precinctExport.js`, `fieldOnePager.js` — precinct.html report features
- `precinctChat.js` / `chatUI.js` — AI chat (code kept, but **intentionally disabled**: the `initPrecinctChat` call is commented out in `js/app/precinctPanel.js`; the Lambda backend stays deployed)
- `urlStateManager.js` — URL hash deep linking
- `themeManager.js`, `bookmarkManager.js`, `auth.js`/`authUI.js`/`authConfig.js`

History note: an earlier app.js-based architecture (electionView.js, demographicsView.js, sidebarController.js, etc.) was abandoned mid-refactor and its 22 unreachable modules were deleted in June 2026 — recover from git history if ever needed.

### Data Contract

Election data lives in `data/`. The manifest (`data/elections.json`) lists all available elections. Each entry has `filename`, `year`, `category`, and `displayName`. CSVs have fixed columns (`PRECINCT CODE`, `REGISTERED VOTERS TOTAL`, `BALLOTS CAST TOTAL`, etc.) plus variable candidate columns prefixed with party codes (`Rep`, `Dem`, etc.). Full spec in `docs/DATA_LAYOUT_SPEC.md`.

Supporting data files:
- `data/Voting_Precincts.geojson` — precinct boundary polygons
- `data/DNC Score By Precinct.csv` — party affiliation scores
- `data/Racial Numbers by Precinct.csv` — demographic data

### Data Pipeline (`data_processor/`)

Python scripts for scraping and processing election data from Collin County's website:
- `collin_harvest.py` — web scraper
- `unified_parser.py` — multi-format CSV parser
- `manifest_generator.py` — generates `data/elections.json`
- `pipeline.py` — main orchestrator

### Testing

- **Unit tests** (`tests/*.test.js`): Jest with jsdom environment. Uses `--experimental-vm-modules` for ES module support. Note: several test files test inline COPIES of source functions rather than importing the module — when changing a module, search tests for duplicated logic.
- **E2E tests** (`e2e/*.spec.js`): 6 files covering core functionality, command palette, accessibility, mobile, boundary switching, and responsive screenshots. Playwright reuses the local server on port 3000. Run locally with `--workers=2` (the Python server is slow under parallel load).
- **Lint**: `make lint` runs ESLint (flat config in `eslint.config.js`) over js/, e2e/, tests/ and fails on errors.

### State Management

No framework state library. The map app's state object lives in `js/app/state.js` (a shared mutable singleton imported by every js/app module); precinctLookup.js holds the lookup page's state. URL hash syncs state for deep linking via `urlStateManager.js` (index) and a custom hash format (precinct.html). Data is cached after first load in `dataLoader.js`.
