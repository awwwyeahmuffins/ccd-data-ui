// viewMode.js
// --------------------------------------------------------------------------------
// The view-mode router: demographics / election / turnout. setViewMode() is the
// ONLY place that flips views — do not add side channels.

import { state } from "./state.js";
import { closeAllPanels, updateBreadcrumbs, showNotification } from "./uiChrome.js";
import { hideInfoCard, hideResultTopline, showResultTopline } from "./precinctPanel.js";
import {
  renderNeutralMap, renderDemographicsMap, renderTurnoutMap,
  renderElectionMap, updateMapLegend
} from "./mapRendering.js";
import { updateMapForSimulation } from "./forecast.js";
import { togglePanel, updateMobileTabBar, openRankerPanel } from "./panels.js";
import { loadElectionData } from "../dataLoader.js";
import { setupPrecinctLabels } from "../mapEnhancements.js";
import { HEATMAP_METRICS, clearMinMaxCache } from "../demographicHeatmap.js";

const electionPanelEl = document.getElementById('election-panel');

export function setViewMode(mode) {
  state.viewMode = mode;

  // Update desktop button states
  document.querySelectorAll('.view-mode-btn').forEach(btn => {
    const isActive = btn.dataset.view === mode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  // A1: Update mobile tab bar
  updateMobileTabBar();

  // Show/hide and populate map view controls
  updateMapViewControls(mode);

  // Close browse panel when switching away from election view
  if (mode !== 'election' && electionPanelEl.classList.contains('active')) {
    closeAllPanels();
  }

  // Render the appropriate view
  switch (mode) {
    case 'demographics':
      renderDemographicsMap();
      hideInfoCard();
      hideResultTopline();
      break;
    case 'election':
      if (state.currentElectionData) {
        renderElectionMap(state.currentElectionData);
        showResultTopline();
        if (state.simulationResult) updateMapForSimulation();
      } else {
        // Show neutral gray map while waiting for election selection
        renderNeutralMap();
        hideResultTopline();
        // Auto-open browse panel so user can pick an election
        if (!electionPanelEl.classList.contains('active')) {
          togglePanel();
        }
      }
      break;
    case 'turnout':
      hideResultTopline();
      if (!state.currentElectionData && state.elections.length > 0) {
        // Auto-load the most recent election for turnout
        const firstElection = state.elections[0];
        loadElectionData(firstElection.filename).then(data => {
          state.currentElectionData = data;
          state.currentElection = firstElection;
          renderTurnoutMap();
          updateMapLegend();
        }).catch(() => renderTurnoutMap());
      } else {
        renderTurnoutMap();
      }
      break;
  }

  // Update legend for current view mode
  updateMapLegend();

  // Gap 6: Update breadcrumbs
  updateBreadcrumbs();
}

export function updateMapViewControls(mode) {
  const controls = document.getElementById('map-view-controls');
  controls.innerHTML = '';

  if (mode === 'demographics') {
    controls.style.display = 'flex';

    // I14: Wrap buttons in toolbar container
    const toolbar = document.createElement('div');
    toolbar.className = 'map-controls-toolbar';

    // Party Lean button (default)
    const partyBtn = document.createElement('button');
    partyBtn.className = 'map-toggle-btn' + (!state.heatmapMetric ? ' active' : '');
    partyBtn.textContent = 'Party Lean';
    partyBtn.addEventListener('click', () => {
      state.heatmapMetric = null;
      renderDemographicsMap();
      updateMapViewControls(mode);
    });
    toolbar.appendChild(partyBtn);

    // Heatmap metric selector
    const select = document.createElement('select');
    select.id = 'heatmap-metric-select';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Demographic layer…';
    select.appendChild(defaultOpt);
    for (const metric of HEATMAP_METRICS) {
      const opt = document.createElement('option');
      opt.value = metric.id;
      opt.textContent = metric.label;
      if (state.heatmapMetric === metric.id) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      state.heatmapMetric = select.value || null;
      clearMinMaxCache();
      renderDemographicsMap();
      updateMapViewControls(mode);
    });
    toolbar.appendChild(select);

    // F4: Labels toggle
    toolbar.appendChild(buildLabelsToggle(mode));

    controls.appendChild(toolbar);
  } else if (mode === 'election' && state.currentElectionData) {
    controls.style.display = 'flex';

    // I14: Wrap buttons in toolbar container
    const toolbar = document.createElement('div');
    toolbar.className = 'map-controls-toolbar';

    // Party color button
    const partyBtn = document.createElement('button');
    partyBtn.className = 'map-toggle-btn' + (state.electionColorMode === 'party' ? ' active' : '');
    partyBtn.textContent = 'Winner';
    partyBtn.addEventListener('click', () => {
      state.electionColorMode = 'party';
      renderElectionMap(state.currentElectionData);
      updateMapViewControls(mode);
    });
    toolbar.appendChild(partyBtn);

    // Margin button
    const marginBtn = document.createElement('button');
    marginBtn.className = 'map-toggle-btn' + (state.electionColorMode === 'margin' ? ' active' : '');
    marginBtn.textContent = 'Margin';
    marginBtn.addEventListener('click', () => {
      state.electionColorMode = 'margin';
      renderElectionMap(state.currentElectionData);
      updateMapViewControls(mode);
    });
    toolbar.appendChild(marginBtn);

    // Competitive ranker button
    const rankerBtn = document.createElement('button');
    rankerBtn.className = 'map-toggle-btn';
    rankerBtn.textContent = 'Swing Precincts';
    rankerBtn.addEventListener('click', () => openRankerPanel());
    toolbar.appendChild(rankerBtn);

    // F4: Labels toggle for election view too
    toolbar.appendChild(buildLabelsToggle(mode));

    controls.appendChild(toolbar);
  } else {
    controls.style.display = 'none';
  }
}

// F4: Labels toggle button (same behavior in demographics and election views)
function buildLabelsToggle(mode) {
  const labelsBtn = document.createElement('button');
  labelsBtn.className = 'map-toggle-btn' + (state.labelsVisible ? ' active' : '');
  labelsBtn.textContent = 'Labels';
  labelsBtn.addEventListener('click', () => {
    state.labelsVisible = !state.labelsVisible;
    if (state.labelsVisible) {
      if (state.labelCleanup) state.labelCleanup();
      state.labelCleanup = setupPrecinctLabels(state.map, state.geojsonLayer);
      if (state.map.getZoom() < 12) {
        showNotification('Zoom in to see precinct labels (zoom 12+)');
      }
    } else {
      if (state.labelCleanup) { state.labelCleanup(); state.labelCleanup = null; }
    }
    updateMapViewControls(mode);
  });
  return labelsBtn;
}

// Initialize view mode button listeners
export function initViewModeButtons() {
  document.querySelectorAll('.view-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.view;
      setViewMode(mode);
    });
  });
}
