// electionWorkflow.js
// --------------------------------------------------------------------------------
// The election lifecycle: load the manifest, select a race (the workflow hub
// that fans out to map, panel, simulator, info card), and URL deep-link sync.

import { state } from "./state.js";
import { buildCommands } from "./commandPalette.js";
import { dismissWelcome, showMapLoading, hideMapLoading, showError, updateBreadcrumbs } from "./uiChrome.js";
import { setViewMode } from "./viewMode.js";
import { togglePanel, updateForecastButton } from "./panels.js";
import { updateInfoCardForElection } from "./precinctPanel.js";
import { buildDncByPrecinct } from "./forecast.js";
import { renderElectionPanel, addToRecentlyViewed } from "./electionPanel.js";
import { listElectionCSVs, loadElectionData, getActiveCounty } from "../dataLoader.js";
import { getCandidateColumns } from "../electionSchema.js";
import { createSliderState, createVoterFlipState } from "../turnoutSimulator.js";
import { buildURLHash, parseURLHash } from "../urlStateManager.js";

// ==========================================================================
// ELECTION DATA LOADING
// ==========================================================================
export async function loadElections() {
  try {
    state.elections = await listElectionCSVs();
    state.filteredElections = [...state.elections];
    renderElectionPanel();
    buildCommands();
    console.log('✅ Loaded', state.elections.length, 'elections');
  } catch (error) {
    console.error('❌ Failed to load elections:', error);
    showError('Failed to load elections list.');
  }
}

// ==========================================================================
// ELECTION SELECTION
// ==========================================================================
export async function selectElection(entry) {
  try {
    state.currentElection = entry;

    // D11: Hide welcome overlay
    dismissWelcome();

    // D12: Show loading overlay on map
    showMapLoading();

    // Load election data
    const electionData = await loadElectionData(entry);
    state.currentElectionData = electionData;

    // Build DNC lookup for simulator (precinct code -> { Precinct, Rep, Mod, Dem, Total })
    state.dncDataByPrecinct = buildDncByPrecinct(state.dncLookup);

    // Build candidate list from election CSV (vote columns only)
    const headers = electionData[0] ? Object.keys(electionData[0]) : [];
    const candidateCols = getCandidateColumns(headers);
    state.simulationCandidates = candidateCols.filter(col => {
      const val = electionData[0][col];
      return val !== '' && !isNaN(Number(val));
    });

    // Create or reset simulator state
    state.sliderState = createSliderState({ Rep: 1.0, Dem: 1.0, Mod: 1.0 }, { minValue: 0.5, maxValue: 1.5 });
    state.voterFlipState = createVoterFlipState();
    state.simulationResult = null;

    // Add to recently viewed
    addToRecentlyViewed(entry);

    // D12: Remove loading overlay
    hideMapLoading();

    // Switch to election view mode and update map
    setViewMode('election');

    // Update info card
    updateInfoCardForElection(entry, electionData);

    // Gap 5: Auto-switch to Forecast tab on election selection
    state.activeElectionTab = 'forecast';

    // Re-render panel so forecast section shows and populate simulator
    renderElectionPanel();

    // Close panel on mobile
    if (window.innerWidth < 768) {
      togglePanel();
    }

    // Update URL state
    updateURLState();

    // Show forecast button in header
    updateForecastButton();

    // Gap 6: Update breadcrumbs
    updateBreadcrumbs();

    console.log('✅ Loaded election:', entry.displayName || entry.filename);
  } catch (error) {
    hideMapLoading(); // D12: clean up on error
    console.error('❌ Failed to load election:', error);
    showError('Failed to load election data.');
  }
}

// ==========================================================================
// URL STATE MANAGEMENT
// ==========================================================================
export function updateURLState() {
  const urlState = {};
  if (getActiveCounty() !== 'collin') {
    urlState.county = getActiveCounty();
  }
  if (state.currentElection) {
    // Prefer the stable race id (v3); fall back to filename for legacy entries
    urlState.race = state.currentElection.raceKey || state.currentElection.filename;
  }
  const hash = buildURLHash(urlState);
  if (hash) {
    history.replaceState(urlState, '', `#${hash}`);
  } else if (window.location.hash) {
    // Back to defaults (Collin, no race) — drop the stale hash
    history.replaceState(urlState, '', window.location.pathname + window.location.search);
  }
}

export function restoreFromURL() {
  const urlState = parseURLHash(window.location.hash);
  if (urlState.race) {
    // Match by race id (v3), exact filename, or a legacy bare filename from
    // an old bookmark (v3 race files live under races/)
    const entry = state.elections?.find(e =>
      e.raceKey === urlState.race ||
      e.filename === urlState.race ||
      e.filename === `races/${urlState.race}`
    );
    if (entry) {
      selectElection(entry);
    }
  }
}

// Handle browser back/forward
window.addEventListener('popstate', () => {
  restoreFromURL();
});
