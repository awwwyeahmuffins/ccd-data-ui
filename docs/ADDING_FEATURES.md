# Adding Features — The Playbook

**Last Updated**: June 11, 2026

This is the repeatable recipe book for extending the app. Follow the recipe that
matches your feature; each one lists every file you touch, in order. If your
feature doesn't fit any recipe, read "Architecture in 90 seconds" and the
"Conventions" section, then model your change on the closest existing feature.

---

## Architecture in 90 seconds

Two self-contained pages, no build step, no framework:

| Page | Orchestrator | What it owns |
|------|-------------|--------------|
| `index.html` (map viewer) | `js/app/main.js` + the other `js/app/` modules | all map-app state, view switching, panels, map rendering |
| `precinct.html` (lookup/report) | `js/precinctLookup.js` | search, report rendering, export |

Root-level `js/` modules are **libraries** — pure-ish functions consumed by the
two orchestrators. They never hold page state and never reach into each other's
DOM. The map app itself lives in `js/app/`:

| Module | Owns |
|--------|------|
| `state.js` | THE shared mutable state object — import it, never copy it |
| `main.js` | entry point: initializeMap, init(), auth-gated startup |
| `viewMode.js` | `setViewMode()` (the ONLY view-flip path) + map toolbar |
| `mapRendering.js` | the 5 render paths + legend |
| `precinctPanel.js` | precinct click, info card, profile panel, (disabled) chat |
| `search.js` | precinct search widget |
| `panels.js` | election panel toggle, FAB, forecast button, mobile tabs, ranker |
| `electionPanel.js` | Browse/Forecast/Saved panel rendering, recently viewed |
| `electionWorkflow.js` | loadElections, selectElection, URL deep-link sync |
| `boundary.js` | 2024↔2026 boundary switching + changes panel |
| `uiChrome.js` | toasts, breadcrumbs, welcome overlay, header collapse |
| `commandPalette.js` | ⌘K palette + global shortcuts (side-effect import) |

**Two invariants** (both documented in main.js):
1. A `js/app/` module must never CALL an imported binding at module top level —
   top-level code may only declare, grab DOM elements, and register listeners
   with locally defined handlers. The function-level import cycles
   (viewMode↔panels, electionPanel↔electionWorkflow) are safe only under this rule.
2. `init()` can run twice on the deployed auth path. Listeners registered at
   module top level run once; listeners registered inside `init()`/`initX()`
   helpers re-register. Don't move registrations between the two.

**Data flow (map page):**
`data/elections.json` (manifest) → `dataLoader.js` (fetch + cache) →
`state.*` (js/app/state.js) → render functions in `mapRendering.js` → Leaflet layers.

**State lives in exactly two places:**
- `js/app/state.js`: the map app's single `state` object.
- precinctLookup.js: a module-level `state` object at the top of the file.

Everything else (URL hash, localStorage) is derived/synced, never authoritative.

---

## Recipe A — Add a new map view mode

Example existing modes: `demographics`, `election`, `turnout`.

1. **Button**: add a `<button class="view-mode-btn" data-view="yourmode">` to
   the `.view-mode-buttons` nav in index.html's header markup.
2. **Renderer**: write `renderYourModeMap()` in `js/app/mapRendering.js` next
   to the other render functions. It should style `state.geojsonLayer`
   features and call `updateMapLegend()`.
3. **Switch**: add a case to `setViewMode()` in `js/app/viewMode.js`.
   That function is the ONLY place that flips views — don't add side channels.
4. **Legend**: extend `updateMapLegend()` (mapRendering.js) for your mode's legend HTML.
5. **Toolbar** (optional): extend `updateMapViewControls(mode)` (viewMode.js)
   if the mode needs its own sub-controls (see how demographics adds the
   Party Lean / heatmap selector toolbar).
6. **Command palette**: add an entry to `buildCommands()` in
   `js/app/commandPalette.js` so the mode is reachable via ⌘K.
7. **Breadcrumb label**: add your mode to `viewLabels` in
   `updateBreadcrumbs()` (js/app/uiChrome.js).
8. **Tests**: e2e — click `[data-view="yourmode"]`, assert
   `.map-legend-leaflet` content changes. See `e2e/core-functionality.spec.js`.

## Recipe B — Add a new panel (slide-in like Browse / profile / ranker)

1. **Markup**: add `<div id="your-panel" class="...">` near the other panels in
   index.html. Give every interactive child an `id` or `data-action`.
2. **Z-index**: pick per the layering map — header 10000, election panel 10001,
   mobile tab bar 10001, profile 10002, ranker 10003. Slot yours deliberately;
   document it in a comment next to the z-index.
