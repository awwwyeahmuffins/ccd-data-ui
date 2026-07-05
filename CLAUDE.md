# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Collin County (TX) Elections Data Viewer — a vanilla JavaScript (ES Modules) web app for visualizing election data at the precinct level: interactive maps, demographic analysis, turnout visualization, targeting, and election forecasting. No build step; served via Python's `http.server`.

**Geo scope: Collin County only.** The registry (`data/tx/counties.json`) contains exactly one entry (Collin, 2024 + 2026 boundary sets). `data/tx/districts.json` + `data/tx/districts/` hold 12 overlapping CD/SD/HD districts whose race data includes out-of-county precinct rows found nowhere else — today they masquerade as extra "counties" in the registry; the approved redesign (`docs/REDESIGN.md`) turns them into district *scoping* instead. The Python pipeline in `data_processor/` is county-agnostic and can bring other counties live, but no other county's data ships in this repo. NEVER fabricate data — unknown values stay empty and render N/A.

**The simplification redesign in `docs/REDESIGN.md` is fully executed (phases 0–6, July 2026).** Consult its Status block for the small set of documented deviations (the elections.html stub is now deleted; the pure modules live in js/domain/). New work follows the layered architecture: `pages → (ui | map | reporting…) → domain → data → lib`, ESLint-enforced.

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
npx playwright test e2e/command-center.spec.js
```

**Dev server URL:** `http://localhost:3000/index.html` (Command Center front door) and `http://localhost:3000/precinct.html` (precinct lookup)

On localhost the Cognito sign-in gate is bypassed; the deployed site requires sign-in. The auth bootstrap lives at the bottom of `js/pages/map.js` (index.html) — it uses `auth.js`/`authUI.js` and needs the `amazon-cognito-identity-js` importmap in the HTML.

## Deployment

The live site is https://collincountyelections.com — S3 + CloudFront in AWS account 967254372913 (`ccd` profile), us-east-1. Shell-exported AWS env vars point at a different account, so the Makefile pins `--profile ccd` and `AWS_REGION=us-east-1`.

```bash
make cdk-diff       # Preview infra changes (Cognito, chat Lambda, CloudFront, budget)
make cdk-deploy     # Deploy CDK stack
make deploy-site    # Sync site content to S3 + invalidate CloudFront
```

`deploy-site` is allowlist-only (`js/`, `data/` minus cache, `index.html`, `precinct.html`, `elections.html`, `forecast.html`, `targets.html`, `explore.html`, `campaign.html`, `methodology.html`, `styles.css`). Shared assets that must deploy (e.g. `js/civic.css`, `js/siteNav.js`) live in `js/` so they ride the sync. NEVER run a bare `aws s3 sync .` — the repo root contains voter PII (`VoterRegistrationFile.txt`) and internal files that must not reach the public bucket.

## Architecture

### Tech Stack
- **Frontend:** Vanilla JS (ES Modules), Leaflet.js (maps), D3.js (data processing)
- **Vendored libraries:** Leaflet, D3, and the Cognito SDK ship from `js/vendor/` (no CDN at runtime — the app works offline in the field). Regenerate the Cognito ESM bundle with `npx esbuild node_modules/amazon-cognito-identity-js/es/index.js --bundle --format=esm --minify --define:global=globalThis --outfile=js/vendor/amazon-cognito-identity.esm.js`.
- **Styling:** Custom CSS with CSS Variables, no preprocessor
- **Data pipeline:** Python 3 scripts in `data_processor/` (pandas, beautifulsoup4)
- **Tests:** Jest 29 + jsdom (unit), Playwright 1.40 (e2e)

### Architecture: self-contained pages

**Adding a feature? Read `docs/REDESIGN.md` first** (the approved target architecture), then `docs/ADDING_FEATURES.md` for the current per-page conventions and the verify checklist.

Each HTML page is self-contained: it loads ONE orchestrator module from `js/` and shares only the library modules. No page imports another page's orchestrator. (The old `js/app/` monolith + `classic.html` were deleted June 2026 — recover from git history if ever needed.)

