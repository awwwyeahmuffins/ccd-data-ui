# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Collin County Election Data Viewer — a vanilla JavaScript (ES Modules) web app for visualizing Collin County, Texas election data with interactive maps, demographic analysis, turnout visualization, and election forecasting. No build step; served via Python's `http.server`.

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

**Dev server URL:** `http://localhost:3000/index-new.html` (note: `index-new.html`, not `index.html`)

## Architecture

### Tech Stack
- **Frontend:** Vanilla JS (ES Modules), Leaflet.js (maps), Chart.js (charts), D3.js (data processing)
- **Styling:** Custom CSS with CSS Variables, no preprocessor
- **Data pipeline:** Python 3 scripts in `data_processor/` (pandas, beautifulsoup4)
- **Tests:** Jest 29 + jsdom (unit), Playwright 1.40 (e2e)

### Module Organization (`js/`)

**App Controller:** `app.js` — initializes everything, orchestrates views, manages app state

**Data Layer:**
- `dataLoader.js` — fetches GeoJSON, CSV, demographic data; implements caching
- `electionSchema.js` — single source of truth for data schema definitions, validation, path building
- `constants.js` — centralized config (colors, category maps, map settings)
- `utils.js` — shared formatters (percentages, numbers), color mapping, debounce

**Three Main Views:**
- `demographicsView.js` — party affiliation and racial demographics visualization
- `electionView.js` — main election results with turnout simulator (largest module, ~1,660 lines)
- `turnoutView.js` — precinct turnout analysis with leaderboards

**Feature Modules:**
- `turnoutSimulator.js` — turnout prediction/simulation engine (~1,120 lines)
- `electionFilters.js` — categorizes elections (Federal, State, County, City, ISD, MUD)
- `precinctHistory.js` — compare precincts across elections
- `electionTrends.js` — trend analysis and vote shift deltas
- `raceAnalytics.js` — race-level statistics
- `racePickerPanel.js` — election selection UI
- `raceGrouping.js` — group elections by race family
- `exportManager.js` / `exportCSV.js` — CSV export

**UI/UX Modules:**
- `sidebarController.js` / `sidebarTemplates.js` — sidebar state and HTML templates
- `legendController.js` — dynamic map legend
- `precinctLayer.js` — GeoJSON layer rendering and styling on the Leaflet map
- `urlStateManager.js` — URL hash-based deep linking
- `keyboardShortcuts.js` — Cmd+K / Ctrl+K command palette
- `mobileGestures.js` — touch/swipe handling
- `skeletonLoader.js` — loading states

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

- **Unit tests** (`tests/*.test.js`): ~28 files, Jest with jsdom environment. Uses `--experimental-vm-modules` for ES module support. Module paths mapped in `jest.config.js`.
- **E2E tests** (`e2e/*.spec.js`): 4 files covering core functionality, command palette, accessibility, and mobile. Playwright auto-starts a Python http.server on port 3000.

### State Management

No framework state library. App state is managed in `app.js` with getter/setter functions. Each view manages its own state. URL hash syncs state for deep linking via `urlStateManager.js`. Data is cached after first load in `dataLoader.js`.
