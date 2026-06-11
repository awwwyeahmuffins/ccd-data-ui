// county.js
// --------------------------------------------------------------------------------
// Statewide county switching. All 254 Texas counties are selectable; counties
// whose registry status isn't "live" render their county outline as a single
// PLACEHOLDER precinct with an explicit banner — no fabricated data.

import { state } from "./state.js";
import { showNotification, showMapLoading, hideMapLoading, updateBoundaryDisclaimer } from "./uiChrome.js";
import { setViewMode } from "./viewMode.js";
import { loadElections, updateURLState } from "./electionWorkflow.js";
import { loadAllData, loadCountyRegistry, setActiveCounty, getActiveCounty, getActiveBoundary } from "../dataLoader.js";
import { setupPrecinctLabels } from "../mapEnhancements.js";
import { clearMinMaxCache } from "../demographicHeatmap.js";

const PLACEHOLDER_BANNER_ID = 'county-placeholder-banner';

function updatePlaceholderBanner(entry) {
  const banner = document.getElementById(PLACEHOLDER_BANNER_ID);
  if (!banner) return;
  if (entry && entry.status !== 'live') {
    banner.querySelector('strong').textContent = `${entry.name} County — PLACEHOLDER`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

// Collin-only chrome (boundary selector, lookup link) hides for other counties
function updateCollinOnlyControls(slug) {
  const isCollin = slug === 'collin';
  const boundarySelect = document.getElementById('boundary-select');
  if (boundarySelect) boundarySelect.style.display = isCollin ? '' : 'none';
  const changesTrigger = document.getElementById('boundary-changes-trigger');
  if (changesTrigger && !isCollin) changesTrigger.classList.remove('visible');
  // The precinct-lookup page is Collin-only for now
  const lookupLink = document.querySelector('.header-btn-lookup');
  if (lookupLink) lookupLink.style.display = isCollin ? '' : 'none';
  if (!isCollin) updateBoundaryDisclaimer('original'); // hide 2026 disclaimer
}

async function switchCounty(slug) {
  console.log(`[County] Switching to: ${slug}`);
  showMapLoading('Loading county…');
  try {
    const entry = await setActiveCounty(slug);

    // Remove old layers/labels
    if (state.geojsonLayer) {
      state.map.removeLayer(state.geojsonLayer);
      state.geojsonLayer = null;
    }
    if (state.labelCleanup) {
      state.labelCleanup();
      state.labelCleanup = null;
    }

    // Re-fetch data (placeholder counties synthesize their outline)
    const { geojson, dncLookup, racialLookup } = await loadAllData();
    state.geojsonData = geojson;
    state.dncLookup = dncLookup;
    state.racialLookup = racialLookup;

    // Clear election-specific state (precinct codes won't match across counties)
    state.currentElection = null;
    state.currentElectionData = null;
    state.selectedPrecinct = null;
    state.selectedLayer = null;
    state.simulationResult = null;
    state.dncDataByPrecinct = null;
    clearMinMaxCache();

    // Reload the (possibly empty) elections manifest for this county
    await loadElections();

    // Re-render and fit the new county
    setViewMode('demographics');
    if (state.geojsonLayer) {
      state.map.fitBounds(state.geojsonLayer.getBounds(), { padding: [24, 24] });
      state.labelCleanup = setupPrecinctLabels(state.map, state.geojsonLayer);
    }

    updateCollinOnlyControls(slug);
    updatePlaceholderBanner(entry);
    updateURLState();
    hideMapLoading();

    if (entry.status === 'live') {
      showNotification(`Switched to ${entry.name} County (${geojson.features.length} precincts)`);
    } else {
      showNotification(`${entry.name} County is a PLACEHOLDER — no precinct data loaded yet`);
    }
  } catch (error) {
    console.error('[County] Switch failed:', error);
    hideMapLoading();
    showNotification('Failed to switch county. Please try again.');
  }
}

export async function initCountySwitching() {
  const select = document.getElementById('county-select');
  if (!select) return;

  let registry;
  try {
    registry = await loadCountyRegistry();
  } catch (err) {
    console.warn('[County] Registry not available:', err);
    select.style.display = 'none';
    return;
  }

  // Live counties first, then a placeholder optgroup with the other 253
  const live = registry.filter(c => c.status === 'live');
  const placeholders = registry.filter(c => c.status !== 'live');
  select.innerHTML =
    live.map(c => `<option value="${c.slug}">${c.name} County</option>`).join('') +
    `<optgroup label="No data yet (placeholders)">` +
    placeholders.map(c => `<option value="${c.slug}">${c.name} (placeholder)</option>`).join('') +
    `</optgroup>`;
  select.value = getActiveCounty();

  select.addEventListener('change', () => switchCounty(select.value));

  // Deep link: #county=<slug> (only honored for counties in the registry)
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const urlCounty = params.get('county');
  if (urlCounty && urlCounty !== getActiveCounty() && registry.some(c => c.slug === urlCounty)) {
    select.value = urlCounty;
    await switchCounty(urlCounty);
  }

  // Keep the boundary-set helpers consistent on first paint
  updateCollinOnlyControls(getActiveCounty());
  if (getActiveCounty() === 'collin') updateBoundaryDisclaimer(getActiveBoundary());
}
