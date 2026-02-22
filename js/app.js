import { renderDemographicsView } from "./demographicsView.js";
import { renderElectionView } from "./electionView.js";
import { renderTurnoutView } from "./turnoutView.js";
import { initMap } from "./mapInitializer.js";
import { clearLayers } from "./utils.js";
import { MAP_CONFIG } from "./constants.js";
import { updateLegend } from "./legendController.js";
import { setActiveBoundary, getActiveBoundary } from "./dataLoader.js";
import { 
  VIEWS as URL_VIEWS,
  parseURLHash, 
  buildURLHash, 
  getShareableURL, 
  copyToClipboard,
  sanitizeState
} from "./urlStateManager.js";
// Import mobile gesture handling (Phase 2 Workstream 4)
import { 
  initSidebarGestures, 
  isTouchDevice, 
  isMobileViewport 
} from "./mobileGestures.js";
// Import keyboard shortcuts (Phase 2 Workstream 5)
import { initKeyboardShortcuts } from "./keyboardShortcuts.js";
import { shouldShowOnboarding, showOnboardingOverlay } from "./onboardingOverlay.js";
import {
  loadBoundaryChangeSummary,
  generateBoundaryTableHTML,
  generateBoundaryStatsHTML,
  exportBoundaryCSV
} from "./boundaryChangesTable.js";

let map = initMap({ center: MAP_CONFIG.center, zoom: MAP_CONFIG.zoom });

// Expose map globally for turnout view's leaderboard zoom functionality
window.leafletMap = map;

// View state constants (extended with turnout)
var VIEWS = Object.freeze({
  DEMOGRAPHICS: 'demographics',
  ELECTION: 'election',
  TURNOUT: 'turnout'
});

// Current app state
let currentState = {
  view: VIEWS.DEMOGRAPHICS,
  race: null,
  precinct: null
};

/**
 * Update URL hash without triggering hashchange event
 * Now supports race parameter for shareable election links
 */
function updateURL(state) {
  let sanitized = sanitizeState(state);
  const hash = buildURLHash(sanitized);
  history.replaceState(sanitized, '', `#${hash}`);
  currentState = { ...currentState, ...sanitized };
}

/**
 * Parse URL hash and return view state
 * Now supports race parameter for shareable election links
 */
function parseURL() {
  let state = parseURLHash(location.hash);
  return {
    view: state.view || VIEWS.DEMOGRAPHICS,
    race: state.race || null,
    precinct: state.precinct || null
  };
}

/**
 * Get current app state (used by copy link and other features)
 */
export function getCurrentState() {
  return { ...currentState };
}

/**
 * Update race in current state (called from electionView when race changes)
 */
export function setCurrentRace(race) {
  currentState.race = race;
  updateURL(currentState);
}

/**
 * Update precinct in current state (called when a precinct is selected)
 */
export function setCurrentPrecinct(precinct) {
  currentState.precinct = precinct;
  updateURL(currentState);
}

/**
 * Show a toast notification
 */
function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) return;

  let toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alert');
  
  // Icon based on type
  let icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
  };
  
  toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
  container.appendChild(toast);
  
  // Remove after duration
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Handle copy link button click
 */
async function handleCopyLink() {
  let btn = document.getElementById('copy-link-btn');
  if (!btn) return;

  const url = getShareableURL(currentState);
  let result = await copyToClipboard(url);
  
  if (result.success) {
    btn.classList.add('copied');
    showToast('Link copied to clipboard!', 'success');
    
    // Reset button state after a moment
    setTimeout(() => {
      btn.classList.remove('copied');
    }, 2000);
  } else {
    showToast('Failed to copy link. Try again.', 'error');
  }
}

/**
 * Update ARIA pressed states for toggle buttons
 */
function updateARIAStates(activeView) {
  let demBtn = document.getElementById("view-dem-btn");
  let electBtn = document.getElementById("view-elect-btn");
  let turnoutBtn = document.getElementById("view-turnout-btn");
  
  if (demBtn) {
    demBtn.setAttribute('aria-pressed', activeView === VIEWS.DEMOGRAPHICS ? 'true' : 'false');
  }
  if (electBtn) {
    electBtn.setAttribute('aria-pressed', activeView === VIEWS.ELECTION ? 'true' : 'false');
  }
  if (turnoutBtn) {
    turnoutBtn.setAttribute('aria-pressed', activeView === VIEWS.TURNOUT ? 'true' : 'false');
  }
}

/**
 * Switch to a specific view
 * @param {string} view - The view to switch to
 * @param {Object} options - Optional { race, precinct } to restore state
 */
