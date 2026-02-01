import { renderDemographicsView } from "./demographicsView.js";
import { renderElectionView } from "./electionView.js";
import { renderTurnoutView } from "./turnoutView.js";
import { initMap } from "./mapInitializer.js";
import { clearLayers } from "./utils.js";
import { MAP_CONFIG } from "./constants.js";
import { updateLegend } from "./legendController.js";
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

const map = initMap({ center: MAP_CONFIG.center, zoom: MAP_CONFIG.zoom });

// Expose map globally for turnout view's leaderboard zoom functionality
window.leafletMap = map;

// View state constants (extended with turnout)
const VIEWS = {
  DEMOGRAPHICS: 'demographics',
  ELECTION: 'election',
  TURNOUT: 'turnout'
};

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
  const sanitized = sanitizeState(state);
  const hash = buildURLHash(sanitized);
  history.replaceState(sanitized, '', `#${hash}`);
  currentState = { ...currentState, ...sanitized };
}

/**
 * Parse URL hash and return view state
 * Now supports race parameter for shareable election links
 */
function parseURL() {
  const state = parseURLHash(location.hash);
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
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alert');
  
  // Icon based on type
  const icons = {
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
  const btn = document.getElementById('copy-link-btn');
  if (!btn) return;
  
  const url = getShareableURL(currentState);
  const result = await copyToClipboard(url);
  
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
  const demBtn = document.getElementById("view-dem-btn");
  const electBtn = document.getElementById("view-elect-btn");
  const turnoutBtn = document.getElementById("view-turnout-btn");
  
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
  const demBtn = document.getElementById("view-dem-btn");
  const electBtn = document.getElementById("view-elect-btn");
  const turnoutBtn = document.getElementById("view-turnout-btn");
  
  // Remove active from all buttons
  demBtn?.classList.remove("active");
  electBtn?.classList.remove("active");
  turnoutBtn?.classList.remove("active");
  
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
  const mobileToggle = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  
  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener("click", () => {
      const isOpen = sidebar.classList.toggle("open");
      overlay?.classList.toggle("visible", isOpen);
      mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    
    // Close sidebar when overlay is clicked
    overlay?.addEventListener("click", () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("visible");
      mobileToggle.setAttribute('aria-expanded', 'false');
    });
    
    // Close sidebar on escape key
    document.addEventListener("keydown", (e) => {
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

document.addEventListener("DOMContentLoaded", () => {
  const demBtn = document.getElementById("view-dem-btn");
  const electBtn = document.getElementById("view-elect-btn");
  const turnoutBtn = document.getElementById("view-turnout-btn");
  const copyLinkBtn = document.getElementById("copy-link-btn");
  
  // Set initial ARIA attributes
  demBtn?.setAttribute('aria-pressed', 'true');
  electBtn?.setAttribute('aria-pressed', 'false');
  turnoutBtn?.setAttribute('aria-pressed', 'false');
  
  // Parse URL and restore state (now includes race parameter)
  const urlState = parseURL();
  
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

  // Set up view toggle handlers
  demBtn?.addEventListener("click", () => {
    switchToView(VIEWS.DEMOGRAPHICS);
  });

  electBtn?.addEventListener("click", () => {
    switchToView(VIEWS.ELECTION);
  });

  turnoutBtn?.addEventListener("click", () => {
    switchToView(VIEWS.TURNOUT);
  });
  
  // Set up copy link button
  copyLinkBtn?.addEventListener("click", handleCopyLink);
  
  // Handle browser back/forward
  window.addEventListener('hashchange', () => {
    const state = parseURL();
    switchToView(state.view, { race: state.race, precinct: state.precinct, force: true });
  });
  
  // Set up mobile toggle
  setupMobileToggle();
  
  // Initialize keyboard shortcuts (Phase 2 WS5)
  initKeyboardShortcuts();
  
  // Add keyboard navigation for view buttons
  [demBtn, electBtn, turnoutBtn].filter(Boolean).forEach(btn => {
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });
  });
});