**Civic-plain design (July 2026):** the app targets 60+ precinct chairs on iPads. Light theme only (the dark "War Room" and its toggle were retired). Every page loads the shared civic layer — `js/civic.css` (canonical tokens: 18px base / 20px via the header text-size toggle, `--*-aaa` inks all ≥7:1 on paper — enforced by `tests/civicTokens.test.js` — gold `:focus-visible`, 44px targets, solid `.backplate` utility, glossary popover styles) and `js/siteNav.js` (renders the one plain-language header into `<header id="site-header">`; idempotent because the map page's init runs twice on the deployed auth path; also owns the text-size toggle and the one-time index.html welcome panel). Plain-language jargon definitions live in `js/glossary.js` (tap-to-open popovers — never hover-only). Data encodings are never color-alone: the map pairs every fill with an SVG pattern (`js/mapPatterns.js` — Rep diagonal / Dem horizontal / other dots; density = strength or bin) and every value with the shared plain-language formatter in `js/mapBins.js` (5 named numeric bins, `describePrecinct()` — used verbatim by polygon aria-labels, the tap readout card, and the List view so they can never disagree). Never reintroduce hover-only labels, sub-16px text, translucent "glass" behind map text, or `maximum-scale` viewport locks; e2e/a11y.spec.js runs axe on all 8 pages plus the deep stateful views and fails on critical/serious violations.

- **`index.html`** (the front door, nav label "Map") loads `js/pages/map.js` — shared header · context strip (district scope select, shared race picker, Map|List view toggle, precinct jump, data-vintage note) · SVG precinct map (pattern fills, keyboard-walkable polygons, tap readout card, binned legend on a solid backplate; `?renderer=canvas` is the perf escape hatch) with Lean/Margin/Diversity modes · a "so what"-first data dock (headline sentence, ≤5 stats, one disclosure) · a fully linear List view (`js/listView.js`, `#view=list`, the skip-link target). The Cognito gate is currently OFF (`REQUIRE_SIGN_IN = false` at the bottom of `js/pages/map.js` — flip to true to restore sign-in; localhost/e2e always bypass); the auth wiring stays intact and needs the `amazon-cognito-identity-js` importmap in its HTML. Smoke: `e2e/command-center.spec.js`, `e2e/list-view.spec.js`.
- **Nav (5 tabs, REDESIGN §3.3):** Map · My Precinct · Priority Precincts · Data Table · How It Works. **`forecast.html`** → `js/forecastPage.js` lives OUTSIDE the nav (linked from Priority Precincts + How It Works); **`elections.html`** is a redirect stub to the Map (removed in Phase 6). **`targets.html`** → `js/targetsPage.js` ("Priority Precincts"), **`explore.html`** ("Data Table"), **`precinct.html`** → `js/precinctLookup.js` ("My Precinct" — the report is 5 flat tabs built ONLY by `getReportStructureHTML()`, Field Guide first; printing always prints the whole report; `#tab=` deep links; viewing a report remembers the precinct in `ccd_my_precincts`), **`methodology.html`** ("How It Works", static). Targets leads with the ranked list (catalogue behind one "Change strategy" disclosure); Explore opens on a Summary view (flat topic tabs; "All columns" is the explicit spreadsheet). **`campaign.html`** → `js/campaignPage.js` ("Campaign Dashboard") lives OUTSIDE the five-tab nav — the campaign persona's `navPages` hook adds it as a sixth tab (direct URLs work for any persona): stackable range filters (margin, 2024→2022 turnout drop-off, % non-white, canvass coverage) driving one memoized derive() that feeds both the table render and a restyle-only map update; district roll-ups (CD/SD/HD/Commissioner via `ROLLUP_KINDS`); multi-sort + pinned columns; win numbers (50%+1 of baseline expected ballots, `TURNOUT_BASELINES` — never a "latest file" heuristic, turnout/2026.csv is the March primary) and a VAN-ready CSV export (`domain/campaign.js`). Canvass coverage (% of a precinct's modeled Dem universe door-knocked) is the optional `profile/canvass.csv` extra (`build_canvass.py` from a gitignored canvassing workbook writes the native 2024 vintage; `svc.loadCanvass()`; roll-ups sum counts and recompute the share, never average) — N/A when absent. The source workbook is on 2024 precincts (1–252); 2026 keeps those numbers but ADDS 253–273 carved from existing ones and the numbers don't correspond across sets, so `port_canvass.py` areal-interpolates 2024→2026 (distributes each source precinct's counts by area overlap; totals conserved; unknown coverage stays N/A, never fabricated 0%). Smoke: `e2e/new-pages.spec.js`, `e2e/targets.spec.js`, `e2e/explore.spec.js`, `e2e/precinct-tabs.spec.js`, `e2e/campaign.spec.js`.
- **Standalone-page rule:** orchestrators must NOT import deleted-monolith modules; include the d3 script; override styles.css's html/body flex lock; add new pages to the deploy allowlist AND give them the `#site-header` placeholder + `js/siteNav.js` + `js/civic.css`.