function switchToView(view, options = {}) {
  let demBtn = document.getElementById("view-dem-btn");
  let electBtn = document.getElementById("view-elect-btn");
  let turnoutBtn = document.getElementById("view-turnout-btn");
  
  // Remove active from all buttons
  demBtn?.classList.remove("active");
  electBtn?.classList.remove("active");
  turnoutBtn?.classList.remove("active");

  // Clear sidebar content when switching views
  let sidebarContent = document.getElementById("sidebar-content");
  if (sidebarContent) sidebarContent.innerHTML = "";

  if (view === VIEWS.DEMOGRAPHICS) {
    if (currentState.view === VIEWS.DEMOGRAPHICS && !options.force) return;
    
    demBtn?.classList.add("active");
    
    clearLayers(map);
    renderDemographicsView(map);
    currentState.view = VIEWS.DEMOGRAPHICS;
    currentState.race = null; // Clear race when switching to demographics
    updateLegend('demographics');
  } else if (view === VIEWS.ELECTION) {
    if (currentState.view === VIEWS.ELECTION && !options.force) return;
    
    electBtn?.classList.add("active");
    
    clearLayers(map);
    // Pass initial race from URL if available
    renderElectionView(map, { initialRace: options.race || null });
    currentState.view = VIEWS.ELECTION;
    if (options.race) {
      currentState.race = options.race;
    }
    updateLegend('election');
  } else if (view === VIEWS.TURNOUT) {
    if (currentState.view === VIEWS.TURNOUT && !options.force) return;
    
    turnoutBtn?.classList.add("active");
    
    clearLayers(map);
    renderTurnoutView(map);
    currentState.view = VIEWS.TURNOUT;
    currentState.race = null; // Clear race when switching to turnout
    updateLegend('turnout');
  }
  
  // Update precinct if provided
  if (options.precinct) {
    currentState.precinct = options.precinct;
  }
  
  updateARIAStates(view);
  updateURL(currentState);
}

/**
 * Handle mobile sidebar toggle and gestures
 */
