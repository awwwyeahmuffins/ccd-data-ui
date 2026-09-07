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

make lint           # ESLint on js/, e2e/, tests/ (js/vendor is ignored)
make format         # Prettier on js/ and e2e/ (js/vendor excluded)
```

**Running a single unit test:**
```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/dataService.test.js
```

**Running a single e2e test:**
```bash
npx playwright test e2e/command-center.spec.js
```

**Dev server URL:** `http://localhost:3000/index.html` (Command Center front door) and `http://localhost:3000/precinct.html` (precinct lookup)

**There is no access control on the deployed site.** The Cognito gate is OFF (`REQUIRE_SIGN_IN = false` at the bottom of `js/pages/map.js`), and even when on it only ever hid index.html's UI: the other nine pages never import `auth.js`, and CloudFront serves every object under `/data/**` unauthenticated. Flipping the flag back on does NOT make the site private — real gating would be a CloudFront Function / Lambda@Edge on the default behavior. The auth bootstrap is kept and wired (it uses `auth.js`/`authUI.js` and needs the `amazon-cognito-identity-js` importmap in the HTML); localhost and e2e always bypass it.

## Deployment

The live site is https://collincountyelections.com — S3 + CloudFront in AWS account 967254372913 (`ccd` profile), us-east-1. Shell-exported AWS env vars point at a different account, so the Makefile pins `--profile ccd` and `AWS_REGION=us-east-1`.

```bash
make cdk-diff       # Preview infra changes (Cognito, chat Lambda, CloudFront, budget)
make cdk-deploy     # Deploy CDK stack
make deploy-site    # Sync site content to S3 + invalidate CloudFront
```

`deploy-site` is allowlist-only (`js/`, `data/` minus cache, plus the root files listed one-per-line in `deploy-manifest.txt` — `index.html`, `precinct.html`, `forecast.html`, `targets.html`, `trends.html`, `explore.html`, `campaign.html`, `matchup.html`, `methodology.html`, `chair.html`, `styles.css`). Shared assets that must deploy (e.g. `js/civic.css`, `js/siteNav.js`) live in `js/` so they ride the sync. NEVER run a bare `aws s3 sync .` — the repo root contains voter PII (`VoterRegistrationFile.txt`) and internal files that must not reach the public bucket.

## Architecture

### Tech Stack
- **Frontend:** Vanilla JS (ES Modules), Leaflet.js (maps), D3.js (data processing)
- **Vendored libraries:** Leaflet, D3, and the Cognito SDK ship from `js/vendor/` (no CDN at runtime for JS). NOTE the app is NOT fully offline: `js/lib/constants.js` still points the basemap at a remote tile host and there is no service worker, so in the field the data and UI work but the map tiles do not. Regenerate the Cognito ESM bundle with `npx esbuild node_modules/amazon-cognito-identity-js/es/index.js --bundle --format=esm --minify --define:global=globalThis --outfile=js/vendor/amazon-cognito-identity.esm.js`.
- **Styling:** Custom CSS with CSS Variables, no preprocessor
- **Data pipeline:** Python 3 scripts in `data_processor/` (pandas, beautifulsoup4)
- **Tests:** Jest 29 + jsdom (unit), Playwright 1.40 (e2e)

### Architecture: self-contained pages

**Adding a feature? Read `docs/REDESIGN.md` first** (the approved target architecture), then `docs/ADDING_FEATURES.md` for the current per-page conventions and the verify checklist.

Each HTML page is self-contained: it loads ONE orchestrator module from `js/` and shares only the library modules. No page imports another page's orchestrator. (The old `js/app/` monolith + `classic.html` were deleted June 2026 — recover from git history if ever needed.)

