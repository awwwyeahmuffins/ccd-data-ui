# Adding Features — The Playbook

**Last Updated**: July 2, 2026

This is the recipe book for extending the app as it exists **today**. Before
using it, read `docs/REDESIGN.md` — a simplification redesign is approved
(target module layout, 5-page IA, migration phases 0–6). New work should land
on the target architecture where a phase has shipped, and should at minimum
avoid deepening the problems the redesign deletes (new county pickers, new
hash schemes, new formatter copies, HTML generation inside domain logic).

> Historical note: earlier versions of this playbook documented the `js/app/`
> monolith (state.js, viewMode.js, commandPalette.js, …) and a ⌘K command
> palette. All of that was deleted in June 2026 — recover from git history if
> ever needed. There is no command palette in the current app.

---

## Architecture in 90 seconds

Seven self-contained pages, no build step, no framework. Each HTML page loads
ONE orchestrator module from `js/`; pages never import each other's
orchestrators; everything else in `js/` is a shared library module.

| Page | Orchestrator | Nav label |
|------|-------------|-----------|
| `index.html` | `js/commandCenter.js` | Map (front door; map, list view, dock, auth bootstrap) |
| `precinct.html` | `js/precinctLookup.js` | Find a Precinct (tabbed report + exports) |
| `elections.html` | `js/electionsPage.js` | Election Results (race catalog — slated to fold into a shared race picker, REDESIGN.md §3.2) |
| `forecast.html` | `js/forecastPage.js` | Forecast (turnout simulator) |
| `targets.html` | `js/targetsPage.js` | Priority Precincts (strategy ranking) |
| `explore.html` | `js/explorePage.js` | Browse All Data (metric grid) |
| `methodology.html` | (static) | How It Works |

**Data flow (all pages):** `data/tx/...` v3 files → `js/dataLoader.js`
(fetch + in-memory cache; `js/v3Pivot.js` pivots race+turnout to the legacy
row shape) → the page orchestrator's module-level state object → page-local
renderers.

**State lives per page.** Each orchestrator keeps a module-level state object
(`cc` in commandCenter.js, `state` in precinctLookup.js, …). The one shared
mutable singleton is `dataLoader.js` (`activeCounty`/`activeBoundary` + cache;
`setActiveBoundary` wipes the cache — re-fetch after switching). URL hash
state is currently hand-rolled per page; don't invent a seventh scheme — reuse
the page's existing read/write helpers (a shared `lib/urlState.js` arrives in
REDESIGN.md Phase 1).

**Shared chrome on every page:** `<header id="site-header">` +
`js/siteNav.js` (header, text-size toggle, welcome panel on index) +
`js/civic.css` loaded LAST (the a11y layer must win by source order) +
`js/glossary.js` / `js/helpPanel.js`.

---

## Recipe A — Add a new map color mode (index.html)

Existing modes: Lean / Margin / Diversity / Primary (`data-mode` buttons).

1. **Button**: add a `data-mode` button next to the others in index.html's
   mode row.
2. **Fill function**: add a `yourModeFill(feature)` in `js/commandCenter.js`
   next to `leanFill`/`marginFill`/etc., and a case in `fillFor()`. Bin numeric
   values through `js/mapBins.js` (named bins) — never invent ad-hoc ranges.
3. **Pattern pairing**: every fill needs an SVG pattern from
   `js/mapPatterns.js` — color-alone encodings are an a11y violation
   (enforced by e2e/a11y.spec.js).
4. **Legend**: extend the legend builder in commandCenter.js so the mode gets
   labeled swatches (color + pattern) on the solid backplate.
5. **Plain language**: if the mode surfaces a new value, wire it through
   `describePrecinct()` in `js/mapBins.js` so the polygon aria-label, tap
   readout card, and List view all say the same thing.
6. **Tests**: e2e — click the mode button, assert the legend content changes
   (`e2e/command-center.spec.js` has the pattern); a11y spec must stay green.

## Recipe B — Add a section to the precinct report (precinct.html)

1. **Renderer**: add a `renderYourSection(precinct)` in `js/precinctLookup.js`
   near the other `render*` functions; return an HTML string built with
   `escapeHtml()` for ALL interpolated data.
2. **Tab placement**: the report is 5 flat tabs (guide / overview / history /
   people / districts). The tab structure is currently duplicated between the
   static HTML in precinct.html and `getReportStructureHTML()` in
   precinctLookup.js — **update both** (single-sourcing is REDESIGN.md
   Phase 5).
