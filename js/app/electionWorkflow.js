// electionWorkflow.js
// --------------------------------------------------------------------------------
// The election lifecycle: load the manifest, select a race (the workflow hub
// that fans out to map, panel, simulator, info card), and URL deep-link sync.

import { state } from "./state.js";
import { buildCommands } from "./commandPalette.js";
import { dismissWelcome, showMapLoading, hideMapLoading, showError, showNotification, updateBreadcrumbs } from "./uiChrome.js";
import { setViewMode } from "./viewMode.js";
import { togglePanel, updateForecastButton } from "./panels.js";
import { updateInfoCardForElection, reapplyPrecinctSelection } from "./precinctPanel.js";
import { buildDncByPrecinct } from "./forecast.js";
import { renderElectionPanel, addToRecentlyViewed } from "./electionPanel.js";
import { switchToCountyView } from "./county.js";
import { listElectionCSVs, loadElectionData, getActiveCounty, loadCountyRegistry } from "../dataLoader.js";
import { districtViewSlugForRace } from "../electionFilters.js";
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

// When the user picks a district's own race (e.g. US Rep District 3) while in
// a single-county view, jump to the cross-county district view so the WHOLE
// district renders — every member county's precincts, not one county with
// holes. Returns true when it handled the selection by jumping.
async function maybeJumpToDistrictView(entry) {
  const slug = districtViewSlugForRace(entry);
  if (!slug || getActiveCounty() === slug) return false;
  const registry = await loadCountyRegistry();
  const view = registry.find(c => c.slug === slug && c.kind === 'district' && c.status === 'live');
  if (!view) return false;

  // Pre-check: confirm the district view actually carries a race for this year
  // before committing to the county switch. District packages only include
  // general elections; 2026 primaries, special elections, etc. may be absent.
  // Without this guard the user gets teleported to an empty view (race=null).
  try {
    const r = await fetch(`data/tx/districts/${slug}/data/elections.json`);
    if (!r.ok) return false;
    const manifest = await r.json();
    const races = manifest?.elections ?? [];
    const hasRace = races.some(e =>
      (entry.raceKey && (e.id === entry.raceKey || e.filename?.includes(entry.raceKey))) ||
      (districtViewSlugForRace(e) === slug && String(e.year) === String(entry.year))
    );
    if (!hasRace) return false;
  } catch {
    return false;
  }

  // Preserve the pre-jump view as a history entry so the Back button returns
  // to it (everything else uses replaceState; without this, Back exits the app)
  history.pushState(null, '', window.location.href);

  await switchToCountyView(slug);

  // Re-select the same contest in the district view's merged election list:
  // exact race id first, then same district race + year (id spellings vary).
  const match = state.elections?.find(e => e.raceKey && e.raceKey === entry.raceKey)
    || state.elections?.find(e => districtViewSlugForRace(e) === slug && e.year === entry.year);
  if (match) {
    await selectElection(match, { skipDistrictJump: true });
    showNotification(`Switched to ${view.name} — all member counties included`);
  }
  return true;
}

export async function selectElection(entry, { skipDistrictJump = false, keepWelcome = false, skipRecent = false } = {}) {
  try {
    if (!skipDistrictJump && await maybeJumpToDistrictView(entry)) return;

    state.currentElection = entry;

    // D11: Hide welcome overlay (kept on the initial default-result load so the
    // welcome still greets first-time visitors over a populated map)
    if (!keepWelcome) dismissWelcome();

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

    // Add to recently viewed (skip for the auto-loaded landing default — it
    // isn't a user action, so it shouldn't populate their history)
    if (!skipRecent) addToRecentlyViewed(entry);

    // D12: Remove loading overlay
    hideMapLoading();

    // Switch to election view mode and update map
    setViewMode('election');

    // Update the county headline (topline) + county-summary card. If the user
    // had a precinct selected, keep them on it — re-highlight it and show ITS
    // results under the new race, rather than dropping back to the county view.
    updateInfoCardForElection(entry, electionData);
    reapplyPrecinctSelection();

    // Show RESULTS first, not the forecast/simulation console. Picking a race
    // colours the map and fills the topline summary; forecasting is a separate,
    // deliberate step (the Forecast tab / the full forecast page).
    state.activeElectionTab = 'browse';

    // Re-render panel so forecast section shows and populate simulator
    renderElectionPanel();

    // Close panel on mobile so the map is visible. Close, never toggle: on the
    // district-jump path the county switch already closed it, and a toggle
    // here would re-open it over the map.
    if (window.innerWidth < 768 &&
        document.getElementById('election-panel')?.classList.contains('active')) {
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

// Pick a sensible headline race so the landing map ANSWERS something instead of
// showing a registration-lean choropleth with nothing selected. Preference:
// newest Presidential race → newest Federal race → newest race → first listed.
// Loads it with keepWelcome so the welcome overlay still shows on top.
export async function selectDefaultElection() {
  if (state.currentElection || !state.elections?.length) return;
  const byYearDesc = (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0);
  const named = (e) => (e.displayName || e.filename || '').toLowerCase();
  const pres = [...state.elections].filter(e => named(e).includes('president')).sort(byYearDesc);
  const federal = [...state.elections].filter(e => e.category === 'Federal').sort(byYearDesc);
  const newest = [...state.elections].sort(byYearDesc);
  const pick = pres[0] || federal[0] || newest[0] || state.elections[0];
  // skipDistrictJump: a default must never teleport away from the current
  // county/district view (it would override a #county= deep link).
  if (pick) await selectElection(pick, { keepWelcome: true, skipRecent: true, skipDistrictJump: true });
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

export function restoreFromURL(hash = window.location.hash) {
  const urlState = parseURLHash(hash);
  if (urlState.race) {
    // Match by race id (v3), exact filename, or a legacy bare filename from
    // an old bookmark (v3 race files live under races/)
    const entry = state.elections?.find(e =>
      e.raceKey === urlState.race ||
      e.filename === urlState.race ||
      e.filename === `races/${urlState.race}`
    );
    if (entry) {
      // URL restores replay exactly what was bookmarked — a deep link into a
      // district view already carries county=<slug>, so never auto-jump here
      // (it would fight the county deep-link path and the back button).
      selectElection(entry, { skipDistrictJump: true });
    }
  }
}

// Handle browser back/forward. A jump to a district view pushes a history
// entry, so going back may land on a DIFFERENT county — switch first (which
// reloads the election list), then restore the race from that same hash.
window.addEventListener('popstate', async () => {
  const hash = window.location.hash;
  const urlState = parseURLHash(hash);
  const county = urlState.county || 'collin';
  if (county !== getActiveCounty()) {
    const { switchToCountyView } = await import('./county.js');
    await switchToCountyView(county);
  }
  restoreFromURL(hash);
});
