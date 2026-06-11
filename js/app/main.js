// main.js — MAP VIEWER ENTRY POINT
// --------------------------------------------------------------------------------
// Owns map creation and the auth-gated init() sequence; everything else lives
// in the js/app/ modules below. How to extend the app: docs/ADDING_FEATURES.md.
//
//   state.js           shared mutable state singleton (import it everywhere)
//   uiChrome.js        welcome overlay · panel constraint · breadcrumbs · toasts ·
//                      header collapse · loading overlay · disclaimer · theme icon
//   mapRendering.js    the 5 render paths + legend
//   viewMode.js        setViewMode (the ONLY view-flip path) + map toolbar
//   precinctPanel.js   precinct click · info card · profile panel · (disabled) chat
//   search.js          precinct search widget
//   panels.js          election panel toggle · FAB · forecast btn · mobile tabs · ranker
//   electionPanel.js   Browse/Forecast/Saved panel rendering + recently viewed
//   electionWorkflow.js loadElections · selectElection · URL deep-link sync
//   boundary.js        2024/2026 boundary switching + changes panel
//   commandPalette.js  ⌘K palette + global keyboard shortcuts (side-effect import)
//
// Rule: a js/app/ module must never CALL an imported binding at module top
// level — top-level code may only declare, grab DOM elements, and register
// listeners with locally defined handlers. (Keeps the function-level import
// cycles between app modules safe.)
//
// Listener registration profile matters: init() can run twice on the deployed
// auth path (initial load + onAuthStateChange). Module-top-level listeners run
// once; init()-time listeners re-register. Preserve that split.

import { initMap, addHomeControl, addBasemapControl, addLocateControl } from "../mapInitializer.js";
import { findPrecinctForPoint } from "../geoLookup.js";
import { loadAllData } from "../dataLoader.js";
import { MAP_CONFIG } from "../constants.js";
import { initTheme, toggleTheme, getCurrentTheme, DARK_TILE_URL, LIGHT_TILE_URL } from "../themeManager.js";
import { setupPrecinctLabels } from "../mapEnhancements.js";
import { loadCensusProfiles } from "../precinctProfile.js";
import { initAuth, isAuthenticated, signOut, onAuthStateChange } from "../auth.js";
import { showAuthOverlay, hideAuthOverlay } from "../authUI.js";

import { state } from "./state.js";
import { WELCOME_SEEN_KEY, dismissWelcome, showNotification, showError, updateThemeToggleIcon } from "./uiChrome.js";
import { renderDemographicsMap, addMapLegend } from "./mapRendering.js";
import { setViewMode, updateMapViewControls, initViewModeButtons } from "./viewMode.js";
import { initProfilePanelControls, initInfoCardControls } from "./precinctPanel.js";
import { selectPrecinctByCode, initPrecinctSearch } from "./search.js";
import { togglePanel, updateForecastButton, initMobileTabBar, initRankerPanelControls } from "./panels.js";
import { loadElections, restoreFromURL } from "./electionWorkflow.js";
import { initBoundarySwitching } from "./boundary.js";
import { loadRecentlyViewed } from "./electionPanel.js";
// Side-effect import: registers ⌘K, the Escape stack, and 1/2/3/b shortcuts
import "./commandPalette.js";

// ==========================================================================
// MAP INITIALIZATION
// ==========================================================================
async function initializeMap() {
  // Initialize map with existing config
  state.map = initMap({
    center: MAP_CONFIG.center,
    zoom: MAP_CONFIG.zoom,
    containerId: 'map'
  });

  // Save tile layer reference for theme switching
  state.map.eachLayer(layer => {
    if (layer instanceof L.TileLayer) {
      state.tileLayer = layer;
    }
  });

  // Load all base data (GeoJSON + DNC + Racial)
  try {
    const { geojson, dncLookup, racialLookup } = await loadAllData();
    state.geojsonData = geojson;
    state.dncLookup = dncLookup;
    state.racialLookup = racialLookup;

    // Add GeoJSON layer with default party lean coloring
    renderDemographicsMap();

    // Fit the county to the viewport on first load — the static center/zoom
    // wastes half the screen (and centers on Dallas on tall phone screens)
    state.map.fitBounds(state.geojsonLayer.getBounds(), { padding: [24, 24] });

    // Gap 1: Home button - reset to full county extent
    addHomeControl(state.map, state.geojsonLayer.getBounds());

    // "Find my precinct" — geolocate, match against loaded precincts
    addLocateControl(state.map, () => {
      if (!navigator.geolocation) {
        showNotification("Your browser doesn't support location lookup.");
        return;
      }
      showNotification('Finding your precinct…');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const features = state.geojsonData?.features || [];
          const feature = findPrecinctForPoint(pos.coords.latitude, pos.coords.longitude, features);
          if (!feature) {
            showNotification("Your location appears to be outside Collin County.");
            return;
          }
          const code = String(feature.properties.PRECINCT);
          state.map.setView([pos.coords.latitude, pos.coords.longitude], 13);
          selectPrecinctByCode(code);
          showNotification(`You're in Precinct ${code}`);
        },
        () => showNotification("Couldn't get your location — check your browser's location permission."),
        { timeout: 10000, maximumAge: 300000 }
      );
    });

    // Gap 9: Basemap toggle
    addBasemapControl(state.map, state.tileLayer);

    // Setup precinct labels (show at zoom >= 12)
    state.labelCleanup = setupPrecinctLabels(state.map, state.geojsonLayer);

    // Add map legend
    addMapLegend();

    // Gap 8: Add minimap overview
    try {
      const miniTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      new L.Control.MiniMap(miniTiles, {
        toggleDisplay: true,
        position: 'bottomright',
        width: 150,
        height: 150,
        zoomLevelOffset: -4
      }).addTo(state.map);
    } catch (e) {
      console.warn('MiniMap plugin not loaded:', e);
    }

    // Show demographics view controls
    updateMapViewControls('demographics');

    console.log('✅ Map initialized with', geojson.features.length, 'precincts');
  } catch (error) {
    console.error('❌ Failed to load map data:', error);
    showError('Failed to load map data. Please refresh the page.');
  }
}

