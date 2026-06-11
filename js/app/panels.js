// panels.js
// --------------------------------------------------------------------------------
// Election browse panel open/close (FAB + header buttons), the forecast header
// button, the mobile tab bar, and the competitive ranker panel.

import { state } from "./state.js";
import { hooks } from "./hooks.js";
import { closeAllPanels, dismissWelcome } from "./uiChrome.js";
import { setViewMode } from "./viewMode.js";
import { selectPrecinctByCode } from "./search.js";
import { rankCompetitivePrecincts, generateRankerHTML, generateRankerCSV } from "../competitiveRanker.js";

// ==========================================================================
// ELECTION PANEL TOGGLE
// ==========================================================================
const fab = document.getElementById('fab');
const electionPanel = document.getElementById('election-panel');
const closePanelBtn = document.getElementById('close-panel');
const openPanelBtn = document.getElementById('open-panel-btn');

export function togglePanel() {
  const isActive = electionPanel.classList.contains('active');
  const fabIconMenu = document.getElementById('fab-icon-menu');
  const fabIconClose = document.getElementById('fab-icon-close');
  if (isActive) {
    electionPanel.classList.remove('active');
    electionPanel.setAttribute('aria-hidden', 'true');
    fab.classList.remove('active');
    // F5: Update FAB aria-label
    fab.setAttribute('aria-label', 'Browse elections');
    // A2: Swap icon back to menu
    if (fabIconMenu) fabIconMenu.style.display = '';
    if (fabIconClose) fabIconClose.style.display = 'none';
    // F5: Return focus to trigger button
    openPanelBtn.focus();
  } else {
    // Gap 4: Close other panels first
    closeAllPanels('election-panel');
    electionPanel.classList.add('active');
    electionPanel.setAttribute('aria-hidden', 'false');
    fab.classList.add('active');
    // F5: Update FAB aria-label
    fab.setAttribute('aria-label', 'Close election browser');
    // A2: Swap icon to X
    if (fabIconMenu) fabIconMenu.style.display = 'none';
    if (fabIconClose) fabIconClose.style.display = '';
    // Refresh panel content
    hooks.renderElectionPanel?.();
    // D11: Hide welcome overlay when panel opens
    dismissWelcome();
    // F5: Focus search input when panel opens
    setTimeout(() => {
      const searchInput = document.getElementById('panel-search-input');
      if (searchInput) searchInput.focus();
    }, 100);
  }
  // Update mobile tab bar Browse button active state
  updateMobileTabBar();
}

fab.addEventListener('click', togglePanel);
openPanelBtn.addEventListener('click', togglePanel);
closePanelBtn.addEventListener('click', togglePanel);

const forecastBtn = document.getElementById('forecast-btn');
forecastBtn.addEventListener('click', () => {
  // I15: When election is selected, open panel and scroll to forecast section
  if (state.currentElection) {
    if (!electionPanel.classList.contains('active')) {
      togglePanel();
    }
    // Scroll to forecast section after panel renders
    setTimeout(() => {
      const forecastSection = document.getElementById('forecast-section');
      if (forecastSection) {
        forecastSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  } else {
    togglePanel();
  }
});

export function updateForecastButton() {
  if (state.currentElection) {
    forecastBtn.style.opacity = '1';
    forecastBtn.style.pointerEvents = 'auto';
    forecastBtn.title = 'Open forecast panel';
    forecastBtn.querySelector('.forecast-btn-text').textContent = 'Forecast';
  } else {
    forecastBtn.style.opacity = '0.4';
    forecastBtn.style.pointerEvents = 'none';
    forecastBtn.title = 'Select an election first to enable forecasting';
  }
}

// ==========================================================================
// MOBILE TAB BAR (A1)
// ==========================================================================
export function initMobileTabBar() {
  const tabBar = document.getElementById('mobile-tab-bar');
  if (!tabBar) return;
  tabBar.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      const action = btn.dataset.action;
      if (action === 'browse') {
        togglePanel();
      } else if (view) {
        // Close browse panel when switching to a view tab
        if (electionPanel.classList.contains('active')) {
          electionPanel.classList.remove('active');
          electionPanel.setAttribute('aria-hidden', 'true');
        }
        setViewMode(view);
      }
      updateMobileTabBar();
    });
  });
}

export function updateMobileTabBar() {
  const tabBar = document.getElementById('mobile-tab-bar');
  if (!tabBar) return;
  tabBar.querySelectorAll('.tab-btn').forEach(btn => {
    const view = btn.dataset.view;
    const action = btn.dataset.action;
    if (action === 'browse') {
      btn.classList.toggle('active', electionPanel.classList.contains('active'));
      btn.setAttribute('aria-selected', electionPanel.classList.contains('active'));
    } else if (view) {
      btn.classList.toggle('active', state.viewMode === view && !electionPanel.classList.contains('active'));
      btn.setAttribute('aria-selected', state.viewMode === view);
    }
  });
}

// ==========================================================================
// COMPETITIVE RANKER PANEL
// ==========================================================================
let cachedRankerData = null;

export function openRankerPanel() {
  if (!state.currentElectionData || !state.simulationCandidates) return;
  // Gap 4: Close other panels first
  closeAllPanels('competitive-ranker-panel');
  const panel = document.getElementById('competitive-ranker-panel');
  const body = document.getElementById('ranker-panel-body');

  const geojsonFeatures = state.geojsonData?.features || [];
  cachedRankerData = rankCompetitivePrecincts(
    state.currentElectionData,
    state.simulationCandidates,
    state.censusProfiles || {},
    geojsonFeatures
  );

  body.innerHTML = generateRankerHTML(cachedRankerData, 25);
  panel.classList.add('active');

  // Click on a ranker card to zoom to that precinct
  body.querySelectorAll('.ranker-card').forEach((card, i) => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      const p = cachedRankerData[i];
      if (p) selectPrecinctByCode(p.precinctCode);
    });
  });
}

export function closeRankerPanel() {
  document.getElementById('competitive-ranker-panel').classList.remove('active');
}

export function exportRankerCSV() {
  if (!cachedRankerData || cachedRankerData.length === 0) return;
  const csv = generateRankerCSV(cachedRankerData);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'competitive_precincts.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// init()-time wiring for the ranker panel header buttons
export function initRankerPanelControls() {
  document.getElementById('close-ranker-panel').addEventListener('click', closeRankerPanel);
  document.getElementById('export-ranker-csv').addEventListener('click', exportRankerCSV);
}
