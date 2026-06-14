// county.js
// --------------------------------------------------------------------------------
// Statewide county switching. All 254 Texas counties are selectable; counties
// whose registry status isn't "live" render their county outline as a single
// PLACEHOLDER precinct with an explicit banner — no fabricated data.

import { state } from "./state.js";
import { escapeHtml } from "../utils.js";
import { showNotification, showMapLoading, hideMapLoading, updateBoundaryDisclaimer } from "./uiChrome.js";
import { setViewMode } from "./viewMode.js";
import { loadElections, updateURLState } from "./electionWorkflow.js";
import { loadAllData, loadCountyRegistry, setActiveCounty, getActiveCounty, getActiveBoundary, getBoundaryConfigs } from "../dataLoader.js";
import { setupPrecinctLabels } from "../mapEnhancements.js";
import { clearMinMaxCache } from "../demographicHeatmap.js";

const PLACEHOLDER_BANNER_ID = 'county-placeholder-banner';

function updatePlaceholderBanner(entry) {
  const banner = document.getElementById(PLACEHOLDER_BANNER_ID);
  if (!banner) return;
  if (entry && entry.status !== 'live') {
    banner.querySelector('strong').textContent = `${entry.name} County — coming soon`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

// Per-county chrome: the boundary selector shows only when the county has
// multiple boundary sets (and repopulates from its registry config); the
// precinct-lookup link stays Collin-only (its extras only exist for Collin).
function updateCollinOnlyControls(slug) {
  const isCollin = slug === 'collin';
  const boundarySelect = document.getElementById('boundary-select');
  if (boundarySelect) {
    const configs = getBoundaryConfigs();
    const ids = Object.keys(configs);
    boundarySelect.innerHTML = ids
      .map(id => `<option value="${id}">${configs[id].label}</option>`)
      .join('');
    boundarySelect.value = getActiveBoundary();
    boundarySelect.style.display = ids.length > 1 ? '' : 'none';
  }
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
      const label = entry.kind === 'district' ? entry.name : `${entry.name} County`;
      showNotification(`Switched to ${label} (${geojson.features.length} precincts)`);
    } else {
      showNotification(`${entry.name} County — precinct results coming soon`);
    }
  } catch (error) {
    console.error('[County] Switch failed:', error);
    hideMapLoading();
    showNotification('Failed to switch county. Please try again.');
  }
}

// Programmatic switch (e.g. jumping to a cross-county district view when a
// district race is selected) — keeps the header dropdown in sync.
export async function switchToCountyView(slug) {
  const select = document.getElementById('county-select');
  if (select) select.value = slug;
  syncCountyComboboxInput();
  await switchCounty(slug);
}

// ==========================================================================
// SEARCHABLE COUNTY PICKER (type-to-filter combobox over the native select)
// ==========================================================================
// The native <select id="county-select"> stays the source of truth; this layers
// a searchable input on top so finding one of 254 counties means typing "tar"
// instead of scrolling a giant menu.

let comboModel = [];      // [{ value, label, group }]
let comboItems = [];      // currently rendered (filtered) subset
let comboHighlight = -1;

function syncCountyComboboxInput() {
  const input = document.getElementById('county-search-input');
  const select = document.getElementById('county-select');
  if (!input || !select) return;
  const opt = select.options[select.selectedIndex];
  input.value = opt ? opt.text : '';
}

function buildCountyComboModel(select) {
  const model = [];
  for (const opt of select.options) {
    const parent = opt.parentElement;
    const group = parent && parent.tagName === 'OPTGROUP' ? parent.label : 'Counties';
    model.push({ value: opt.value, label: opt.text, group });
  }
  return model;
}

function renderCountyComboList(query) {
  const list = document.getElementById('county-combobox-list');
  const select = document.getElementById('county-select');
  if (!list || !select) return;
  const q = (query || '').trim().toLowerCase();
  comboItems = comboModel.filter(o => !q || o.label.toLowerCase().includes(q));

  if (!comboItems.length) {
    list.innerHTML = '<div class="county-combobox-empty">No match</div>';
    return;
  }
  const current = select.value;
  let html = '';
  let lastGroup = null;
  comboItems.forEach((o, i) => {
    if (o.group !== lastGroup) {
      html += `<div class="county-combobox-group">${escapeHtml(o.group)}</div>`;
      lastGroup = o.group;
    }
    const cls = ['county-combobox-option'];
    if (o.value === current) cls.push('is-current');
    if (i === comboHighlight) cls.push('highlighted');
    html += `<div class="${cls.join(' ')}" role="option" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`;
  });
  list.innerHTML = html;
  // mousedown (not click) so selection fires before the input's blur closes it
  list.querySelectorAll('.county-combobox-option').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      chooseCountyFromCombo(el.dataset.value);
    });
  });
  const hi = list.querySelector('.county-combobox-option.highlighted');
  if (hi) hi.scrollIntoView({ block: 'nearest' });
}