**Civic-plain design (July 2026):** the app targets 60+ precinct chairs on iPads. Light theme only (the dark "War Room" and its toggle were retired). Every page loads the shared civic layer — `js/civic.css` (canonical tokens: 18px base / 20px via the header text-size toggle, `--*-aaa` inks all ≥7:1 on paper — enforced by `tests/civicTokens.test.js` — gold `:focus-visible`, 44px targets, solid `.backplate` utility, glossary popover styles) and `js/siteNav.js` (renders the one plain-language header into `<header id="site-header">`; idempotent because the map page's init runs twice on the deployed auth path; also owns the text-size toggle and the one-time index.html welcome panel). Plain-language jargon definitions live in `js/glossary.js` (tap-to-open popovers — never hover-only). Data encodings are never color-alone: the map pairs every fill with an SVG pattern (`js/map/mapPatterns.js` — Rep diagonal / Dem horizontal / other dots; density = strength or bin) and every value with the shared plain-language formatter in `js/map/mapBins.js` (5 named numeric bins, `describePrecinct()` — used verbatim by polygon aria-labels, the tap readout card, and the List view so they can never disagree). Never reintroduce hover-only labels, sub-16px text, translucent "glass" behind map text, or `maximum-scale` viewport locks; e2e/a11y.spec.js runs axe on all 10 pages plus the deep stateful views and fails on critical/serious violations.

- **`index.html`** (the front door, nav label "Map") loads `js/pages/map.js` — shared header · context strip (district scope select, shared race picker, Map|List view toggle, precinct jump, data-vintage note) · SVG precinct map (pattern fills, keyboard-walkable polygons, tap readout card, binned legend on a solid backplate; `?renderer=canvas` is the perf escape hatch) with Lean/Margin/Diversity modes · a "so what"-first data dock (headline sentence, ≤5 stats, one disclosure) · a fully linear List view (`js/listView.js`, `#view=list`, the skip-link target). The Cognito gate is currently OFF (`REQUIRE_SIGN_IN = false` at the bottom of `js/pages/map.js` — flip to true to restore sign-in; localhost/e2e always bypass); the auth wiring stays intact and needs the `amazon-cognito-identity-js` importmap in its HTML. Smoke: `e2e/command-center.spec.js`, `e2e/list-view.spec.js`.
- **Nav (6 tabs, REDESIGN §3.3):** Map · My Precinct · Priority Precincts · Trends · Data Table · How It Works. **`forecast.html`** → `js/forecastPage.js` lives OUTSIDE the nav (linked from Priority Precincts + How It Works); **`elections.html`** is a redirect stub to the Map (removed in Phase 6). **`targets.html`** → `js/targetsPage.js` ("Priority Precincts"), **`explore.html`** ("Data Table"), **`precinct.html`** → `js/precinctLookup.js` ("My Precinct" — the report is 5 flat tabs built ONLY by `getReportStructureHTML()`, Field Guide first; printing always prints the whole report; `#tab=` deep links; viewing a report remembers the precinct in `ccd_my_precincts`), **`methodology.html`** ("How It Works", static). Targets leads with the ranked list (catalogue behind one "Change strategy" disclosure); Explore opens on a Summary view (flat topic tabs; "All columns" is the explicit spreadsheet). **`campaign.html`** → `js/campaignPage.js` ("Campaign Dashboard") lives OUTSIDE the six-tab nav — the campaign persona's `navPages` hook appends it (direct URLs work for any persona): stackable range filters (margin, 2024→2022 turnout drop-off, % non-white, canvass coverage) driving one memoized derive() that feeds both the table render and a restyle-only map update; district roll-ups (CD/SD/HD/Commissioner via `ROLLUP_KINDS`); multi-sort + pinned columns; win numbers (50%+1 of baseline expected ballots, `TURNOUT_BASELINES` — never a "latest file" heuristic, turnout/2026.csv is the March primary) and a VAN-ready CSV export (`domain/campaign.js`). Canvass coverage (% of a precinct's modeled Dem universe door-knocked) is the optional `profile/canvass.csv` extra (`build_canvass.py` from a gitignored canvassing workbook writes the native 2024 vintage; `svc.loadCanvass()`; roll-ups sum counts and recompute the share, never average) — N/A when absent. The source workbook is on 2024 precincts (1–252); 2026 keeps those numbers but ADDS 253–273 carved from existing ones and the numbers don't correspond across sets, so `port_canvass.py` areal-interpolates 2024→2026 (distributes each source precinct's counts by area overlap; totals conserved; unknown coverage stays N/A, never fabricated 0%). **`trends.html`** → `js/trendsPage.js` ("Trends") answers the one question the other tabs can't: how a precinct's Dem-vs-Rep balance MOVED between cycles — as an arrow map (`map/swingLayer.js`), the swing scatter, and a filterable table, all driven by one filter set and cross-highlighted. TWO switchable metrics: the general-election composite (below) and PRIMARY PARTICIPATION (`buildPrimaryIndex` over `profile/primary_turnout.csv` — 2022/2024/2026, so it powers the real year-pair picker; labeled as engagement, never vote share). IMPACT rides beside every percentage: `netVotes` (change in the per-race Dem-minus-Rep gap — sums to the county's margin change ACROSS THE PRECINCTS WITH RESULTS IN BOTH YEARS; measured -22,943 vs the county's -23,875, a 3.9% gap that is almost entirely precinct 252, which has 2024 results but no 2022 composite entry) plus `demChange`/`repChange` per base, because 121 precincts added Democratic votes 2022→2024 and still moved Republican — the sentence a margin alone cannot say, and the `dem-grew-moved-rep` filter isolates it. Map arrows lie on one 45° axis (Dem up-right, Rep down-left), length = net votes by default (95th-percentile scale) or points via a toggle; precincts with no arrow (too-few-votes / no-comparison) get distinct cross-hatch patterns. Because Texas staggers its ballot, NO office runs in both 2022 and 2024 (midterm = Governor/Lt Gov/AG, presidential = President/US Senator, and even the high courts alternate seats) — so each axis is a COMPOSITE: the precinct's mean two-party margin across every race that reached the whole county's ballot, which cancels candidate-specific noise. Composite membership is chosen EMPIRICALLY by precinct coverage (`COMPOSITE_MIN_COVERAGE`, 95%), never a hardcoded office list: statewide/countywide races cover ~267 of 273 precincts, district-limited ones ~18. The `COUNTYWIDE_CATEGORIES` pre-filter (Federal/State/County) is only a fetch optimisation — 199 race loads down to 71 — and yields a byte-identical composite (17 races in 2022, 18 in 2024). Precincts casting fewer than `TINY_ELECTORATE_PER_RACE` (50) votes per race are flagged and held OFF the chart but kept in the table: Collin has precincts casting 1–2 votes per contest where a single ballot reads as "100% Democratic" and would stretch the axes to ±100. Smoke: `e2e/trends.spec.js`. Verified 2022→2024: county swing −0.6 pts vote-weighted (essentially flat, a hair Republican), 108 precincts toward Dem / 125 toward Rep, 14 flips.

