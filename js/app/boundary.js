// boundary.js
// --------------------------------------------------------------------------------
// Boundary-set switching (2024 vs 2026 precincts) and the boundary-changes
// side panel. Previously these lived inside init(), which made
// closeBoundaryPanel unreachable from the global Escape handler (a live
// ReferenceError) — module scope fixes that.

import { state } from "./state.js";
import { showNotification, showMapLoading, hideMapLoading, updateBoundaryDisclaimer } from "./uiChrome.js";
import { setViewMode } from "./viewMode.js";
import { loadElections, selectElection } from "./electionWorkflow.js";
import { loadAllData, setActiveBoundary, getActiveBoundary } from "../dataLoader.js";
import { setupPrecinctLabels } from "../mapEnhancements.js";
import { clearMinMaxCache } from "../demographicHeatmap.js";
import { loadBoundaryChangeSummary, generateBoundaryTableHTML, generateBoundaryStatsHTML, exportBoundaryCSV } from "../boundaryChangesTable.js";

let cachedBoundaryData = null;

async function openBoundaryPanel() {
  const boundaryPanel = document.getElementById('boundary-changes-panel');
  const boundaryPanelContent = document.getElementById('boundary-panel-content');
  if (!cachedBoundaryData) {
    boundaryPanelContent.innerHTML = '<div style="padding:20px;text-align:center;">Loading...</div>';
    try {
      cachedBoundaryData = await loadBoundaryChangeSummary();
    } catch (err) {
      boundaryPanelContent.innerHTML = `<div style="padding:20px;color:red;">Failed to load: ${err.message}</div>`;
      boundaryPanel.classList.add('open');
      return;
    }
  }
  renderBoundaryPanel();
  boundaryPanel.classList.add('open');
}

function renderBoundaryPanel(filters = {}) {
  const boundaryPanelContent = document.getElementById('boundary-panel-content');
  if (!cachedBoundaryData) return;
  let html = generateBoundaryStatsHTML(cachedBoundaryData);
  html += generateBoundaryTableHTML(cachedBoundaryData, filters);
  html += '<button class="boundary-export-btn" id="boundary-export-csv">Export CSV</button>';
  boundaryPanelContent.innerHTML = html;

  // Wire filter dropdown
  const filterSelect = document.getElementById('boundary-filter-type');
  if (filterSelect) {
    filterSelect.addEventListener('change', () => {
      renderBoundaryPanel({ ...filters, changeType: filterSelect.value });
    });
  }
  // Wire sortable headers
  boundaryPanelContent.querySelectorAll('.boundary-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const sortBy = th.dataset.sort;
      const sortDir = filters.sortBy === sortBy && filters.sortDir === 'asc' ? 'desc' : 'asc';
      renderBoundaryPanel({ ...filters, sortBy, sortDir });
    });
  });
  // Wire export
  document.getElementById('boundary-export-csv')?.addEventListener('click', () => {
    exportBoundaryCSV(cachedBoundaryData);
  });
}

export function closeBoundaryPanel() {
  document.getElementById('boundary-changes-panel').classList.remove('open');
}

export function isBoundaryPanelOpen() {
  return document.getElementById('boundary-changes-panel').classList.contains('open');
}

// init()-time wiring: boundary <select>, disclaimer dismiss, panel trigger/close
export function initBoundarySwitching() {
  // Boundary selector — switch between 2024 (252) and 2026 (273) precincts
  const boundarySelect = document.getElementById('boundary-select');
  if (boundarySelect) {
    boundarySelect.value = getActiveBoundary();
    boundarySelect.addEventListener('change', async () => {
      const newBoundary = boundarySelect.value;
      console.log(`[Boundary] Switching to: ${newBoundary}`);

      // Remember the race so we can stay on it after the swap — the same
      // contest exists in both boundary sets, so don't dump the user back to
      // the demographics map. (The selected precinct can't carry: codes differ.)
      const prevRaceKey = state.currentElection?.raceKey;
      const prevFilename = state.currentElection?.filename;

      showMapLoading('Switching boundaries...');

      try {
        // 1) Clear cached data and set new boundary
        setActiveBoundary(newBoundary);

        // 2) Remove old map layer and labels
        if (state.geojsonLayer) {
          state.map.removeLayer(state.geojsonLayer);
          state.geojsonLayer = null;
        }
        if (state.labelCleanup) {
          state.labelCleanup();
          state.labelCleanup = null;
        }

        // 3) Re-fetch GeoJSON + DNC + Racial for new boundary
        const { geojson, dncLookup, racialLookup } = await loadAllData();
        state.geojsonData = geojson;
        state.dncLookup = dncLookup;
        state.racialLookup = racialLookup;

        // 4) Clear election-specific state (old precinct codes won't match)
        state.currentElection = null;
        state.currentElectionData = null;
        state.selectedPrecinct = null;
        state.selectedLayer = null;
        state.simulationResult = null;
        state.dncDataByPrecinct = null;
        clearMinMaxCache();

        // 5) Reload elections manifest for the new boundary
        await loadElections();

        // 6) Re-select the same race in the new boundary set if it exists, so
        // the user stays put; otherwise fall back to the demographics view.
        const match = (prevRaceKey || prevFilename)
          ? state.elections?.find(e =>
              (prevRaceKey && e.raceKey === prevRaceKey) ||
              (prevFilename && e.filename === prevFilename))
          : null;
        if (match) {
          await selectElection(match, { skipDistrictJump: true, skipRecent: true });
        } else {
          setViewMode('demographics');
        }

        // 7) Rebuild precinct labels (guard against null layer)
        if (state.geojsonLayer) {
          state.labelCleanup = setupPrecinctLabels(state.map, state.geojsonLayer);
        }

        // 8) Update disclaimer and notify
        updateBoundaryDisclaimer(newBoundary);
        hideMapLoading();

        const label = newBoundary === '2026' ? '2026 Boundaries' : '2024 Boundaries';
        showNotification(`Switched to ${label} (${geojson.features.length} precincts)`);
        console.log(`[Boundary] Loaded ${geojson.features.length} precincts`);
      } catch (error) {
        console.error('[Boundary] Switch failed:', error);
        hideMapLoading();
        showNotification('Failed to switch boundaries. Please try again.');
      }
    });
  }

  // Show/hide boundary disclaimer based on initial boundary
  updateBoundaryDisclaimer(getActiveBoundary());
  document.getElementById('dismiss-boundary-disclaimer')?.addEventListener('click', () => {
    const banner = document.getElementById('boundary-disclaimer');
    if (banner) banner.style.display = 'none';
  });

  // Boundary changes panel trigger + close
  const boundaryTrigger = document.getElementById('boundary-changes-trigger');

  function updateBoundaryTriggerVisibility() {
    if (boundaryTrigger) {
      if (getActiveBoundary() === '2026') {
        boundaryTrigger.classList.add('visible');
      } else {
        boundaryTrigger.classList.remove('visible');
      }
    }
  }
  updateBoundaryTriggerVisibility();

  // Update trigger visibility when boundary changes
  if (boundarySelect) {
    boundarySelect.addEventListener('change', updateBoundaryTriggerVisibility);
  }

  boundaryTrigger?.addEventListener('click', openBoundaryPanel);
  document.getElementById('close-boundary-panel')?.addEventListener('click', closeBoundaryPanel);
}
