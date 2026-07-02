# REDESIGN.md — Collin County Elections Viewer: Simplification Redesign

**Last Updated**: July 2, 2026
**Status**: COMPLETE — all phases (0–6) executed July 2, 2026, plus both
post-Phase-6 follow-ups (same day): the elections.html redirect stub is now
DELETED (old bookmarks 404 — accepted by the owner in favor of finishing the
cleanup in one release), and the four surviving modules were rehomed:
`domain/trends.js`, `domain/simulator.js`, `domain/history.js` (pure — the
fetch-coupled wrappers became one-line svc compositions in their consumers,
and `buildPrecinctTrend` now takes data as arguments), while precinctProfile
dissolved entirely (census-profile loading moved into the dataService handle
as `loadCensusProfiles()`; its render helper had no consumers). The layered
tree is now complete: NO first-party module lives at the js/ root except the
page-shared library keepers (siteNav, glossary, helpPanel, listView,
countyBriefing, geoLookup, electionSchema, v3Pivot, auth*, and the five page
orchestrators pending their pages/ move).

- **Phase 6** (deletions + deploy): done, with three documented judgment calls:
  1. **Deleted outright**: `dataLoader.js`, `utils.js`, `constants.js`,
     `electionFilters.js`, `raceGrouping.js`, root `mapBins.js`/`mapPatterns.js`
     shims, `electionsPage.js`, and the obsolete `dataLoader`/`districtViewSlug`
     test suites. Every remaining importer now hits the final homes directly
     (`git grep` shows zero import references to any deleted module); the last
     five dataLoader consumers (precinctLookup, precinctHistory,
     precinctProfile, fieldOnePager, precinctExport) migrated onto
     `boundary()`. `ELECTION_META_KEYS` moved into electionSchema.js (its
     single source).
  2. **elections.html stub KEPT for one release** — the plan's own §3.2 grace
     period. Deleting it in the same release that created it would 404 every
     old bookmark. Remove it (and its deploy-manifest line) next cycle.
  3. **Four "superseded originals" survive as pure modules** —
     `electionTrends.js`, `precinctHistory.js`, `precinctProfile.js`,
     `turnoutSimulator.js`. Their HTML halves are gone (Phase 2 moved them to
     ui/), but their pure/data halves were never rehomed to `domain/` because
     no phase actually built domain/trends|history|profile|simulator. They are
     single-consumer, tested, and layer-clean in practice; moving them is
     mechanical follow-up work, not a blocker. `tests/countyRegistry.test.js`
     also stays — it validates the on-disk registry JSON the Python pipeline
     still owns, which is data integrity, not dead code.
  4. **Deploy**: `deploy-manifest.txt` is the one root-file allowlist;
     `make deploy-site` loops over it (fails on a missing file) and
     `make deploy-dry-run` lists exactly what ships. Bare `aws s3 sync .`
     remains forbidden (voter PII in the repo root).

- **Phase 5** (IA changes): done. The five-tab nav shipped (Map · My Precinct ·
  Priority Precincts · Data Table · How It Works); forecast.html left the nav
  (inbound doors: Priority Precincts footer + How It Works "Advanced tools";
  outbound: flipped-precinct chips → My Precinct, map link → Map);
  elections.html is a redirect stub carrying #race= through to the Map
  (removed in Phase 6). The welcome panel names all five tabs with "Find your
  precinct" as the primary action and offers the remembered precinct
  (localStorage `ccd_my_precincts`, max 3 — written by the report page, read
  by the welcome + the Map's county dock). Cross-links per §3.5: Map precinct
  dock → Data Table with the row highlighted (`explore.html#precinct=`);
  precinct report → back to the Map centered on the precinct; the report tab
  structure is single-sourced in `getReportStructureHTML()` (the static copy
  in precinct.html was deleted). One deviation: **Data Table's Summary view
  was KEPT** — the plan's premise ("duplicates the Map's county briefing")
  described an older dashboard-style Summary; today's Summary is a compact
  COLUMN SET (the 8 key numbers, no horizontal scroll), which fits the
  one-spreadsheet model and is the most senior-friendly default. The stale
  full-viewport-lock cleanup was already done upstream; the three vestigial
  per-page undo rules were deleted.

- **Phase 4** (map extraction): done. `js/map/` owns the ONE Leaflet stack:
  `mapView.js` (map/renderer/basemap creation, keyboard layer, precinct-number
  chips, fitting, and the precinct.html mini-map shell — the second consumer),
  `mapStyles.js` (the fill engines, env-arg pure), `legend.js` (legendHTML),
  plus `mapBins.js`/`mapPatterns.js` moved in (root shims remain until Phase
  6). `commandCenter.js` became `js/pages/map.js` (1,379 lines, wiring +
  race/dock orchestration; index.html loads it directly). One deviation: the
  precinct mini-map kept its page-local context/selected layers — the shared
  seam is map+tiles creation (`createMiniMap`), because the report's mini-map
  is interactive-with-context, not a plain highlight, and forcing it through a
  generic interface would have changed behavior.

- **Phase 3** (data service, Collin-only): done. `js/data/` landed (frozen
  catalog, per-boundary memoized handles — switching is repointing, nothing is
  wiped; districts.js owns membership + tree loading). All five county pickers
  are gone; the Map and Priority Precincts gained the `district=` scope
  (legacy `county=` deep links read-tolerated everywhere, written nowhere).
  A district scope also surfaces that district's tree-only races (the 2020
  statewide trio) with Collin rows joined to the 2026 map. Three latent
  dataLoader bugs died with the service: cached rejections, the
  string-before-manifest wrong-shape fallback, and the RFC-4180 quote bug.
  dataLoader.js is now the §5.1 compat shim for the library modules that still
  import it (precinctLookup, precinctHistory, precinctProfile, fieldOnePager,
  precinctExport — they migrate fully when Phases 4–5 touch them).