Smoke: `e2e/new-pages.spec.js`, `e2e/targets.spec.js`, `e2e/explore.spec.js`, `e2e/precinct-tabs.spec.js`, `e2e/campaign.spec.js`, `e2e/trends.spec.js`.
- **Standalone-page rule:** orchestrators must NOT import deleted-monolith modules; include the d3 script; override styles.css's html/body flex lock; add new pages to the deploy allowlist AND give them the `#site-header` placeholder + `js/siteNav.js` + `js/civic.css`.

**Foundation (`js/lib/` — Phase 1 of REDESIGN.md; the bottom layer, imports nothing, ESLint-enforced):**
- `lib/format.js` — the one home for formatters (`formatPct`/`formatPctCompact`/`formatPctWhole`, `formatNumber`/`formatNumberOrNA`, `formatCurrency`, `safeNumber`, `populationOf`, `formatPrecinctLabel`)
- `lib/dom.js` — `escapeHtml`/`csvEscape` (use for any innerHTML/CSV output) + `debounce`
- `lib/download.js` — `downloadFile` (Blob + anchor download; used by precinctExport and the campaign CSV export)
- `lib/urlState.js` — the one hash-state module (`readParams`/`writeParams`/`onChange`); all six pages use it. Params: `race, precinct, view, tab, strategy, boundary, district` (+ legacy `county`)
- `lib/constants.js` — frozen literals (`PARTY_COLORS` — data encodings, do not change — `PARTY_STRENGTH_COLORS`, `MAP_CONFIG`, `LIGHT_TILE_URL`)
- `lib/persona.js` — persona (view mode) state, plumbing only (July 2026): `public` (default) / `chair` ("Simple View") / `campaign` ("Detailed View"). Resolution: URL `#persona=` (an ENTRY param — consumed at load, persisted, NEVER written back; pages' hash rewrites would destroy it) > localStorage `ccd_persona` > public. siteNav stamps the result as `html[data-persona]` before paint; switching (via the always-visible `#nav-persona` header "View" switcher — `menuLabel` per layout — which persists `ccd_persona` and reloads) is how users reach the persona dashboards, the ONLY nav path to them. (`devToolsEnabled`/`#dev=1` still exists in `lib/persona.js` for future dev-only chrome but no longer gates the View switcher.) Layout registry: `ui/personaLayouts.js`. The chair persona has the ONE persona-divergent surface (July 2026): its `navPages` prepends a "My Dashboard" tab → **`chair.html`** → `js/chairPage.js` (precinct picker persisted via `#precinct=` + the shared `ccd_my_precincts` MRU; 3×3 universe matrix of MODELED estimates from `js/domain/chairMetrics.js`; inactive-voter tracker reading optional `profile/field_ops.csv` — generated by `data_processor/build_field_ops.py`, aggregate-only (counts the voter file's INA/inactive status — this vintage has no "suspense" code), N/A when absent; voting info from hand-maintained `data/tx/collin/voting_info.json`; two-page print packet in `js/chairPrint.js` whose page-2 handout is structurally apolitical — `tests/chairPrint.test.js` bans partisan terms there). The page itself renders identically for every persona (works standalone at chair.html); only the nav entry is persona-gated. The public persona keeps the identical six-tab app; the campaign persona appends a "Campaign Dashboard" nav tab (campaign.html). Smoke: `e2e/chair.spec.js`