// ==========================================================================
// INITIALIZATION
// ==========================================================================
async function init() {
  console.log('🚀 Initializing Collin County Elections...');

  // Initialize theme before anything else
  initTheme();
  updateThemeToggleIcon();

  // If dark mode is active, swap tile layer immediately
  if (getCurrentTheme() === 'dark' && state.tileLayer) {
    state.tileLayer.setUrl(DARK_TILE_URL);
  }

  await initializeMap();

  // Apply dark tiles if theme was already dark before map init
  if (getCurrentTheme() === 'dark' && state.tileLayer) {
    state.tileLayer.setUrl(DARK_TILE_URL);
  }

  await loadElections();
  loadRecentlyViewed();
  initViewModeButtons();

  // Boundary switching + boundary-changes panel (js/app/boundary.js)
  initBoundarySwitching();

  // Preload census profiles in background and store in state
  loadCensusProfiles().then(profiles => { state.censusProfiles = profiles; }).catch(err => console.warn('Census profiles not loaded:', err));

  // Profile panel + info card controls (js/app/precinctPanel.js)
  initProfilePanelControls();

  // Precinct search
  initPrecinctSearch();

  // Ranker panel
  initRankerPanelControls();

  // Theme toggle
  const themeToggleBtn = document.getElementById('theme-toggle');
  themeToggleBtn.addEventListener('click', () => {
    const newTheme = toggleTheme();
    updateThemeToggleIcon();
    if (state.tileLayer) {
      state.tileLayer.setUrl(newTheme === 'dark' ? DARK_TILE_URL : LIGHT_TILE_URL);
    }
  });

  // A1: Mobile tab bar event listeners
  initMobileTabBar();

  // D11: Welcome overlay — show once per browser, dismissible via X / Escape
  if (localStorage.getItem(WELCOME_SEEN_KEY)) {
    dismissWelcome();
  }

  const welcomeCloseBtn = document.getElementById('welcome-close-btn');
  if (welcomeCloseBtn) {
    welcomeCloseBtn.addEventListener('click', dismissWelcome);
  }

  initInfoCardControls();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const overlay = document.getElementById('welcome-overlay');
      if (overlay && overlay.style.display !== 'none') dismissWelcome();
    }
  });

  const welcomeBrowseBtn = document.getElementById('welcome-browse-btn');
  if (welcomeBrowseBtn) {
    welcomeBrowseBtn.addEventListener('click', () => {
      dismissWelcome();
      setViewMode('election');
    });
  }

  // Gap 7: Welcome feature card click handlers
  document.querySelectorAll('.welcome-feature[data-view]').forEach(card => {
    card.addEventListener('click', () => {
      dismissWelcome();
      setViewMode(card.dataset.view);
      if (card.dataset.view === 'election') {
        togglePanel();
      }
    });
  });

  // Restore state from URL
  restoreFromURL();
  updateForecastButton();

  console.log('✅ App initialized');
}

// Auth-gated app startup
function setupLogout() {
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.style.display = '';
    logoutBtn.addEventListener('click', () => {
      signOut();
      location.reload();
    });
  }
}

// Listen for auth-expired events from chat API
window.addEventListener('auth-expired', () => {
  signOut();
  location.reload();
});

(async () => {
  initAuth();
  // Local dev bypass: the gate exists to keep the public deployment
  // behind sign-in; localhost development and e2e tests skip it
  const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (isLocalDev || await isAuthenticated()) {
    hideAuthOverlay();
    init();
    setupLogout();
  } else {
    showAuthOverlay();
  }
  onAuthStateChange((authenticated) => {
    if (authenticated) { hideAuthOverlay(); init(); setupLogout(); }
    else { location.reload(); }
  });
})();
