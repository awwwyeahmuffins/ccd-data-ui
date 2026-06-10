# UX Research Findings: Collin County Election Data Viewer

## Research Methodology
Two empathy interviews were conducted with simulated user personas representing the tool's primary audience segments. Each researcher independently explored the full application codebase (`index.html`, JS modules, CSS) and walked through the tool from the persona's perspective, documenting pain points, workflow friction, and improvement opportunities.

---

## User Personas

### Persona 1: Carlos Rivera
- **Age:** 34
- **Role:** Campaign field director for a county commissioner race in Collin County
- **Usage:** 3-4 times per week on laptop; occasionally on phone while canvassing
- **Tech skill:** Moderate (Google Sheets, not a developer)
- **Primary goal:** Identify which precincts to focus canvassing efforts on
- **Researcher:** Alex (UX Designer)

### Persona 2: Priya Patel
- **Age:** 28
- **Role:** Political data analyst at a PAC (Political Action Committee)
- **Usage:** Daily, exclusively desktop with dual monitors
- **Tech skill:** High (Python, SQL, Tableau)
- **Primary goal:** Compare elections across years, model turnout scenarios, produce reports for PAC leadership
- **Researcher:** Jordan (Product Manager)

---

## Consolidated Pain Points (Prioritized)

### CRITICAL -- Blocks core workflows or causes user abandonment

| # | Pain Point | Personas Affected | Details |
|---|-----------|-------------------|---------|
| C1 | **Mobile view mode buttons disappear entirely below 600px** | Carlos | The Demographics/Elections/Turnout view switcher has `display: none` at 600px. Carlos cannot switch views on mobile at all. Core navigation is broken. |
| C2 | **Notifications are console-only** | Both | `showNotification()` only calls `console.log()`. Users receive zero visual feedback when actions fail or require prerequisites. Switching to Election view without selecting an election does nothing visible. |
| C3 | **FAB "+" icon is misleading** | Carlos | The "+" universally means "create/add new." It actually opens the election browser. Incorrect mental model for non-technical users. |
| C4 | **"Hide" header button has no return mechanism** | Carlos | Clicking "Hide" collapses the header off-screen. No visible toggle, tab, or gesture to restore it. User loses access to view modes, search, browse, forecast, and theme toggle. |
| C5 | **Color-only map information** | Both | Map relies entirely on color to convey party affiliation and margins. No pattern fills, crosshatching, or text labels. Fails WCAG for color vision deficiency. |
| C6 | **No tabular data view** | Priya | Power users need to see all 330 precincts at once in a sortable grid/table. The only way to view precinct data is clicking one-at-a-time on the map. |
| C7 | **No election-over-election comparison** | Priya | Trend/swing analysis (e.g., President 2024 vs 2020 delta map) is the core PAC workflow. `electionTrends.js` and `precinctHistory.js` modules exist but are never surfaced in the UI. |
| C8 | **Export functionality mostly unwired** | Both | `exportManager.js` has complete export capabilities (race results, precinct history, filtered results, export dropdown UI) but only the competitive ranker CSV export is actually wired up in the HTML. Carlos and Priya both need to export data regularly. |

### HIGH -- Significant friction that degrades experience