**Data Layer (`js/data/` — Phase 3; imports lib only, ESLint-enforced):**
- `data/catalog.js` — frozen Collin config (BOUNDARY_SETS with full paths, DEFAULT_BOUNDARY "2026"); replaces the counties.json fetch on the frontend
- `data/dataService.js` — `boundary(id)` → memoized per-boundary handle (`loadAll/listRaces/loadRace/loadPrecinctRaces/loadCountyBaselines/loadPrimaryTurnout`); switching boundaries is repointing, nothing is wiped; no cached rejections; RFC-4180 CSV parsing
- `data/districts.js` — DISTRICT_LIST (12 districts), `precinctsInDistrict` (geojson CONG/SEN/SHR props), district tree race loading + out-of-county aggregates. Districts are a SCOPE (`district=` param on Map + Targets), never a pseudo-county; legacy `#county=` deep links are read-tolerated, never written
- `electionSchema.js` — data schema definitions, validation, path building; `getRaceKey` (import it — do not hand-inline `e.raceKey || e.filename`; trends' cross-year normalizer is the separate `getRaceFamilyKey`) and the one `ELECTION_META_KEYS`
- (the `constants.js`/`utils.js`/`dataLoader.js`/`electionFilters.js`/`raceGrouping.js` shims and root `mapBins.js`/`mapPatterns.js` are DELETED — import the final homes)

**Domain layer (`js/domain/` — pure computation, no fetch/DOM; imports lib only, ESLint-enforced):**
- `domain/races.js` — the taxonomy home: BOTH categorization policies (`categorizeElection` catalog policy, `categorizeRace` history policy — different outputs on purpose, see REDESIGN.md status), filter/search/count/format helpers, race-family grouping
- `domain/history.js` — per-precinct voting history/comparison + `buildPrecinctTrend` (data comes in as arguments; pages compose with the data service)
- `domain/trends.js` — cross-year race-family normalization (`getRaceFamilyKey`) + margin deltas + the Trends page's two-party composite (`twoPartyMargin`, `selectCompositeRaces`, `buildPartisanIndex`, `buildSwingSeries`, `summarizeSwing`). NOTE `twoPartyMargin` excludes third parties from BOTH sides — the composite uses it deliberately, so its margins are not comparable to a raw winner-minus-runner-up gap
- `domain/simulator.js` — the turnout simulation engine (forecast page; forecastPage.js renders its own markup)
- `domain/campaign.js` — the campaign dashboard engine: win numbers (floor(expected/2)+1), persuasion-vs-turnout classification, district roll-ups (sums counts, recomputes shares — never averages percentages), stable multi-key sort, VAN target-list CSV

**Shared UI components (`js/ui/` — render what they're handed, never fetch; imports lib+domain only, ESLint-enforced):**
- `ui/racePicker.js` — the ONE searchable race picker (category groups + search); used by Map and Forecast; styles in civic.css
- `ui/precinctFinder.js` — the ONE number-vs-address heuristic + geocode/geolocate flows + plain-language status copy; used by Map and My Precinct
- `ui/dataTable.js` — column-model table renderer (generalizes listView's row-model pattern); used by explore and trends
- `ui/swingScatter.js` — the Trends page's precinct swing scatter (inline SVG, no chart library). The plot area is forced SQUARE because both axes share one domain — that is what makes the no-change diagonal a true 45° and the distance from it a readable swing. Direction is encoded by SHAPE (triangle up/down, circle) as well as hue; `describeSwing()` is the ONE plain-language sentence used verbatim by the marks' aria-labels, the readout, and the table, so they cannot disagree
- `ui/reportSections.js` — the precinct report's HTML generators (from precinctProfile/precinctHistory)
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
- `map/mapBins.js` (named numeric bins + the one plain-language precinct formatter) + `map/mapPatterns.js` (SVG pattern fills — a11y requirement)
- `map/swingLayer.js` — the Trends map: per-precinct direction arrows on one 45° axis (geometry built from a direction vector; `makeArrowScale` sizes by net votes or points), quiet-paper fills for arrowed precincts, patterned fills only for the data silences, and the legend model (`swingLegend`)
- `siteNav.js` (shared header + text-size toggle + welcome) + `civic.css` (shared tokens/a11y layer) + `glossary.js` (plain-language term popovers)
- `auth.js`/`authUI.js`/`authConfig.js` (Cognito; dormant — `themeManager.js` was deleted in Phase 1, the app is light-only)

History note: an earlier app.js-based architecture (22 modules) was deleted June 2026, and the `js/app/` Command-Center-era monolith + many map-only libs (competitiveRanker, marginView, demographicHeatmap, mapEnhancements, mapInitializer, boundaryChangesTable, universeBuilder, reverseCalculator, exportManager/exportCSV, urlStateManager, bookmarkManager, precinctChat/chatUI) were deleted with `classic.html` — recover from git history if ever needed.

### Data Contract (v3, normalized)

Election data lives under `data/tx/<county-slug>/` per boundary set: long-format race CSVs (`precinct,party,candidate,votes`), per-election-date turnout CSVs, an object manifest (`{version:3, elections:[...]}`), boundaries GeoJSON, and optional `profile/` extras (dnc_scores, racial, census_profiles — absent = N/A). `js/v3Pivot.js` pivots race+turnout into the legacy in-memory row shape at load and computes winners (alphabetical first-max rule, with exact ties flagged in a `Tie` column — which MUST stay in `ELECTION_META_KEYS`/`SKIP_KEYS`/`META_COLUMNS`, or the row-key loops read `+true` as one vote); the app's consumers never see the file format. Full spec: `docs/DATA_LAYOUT_SPEC.md`. Manifests are generated, never hand-edited.

### Data Pipeline (`data_processor/`)

Python scripts for sourcing and converting election data:
- `tx_etl.py` — OpenElections precinct results → v3 county data (any Texas county)
- `fetch_vtd_geojson.py` — TLC election-vintage VTD boundaries → WGS84 GeoJSON + join validation
- `v3_writer.py` — shared v3 emission helpers
- `collin_harvest.py` / `unified_parser.py` / `pipeline.py` — Collin website scraper stack (legacy wide format; route new output through v3_writer)
- `migrate_collin_v3.py` / `verify_v3_migration.py` — one-shot historical migration tools (legacy dirs now live only in git history)

### Testing

- **Unit tests** (`tests/*.test.js`): Jest with jsdom environment. Uses `--experimental-vm-modules` for ES module support. Every suite imports the REAL modules (jest.config.js's moduleNameMapper resolves `./x.js` to `js/x.js`); the copy-based suites were rewritten in Phase 1 — do not reintroduce inline copies of source functions.
- **E2E tests** (`e2e/*.spec.js`): 16 files (see `ls e2e/`) — `command-center` (map, dock, pickers, deep links), `list-view`, `new-pages` (forecast/methodology), `targets`, `explore`, `trends` (swing chart, composite membership, tiny-electorate handling), `campaign`, `chair`, `matchup`, `precinct-tabs`, `precinct-lookup`, `onboarding` (welcome/help), `persona`, `boundary-switching`, `deep-links`, and `a11y` (axe on all 10 pages + stateful views). Playwright reuses the local server on port 3000. Run locally with `--workers=2` (the Python server is slow under parallel load). In sandboxes where the pinned browser build is missing, set `CCD_CHROMIUM_PATH` to a local Chromium (the config wires it into the chromium-family projects).
- **Lint**: `make lint` runs ESLint (flat config in `eslint.config.js`) over js/, e2e/, tests/ and fails on errors.

### State Management

No framework state library. Each page orchestrator holds its own module-level state object (e.g. the `cc` object in `js/pages/map.js`, the `pg` object in `js/targetsPage.js`, the module state in `js/precinctLookup.js`).

Data access goes through `js/data/dataService.js`: `boundary(id)` returns a memoized per-boundary handle, so switching boundaries REPOINTS rather than wiping a shared singleton, and nothing is cached on rejection. (The old `dataLoader.js` mutable singleton with its `setActiveCounty`/`setActiveBoundary` cache wipe was deleted in the July 2026 redesign.)

URL hash state goes through the ONE module, `js/lib/urlState.js` (`readParams`/`writeParams`/`onChange`). Do not hand-roll a seventh scheme. Params: `race, precinct, view, tab, strategy, boundary, district` (+ legacy `county`, read-tolerated). Note `writeParams` uses `replaceState` by default, so it fires no `hashchange` — a page that pushes real history entries (precinct.html, chair.html) must subscribe via `onChange` for Back to work.

Async loads that write shared state carry a monotonic token (`cc.loadToken` in `js/pages/map.js`, `selectSeq` in `js/precinctLookup.js`, `pg.electionSeq` in `js/targetsPage.js`) and check it after every await. Without it a superseded fetch paints over the newer selection — see the Sept 2026 audit.