3. **Print/export**: printing always prints the whole report; check
   `js/precinctExport.js` and `js/fieldOnePager.js` — if your section belongs
   in the markdown export or the one-pager, extend those too.
4. **Tests**: `e2e/precinct-tabs.spec.js` has the tab/deep-link patterns.

## Recipe C — Add a new data source (CSV / GeoJSON / lookup)

1. **Spec first**: if it's election-shaped data, conform to
   `docs/DATA_LAYOUT_SPEC.md`. Pipeline scripts live in `data_processor/`.
2. **Loader**: add a `loadYourData()` to `js/dataLoader.js`, following the
   existing fetch + in-memory cache pattern. Respect the active boundary set
   (`getBoundaryConfigs()` / the entry's `dataDir`) if the data is
   per-boundary.
3. **Schema/validation**: if rows need validation, extend
   `js/electionSchema.js`.
4. **Consume**: load it in the page orchestrator's init/load block and stash
   it on that page's state object.
5. **Participation gotcha**: election CSVs contain ALL precincts regardless of
   race scope. Non-participating precincts still show county-wide
   `BALLOTS CAST TOTAL > 0` — check candidate votes, not ballots cast, to
   decide participation.
6. **Manifest**: new elections are added to the v3 manifest by the pipeline
   (`data_processor/`), never by hand.
7. **Honest gaps**: absent optional data (profile extras) must render N/A —
   never fabricate.

## Recipe D — Add a page

Strongly reconsider first: the approved redesign *reduces* the page count to 5
(REDESIGN.md §3). If the feature is real, it probably belongs on an existing
page. If a new page is truly warranted:

1. New `your-page.html` with the `#site-header` placeholder, `js/siteNav.js`,
   `js/civic.css` loaded last, and the d3 vendor script.
2. One new orchestrator `js/yourPage.js`; import only library modules, never
   another page's orchestrator.
3. If you load `styles.css`, add the inline override that restores normal
   document flow (it pins html/body to a full-viewport flex map layout — see
   the comment blocks in elections/forecast/targets.html).
4. Add the page to `js/siteNav.js`'s nav list AND to the `deploy-site`
   allowlist in the Makefile (a page missing from the allowlist silently never
   deploys).
5. Add an e2e smoke spec and include the page in `e2e/a11y.spec.js`'s page
   list.

## Recipe E — Persona-aware chrome (July 2026)

The app is growing toward three personas — `public` (default), `chair`
("Simple View"), `campaign` ("Detailed View"). Public and chair still get the
identical public app; the campaign persona has the first real persona view —
the Campaign Dashboard (`campaign.html` → `js/campaignPage.js`), surfaced as a
sixth nav tab via its `navPages` hook. The page never gates on persona: a
direct URL works for anyone, the tab is just discoverability.

- **State** lives in `js/lib/persona.js`: resolution is URL `#persona=` >
  localStorage `ccd_persona` > `"public"`. The URL param is an ENTRY
  param — consumed once at load, persisted, **never written back** (pages'
  `updateURL()` calls rebuild the whole hash, so it couldn't survive anyway;
  same rule as legacy `county=`). Don't "fix" `writeParams` to preserve it.
- **The resolved persona** is stamped as `html[data-persona="…"]` by
  `js/siteNav.js` at module load, before paint (same pattern as
  `html.text-large`). Scope future persona CSS off that attribute.
- **Layout wrappers** live in `js/ui/personaLayouts.js` — an id-keyed
  registry, one entry per persona, with `navPages(pages)` (which tabs) and
  `renderChromeExtras(headerEl)` (extra header chrome) hooks that siteNav
  consults. `campaign.navPages` appends the Campaign Dashboard tab; everything
  else is identity/no-op. When a persona's chrome truly diverges further, grow
  its entry (or split it into its own module) rather than branching inside
  siteNav.
- **Switching personas reloads the page.** Orchestrators render once at
  `init()` and never subscribe to hash changes; a reload is the honest way to
  re-enter with different chrome. (A future live switch would adopt
  `urlState.onChange`, which exists and is unused.)
- **The dev toggle** (`#nav-persona` select in the header) renders only when
  dev tools are armed: visit any page with `#dev=1` (persists `ccd_dev_tools`),
  disarm with `#dev=0`. It must keep meeting the civic-plain rules — it ships
  to production, just hidden behind the flag.
- **Tests**: `tests/persona.test.js` (resolution), the persona describes in
  `tests/siteNav.test.js` (chrome), `e2e/persona.spec.js` (toggle, persistence,
  its own axe pass — `a11y.spec.js` never sees dev-only chrome), and the
  `persona=` describe in `e2e/deep-links.spec.js`.

---

## Conventions (apply to every recipe)

- **Escaping**: any string that reaches `innerHTML` goes through
  `escapeHtml()`; anything written to CSV goes through `csvEscape()`. Both
  live in `js/utils.js`. No exceptions — this codebase has been burned by XSS
  and CSV formula injection before (see `docs/SECURITY_AUDIT.md`).
  (`precinctProfile.js` has a second `escapeHtml` copy; it dies in REDESIGN.md
  Phase 1 — don't add a third.)
- **Party colors are data encodings** — locked in `js/constants.js`
  (`PARTY_COLORS`). Never restyle them; `tests/cssVariables.test.js` pins the
  design-token hexes too.
- **Civic-plain rules are hard requirements**: 18px minimum text, 44px hit
  targets, no hover-only affordances, no color-alone encodings (pair fills
  with `mapPatterns`), no translucent backplates behind map text, no
  `maximum-scale` viewport locks. Light theme only — dark mode was retired.
  `e2e/a11y.spec.js` fails the build on critical/serious axe violations.
- **CSS**: use the existing CSS variables; `js/civic.css` always loads last.
  Page-specific styles live in that page's `<style>` block.
- **Mobile/iPad**: test at 390px wide and iPad sizes; the primary users are
  60+ chairs on iPads.
- **No new globals**: features hang off the page's state object; pure helper
  logic goes in a `js/` library module so it's unit-testable — and unit tests
  must IMPORT the module (several legacy tests assert inline copies; never add
  another).
- **Geocoding**: use `js/geoLookup.js` (Nominatim). The US Census geocoder is
  CORS-blocked in browsers — don't switch back.

## Verify checklist (run before calling a feature done)

```bash
make lint                 # ESLint — errors fail
node --experimental-vm-modules node_modules/jest/bin/jest.js   # unit tests
npx playwright test --workers=2 --project=chromium             # e2e (server must be on :3000)
```

E2E gotchas that look like your bug but aren't:

- The welcome panel shows once per browser profile (`ccd_welcome_seen` in
  localStorage); dismiss via the `.welcome-dismiss` button or Escape.
- Wait for the map/legend to render before interacting with precinct polygons.
- `test.setTimeout(60000)` — the Python dev server is slow under parallel
  load; run with `--workers=2`.

## Deploying

`make deploy-site` (allowlist-only S3 sync — never bare `aws s3 sync .`; the
repo root contains voter PII). Infra changes: `make cdk-diff` then
`make cdk-deploy`. AWS profile `ccd`, region us-east-1 — always.

---

## Appendix — Producing v3 data for another county (pipeline only)

**The frontend is Collin-only by decision** (REDESIGN.md, July 2026): the
registry contains one county, and the redesign removes county pickers rather
than generalizing them. The Python pipeline, however, remains county-agnostic.
If statewide ever returns, it re-enters through the data layer (a registry +
county param in the data service), not by resurrecting per-page pickers.

To produce v3 data for a county (output is not consumed by this frontend
today):

1. **Results** — run the ETL on an OpenElections precinct file
   (https://github.com/openelections/openelections-data-tx):
   ```bash
   python3 data_processor/tx_etl.py \
     https://raw.githubusercontent.com/openelections/openelections-data-tx/master/2022/counties/20221108__tx__general__<county>__precinct.csv \
     --county <slug>
   ```
   Writes v3 races/turnout/manifest per `docs/DATA_LAYOUT_SPEC.md`. Missing
   turnout = no turnout file = N/A.
2. **Boundaries** — election-vintage TLC VTDs (NOT Census VTDs — counties
   redraw between censuses):
   ```bash
   python3 data_processor/fetch_vtd_geojson.py --county <slug> --set <year> --validate
   ```
   **Hard gate: 100% of vote-bearing precincts must match** the boundary join,
   or the data doesn't ship. Never fabricate data; never weaken a gate.
3. **Batch + audit gates** — `data_processor/batch_import.py` runs the scaled
   three-gate version (ETL → canvass audit against MEDSL-2022/VEST-2020
   official datasets → TLC boundary join); `data_processor/derive_profiles.py`
   fills vote-derived profile estimates. Per-county outcomes are recorded in
   an audit report by the pipeline. Fix the data, never the gate.
