// uiChrome.js
// --------------------------------------------------------------------------------
// App-wide chrome helpers for the map viewer: welcome overlay, the
// single-active-panel constraint, breadcrumbs, toast notifications, header
// collapse, map loading overlay, boundary disclaimer banner, theme icon.

import { state } from "./state.js";
import { closeProfilePanel } from "./precinctPanel.js";
import { setViewMode } from "./viewMode.js";
import { formatElectionName } from "../electionFilters.js";
import { getCurrentTheme } from "../themeManager.js";

// ==========================================================================
// WELCOME OVERLAY (D11) — shown once per browser, dismissible
// ==========================================================================
export const WELCOME_SEEN_KEY = 'ccd_welcome_seen';
export function dismissWelcome() {
  const overlay = document.getElementById('welcome-overlay');
  if (overlay) overlay.style.display = 'none';
  try { localStorage.setItem(WELCOME_SEEN_KEY, '1'); } catch { /* private mode */ }
}

// ==========================================================================
// GAP 4: SINGLE ACTIVE PANEL CONSTRAINT
// ==========================================================================
const PANEL_IDS = ['election-panel', 'precinct-profile-panel', 'competitive-ranker-panel'];
export function closeAllPanels(except = null) {
  PANEL_IDS.forEach(id => {
    if (id === except) return;
    const el = document.getElementById(id);
    if (el?.classList.contains('active')) {
      el.classList.remove('active');
      el.setAttribute('aria-hidden', 'true');
    }
  });
  // Reset FAB state if election panel was closed
  if (except !== 'election-panel') {
    const fabEl = document.getElementById('fab');
    const fabIconMenu = document.getElementById('fab-icon-menu');
    const fabIconClose = document.getElementById('fab-icon-close');
    if (fabEl?.classList.contains('active')) {
      fabEl.classList.remove('active');
      fabEl.setAttribute('aria-label', 'Browse elections');
      if (fabIconMenu) fabIconMenu.style.display = '';
      if (fabIconClose) fabIconClose.style.display = 'none';
    }
  }
}

// ==========================================================================
// GAP 6: BREADCRUMB NAVIGATION
// ==========================================================================
export function updateBreadcrumbs() {
  const bar = document.getElementById('breadcrumb-bar');
  if (!bar) return;

  const viewLabels = { demographics: 'Demographics', election: 'Elections', turnout: 'Turnout' };
  const crumbs = [];

  // First crumb: current view
  crumbs.push({ label: viewLabels[state.viewMode] || 'Map', action: 'view', isActive: !state.currentElection && !state.selectedPrecinct });

  // Second crumb: current election (if any)
  if (state.currentElection) {
    const name = state.currentElection.displayName || formatElectionName(state.currentElection.filename);
    const short = name.length > 25 ? name.substring(0, 25) + '...' : name;
    crumbs.push({ label: short, action: 'election', isActive: !state.selectedPrecinct });
  }

  // Third crumb: selected precinct (if profile panel is open)
  const profilePanel = document.getElementById('precinct-profile-panel');
  if (state.selectedPrecinct && profilePanel?.classList.contains('active')) {
    crumbs.push({ label: `Precinct ${state.selectedPrecinct.PRECINCT}`, action: 'precinct', isActive: true });
  }

  // A lone view-name crumb just repeats the header's active view toggle — hide it
  bar.style.display = crumbs.length > 1 ? '' : 'none';

  bar.innerHTML = crumbs.map((c, i) => {
    const sep = i > 0 ? '<span class="breadcrumb-sep">/</span>' : '';
    return `${sep}<span class="breadcrumb-item ${c.isActive ? 'active' : ''}" data-crumb="${c.action}">${c.label}</span>`;
  }).join('');

  // Wire click handlers
  bar.querySelectorAll('.breadcrumb-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.crumb;
      if (action === 'view') {
        closeProfilePanel();
        setViewMode(state.viewMode);
      } else if (action === 'election' && state.currentElection) {
        closeProfilePanel();
      }
    });
  });
}

// ==========================================================================
// TOAST NOTIFICATIONS (A4)
// ==========================================================================
export function showNotification(message) {
  const container = document.getElementById('toast-container');
  if (!container) { console.log(message); return; }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  // Auto-remove after 4 seconds with fade-out
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 4000);
}

// ==========================================================================
// HEADER TOGGLE
// ==========================================================================
const appHeader = document.getElementById('app-header');
const toggleHeaderBtn = document.getElementById('toggle-header');
let headerVisible = true;

export function toggleHeader() {
  headerVisible = !headerVisible;
  const showHeaderTab = document.getElementById('show-header-tab');
  if (headerVisible) {
    appHeader.classList.remove('collapsed');
    toggleHeaderBtn.title = 'Hide header';
    toggleHeaderBtn.setAttribute('aria-label', 'Hide header');
    if (showHeaderTab) showHeaderTab.style.display = 'none';
  } else {
    appHeader.classList.add('collapsed');
    toggleHeaderBtn.title = 'Show header';
    toggleHeaderBtn.setAttribute('aria-label', 'Show header');
    if (showHeaderTab) showHeaderTab.style.display = 'flex';
  }
}

toggleHeaderBtn.addEventListener('click', toggleHeader);
// A3: Header restore tab click
document.getElementById('show-header-tab').addEventListener('click', toggleHeader);

// ==========================================================================
// ERROR HANDLING
// ==========================================================================
export function showError(message) {
  console.error(message);
  // Could add toast notification here
}

// ==========================================================================
// BOUNDARY DISCLAIMER BANNER
// ==========================================================================
export function updateBoundaryDisclaimer(boundary) {
  const banner = document.getElementById('boundary-disclaimer');
  if (!banner) return;
  banner.style.display = boundary === '2026' ? 'flex' : 'none';
}

// ==========================================================================
// MAP LOADING OVERLAY (D12)
// ==========================================================================
export function showMapLoading(message = 'Loading election data...') {
  const container = document.getElementById('map-container');
  if (!container || document.getElementById('map-loading-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'map-loading-overlay';
  overlay.innerHTML = `<div class="loading-spinner"></div><div class="loading-text">${message}</div>`;
  container.appendChild(overlay);
}

export function hideMapLoading() {
  const overlay = document.getElementById('map-loading-overlay');
  if (overlay) overlay.remove();
}

// ==========================================================================
// THEME TOGGLE ICON
// ==========================================================================
export function updateThemeToggleIcon() {
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.textContent = getCurrentTheme() === 'dark' ? '☀️' : '🌙';
  }
}