**Foundation (`js/lib/` — Phase 1 of REDESIGN.md; the bottom layer, imports nothing, ESLint-enforced):**
- `lib/format.js` — the one home for formatters (`formatPct`/`formatPctCompact`/`formatPctWhole`, `formatNumber`/`formatNumberOrNA`, `formatCurrency`, `safeNumber`, `populationOf`, `formatPrecinctLabel`)
- `lib/dom.js` — `escapeHtml`/`csvEscape` (use for any innerHTML/CSV output) + `debounce`
- `lib/download.js` — `downloadFile` (Blob + anchor download; used by precinctExport and the campaign CSV export)
- `lib/urlState.js` — the one hash-state module (`readParams`/`writeParams`/`onChange`); all six pages use it. Params: `race, precinct, view, tab, strategy, boundary, district` (+ legacy `county`)
- `lib/constants.js` — frozen literals (`PARTY_COLORS` — data encodings, do not change — `PARTY_STRENGTH_COLORS`, `MAP_CONFIG`, `LIGHT_TILE_URL`)
- `lib/persona.js` — persona (view mode) state, plumbing only (July 2026): `public` (default) / `chair` ("Simple View") / `campaign` ("Detailed View"). Resolution: URL `#persona=` (an ENTRY param — consumed at load, persisted, NEVER written back; pages' hash rewrites would destroy it) > localStorage `ccd_persona` > public. siteNav stamps the result as `html[data-persona]` before paint; switching (via the always-visible `#nav-persona` header "View" switcher — `menuLabel` per layout — which persists `ccd_persona` and reloads) is how users reach the persona dashboards, the ONLY nav path to them. (`devToolsEnabled`/`#dev=1` still exists in `lib/persona.js` for future dev-only chrome but no longer gates the View switcher.) Layout registry: `ui/personaLayouts.js`. The chair persona has the ONE persona-divergent surface (July 2026): its `navPages` prepends a "My Dashboard" tab → **`chair.html`** → `js/chairPage.js` (precinct picker persisted via `#precinct=` + the shared `ccd_my_precincts` MRU; 3×3 universe matrix of MODELED estimates from `js/domain/chairMetrics.js`; inactive-voter tracker reading optional `profile/field_ops.csv` — generated by `data_processor/build_field_ops.py`, aggregate-only (counts the voter file's INA/inactive status — this vintage has no "suspense" code), N/A when absent; voting info from hand-maintained `data/tx/collin/voting_info.json`; two-page print packet in `js/chairPrint.js` whose page-2 handout is structurally apolitical — `tests/chairPrint.test.js` bans partisan terms there). The page itself renders identically for every persona (works standalone at chair.html); only the nav entry is persona-gated. The public persona keeps the identical five-tab app; the campaign persona appends a "Campaign Dashboard" nav tab (campaign.html). Smoke: `e2e/chair.spec.js`