| # | Pain Point | Personas Affected | Details |
|---|-----------|-------------------|---------|
| H1 | **Filter chips are mutually exclusive** | Priya | Cannot combine year + category (e.g., "2024 Federal"). Clicking Federal drops the 2024 year filter. OR logic instead of AND logic. |
| H2 | **No onboarding or empty-state guidance** | Carlos | First-time users see a map with no welcome message, tutorial, or "getting started" guidance. No explanation of what the colors mean beyond a small legend. |
| H3 | **Three separate search mechanisms** | Carlos | Precinct search (bottom-left), panel search (election panel), and command palette (Cmd+K) all do different things. Cognitive overload for moderate-skill users. |
| H4 | **Header z-index covers zoom controls on mobile** | Carlos | Header z-index 10000 covers Leaflet zoom controls on mobile devices. Zoom buttons cannot be clicked. |
| H5 | **Election panel information overload** | Both | Panel contains: search, 6 filter chips, forecast section with sliders, bookmarks, recently viewed, and ALL election groups (100+ races). Requires extensive scrolling. |
| H6 | **No loading states visible** | Both | `skeletonLoader.js` and loading CSS classes exist but are never used. Switching elections shows no spinner or progress indicator. Census data loads in background with no indication. |
| H7 | **No multi-precinct comparison** | Priya | Single-select only. Cannot compare two precincts side-by-side. |
| H8 | **No scenario save/compare in forecast** | Priya | Turnout simulator cannot save named scenarios or compare "Optimistic" vs "Pessimistic" models. |
| H9 | **No simulation results export** | Priya | Cannot download per-precinct simulated outcomes to bring into external models. |
| H10 | **URL state incomplete** | Priya | Only preserves selected race. Does not preserve: view mode, selected precinct, zoom/center, simulation sliders, or filter state. Cannot share a specific analysis state. |
| H11 | **Silent failure on Election view without selection** | Carlos | Switching to "Election" view mode without selecting an election first does nothing visible. Only logs to console. |

### MEDIUM -- Quality-of-life issues that cause friction

| # | Pain Point | Personas Affected | Details |
|---|-----------|-------------------|---------|
| M1 | **Minimal precinct click data** | Carlos | Info card shows party counts but no spatial context (city, commissioner precinct, school district). Profile panel opens simultaneously but isn't obviously connected. |
| M2 | **No overview/dashboard** | Carlos | No summary view showing total vote count, winner margin, overall turnout for a race across the whole county. |
| M3 | **Two panels open simultaneously on precinct click** | Carlos | Clicking a precinct opens both the info card AND the profile panel. Overwhelming for moderate-skill users. |
| M4 | **No collapse/expand affordance on election groups** | Carlos | Group headers are clickable to expand/collapse but have no chevron or +/- icon. The `group-toggle` button CSS exists but is never rendered. |
| M5 | **Info card repositioning when panel opens** | Both | Info card jumps from bottom-right (360px) to bottom-left (280px) when election panel opens. Jarring and data gets truncated. |
| M6 | **ARIA and focus management gaps** | Carlos | FAB doesn't update aria-label when toggling. Filter chips lack `role`/`aria-pressed`. Focus not trapped in open panels. Emoji icons read poorly by screen readers. |
| M7 | **No data provenance/attribution** | Priya | No visible data sourcing or vintage information. Analysts need to cite sources in reports. |
| M8 | **Map lacks data labels** | Priya | No vote share percentages displayed on precincts. Only solid color blocks. |
| M9 | **`keyboardShortcuts.js` module unused** | Priya | Only Cmd+K and Escape work. Module exists with more shortcuts but is not imported. |
| M10 | **Competitive ranker not configurable** | Priya | Fixed top-25 limit. No custom margin threshold, turnout threshold, or demographic filters. |
| M11 | **Floating map view controls feel disconnected** | Carlos | Winner/Margin/Swing Precincts buttons float at top-left over the map with no container or visual grouping. |
| M12 | **Redundant panel entry points** | Carlos | FAB, "Browse" header button, and "Forecast" button all open the same panel. Confusing. |

### LOW -- Polish items

| # | Pain Point | Personas Affected | Details |
|---|-----------|-------------------|---------|
| L1 | **Turnout simulator complexity** | Carlos | Sliders with 1% granularity (50-150%) are too fine for non-technical users who think in broad terms. |
| L2 | **Dark mode legend has hardcoded white background** | Priya | JavaScript-generated legend HTML uses inline `background: white` that doesn't adapt to dark theme. |
| L3 | **Small touch targets for bookmark stars** | Carlos | Bookmark stars have `padding: 2px 4px`, well below WCAG 48x48px minimum for touch. |
| L4 | **Flipped precinct visual too subtle** | Priya | Thick border (weight: 3) on flipped precincts is barely visible at county zoom level. |
| L5 | **No share/screenshot export** | Priya | No built-in image capture for presentations. |
| L6 | **Command palette is name-search only** | Priya | Cannot query by data criteria (e.g., "precincts where Dem > 60%"). |
| L7 | **Precinct search widget may overlap FAB on mobile** | Carlos | Positioned at bottom: 90px while FAB is at bottom: 24px. |

