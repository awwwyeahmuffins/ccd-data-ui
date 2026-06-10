# Feature Roadmap — Collin County Election Data Viewer

## Overview

This document outlines new features organized into three parallel workstreams that can be developed independently by separate teams. Each workstream targets a different area of the application.

---

## Workstream 1: Map & Geospatial Enhancements

**Goal:** Make the map more informative at a glance without requiring clicks.

### 1A. Precinct Labels on Map
- Display precinct numbers directly on the map polygons when zoomed in sufficiently
- Labels auto-hide at lower zoom levels to avoid clutter
- Use Leaflet's `Tooltip` permanent mode bound to polygon centroids
- Labels styled with a subtle text shadow for readability over colored fills

### 1B. Enhanced Hover Tooltips
- On hover, show a floating tooltip with key stats: precinct number, registered voters, turnout %, and leading candidate
- Tooltip content is context-aware — changes based on active view (Demographics, Election, Turnout)
- Styled consistently with the app's design tokens

### 1C. Zoom-to-Precinct on Selection
- When a user selects a precinct (click or search), the map smoothly flies to center on it
- Applies a highlight animation (pulse outline) to draw attention to the selected precinct
- Works from command palette, search results, and direct map clicks

---

## Workstream 2: Analytics & Data Visualization

**Goal:** Add deeper analytical views that help users find meaningful patterns in election data.

### 2A. Margin of Victory View Mode
- New color scheme: deep red → white → deep blue based on winning margin (not just winner)
- Competitive precincts (margin < 5%) shown distinctly (near-white)
- Legend updates to show margin scale with breakpoints
- Accessible from view mode selector in header

### 2B. Competitiveness Score
- Calculate a 0–100 "competitiveness" score per precinct based on historical margin consistency
- Score shown in precinct info card alongside existing stats
- Precincts where margin has been within 10% across elections rank higher
- Helps identify swing precincts vs. safe seats

### 2C. Election Comparison Panel
- Side-by-side comparison of two elections on a split view
- Select "Compare" from election panel to pick a second election
- Show delta overlays: which precincts shifted toward which party
- Summary stats: total precincts flipped, average margin shift, biggest swings

---

## Workstream 3: UX, Accessibility & Quality-of-Life

**Goal:** Improve usability, add polish, and make the app more accessible.

### 3A. Dark Mode / Theme Toggle
- Add a theme toggle button in the header
- Dark mode color palette using CSS custom properties (already in use)
- Persist theme choice in localStorage
- Map tile layer switches to a dark basemap (CartoDB Dark Matter)
- All UI elements (panels, cards, legends, charts) respect the theme

### 3B. Bookmark / Favorite Elections
- Star icon on each election item in the panel
- Starred elections persist in localStorage and appear in a "Favorites" section above "Recently Viewed"
- Quick access from command palette with "Favorites" category
- Max 20 bookmarks with oldest auto-removed

### 3C. Print-Friendly View
- "Print" button in header (or Ctrl+P handler)
- Activates a print stylesheet that:
  - Hides header, FAB, sidebar panels, and interactive controls
  - Centers the map at current zoom/position
  - Renders the legend and info card alongside the map
  - Adds a title block with election name, date, and data source
- Uses `@media print` CSS rules so no JS changes needed for basic support

---

## Implementation Priority

| Feature | Effort | Impact | Priority |
|---------|--------|--------|----------|
| 1A. Precinct Labels | Low | High | P0 |
| 1B. Hover Tooltips | Low | High | P0 |
| 3A. Dark Mode | Medium | High | P0 |
| 2A. Margin of Victory | Medium | High | P1 |
| 3C. Print-Friendly View | Low | Medium | P1 |
| 3B. Bookmark Elections | Low | Medium | P1 |
| 1C. Zoom-to-Precinct | Low | Medium | P2 |
| 2B. Competitiveness Score | Medium | Medium | P2 |
| 2C. Election Comparison | High | High | P2 |

---

## Team Assignment

- **Team 1 (Map):** Features 1A, 1B, 1C
- **Team 2 (Analytics):** Features 2A, 2B, 2C
- **Team 3 (UX):** Features 3A, 3B, 3C