**Data Layer (`js/data/` — Phase 3; imports lib only, ESLint-enforced):**
- `data/catalog.js` — frozen Collin config (BOUNDARY_SETS with full paths, DEFAULT_BOUNDARY "2026"); replaces the counties.json fetch on the frontend
- `data/dataService.js` — `boundary(id)` → memoized per-boundary handle (`loadAll/listRaces/loadRace/loadPrecinctRaces/loadCountyBaselines/loadPrimaryTurnout`); switching boundaries is repointing, nothing is wiped; no cached rejections; RFC-4180 CSV parsing
- `data/districts.js` — DISTRICT_LIST (12 districts), `precinctsInDistrict` (geojson CONG/SEN/SHR props), district tree race loading + out-of-county aggregates. Districts are a SCOPE (`district=` param on Map + Targets), never a pseudo-county; legacy `#county=` deep links are read-tolerated, never written
- `electionSchema.js` — data schema definitions, validation, path building; the one `getRaceKey` (trends' cross-year normalizer is `getRaceFamilyKey`) and the one `ELECTION_META_KEYS`
- (the `constants.js`/`utils.js`/`dataLoader.js`/`electionFilters.js`/`raceGrouping.js` shims and root `mapBins.js`/`mapPatterns.js` are DELETED — import the final homes)

**Domain layer (`js/domain/` — pure computation, no fetch/DOM; imports lib only, ESLint-enforced):**
- `domain/races.js` — the taxonomy home: BOTH categorization policies (`categorizeElection` catalog policy, `categorizeRace` history policy — different outputs on purpose, see REDESIGN.md status), filter/search/count/format helpers, race-family grouping
- `domain/history.js` — per-precinct voting history/comparison + `buildPrecinctTrend` (data comes in as arguments; pages compose with the data service)
- `domain/trends.js` — cross-year race-family normalization (`getRaceFamilyKey`) + margin deltas
- `domain/simulator.js` — the turnout simulation engine (forecast page; HTML lives in `ui/simulatorControls.js`)
- `domain/campaign.js` — the campaign dashboard engine: win numbers (floor(expected/2)+1), persuasion-vs-turnout classification, district roll-ups (sums counts, recomputes shares — never averages percentages), stable multi-key sort, VAN target-list CSV

**Shared UI components (`js/ui/` — render what they're handed, never fetch; imports lib+domain only, ESLint-enforced):**
- `ui/racePicker.js` — the ONE searchable race picker (category groups + search); used by Map and Forecast; styles in civic.css
- `ui/precinctFinder.js` — the ONE number-vs-address heuristic + geocode/geolocate flows + plain-language status copy; used by Map and My Precinct
- `ui/dataTable.js` — column-model table renderer (generalizes listView's row-model pattern); used by explore
- `ui/reportSections.js` — the precinct report's HTML generators (from precinctProfile/precinctHistory)
- `ui/simulatorControls.js` — the simulator's HTML generators (from turnoutSimulator)
- `ui/personaLayouts.js` — the persona layout registry (`layoutFor(id)`): per-persona `badge`, `navPages(pages)`, `renderChromeExtras(headerEl)` hooks consulted by siteNav — identity/no-op except `campaign.navPages`, which appends the Campaign Dashboard tab

**Library Modules (root js/, consumed by the page orchestrators):**

- `targeting.js` — precinct-targeting strategy engine (targets page, pure/tested)
- `talkingPointsBuilder.js` — precinct-chair talking points (precinct page, pure/tested)
- `precinctExport.js`, `fieldOnePager.js` — precinct.html report features (HTML renderers live in `ui/reportSections.js`)
- `geoLookup.js` — address→precinct (Nominatim) + point-in-polygon
- `countyBriefing.js` (the dock's pure "so what" model) + `listView.js` (linear precinct list; pure row model + chunked renderer)

**Map layer (`js/map/` — Phase 4; the ONE Leaflet stack, imports lib+domain only, ESLint-enforced):**
- `map/mapView.js` — map/renderer/basemap creation (SVG default, canvas escape hatch), keyboard-walkable precinct paths, close-zoom number chips, view fitting, the precinct mini-map shell
- `map/mapStyles.js` — the fill engines (pattern + color, never color alone) with env args
- `map/legend.js` — `legendHTML(env)`, the exact fills the map uses
- `map/mapBins.js` (named numeric bins + the one plain-language precinct formatter) + `map/mapPatterns.js` (SVG pattern fills — a11y requirement); root `mapBins.js`/`mapPatterns.js` are shims until Phase 6
- `siteNav.js` (shared header + text-size toggle + welcome) + `civic.css` (shared tokens/a11y layer) + `glossary.js` (plain-language term popovers)
- `auth.js`/`authUI.js`/`authConfig.js` (Cognito; dormant — `themeManager.js` was deleted in Phase 1, the app is light-only)

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

- **Unit tests** (`tests/*.test.js`): Jest with jsdom environment. Uses `--experimental-vm-modules` for ES module support. Every suite imports the REAL modules (jest.config.js's moduleNameMapper resolves `./x.js` to `js/x.js`); the last three copy-based suites (utils, electionFilters, dataLoader) were rewritten in Phase 1 — do not reintroduce inline copies of source functions.
- **E2E tests** (`e2e/*.spec.js`): 9 files — `command-center` (map, dock, pickers, deep links), `list-view`, `new-pages` (elections/forecast/methodology), `targets`, `explore`, `precinct-tabs`, `precinct-lookup`, `onboarding` (welcome/help), and `a11y` (axe on all 8 pages + stateful views). Known gaps: boundary switching and inbound deep-link consumption have no dedicated specs yet (planned in REDESIGN.md Phase 1). Playwright reuses the local server on port 3000. Run locally with `--workers=2` (the Python server is slow under parallel load).
- **Lint**: `make lint` runs ESLint (flat config in `eslint.config.js`) over js/, e2e/, tests/ and fails on errors.

### State Management

No framework state library. Each page orchestrator holds its own module-level state object (e.g. the `cc` object in `commandCenter.js`, the `state` object in `precinctLookup.js`). The one shared mutable singleton is `dataLoader.js`: module-level `activeCounty`/`activeBoundary` plus an in-memory cache that `setActiveCounty`/`setActiveBoundary` wipe entirely (no change events — consumers must re-fetch and re-render by convention). URL hash state is hand-rolled per page (six different schemes, two parser styles); there is no shared URL-state module. Both of these are slated for replacement — a keyed per-boundary data service and a single `urlState` module — see `docs/REDESIGN.md` §5.