---

## Moments of Delight

Both personas identified positive aspects of the tool:

1. **Cmd+K command palette** -- Modern, discoverable, searches elections AND precincts. Power users love it.
2. **Competitive ranker with CSV export** -- Immediately actionable for field organizers. Shows margin, demographics, and party lean.
3. **Precinct profile panel** -- Rich data including racial demographics, party affiliation breakdown, and district officials.
4. **Dark mode support** -- Appreciated by daily users, especially analysts working late.
5. **URL deep linking** -- Even though incomplete, the ability to share a race link is valued.
6. **Turnout simulator concept** -- The idea of modeling turnout scenarios is exactly what PAC analysts need.
7. **Bookmark system** -- Quick way to save frequently accessed races.
8. **Filter chips in election panel** -- When they work (single filter), they're fast and intuitive.

---

## Implementation Plan

Based on the findings above, we recommend splitting implementation work between two UI engineers, organized by domain expertise.

### UI Engineer 1 (layout-eng): Layout, Navigation, and Information Architecture

**Focus:** Structural changes to navigation, panels, information density, and mobile support.

#### Task Group A: Fix Critical Navigation (Priority: CRITICAL)
1. **Fix mobile view mode buttons (C1):** Replace the hidden view mode buttons with a mobile-friendly bottom tab bar or hamburger menu that persists at all viewport widths. Use icon+text at wide viewports, icon-only on narrow.
2. **Fix FAB icon (C3):** Replace the "+" SVG with a menu/grid icon or a "browse" icon (e.g., a list or compass icon). Update the aria-label accordingly. When the panel is open, show an "X" icon (it already rotates 45deg but the underlying icon should change semantically).
3. **Fix "Hide" header (C4):** Add a small floating toggle tab (e.g., a thin horizontal bar or downward chevron) that appears at the top of the screen when the header is collapsed. Clicking it restores the header.
4. **Add visible notification system (C2):** Replace the console-only `showNotification()` with a toast/snackbar component. Position at bottom-center, auto-dismiss after 3-4 seconds. Use for: election view without selection, data load errors, export confirmations.

#### Task Group B: Improve Information Architecture (Priority: HIGH)
5. **Restructure election panel sections (H5):** Split the overloaded panel into collapsible accordion sections: (a) Active Election / Forecast, (b) Search & Filters, (c) Recently Viewed & Bookmarks, (d) Browse by Category. Default to collapsed for categories with expand on click. Add chevron icons to group headers (M4).
6. **Make filter chips combinable (H1):** Change from mutually-exclusive OR logic to AND logic. Allow selecting a year chip AND a category chip simultaneously. Show active filters as dismissible tags.
7. **Consolidate search (H3):** Remove the floating precinct search widget. Merge precinct search into the command palette (Cmd+K) which already searches precincts. Or add a "Precinct" tab to the election panel search. Reduce from 3 search UIs to 2 max.
8. **Fix header z-index on mobile (H4):** Lower the header z-index or increase Leaflet control z-index so zoom controls are accessible on mobile.

#### Task Group C: Mobile Experience (Priority: HIGH)
9. **Ensure view modes accessible on mobile (C1):** If using a bottom tab bar, ensure it has proper touch targets (48x48px minimum). Include all three views plus a "Browse" action.
10. **Fix info card behavior (M5):** Instead of repositioning and shrinking the info card when the panel opens, either: (a) overlay it as a bottom sheet, or (b) integrate precinct details into the panel itself when on mobile.
11. **Fix FAB/precinct search overlap on mobile (L7):** Adjust positioning so elements don't overlap.
12. **Increase touch targets for bookmark stars (L3):** Expand clickable area to at least 44x44px.

#### Task Group D: Onboarding & Feedback (Priority: HIGH)
13. **Add first-use empty state (H2):** When no election is selected, show an overlay or card on the map with: "Welcome to Collin County Elections. Click Browse to explore election results, or press Cmd+K to search." Include 2-3 quick-start action buttons.
14. **Add loading states (H6):** Use the existing `skeletonLoader.js` and loading CSS. Show a spinner overlay when loading election data. Show skeleton screens in the election panel while data loads.