function chooseCountyFromCombo(value) {
  const select = document.getElementById('county-select');
  if (!select) return;
  if (value && value !== select.value) {
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }
  syncCountyComboboxInput();
  closeCountyComboList();
}

function openCountyComboList() {
  const list = document.getElementById('county-combobox-list');
  const input = document.getElementById('county-search-input');
  if (!list || !input) return;
  comboHighlight = -1;
  list.classList.add('active');
  input.setAttribute('aria-expanded', 'true');
  renderCountyComboList('');
  input.select();
}

function closeCountyComboList() {
  const list = document.getElementById('county-combobox-list');
  const input = document.getElementById('county-search-input');
  if (list) list.classList.remove('active');
  if (input) input.setAttribute('aria-expanded', 'false');
}

function initCountyCombobox() {
  const input = document.getElementById('county-search-input');
  const select = document.getElementById('county-select');
  if (!input || !select || input.dataset.comboReady === '1') {
    comboModel = buildCountyComboModel(select);  // refresh model on re-init
    syncCountyComboboxInput();
    return;
  }
  input.dataset.comboReady = '1';
  comboModel = buildCountyComboModel(select);
  syncCountyComboboxInput();

  input.addEventListener('focus', openCountyComboList);
  input.addEventListener('input', () => {
    comboHighlight = -1;
    document.getElementById('county-combobox-list')?.classList.add('active');
    renderCountyComboList(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      comboHighlight = Math.min(comboHighlight + 1, comboItems.length - 1);
      renderCountyComboList(input.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      comboHighlight = Math.max(comboHighlight - 1, 0);
      renderCountyComboList(input.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (comboHighlight >= 0 && comboItems[comboHighlight]) chooseCountyFromCombo(comboItems[comboHighlight].value);
      else if (comboItems.length === 1) chooseCountyFromCombo(comboItems[0].value);
    } else if (e.key === 'Escape') {
      closeCountyComboList();
      syncCountyComboboxInput();
      input.blur();
    }
  });
  // Delay close so an option's mousedown can register first
  input.addEventListener('blur', () => {
    setTimeout(() => { closeCountyComboList(); syncCountyComboboxInput(); }, 150);
  });
  // Keep the input label in sync when the county changes by any path
  select.addEventListener('change', syncCountyComboboxInput);
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

  // Counties first, then cross-county district views grouped by chamber,
  // then any data-less placeholders
  const counties = registry.filter(c => c.status === 'live' && c.kind !== 'district');
  const placeholders = registry.filter(c => c.status !== 'live');
  const districtGroups = new Map();
  for (const d of registry.filter(c => c.kind === 'district')) {
    if (!districtGroups.has(d.group)) districtGroups.set(d.group, []);
    districtGroups.get(d.group).push(d);
  }
  const districtNum = s => Number(String(s.slug).split('-').pop()) || 0;
  let html = counties.map(c => `<option value="${c.slug}">${c.name} County</option>`).join('');
  for (const [group, ds] of districtGroups) {
    html += `<optgroup label="${group}">` +
      ds.sort((a, b) => districtNum(a) - districtNum(b))
        .map(d => `<option value="${d.slug}">${d.name}</option>`).join('') +
      `</optgroup>`;
  }
  if (placeholders.length) {
    html += `<optgroup label="No data yet (placeholders)">` +
      placeholders.map(c => `<option value="${c.slug}">${c.name} (placeholder)</option>`).join('') +
      `</optgroup>`;
  }
  select.innerHTML = html;
  select.value = getActiveCounty();

  select.addEventListener('change', () => switchCounty(select.value));

  // Build the searchable combobox over the now-populated select
  initCountyCombobox();

  // Deep link: #county=<slug> (only honored for counties in the registry)
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const urlCounty = params.get('county');
  if (urlCounty && urlCounty !== getActiveCounty() && registry.some(c => c.slug === urlCounty)) {
    select.value = urlCounty;
    await switchCounty(urlCounty);
  }
  syncCountyComboboxInput();

  // Keep the boundary-set helpers consistent on first paint
  updateCollinOnlyControls(getActiveCounty());
  if (getActiveCounty() === 'collin') updateBoundaryDisclaimer(getActiveBoundary());
}
