# Plan: 2026 Partisan Swing Simulator

## Context

The 2026 boundary view currently shows 92 election results remapped from old precincts, which is confusing — those elections never happened under these boundaries. The user (targeting precinct chairs and campaign staff) wants to replace this with an interactive "Generic Republican vs Generic Democrat" simulator that lets users model turnout scenarios and identify flippable precincts.

## What Changes

### 1. New Module: `js/partisanSimulator.js`

A standalone module following the same patterns as `turnoutSimulator.js` (state managers, pure calculation functions, HTML generators).

**Data source**: DNC Score CSV (`data/2026/DNC Score By Precinct.csv`) — each precinct has `Rep`, `Mod`, `Dem` registered voter counts.

**Baseline model**: "Generic R vs Generic D" where:
- Generic R votes = Rep registered voters
- Generic D votes = Dem registered voters
- Moderate voters split via a slider (default 50/50)

#### A. State Management

```
createPartisanSimState() → {
  demTurnout: 1.0,       // 0.5x – 2.0x slider
  repTurnout: 1.0,       // 0.5x – 2.0x slider
  modLean: 0.5,          // 0.0 (all R) – 1.0 (all D), default 0.5
  repToDem: 0,           // 0–25% persuasion
  demToRep: 0,           // 0–25% persuasion
  manualMode: false,     // toggle for manual entry
  manualDemTotal: null,   // county-wide Dem target
  manualRepTotal: null,   // county-wide Rep target
}
```

#### B. Core Calculation: `simulatePrecinct(dncRow, state)`

For each precinct:
1. Start with base votes: `repBase = dncRow.Rep * state.repTurnout`, `demBase = dncRow.Dem * state.demTurnout`
2. Split moderates: `modToR = dncRow.Mod * (1 - state.modLean)`, `modToD = dncRow.Mod * state.modLean`
3. Apply persuasion: move `repToDem%` of R votes to D, and vice versa
4. Determine winner by higher total
5. Return `{ repVotes, demVotes, winner, margin, flipped }`

For manual mode: distribute county-wide totals proportionally to each precinct based on its share of total party registration.

#### C. Orchestration: `runPartisanSimulation(dncData, state)`

- Loop all precincts, call `simulatePrecinct()` for each
- Compute county-wide totals (sum all R votes, all D votes)
- Compute county margin string (e.g. "R+12" or "D+3")
- Detect flipped precincts (compare to baseline where turnout=1.0, modLean=0.5, no persuasion)
- Rank precincts by closeness of margin (most flippable first)
- Return `{ precinctResults, countySummary, flippedPrecincts, flippableRanking }`

#### D. UI Generation

`generatePartisanSimHTML(state)` — control panel:
- **Turnout section**: Dem turnout slider (50%–200%), Rep turnout slider (50%–200%)
- **Moderate lean**: Single slider (All R ← → All D), default center
- **Persuasion section**: "R→D swing" slider (0–25%), "D→R swing" slider (0–25%)
- **Manual entry toggle**: Expandable section with two number inputs (county-wide Dem total, Rep total)
- **Reset button**

`generatePartisanResultsHTML(result)` — results dashboard:
- **County margin**: Big display showing "R+12 → D+2" with color
- **Precinct flip summary**: "X precincts flip to D, Y flip to R" with counts
- **Most flippable precincts table**: Ranked list showing precinct #, current margin, votes needed to flip, sorted by easiest to flip. Top 15 rows.

### 2. Election View Integration (`js/electionView.js`)

When `getActiveBoundary() === "2026"`:

- **Hide** the election picker dropdown and normal turnout simulator
- **Show** the partisan swing simulator panel instead
- Load DNC data (already loaded via `loadAllData()`) and pass to simulator
- On slider changes (100ms debounce), rerun simulation and:
  - Recolor the map (R=red, D=blue, flipped=gold dashed border — same pattern as existing turnout sim)
  - Update results dashboard HTML
- The map still shows 2026 precinct polygons, just colored by simulated partisan outcome

Key integration points in `electionView.js`:
- `loadAndRenderElection()` (line ~821): Add branch for 2026 — skip election CSV loading, use DNC data directly
- `setupSimulatorEventListeners()` (line ~1373): Add partisan sim listener setup
- `updateMapWithSimulation()` (line ~1557): Reuse for partisan sim map recoloring

### 3. Precinct Lookup Changes (`js/precinctLookup.js`)

When `getActiveBoundary() === "2026"`:

- **Replace** the "Election History" section with a **"Partisan Lean"** summary:
  - Show the precinct's DNC Score data: Rep/Dem/Mod counts and shares
  - Show baseline "Generic R vs Generic D" outcome for this precinct
  - Note: "No elections have been held under 2026 boundaries"
- This is a simple static section, not the full interactive simulator (that lives in the main election view)

### 4. Precinct Sidebar Click (election view)

When a user clicks a precinct on the map in 2026 mode:
- Show the precinct's simulated R vs D votes under current slider settings
- Show if this precinct flipped from baseline
- Show its rank in the flippable list

## Files Modified

| File | Change |
|---|---|
| `js/partisanSimulator.js` | **NEW** — state management, simulation engine, HTML generators |
| `js/electionView.js` | Branch for 2026 mode: show partisan sim instead of election picker/turnout sim |
| `js/precinctLookup.js` | Replace election history with partisan lean summary in 2026 mode |

## Reusable Patterns from Existing Code

- `turnoutSimulator.js`: `createSliderState()` pattern, `runFullSimulation()` orchestration, `generateSimulatorControlsHTML()` UI pattern, `detectFlippedPrecincts()` logic
- `electionView.js` lines 1557-1638: `updateMapWithSimulation()` map recoloring with gold dashed borders for flips
- `electionView.js` lines 871-883: DNC data normalization (lowercase → uppercase keys)
- `electionView.js` line 91: 100ms debounce pattern for slider updates

## Verification

1. Load `index-new.html`, switch to 2026 boundary view
2. Election picker should be hidden, partisan simulator panel should appear
3. Adjust Dem turnout slider to 1.5x — map should recolor, some precincts flip blue
4. Check "Most Flippable" table shows ranked precincts
5. Toggle manual mode, enter 250K Dem / 200K Rep — map updates
6. Click a precinct — sidebar shows simulated R vs D for that precinct
7. Switch to precinct lookup page, 2026 view — election history replaced with partisan lean summary
8. Switch back to original boundary — normal election picker returns
9. `make test-unit` — all tests pass