- **Phase 1** (js/lib/ extraction, urlState adoption, real-module tests, deep-links + boundary-switching specs, themeManager/chatEndpoint deletion): done.
- **Phase 2** (shared components + domain/view splits): done, with three documented deviations from the letter of the plan:
  1. **`ui/boundaryToggle.js` deferred.** The July 2026 primary-turnout refocus pinned the app to the 2026 boundary set; every boundary selector in the shipped UI is hidden. Building the toggle now would add UI the product deliberately removed. The `boundary` URL param stays in the vocabulary; the component gets built if/when a boundary choice returns (likely alongside Phase 3's per-boundary handles, which make switching instant).
  2. **The two categorization policies were homed, not merged.** `domain/races.js` now owns both `categorizeElection` (catalog policy: 6 categories, County fallback) and `categorizeRace` (history policy: + Propositions, Other fallback). They give different answers for the same filename (e.g. Courts of Appeals) and both are load-bearing; a true merge needs a product decision about which grouping wins.
  3. **`ElectionFilterManager` + `handleDropdownKeyboard` were deleted, not absorbed.** They had zero consumers outside their own tests (they served the deleted js/app monolith's dropdown); `ui/racePicker.js` was written fresh from the Map's proven menu instead.
  4. **Targets kept its cards.** `targets.html` has no `<table>` — the ranked list is rich cards. `ui/dataTable.js`'s consumers are explore (done) and the precinct history section (when its renderer next changes).

This is a first-principles redesign of the application's information architecture,
module boundaries, and navigation. The goal is **simplification, not features**:
reduce cognitive load, give every page a single responsibility, eliminate
duplicate functionality, and leave an architecture that can grow for years
without becoming another monolith.

**Locked product decisions** (confirmed with the owner, July 2026):

1. **Primary user: precinct chairs** — campaign/party field organizers, age 60+,
   on iPads. Curious citizens, journalists, and researchers are secondary
   audiences served where cheap, never at the chairs' expense. The civic-plain
   a11y layer (`js/civic.css`, 18px floor, pattern fills, glossary popovers,
   44px targets) is a keeper and is not renegotiated by this redesign.
2. **Geo scope: Collin County only — simplify hard.** The registry
   (`data/tx/counties.json`) contains exactly one county. The statewide
   narrative in older docs was aspirational; the owner chose to delete the
   statewide generality from the frontend. Districts (CD/SD/HD) survive as
   *race scoping within Collin*, not as pseudo-counties.
3. **Constraints kept on purpose:** no build step, no framework, vendored
   libraries (offline-capable in the field), Jest + Playwright, the v3 data
   contract, S3/CloudFront static hosting with an allowlist deploy.
4. **Bias:** delete and merge before abstracting.

---

## 1. Current-state analysis

### 1.1 Inventory

Seven self-contained pages, each loading one orchestrator module; ~13,500 lines
of first-party JS across 34 modules.

| Page | Orchestrator | Lines | What it actually is |
|---|---|---|---|
| `index.html` "Map" | `commandCenter.js` | 1,812 | Leaflet choropleth (Lean/Margin/Diversity/Primary), bespoke searchable county+race menus, Map/List toggle, precinct/address search + geolocate, county-briefing dock, legend, readout card, boundary switching, auth bootstrap |
| `precinct.html` "Find a Precinct" | `precinctLookup.js` | 2,266 | Address/number search → 5-tab report (guide/overview/history/people/districts), mini Leaflet map, talking points, similar precincts, print/PDF/Markdown/one-pager exports |
| `targets.html` "Priority Precincts" | `targetsPage.js` | 433 | Ranked precinct list per strategy; catalog behind one disclosure (the best-designed page) |
| `explore.html` "Browse All Data" | `explorePage.js` | 326 | Summary view + topic tabs + all-columns spreadsheet + filter builder, in one surface |
| `forecast.html` "Forecast" | `forecastPage.js` | 318 | Scenario presets + sliders → simulated outcome table (`turnoutSimulator.js`, 1,152 lines, single consumer) |
| `elections.html` "Election Results" | `electionsPage.js` | 194 | Race catalog with search + category chips; links out to map/forecast |
| `methodology.html` "How It Works" | (static) | — | Sources, reading the map, limits, privacy |

### 1.2 Who uses what

| Feature cluster | Problem it solves | Who uses it | Frequency | Verdict |
|---|---|---|---|---|
| Map + lean/margin modes | Orient in the county; see where each side is strong | Chairs, everyone | Every visit | Keep — front door |
| Precinct report + talking points + one-pager | Prep a chair to work precinct N | Chairs | Weekly in season | Keep — core value |
| Targeting strategies | Decide where to spend volunteer hours | Chairs, field directors | Weekly in season | Keep — core value |
| Raw data table | Sort/filter/export numbers | Researchers, power chairs | Occasional | Keep, single-purpose it |
| Race catalog (`elections.html`) | Find a race | Everyone | Transit page only | **Delete as a page** — it's a race picker wearing a page costume |
| Turnout forecast | "What if turnout shifts?" | Field directors, researchers | Rare, speculative | **Demote out of nav**; revisit deletion after a cycle of real usage |
| Auth gate | Restrict deployed access | Owner | Currently off | Keep dormant, isolated |

## 2. Pain points

Verified against the code (file:line), not vibes:

1. **Duplication of the same job.** County picker ×5 implementations in 3
   interaction models; race picker ×3; precinct search ×2; five hand-rolled
   table/list renderers (only index uses the shared `listView.js`); two Leaflet
   stacks (map inline in `commandCenter.js:62-336` + legend `:750-826`; mini-map
   in `precinctLookup.js:1033-1082`) with no shared map module.
2. **Duplicated primitives.** `escapeHtml` ×2 (`utils.js:96`,
   `precinctProfile.js:15`); `formatPct`/`formatNum` in 3–4 places (`utils.js`,
   `precinctProfile.js`, `turnoutSimulator.js`, inline in `commandCenter.js:68`);
   `getRaceKey` ×2 (`electionSchema.js:306`, `electionTrends.js:15`); two
   parallel election-category taxonomies (`electionFilters.js` vs
   `precinctHistory.js`).
3. **URL state anarchy.** The shared `urlStateManager.js` was deleted with the
   old monolith; six pages now hand-roll six hash schemes in two parser styles
   (`URLSearchParams` vs manual `split("&")`), with inconsistent
   omit-the-default rules. Only the map page can express
   county+race+precinct; the precinct page can't take a race; boundary is not
   deep-linkable anywhere.
4. **A global-wipe data singleton.** `dataLoader.js` holds module-level mutable
   state; `setActiveCounty`/`setActiveBoundary` wipe the whole cache
   (`clearDataCache()`), with no change events — every consumer re-fetches by
   convention. `constants.js` exports mutable `let` bindings; `utils.js`
   exports a mutable `partyColorMap` and is a grab-bag (formatters, escaping, a
   Leaflet helper, debounce, chart builders).
5. **Mixed concerns.** `turnoutSimulator.js`, `precinctHistory.js`, and
   `precinctProfile.js` mix pure computation with HTML-string generation;
   `electionFilters.js` (732 lines) is pure categorizers + a stateful
   `ElectionFilterManager` class + a DOM keyboard handler.
6. **Tests that can't fail.** `tests/utils.test.js`,
   `tests/electionFilters.test.js`, and `tests/dataLoader.test.js` test inline
   *copies* of source functions instead of importing the modules — regressions
   in the real code are invisible. E2E gaps: boundary switching, inbound
   deep-link consumption, export content.
7. **Navigation without a spine.** Flat 7-tab nav; `explore.html` has zero
   inbound links; `forecast.html` is reachable only from `elections.html`;
   `precinct.html` links out only to targets (a dead end for "back to map");
   the welcome panel names 3 of the 7 tabs.
8. **Overloaded pages.** The map page hosts county picking + race picking +
   view toggling + precinct search + geolocation + 4 analytic modes + a dock
   that is also a briefing, a race result, a precinct detail, and a link hub.
   Explore is a dashboard and a spreadsheet fighting over one surface.
9. **CSS at cross purposes.** `styles.css` pins html/body to a full-viewport
   flex map layout; three flow pages carry inline overrides to undo it; the two
   biggest pages don't load it at all.
10. **Doc drift.** CLAUDE.md and the data spec claimed 254 live counties (the
    registry has 1); ADDING_FEATURES.md documented a deleted `js/app/`
    architecture and a command palette that no longer exists; CLAUDE.md's state
    management section referenced deleted files. (Fixed in Phase 0, alongside
    this document.)
11. **Deploy toil + PII hazard.** One manual `aws s3 cp` per HTML page in the
    Makefile; the repo root contains voter PII, so the allowlist is the only
    guardrail and it's hand-maintained.
12. **Districts masquerade as counties.** `districts.json` entries are
    concatenated into the county registry and appear in county pickers, which
    forces ~40 special-case branches in `commandCenter.js` to merge "Collin at
    precinct level + other counties as aggregates" for district races.

## 3. Recommended information architecture

### 3.1 The core insight

The current 7 tabs are organized by *artifact* (map, results, forecast,
table…). A precinct chair's day is organized by three questions: **"What's my
precinct?"**, **"Where should we work?"**, and **"How do I check a number?"**
The redesign collapses to **5 pages, 5 nav tabs**, organized around those
questions, with the forecast demoted to a linked tool.

### 3.2 What changes

- **DELETE `elections.html`.** Its two real assets — the searchable race
  catalog with category chips and family grouping — become the shared **race
  picker component** used on the Map and Forecast. County-wide totals for a
  race already render in the Map's race dock. The page becomes a one-line
  redirect stub (`index.html#race=…`) for one release, then is removed.
- **DEMOTE `forecast.html`** out of the nav. It is speculative and
  single-consumer. It stays alive as an "advanced tool," linked from Priority
  Precincts ("Model a turnout scenario for this race") and How It Works.
  Revisit deletion after a cycle of real usage; spend no redesign budget on it
  beyond the domain/view split (§4).
- **RENAME** for plain language: "Browse All Data" → **Data Table**;
  "Find a Precinct" → **My Precinct**.
- **The Map stays the front door**, made chair-first:
  1. **Remembered precincts.** The precinct page persists the last precinct(s)
     viewed (`localStorage: ccd_my_precincts`, max 3). The Map and the welcome
     panel show a "Your precinct: 42 — open report" card when set. No accounts,
     no server state.
  2. **The welcome panel names all five tabs** (today it names 3 of 7) and its
     primary action becomes "Find your precinct" — the first thing every new
     chair does.

### 3.3 Navigation tree

```
Map  |  My Precinct  |  Priority Precincts  |  Data Table  |  How It Works
                        (forecast.html lives outside the nav, linked in context)
```

### 3.4 Page-by-page redesign

| Page | ONE question it answers | Primary user | Inputs (URL params) | Outputs | Actions | Links forward to |
|---|---|---|---|---|---|---|
| **Map** `index.html` | "How does each precinct lean, for this race or overall?" | Chair / organizer | `race, precinct, view (map\|list), boundary, district` | Choropleth (Lean/Margin/Diversity/Primary), legend, race dock, county briefing, precinct readout | Pick race, switch boundaries, scope to a district, search address/precinct, geolocate, toggle Map/List | Readout → **My Precinct**; briefing → **Priority Precincts**; readout → **Data Table** (row highlighted); race dock → **Forecast** |
| **My Precinct** `precinct.html` | "What do I need to know — and hand out — about precinct N?" | Chair | `precinct, tab, boundary` | Sectioned report, mini-map, talking points, canvass script, similar precincts, one-pager | Search address/number, geolocate, print, export PDF/Markdown, copy one-pager | Mini-map → **Map** centered on precinct (new back-link, closes today's dead end); similar precincts → their reports; strategy mentions → **Priority Precincts** |
| **Priority Precincts** `targets.html` | "Which precincts should we work first, under this strategy?" | Chair / field director | `strategy, boundary, district` | Ranked list with why-ranked rationale per row | Choose strategy (keep the single-disclosure design — it's the model page), export list CSV | Row → **My Precinct** and **Map**; footer → **Forecast**, **How It Works** |
| **Data Table** `explore.html` | "Give me the raw numbers to sort, filter, and export myself." | Researcher / journalist / power chair | `view (column set), sort, dir, party, boundary, precinct (highlight)` | One spreadsheet: column-set tabs + filter chips + count line. **The "Summary" mode is deleted** — it duplicated the Map's county briefing; two surfaces answering one question was the pages-fighting problem | Sort, filter, choose columns, export CSV | Row → **My Precinct**; header note → **How It Works** |
| **Forecast** `forecast.html` (not in nav) | "If turnout shifts, who wins this race?" | Field director / researcher | `race, boundary` + scenario params | Simulated outcome table, flipped-precinct list | Presets, sliders, flip rates | Flipped precincts → **Map** / **My Precinct**; race picker shared with Map |
| **How It Works** `methodology.html` | "Where do these numbers come from, and what do the words mean?" | Everyone | — | Static prose + glossary source | — | Linked from every data-quality banner and glossary popover |

### 3.5 Cross-linking rules (enforceable, testable)

1. **Shared object vocabulary.** Any page showing a precinct or race links to
   the same object on sibling pages using the shared URL vocabulary (§5.3). No
   page invents its own param names.
2. **No leaf pages.** Every page has at least one forward action. Current
   violations fixed: explore gains inbound links (Map readout, Targets footer);
   precinct gains a back-to-Map link; forecast gains outbound links for flipped
   precincts.
3. **Deep links are first-class.** Every param a page writes, it must consume
   on load (Playwright gate: `deep-links.spec.js`).
4. **County params are dead.** `#county=` is read-tolerated for old bookmarks,
   never written.

## 4. Module boundaries

### 4.1 Target directory layout (no-build vanilla ES modules)

```
js/
  lib/          zero-dependency utilities            (imports: nothing)
    format.js        formatPct, formatNumber, safeNumber, populationOf, formatPrecinctLabel
                     ← utils.js + the copies in precinctProfile/turnoutSimulator/commandCenter
    dom.js           escapeHtml, csvEscape, debounce
    urlState.js      readParams / writeParams / onChange (§5.3)  ← 6 hand-rolled hash schemes
    constants.js     PARTY_COLORS etc. — const + Object.freeze  ← mutable `let` exports die

  data/         fetch + cache + v3 contract          (imports: lib)
    catalog.js       inline Collin config: dataRoot, boundarySets, default boundary
                     ← replaces the counties.json fetch + registry machinery
    dataService.js   keyed per-boundary cache (§5.1)  ← dataLoader.js
    electionSchema.js  (moved as-is; the single home of getRaceKey)
    v3Pivot.js         (moved as-is — keeper)
    districts.js     precinct↔CD/SD/HD membership FROM THE GEOJSON PROPS
                     (`CONG`/`SEN`/`SHR` are already on every precinct feature —
                     no crosswalk needed); district race results keep loading
                     from data/tx/districts/ trees (§5.2)
    geoLookup.js       (moved as-is — keeper)

  domain/       pure computation, no fetch, no DOM   (imports: lib)
    races.js         categorize, search, filter, group; the ONE category taxonomy
                     ← electionFilters.js pure half + raceGrouping.js
                       + precinctHistory's parallel taxonomy
    metrics.js       ← precinctMetrics.js (keeper)
    targeting.js     (moved as-is — keeper)
    trends.js        ← electionTrends.js (its local getRaceKey deleted)
    history.js       ← precinctHistory.js minus the generate*HTML renderers
    simulator.js     ← turnoutSimulator.js minus its two HTML generators
    profile.js       ← precinctProfile.js pure parts
    briefing.js      ← countyBriefing.js
    talkingPoints.js (moved as-is — keeper)

  map/          the ONE Leaflet stack                (imports: lib, domain)
    mapView.js       create/destroy, choropleth layer, selection, fit, keyboard,
                     canvas/svg renderer option
                     ← commandCenter.js:62-336 + the precinctLookup mini-map
    mapStyles.js     leanFill/marginFill/diversityFill/raceFill/primaryFill
                     ← commandCenter.js:81-156
    legend.js        ← commandCenter.js:750-826
    mapBins.js, mapPatterns.js   (moved as-is — keepers; patterns are an a11y requirement)

  ui/           shared DOM components                (imports: lib, domain)
    siteNav.js, glossary.js, helpPanel.js  (moved; nav list updated)
    racePicker.js    the ONE searchable race picker with category groups + keyboard
                     ← electionsPage catalog UI + commandCenter race menu
                       + forecastPage select + ElectionFilterManager + its keyboard handler
    precinctFinder.js  address/number search + geolocate  ← the two page-local copies
    boundaryToggle.js  2024/2026 selector, writes `boundary`  ← 3 page-local versions
    listView.js      (moved as-is — row-model keeper, the Map's List view)
    dataTable.js     column-model table renderer — the ONE table; adopted by
                     explore, then targets, then the precinct history section
    reportSections.js  precinct-report HTML renderers ← precinctProfile view half
                       + precinctHistory generate*HTML
    simulatorControls.js  ← turnoutSimulator's two HTML generators

  reporting/    exports and printables               (imports: lib, domain, ui)
    export.js        print/PDF/Markdown/CSV writers  ← precinctExport.js + print/copy plumbing
    onePager.js      ← fieldOnePager.js data+template half

  auth/         quarantined                          (imports: lib only)
    auth.js, authUI.js, authConfig.js (dead chatEndpoint deleted)
    — kept, isolated, OFF; imported from exactly one place (pages/map.js)

  pages/        one controller per HTML page         (imports: anything below)
    map.js       ← commandCenter.js  (shrinks to wiring, ~400 lines)
    precinct.js  ← precinctLookup.js (shrinks similarly)
    targets.js   ← targetsPage.js
    explore.js   ← explorePage.js
    forecast.js  ← forecastPage.js

  vendor/       unchanged
  civic.css     unchanged (keeper; still loads last on every page)
```

### 4.2 Layering rules

```
pages → (ui | map | reporting) → domain → data → lib
```

- No upward imports. `lib` imports nothing. `domain` never fetches and never
  touches the DOM. `map`/`ui` never fetch — data comes in as arguments.
- Enforced with ESLint `no-restricted-imports` per directory in
  `eslint.config.js` — this replaces the unenforced "must not import js/app/*"
  guard comments, which are deleted.
- **Move policy for a no-build repo:** import paths are literal, so files are
  *not* mass-moved. New modules are born at their final path; a legacy file
  stays at `js/foo.js` re-exporting from the new location until its last
  importer migrates, then it is deleted. Every phase ends with zero broken
  imports by construction.

### 4.3 Explicit keepers (do not redesign)

`targeting.js`, `mapBins.js`/`mapPatterns.js` (a11y compliance, not
decoration), `v3Pivot.js`, the `listView.js` row-model pattern (generalized
into `ui/dataTable.js`, not replaced), `civic.css`, `geoLookup.js`, the v3 data
contract, the Jest/Playwright split, `serve.py`.

### 4.4 Auth decision

**Keep, isolated, off.** The Cognito gate is deployed infrastructure the owner
may re-enable; deleting it saves little. Rules: `auth/` is imported from
exactly one place (`pages/map.js`, behind `REQUIRE_SIGN_IN`); `siteNav`'s
sign-out button keeps its SDK-free localStorage scan; the never-called
`authConfig.chatEndpoint` is deleted in Phase 1; `themeManager.js` (17-line
light-only vestige) is deleted outright.

## 5. Data flow

### 5.1 Data service (the singleton fix)

`dataLoader.js` forces a global cache wipe on `setActiveBoundary`/
`setActiveCounty` with no change events — the root of the shared-mutable-state
pain. Replacement:

```js
// js/data/dataService.js
import { BOUNDARY_SETS, DEFAULT_BOUNDARY } from "./catalog.js";
const handles = new Map();                 // boundaryId -> handle

export function boundary(id = DEFAULT_BOUNDARY) {
  if (!handles.has(id)) handles.set(id, makeHandle(BOUNDARY_SETS[id]));
  return handles.get(id);                  // { id, label, loadAll(), listRaces(),
}                                          //   loadRace(entry), loadPrecinctRaces(code),
                                           //   loadCountyBaselines(), loadPrimaryTurnout() }
```

- Each handle memoizes its own geojson/elections/turnout/history/baselines —
  **switching boundaries is just asking for a different handle; nothing is
  wiped and the old handle stays warm** (instant switch-back, exactly what
  boundary comparison wants).
- No module-level `activeCounty`, no `setActiveCounty`, no registry fetch.
  `data/catalog.js` is ~20 lines of frozen config equivalent to today's
  Collin registry entry (inlined — one fewer fetch; the file isn't shared
  with the pipeline).
- The per-function caches already keyed by dataDir (`loadPrecinctRaces`,
  `loadTurnoutFile`, `loadCountyBaselines`) port over nearly unchanged; only
  the top-level `allData`/`elections`/`electionsList` slots become per-handle.
- The `categorizeByOffice` override in `dataLoader.js` ("non-Collin manifests
  often mislabel…") existed only for pseudo-county manifests — deleted with
  the masquerade.

### 5.2 Districts become scoping, not places

**Verified data facts that shape this design:**

- Collin's boundaries GeoJSON already carries per-precinct `CONG`/`SEN`/`SHR`
  properties — precinct→district membership needs **no crosswalk**. (The
  `crosswalks/` directory holds precinct↔block-group and old↔new precinct
  files, which are unrelated.)
- The district trees (`data/tx/districts/*/data/`) contain out-of-county
  precinct rows (hunt, rockwall, denton, dallas, and ~20 more county prefixes)
  **that exist nowhere else**, plus a few races absent from the Collin
  manifest (e.g. the 2020 statewide set in cd-3). **These trees are kept.**

What dies is the **pseudo-county masquerade**: the `districts.json`-into-
county-registry concatenation, district entries in pickers, and the ~40
district/Collin special-case branches in `commandCenter.js` that merge
"Collin at precinct level + other counties as aggregates."

What replaces it: `data/districts.js` exposes `DISTRICT_LIST` and
`precinctsInDistrict(id)` (from the GeoJSON props), and loads district race
results — including the out-of-county aggregate rows — from the district
trees when a district race or district scope is active. The Map and Targets
gain a "Limit to district" filter (`district=` param).

### 5.3 URL state (one module, one vocabulary)

`js/lib/urlState.js` — hash-based (keeps S3/CloudFront happy),
`URLSearchParams` semantics, ~50 lines. API: `readParams()`,
`writeParams(patch, {replace})` (defaults omitted by one rule), `onChange(fn)`.

| Param | Values | Used by |
|---|---|---|
| `race` | race key (`electionSchema.getRaceKey` — the surviving copy) | map, forecast |
| `precinct` | precinct code | map, precinct, explore (highlight) |
| `view` | map: `map\|list`; explore: column-set id | map, explore |
| `tab` | report section id | precinct |
| `strategy` | strategy id | targets |
| `boundary` | `2024\|2026` (omit default) | all data pages |
| `district` | `cd-3` … (omit = whole county) | map, targets |

Legacy `county=` is read-tolerated and never written. All six hand-rolled
parsers delete.

### 5.4 End-to-end flow

```
data/tx/collin/** (v3 files)         data/tx/districts/** (district races)
        │                                     │
        ▼                                     ▼
js/data/dataService.js  ◄── catalog.js   js/data/districts.js ◄── geojson props
        │  (per-boundary handles, memoized)
        ▼
js/domain/*  (pure: races, metrics, targeting, history, trends, simulator, briefing, profile)
        │
        ▼
js/map/* · js/ui/* · js/reporting/*  (render what they're handed; never fetch)
        │
        ▼
js/pages/*  (wiring: read urlState → ask data → run domain → hand to ui/map → write urlState)
```

## 6. Component hierarchy

```
Every page
└── #site-header (ui/siteNav) ── text-size toggle · help (ui/helpPanel) · welcome (Map only)
    └── glossary popovers (ui/glossary) available anywhere terms appear

Map (pages/map)
├── context strip: ui/racePicker · ui/precinctFinder · ui/boundaryToggle · view toggle
├── map/mapView ── map/mapStyles · map/legend · map/mapBins · map/mapPatterns
├── readout card (page-local, formats via lib/format, describes via mapBins.describePrecinct)
├── dock: domain/briefing → page-local renderer
└── List view: ui/listView (row model + chunked renderer)

My Precinct (pages/precinct)
├── ui/precinctFinder
├── map/mapView (mini-map — consumer #2 proves the interface)
├── ui/reportSections (sections; history tables via ui/dataTable)
│   └── domain/history · domain/profile · domain/trends · domain/talkingPoints
└── reporting/export · reporting/onePager

Priority Precincts (pages/targets)
├── strategy disclosure (page-local; the model interaction)
├── domain/targeting → ui/dataTable
└── reporting/export (CSV)

Data Table (pages/explore)
├── ui/boundaryToggle · column-set tabs · filter chips (page-local)
├── domain/metrics → ui/dataTable
└── reporting/export (CSV)

Forecast (pages/forecast)
├── ui/racePicker · ui/simulatorControls
└── domain/simulator → outcome table (ui/dataTable)
```

## 7. Technical refactoring plan & migration strategy

Each phase ships independently; the existing e2e suite must be green at every
phase boundary. New specs land *in the phase before* the code they protect
changes.

### Phase 0 — Documentation truth (done with this document)
Fix CLAUDE.md (254-county claim, state-management fiction, phantom e2e files),
rewrite `docs/ADDING_FEATURES.md` (deleted `js/app/` recipes, nonexistent
palette), fix `docs/DATA_LAYOUT_SPEC.md` registry claims. Land this document.
*Risk:* none.

### Phase 1 — Extract `js/lib/`, point tests at real modules
Create `lib/format.js`, `lib/dom.js`, `lib/urlState.js`, `lib/constants.js`
(frozen). Delete the duplicate `escapeHtml`/formatters/`getRaceKey`/taxonomy
(originals keep one-line aliases importing lib until Phase 6). Adopt
`urlState` in all six pages **preserving today's exact hash strings**
(asserted in tests). Rewrite `tests/utils.test.js`,
`tests/electionFilters.test.js`, `tests/dataLoader.test.js` to import the real
modules. Add `e2e/deep-links.spec.js` (each page consumes every param it
writes) and `e2e/boundary-switching.spec.js`. Delete `authConfig.chatEndpoint`
and `themeManager.js`.
*Risk:* low (mechanical, test-backed). *Gate:* full unit + e2e + the two new specs.

### Phase 2 — Shared components + domain/view splits
Build `ui/racePicker.js`, `ui/precinctFinder.js`, `ui/boundaryToggle.js`,
`ui/dataTable.js`; adopt one page per PR (finder into map/precinct; picker into
map/forecast; dataTable into explore first, then targets). Split HTML
generators out of `turnoutSimulator`/`precinctProfile`/`precinctHistory` into
`ui/simulatorControls.js` and `ui/reportSections.js`; `electionFilters.js`
splits into `domain/races.js` (pure) + racePicker (stateful+keyboard).
*Risk:* medium (touchpoints across pages; one page per PR).
*Gate:* command-center, precinct-lookup, precinct-tabs, targets, explore, a11y specs.

### Phase 3 — Data service, Collin-only  ← highest-risk phase
Land `data/catalog.js` + `data/dataService.js` + `data/districts.js`. Migrate
pages off `setActiveCounty`/`setActiveBoundary` one page per PR;
`dataLoader.js` becomes a re-exporting shim. **Remove all five county
pickers**; add the district scope filter to Map and Targets; delete the ~40
special-case branches and the `categorizeByOffice` override; simplify
`formatPrecinctLabel`. Sequenced after Phase 2 so pickers are already
centralized.
*Gate:* full e2e; boundary-switching spec must show old-boundary state survives
a round-trip; deep-links spec must show legacy `#county=` links don't break.

### Phase 4 — Map extraction
Extract `map/mapView.js`, `map/mapStyles.js`, `map/legend.js` from
`commandCenter.js`; move `mapBins`/`mapPatterns` into `map/`. Point the
precinct mini-map at `mapView` (the second consumer proves the interface).
`commandCenter.js` becomes `pages/map.js`, a wiring-only controller.
*Risk:* medium — pattern-fill behavior is a11y compliance and must survive.
*Gate:* command-center, list-view, a11y, precinct-lookup specs + visual pass on legend swatches.

### Phase 5 — IA changes
Fold `elections.html` into the race picker (redirect stub). Remove Forecast
from the nav; add its inbound links (Targets, How It Works) and outbound links
(flipped precincts → Map/My Precinct). Delete explore's Summary mode.
Single-source the precinct report tab structure (today duplicated between
static HTML and `getReportStructureHTML()`). New nav labels, welcome panel
(all 5 tabs + "Find your precinct" primary action), cross-links per §3.5,
remembered-precinct card. Move `styles.css`'s full-viewport lock into the map
page so the three inline undo-overrides die.
*Risk:* medium (user-visible; each item independent).
*Gate:* full e2e; update new-pages/onboarding specs in the same PRs; new nav
spec asserting no leaf pages.

### Phase 6 — Deletions and deploy
Delete outright: `elections.html` + `electionsPage.js` (stub removed), the
`dataLoader.js`/`utils.js`/`constants.js` shims, the superseded originals
(`electionFilters.js`, `raceGrouping.js`, `electionTrends.js`,
`precinctHistory.js`, `precinctProfile.js`, `turnoutSimulator.js`), the
`districts.json` registry masquerade, obsolete tests
(`countyRegistry.test.js`, `districtViewSlug.test.js` — replaced by
`districts.js` tests). **`data/tx/districts/` data trees are KEPT** (sole
source of out-of-county district rows). Rewrite `deploy-site` around a
`deploy-manifest.txt` allowlist (one path per line; the Makefile loops over
it; adding a page becomes a one-line diff). Bare `aws s3 sync .` stays
forbidden — the repo root contains voter PII.
*Risk:* low if Phases 1–5 held the shims honest — deletion is the proof the
migration finished.
*Gate:* full unit + e2e; `git grep` shows zero references to deleted modules;
a dry-run deploy lists exactly the manifest.

## 8. Feature matrix

Feature → owning module → page → shared components → data source. Every
current capability has exactly one owning module; nothing is homeless.

| # | Feature | Owning module | Page | Shared components | Data source |
|---|---|---|---|---|---|
| 1 | Choropleth lean/margin/diversity/primary modes | `map/mapStyles.js` | Map | `mapView`, `mapBins`, `mapPatterns` | `dataService.boundary().loadAll()` |
| 2 | Race-results choropleth | `map/mapStyles.js` | Map | `mapView`, `racePicker` | `loadRace()` via `v3Pivot` |
| 3 | Legend with pattern swatches | `map/legend.js` | Map | `mapBins`, `mapPatterns` | derived |
| 4 | Precinct selection + readout card | `pages/map.js` | Map | `mapView`, `lib/format` | geojson props |
| 5 | Map/List toggle (list view) | `ui/listView.js` | Map | `urlState (view)` | geojson props |
| 6 | County briefing dock | `domain/briefing.js` | Map | `lib/format` | geojson props |
| 7 | Race briefing (county totals) | `pages/map.js` | Map | `racePicker`, `lib/format` | `loadRace()` |
| 8 | Boundary switching 2024/2026 | `data/dataService.js` | Map, My Precinct, Targets, Data Table, Forecast | `ui/boundaryToggle`, `urlState (boundary)` | `data/catalog.js` |
| 9 | District scoping (CD/SD/HD) | `data/districts.js` | Map, Targets | `urlState (district)` | geojson `CONG`/`SEN`/`SHR` props |
| 10 | District race results (incl. out-of-county rows) | `data/districts.js` | Map | `mapView` | `data/tx/districts/` trees |
| 11 | Address search + geolocate | `data/geoLookup.js` | Map, My Precinct | `ui/precinctFinder` | Nominatim + geojson |
| 12 | Precinct-number search | `ui/precinctFinder.js` | Map, My Precinct | — | geojson props |
| 13 | Race catalog search/categories | `domain/races.js` | Map, Forecast | `ui/racePicker` | `listRaces()` manifest |
| 14 | Deep links / shareable URLs | `lib/urlState.js` | all | — | — |
| 15 | Precinct report sections | `pages/precinct.js` | My Precinct | `ui/reportSections`, `ui/dataTable` | `loadPrecinctRaces()`, profile extras |
| 16 | Precinct mini-map | `map/mapView.js` | My Precinct | — | geojson |
| 17 | Voting history table | `domain/history.js` | My Precinct | `ui/reportSections`, `ui/dataTable` | `loadPrecinctRaces()` |
| 18 | PVI / county baseline comparison | `domain/history.js` | My Precinct | — | `loadCountyBaselines()` |
| 19 | Trend arrows / deltas | `domain/trends.js` | My Precinct, Map | `lib/format` | `loadRace()` pairs |
| 20 | Takeaways ("what this means") | `domain/profile.js` | My Precinct | `ui/reportSections` | merged props |
| 21 | Talking points + canvass script | `domain/talkingPoints.js` | My Precinct | `ui/reportSections` | derived signature |
| 22 | Similar precincts | `domain/history.js` | My Precinct | — | geojson props |
| 23 | Field one-pager (print/copy) | `reporting/onePager.js` | My Precinct | `reporting/export` | `loadPrecinctRaces()` + profile |
| 24 | PDF / Markdown export | `reporting/export.js` | My Precinct | `lib/dom (csvEscape)` | report data |
| 25 | Remembered "my precinct" | `pages/precinct.js` | My Precinct, Map | localStorage | — |
| 26 | Targeting strategies + rationale | `domain/targeting.js` | Priority Precincts | — | geojson + turnout + primary lookups |
| 27 | Ranked precinct list | `pages/targets.js` | Priority Precincts | `ui/dataTable`, `urlState (strategy)` | `rankPrecincts()` |
| 28 | Targets CSV export | `reporting/export.js` | Priority Precincts | `lib/dom` | ranked rows |
| 29 | Data grid: column sets, sort, filter chips | `domain/metrics.js` | Data Table | `ui/dataTable`, `urlState` | `buildRecords()` |
| 30 | Data grid CSV export | `reporting/export.js` | Data Table | `lib/dom` | records |
| 31 | Turnout/flip simulation | `domain/simulator.js` | Forecast | `ui/simulatorControls`, `racePicker` | `loadRace()` + lean lookup |
| 32 | Scenario presets | `pages/forecast.js` | Forecast | `ui/simulatorControls` | static config |
| 33 | Primary-turnout overlay/metrics | `data/dataService.js` | Map, Targets, My Precinct | — | `profile/primary_turnout` data |
| 34 | Glossary popovers | `ui/glossary.js` | all | — | static terms |
| 35 | Help panel, text-size toggle, welcome | `ui/siteNav.js`, `ui/helpPanel.js` | all | — | localStorage |
| 36 | Auth gate (dormant) | `auth/*` | Map only | — | Cognito |
| 37 | v3 manifest + pivot contract | `data/electionSchema.js`, `data/v3Pivot.js` | all data pages | — | `elections.json`, race/turnout CSVs |

---

## Appendix: what was deliberately NOT done

- **No framework, no build step introduced.** The no-build constraint is a
  feature for this team (offline field use, zero toolchain, trivially
  debuggable). The layered directory structure + ESLint import rules give the
  discipline a bundler would, without the bundler.
- **Statewide generality removed, not "kept just in case."** The v3 data
  contract and the Python pipeline remain county-agnostic, so a future
  statewide push re-enters through the *data* layer (a registry + a county
  param in `catalog.js`), not by resurrecting five county pickers.
- **Forecast not deleted yet.** It's demoted, isolated behind
  `domain/simulator.js` + one page controller, and cheap to remove later if a
  season of usage shows nobody opens it.