3. **Single-active-panel rule**: add your panel id to `PANEL_IDS` and use
   `closeAllPanels()` (js/app/uiChrome.js) so opening yours closes the others.
   Do not hand-roll visibility toggling. Put your open/close functions in
   `js/app/panels.js` (or a new js/app module if it's substantial).
4. **Open triggers**: header button and/or command-palette entry
   (commandPalette.js) and/or mobile tab bar (panels.js).
5. **Escape + click-outside**: add your panel to the Escape stack in the
   global keydown handler in `js/app/commandPalette.js` rather than adding a
   new listener.
6. **Tests**: e2e — open, assert visible, press Escape, assert closed. On
   mobile viewports remember the FAB is hidden ≤1024px; open via tab bar
   `[data-action="..."]`.

## Recipe C — Add a new data source (CSV / GeoJSON / lookup)

1. **Spec first**: if it's election-shaped data, conform to
   `docs/DATA_LAYOUT_SPEC.md`. Pipeline scripts live in `data_processor/`.
2. **Loader**: add a `loadYourData()` to `js/dataLoader.js`, following the
   existing fetch + in-memory cache pattern. Respect `getActiveBoundary()` if
   the data is per-boundary (2024 vs 2026 files live in `data/` vs `data/2026/`).
3. **Schema/validation**: if rows need validation, extend `js/electionSchema.js`.
4. **Consume**: stash on `state.yourData` during `initializeMap()`'s
   `loadAllData()` block (js/app/main.js) or `loadData()` (precinctLookup.js).
5. **Participation gotcha**: election CSVs contain ALL precincts regardless of
   race scope. Non-participating precincts still show county-wide
   `BALLOTS CAST TOTAL > 0` — check candidate votes, not ballots cast, to
   decide participation (see `precinctHasCandidateVotes()` in js/app/mapRendering.js).
6. **Manifest**: new elections must be added to `data/elections.json` via
   `data_processor/manifest_generator.py`, never by hand.

## Recipe D — Add a command-palette command

1. Find the commands array in `buildCommands()` in `js/app/commandPalette.js`.
2. Add `{ label, hint, action }` — action is a closure over existing functions.
   Keep actions one-liners that call named functions; don't inline logic.
3. e2e: `e2e/command-palette.spec.js` has the pattern (⌘K, type, Enter, assert).

## Recipe E — Add a section to the precinct report (precinct.html)

1. **Renderer**: add a `renderYourSection(precinct)` in `js/precinctLookup.js`
   near the other `render*` functions; return an HTML string built with
   `escapeHtml()` for ALL interpolated data.
2. **Compose**: call it from the main report-render function in DOM order.
3. **Print/export**: check `js/precinctExport.js` and `js/fieldOnePager.js` —
   if your section belongs in the one-pager or CSV export, extend those too.
4. **Styles**: precinct.html keeps its page-specific styles in its own
   `<style>` block; shared tokens come from `styles.css` CSS variables.

---

## Conventions (apply to every recipe)

- **Escaping**: any string that reaches `innerHTML` goes through
  `escapeHtml()`; anything written to CSV goes through `csvEscape()`. Both live
  in `js/utils.js`. No exceptions — this codebase has been burned by XSS and
  CSV formula injection before (see `docs/SECURITY_AUDIT.md`).
- **Party colors are data encodings** — locked in `js/constants.js`
  (`PARTY_COLORS`). Never restyle them; `tests/cssVariables.test.js` pins the
  design-token hexes too.
- **CSS**: use the existing CSS variables (`--primary`, `--bg-secondary`,
  `--radius-md`, …). Page-wide styles go in `styles.css`; index-only styles in
  index.html's `<style>`. Dark mode = `[data-theme="dark"]` overrides — add one
  for any new surface you create.
- **Mobile**: the tab bar shows ≤1024px. Hit targets ≥44px. Test at 390px wide.
- **No new globals**: features hang off the page `state` object; helper logic
  that is pure goes in a `js/` module so it's unit-testable.
- **Geocoding**: use `js/geoLookup.js` (Nominatim). The US Census geocoder is
  CORS-blocked in browsers — don't switch back.

## Verify checklist (run before calling a feature done)

```bash
make lint                 # ESLint — errors fail
node --experimental-vm-modules node_modules/jest/bin/jest.js   # unit tests
npx playwright test --workers=2 --project=chromium             # e2e (server must be on :3000)
```

E2E gotchas that look like your bug but aren't:
- Election groups in the browse panel are collapsed by default — click
  `.group-header` or type in `#panel-search-input` before clicking `.election-item`.
- Selecting an election auto-switches the panel to the Forecast tab.
- Wait for `.map-legend-leaflet` to know the map finished initializing.
- `test.setTimeout(60000)` — the Python dev server is slow under parallel load.
- Welcome overlay shows once per browser profile (`ccd_welcome_seen` in
  localStorage); dismiss with `#welcome-close-btn` or Escape.

## Deploying

`make deploy-site` (allowlist-only S3 sync — never bare `aws s3 sync .`; the
repo root contains voter PII). Infra changes: `make cdk-diff` then
`make cdk-deploy`. AWS profile `ccd`, region us-east-1 — always.