### UI Engineer 2 (interaction-eng): Interactive Components, Data Display, and Polish

**Focus:** Interactive features, data visualization improvements, export wiring, and accessibility.

#### Task Group E: Wire Up Existing Modules (Priority: CRITICAL)
1. **Wire up export functionality (C8):** Instantiate the `createExportDropdown()` from `exportManager.js` in the election panel when a race is selected. Enable "Current Race Results" export immediately. Enable "Selected Precinct History" when a precinct is clicked. Add an export button to the info card and/or the precinct profile panel header.
2. **Import and activate `keyboardShortcuts.js` (M9):** Add the import to `index.html`. Wire up shortcuts: 1/2/3 for view modes, B for browse panel, Escape for close (already works), N/P for next/previous election.
3. **Surface precinct history in UI (C7 partial):** Add a "History" tab or section to the precinct profile panel that shows results across elections for the selected precinct, using the existing `precinctHistory.js` module.

#### Task Group F: Accessibility Fixes (Priority: CRITICAL)
4. **Add pattern/label options for color-blind users (C5):** Add a toggle for "High contrast" or "Pattern fills" mode that overlays crosshatch patterns on map polygons alongside colors. Alternatively, add abbreviated party labels (R/D/M) as precinct text overlays.
5. **Fix ARIA issues (M6):** Update FAB aria-label when toggling state. Add `role="radiogroup"` to filter chips container, `aria-pressed` to individual chips. Trap focus inside open panels. Replace emoji icons with proper SVG icons that have accessible labels.
6. **Fix dark mode legend (L2):** Replace hardcoded `background: white` in JavaScript-generated legend HTML with `var(--bg-primary)`. Use CSS variables for all legend text colors.

#### Task Group G: Data Display Improvements (Priority: HIGH)
7. **Add race summary/dashboard (M2):** When an election is loaded, show a compact summary bar or card: total votes, winner with margin, overall turnout, number of participating precincts. Position above the map or as part of the info card.
8. **Improve info card (M1, M5):** Add spatial context (commissioner precinct, congressional district) from GeoJSON properties. Show this data without needing the full profile panel.
9. **Make precinct click less overwhelming (M3):** On click, show only the info card first. Add a "View full profile" link/button on the info card that opens the profile panel. Don't auto-open both simultaneously.
10. **Fix notification for Election view switch (H11):** Wire the new toast system (from Task Group D) to the `showNotification()` call when switching to Election view without a selection.

#### Task Group H: Forecast & Simulation Polish (Priority: MEDIUM)
11. **Add simulation results export (H9):** Add an "Export Simulation" button to the forecast section that downloads per-precinct simulated outcomes (original vs simulated votes, flipped status).
12. **Improve flipped precinct visual (L4):** Use pulsing animation or a distinct fill pattern (diagonal stripes) for flipped precincts instead of just a thicker border.
13. **Simplify simulator for non-technical users (L1):** Add preset buttons ("Low Dem Turnout", "High Rep Turnout", "Baseline") alongside the fine-grained sliders.

#### Task Group I: Map View Controls (Priority: MEDIUM)
14. **Group floating map controls (M11):** Wrap the Winner/Margin/Swing Precincts buttons in a visually distinct container (card with border/shadow) so they look like a cohesive toolbar.
15. **Deduplicate panel entry points (M12):** Remove the Forecast button from the header (it duplicates Browse). Instead, when an election is selected, change the Browse button text to "Election Panel" or show the forecast section more prominently within the panel.

---

## Success Metrics

- **Task completion rate:** Carlos can find and analyze his commissioner race in under 4 clicks
- **Mobile usability:** All core features accessible at 375px viewport
- **Export adoption:** Users can export race data without leaving the tool
- **Accessibility:** Pass WCAG 2.1 AA for color contrast, focus management, and screen reader compatibility
- **First-use success:** New users can understand the tool's purpose and select an election within 30 seconds