function setupMobileToggle() {
  let mobileToggle = document.getElementById("sidebar-toggle");
  let sidebar = document.getElementById("sidebar");
  let overlay = document.getElementById("sidebar-overlay");

  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener("click", function toggleSidebar() {
      let isOpen = sidebar.classList.toggle("open");
      overlay?.classList.toggle("visible", isOpen);
      mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Close sidebar when overlay is clicked
    overlay?.addEventListener("click", function closeSidebarOnOverlay() {
      sidebar.classList.remove("open");
      overlay.classList.remove("visible");
      mobileToggle.setAttribute('aria-expanded', 'false');
    });

    // Close sidebar on escape key
    document.addEventListener("keydown", function closeSidebarOnEscape(e) {
      if (e.key === 'Escape' && sidebar.classList.contains("open")) {
        sidebar.classList.remove("open");
        overlay?.classList.remove("visible");
        mobileToggle.setAttribute('aria-expanded', 'false');
      }
    });
    
    // Initialize swipe-to-close gesture for touch devices
    if (isTouchDevice()) {
      initSidebarGestures();
    }
  }
}

document.addEventListener("DOMContentLoaded", function initializeApp() {
  let demBtn = document.getElementById("view-dem-btn");
  let electBtn = document.getElementById("view-elect-btn");
  let turnoutBtn = document.getElementById("view-turnout-btn");
  let copyLinkBtn = document.getElementById("copy-link-btn");
  
  // Set initial ARIA attributes
  demBtn?.setAttribute('aria-pressed', 'true');
  electBtn?.setAttribute('aria-pressed', 'false');
  turnoutBtn?.setAttribute('aria-pressed', 'false');
  
  // Parse URL and restore state (now includes race parameter)
  let urlState = parseURL();
  
  // Initialize current state from URL
  currentState = {
    view: urlState.view || VIEWS.DEMOGRAPHICS,
    race: urlState.race || null,
    precinct: urlState.precinct || null
  };
  
  // Render initial view based on URL or default
  if (urlState.view === VIEWS.ELECTION) {
    electBtn?.classList.add("active");
    demBtn?.classList.remove("active");
    turnoutBtn?.classList.remove("active");
    // Pass initial race from URL to election view
    renderElectionView(map, { initialRace: urlState.race });
    updateARIAStates(VIEWS.ELECTION);
    updateLegend('election');
  } else if (urlState.view === VIEWS.TURNOUT) {
    turnoutBtn?.classList.add("active");
    demBtn?.classList.remove("active");
    electBtn?.classList.remove("active");
    renderTurnoutView(map);
    updateARIAStates(VIEWS.TURNOUT);
    updateLegend('turnout');
  } else {
    demBtn?.classList.add("active");
    renderDemographicsView(map);
    currentState.view = VIEWS.DEMOGRAPHICS;
    updateARIAStates(VIEWS.DEMOGRAPHICS);
    updateLegend('demographics');
  }
  
  // Update URL with initial state
  updateURL(currentState);

  // Show onboarding overlay for first-time users
  if (shouldShowOnboarding()) {
    showOnboardingOverlay(function handleOnboardingAction(action) {
      if (action === 'demographics') switchToView(VIEWS.DEMOGRAPHICS);
      else if (action === 'election') switchToView(VIEWS.ELECTION);
      else if (action === 'election-simulator') {
        switchToView(VIEWS.ELECTION);
        setTimeout(function scrollToSimulator() {
          let sim = document.getElementById('turnout-simulator-container');
          if (sim) sim.scrollIntoView({ behavior: 'smooth' });
        }, 500);
      }
      else if (action === 'precinct-lookup') window.location.href = 'precinct.html';
    });
  }

  // Set up view toggle handlers
  demBtn?.addEventListener("click", function showDemographicsView() {
    switchToView(VIEWS.DEMOGRAPHICS);
  });

  electBtn?.addEventListener("click", function showElectionView() {
    switchToView(VIEWS.ELECTION);
  });

  turnoutBtn?.addEventListener("click", function showTurnoutView() {
    switchToView(VIEWS.TURNOUT);
  });
  
  // Set up boundary selector
  let boundarySelect = document.getElementById("boundary-select");
  if (boundarySelect) {
    boundarySelect.value = getActiveBoundary();
    boundarySelect.addEventListener("change", function handleBoundaryChange() {
      setActiveBoundary(boundarySelect.value);
      clearLayers(map);
      // Re-render the current view with new boundary data
      switchToView(currentState.view, { force: true, race: currentState.race });
      // Show/hide boundary changes trigger
      updateBoundaryChangeTrigger();
    });
  }

  // Boundary changes trigger button
  let cachedBoundaryChangeData = null;
  function updateBoundaryChangeTrigger() {
    let trigger = document.getElementById("boundary-changes-trigger");
    if (trigger) {
      if (getActiveBoundary() === "2026") {
        trigger.classList.add("visible");
      } else {
        trigger.classList.remove("visible");
      }
    }
  }
  updateBoundaryChangeTrigger();

  let boundaryTrigger = document.getElementById("boundary-changes-trigger");
  if (boundaryTrigger) {
    boundaryTrigger.addEventListener("click", async function openBoundaryChangesPanel() {
      let panel = document.getElementById("boundary-changes-panel");
      let content = document.getElementById("boundary-panel-content");
      if (!panel || !content) return;

      if (!cachedBoundaryChangeData) {
        content.innerHTML = '<div style="padding:20px;text-align:center;">Loading...</div>';
        panel.classList.add("open");
        try {
          cachedBoundaryChangeData = await loadBoundaryChangeSummary();
        } catch (err) {
          content.innerHTML = '<div style="padding:20px;color:red;">Failed to load data.</div>';
          return;
        }
      }

      function renderPanel(filters) {
        let html = generateBoundaryStatsHTML(cachedBoundaryChangeData);
        html += generateBoundaryTableHTML(cachedBoundaryChangeData, filters);
        html += '<button class="boundary-export-btn" id="boundary-export-csv">Export CSV</button>';
        content.innerHTML = html;

        let filterSelect = document.getElementById("boundary-filter-type");
        if (filterSelect) {
          filterSelect.addEventListener("change", function() {
            renderPanel({ ...filters, changeType: filterSelect.value });
          });
        }
        content.querySelectorAll(".boundary-table th[data-sort]").forEach(function(th) {
          th.addEventListener("click", function() {
            let sortBy = th.dataset.sort;
            let sortDir = filters && filters.sortBy === sortBy && filters.sortDir === "asc" ? "desc" : "asc";
            renderPanel({ ...filters, sortBy: sortBy, sortDir: sortDir });
          });
        });
        let exportBtn = document.getElementById("boundary-export-csv");
        if (exportBtn) {
          exportBtn.addEventListener("click", function() {
            exportBoundaryCSV(cachedBoundaryChangeData);
          });
        }
      }

      renderPanel({});
      panel.classList.add("open");
    });
  }

  let closeBoundaryBtn = document.getElementById("close-boundary-panel");
  if (closeBoundaryBtn) {
    closeBoundaryBtn.addEventListener("click", function() {
      let panel = document.getElementById("boundary-changes-panel");
      if (panel) panel.classList.remove("open");
    });
  }

  // Set up copy link button
  copyLinkBtn?.addEventListener("click", handleCopyLink);

  // Handle browser back/forward
  window.addEventListener('hashchange', function handleHashChange() {
    let state = parseURL();
    switchToView(state.view, { race: state.race, precinct: state.precinct, force: true });
  });
  
  // Set up mobile toggle
  setupMobileToggle();
  
  // Initialize keyboard shortcuts (Phase 2 WS5)
  initKeyboardShortcuts();
  
  // Add keyboard navigation for view buttons
  for (let btn of [demBtn, electBtn, turnoutBtn].filter(Boolean)) {
    btn.addEventListener('keydown', function handleViewButtonKeydown(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });
  }
});
