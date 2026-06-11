// electionPanel.js
// --------------------------------------------------------------------------------
// The Browse Elections panel: tabbed content (Browse / Forecast / Saved),
// filters, grouped race list, recently-viewed history, and all its wiring.

import { state } from "./state.js";
import { showNotification } from "./uiChrome.js";
import { hideInfoCard } from "./precinctPanel.js";
import { setViewMode } from "./viewMode.js";
import { updateForecastButton } from "./panels.js";
import { renderForecastSection } from "./forecast.js";
import { selectElection, updateURLState } from "./electionWorkflow.js";
import { CATEGORY_ORDER, filterByCategory, filterByYear, searchElections, formatElectionName } from "../electionFilters.js";
import { toggleBookmark, renderBookmarkStar, renderBookmarksSection, getBookmarks } from "../bookmarkManager.js";
import { exportRaceResults } from "../exportManager.js";
import { escapeHtml } from "../utils.js";

export function renderElectionPanel() {
  const panelContent = document.getElementById('panel-content-area');
  if (!panelContent) return;

  // Apply filters
  let filtered = state.elections;

  if (state.filters.category && state.filters.category !== 'All') {
    filtered = filterByCategory(filtered, state.filters.category);
  }

  if (state.filters.year) {
    filtered = filterByYear(filtered, state.filters.year);
  }

  if (state.filters.search) {
    filtered = searchElections(filtered, state.filters.search);
  }

  state.filteredElections = filtered;

  // Group by category
  const grouped = {};
  CATEGORY_ORDER.forEach(cat => {
    if (cat !== 'All') {
      grouped[cat] = filterByCategory(filtered, cat);
    }
  });

  // Gap 5: Build tabbed content
  const tab = state.activeElectionTab;

  // --- Browse Tab ---
  const browseHtml = `
    <div class="panel-tab-content ${tab === 'browse' ? 'active' : ''}" data-tab-content="browse">
      <input
        type="text"
        class="panel-search"
        placeholder="Search races..."
        id="panel-search-input"
        value="${escapeHtml(state.filters.search)}"
      />
      <div class="filter-chips" id="filter-chips" role="group" aria-label="Filter elections">
        ${renderFilterChips()}
      </div>
      <div id="election-groups">
        ${renderElectionGroups(grouped)}
      </div>
      ${filtered.length === 0 ? renderEmptyState() : ''}
    </div>
  `;

  // --- Forecast Tab ---
  const forecastHtml = `
    <div class="panel-tab-content ${tab === 'forecast' ? 'active' : ''}" data-tab-content="forecast">
      ${state.currentElection ? `
        <div id="forecast-section" class="forecast-section active">
          <div class="forecast-header">
            <div class="forecast-election">
              <span class="forecast-label">Forecasting:</span>
              <strong>${state.currentElection.displayName || formatElectionName(state.currentElection.filename)}</strong>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <button id="export-race-csv" class="export-csv-btn" title="Export race results to CSV">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export CSV
              </button>
              <button id="clear-election-btn" class="clear-election-btn" title="Clear selection">✕</button>
            </div>
          </div>
          <div id="universe-builder-container"></div>
          <div id="turnout-simulator-container"></div>
          <div id="simulation-summary"></div>
          <div id="reverse-calculator-container"></div>
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <div class="empty-state-title">No election selected</div>
          <div class="empty-state-text">Select an election from the Browse tab to enable forecasting</div>
        </div>
      `}
    </div>
  `;

  // --- Saved Tab ---
  const savedHtml = `
    <div class="panel-tab-content ${tab === 'saved' ? 'active' : ''}" data-tab-content="saved">
      ${renderBookmarksSection(state.elections)}
      ${renderRecentlyViewed()}
      ${state.recentlyViewed.length === 0 && getBookmarks().length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">⭐</div>
          <div class="empty-state-title">No saved items</div>
          <div class="empty-state-text">Bookmark elections or browse to build your history</div>
        </div>
      ` : ''}
    </div>
  `;

  panelContent.innerHTML = browseHtml + forecastHtml + savedHtml;

  // Update tab bar active state
  document.querySelectorAll('#election-panel-tabs .panel-tab').forEach(t => {
    const isActive = t.dataset.panelTab === tab;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', isActive);
  });

  // Re-attach event listeners
  attachPanelEventListeners();
  if (state.currentElection && state.currentElectionData && tab === 'forecast') {
    renderForecastSection();
  }
}

function renderFilterChips() {
  const years = [...new Set(state.elections.map(e => e.year).filter(y => y))].sort((a, b) => b - a);
  const noneActive = state.filters.category === 'All' && !state.filters.year;

  return `
    <button class="filter-chip ${noneActive ? 'active' : ''}" data-filter="all" aria-pressed="${noneActive}">All (${state.elections.length})</button>
    ${years.slice(0, 3).map(year => {
      const isActive = state.filters.year === year;
      return `<button class="filter-chip ${isActive ? 'active' : ''}" data-filter="year-${year}" aria-pressed="${isActive}">${year}</button>`;
    }).join('')}
    ${CATEGORY_ORDER.filter(c => c !== 'All').slice(0, 3).map(cat => {
      const count = filterByCategory(state.elections, cat).length;
      const isActive = state.filters.category === cat;
      return count > 0 ? `
        <button class="filter-chip ${isActive ? 'active' : ''}" data-filter="cat-${cat}" aria-pressed="${isActive}">${cat}</button>
      ` : '';
    }).join('')}
  `;
}

function renderRecentlyViewed() {
  if (state.recentlyViewed.length === 0) return '';

  return `
    <div class="recent-section">
      <div class="section-title" style="display: flex; justify-content: space-between; align-items: center;">
        <span>Recently Viewed</span>
        <button id="clear-recent" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 11px;">Clear</button>
      </div>
      ${state.recentlyViewed.map(entry => `
        <div class="recent-item ${state.currentElection?.filename === entry.filename ? 'selected' : ''}" data-filename="${entry.filename}">
          <div class="recent-item-title">${entry.displayName || formatElectionName(entry.filename)}</div>
          <div class="recent-item-meta">${entry.year || ''} • ${entry.category || 'Election'}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderElectionGroups(grouped) {
  return CATEGORY_ORDER.filter(cat => cat !== 'All').map(category => {
    const elections = grouped[category] || [];
    if (elections.length === 0) return '';

    // B5: Groups collapsed by default; expand if the current election belongs
    // to this category, or when searching (results are already filtered —
    // keeping them collapsed makes matches look like an empty panel)
    const hasSelected = state.currentElection && elections.some(e => e.filename === state.currentElection.filename);
    const searchActive = Boolean(state.filters.search && state.filters.search.trim());
    const expandedClass = (hasSelected || searchActive) ? 'expanded' : '';

    return `
      <div class="election-group ${expandedClass}" data-category="${category}">
        <div class="group-header">
          <div>
            <div class="group-title">${category}</div>
          </div>
          <span style="display:flex;align-items:center;gap:8px;">
            <span class="group-count">${elections.length} races</span>
            <svg class="group-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 6 15 12 9 18"></polyline></svg>
          </span>
        </div>
        <div class="election-list">
          ${elections.map(entry => `
            <div class="election-item ${state.currentElection?.filename === entry.filename ? 'selected' : ''}" data-filename="${entry.filename}">
              <span class="election-item-name">${entry.displayName || formatElectionName(entry.filename)}</span>
              <span style="display:flex;align-items:center;gap:4px;">
                ${renderBookmarkStar(entry.filename)}
                <span class="election-item-year">${entry.year || ''}</span>
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderEmptyState() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">🔍</div>
      <div class="empty-state-title">No races found</div>
      <div class="empty-state-text">Try adjusting your filters or search query</div>
    </div>
  `;
}

function attachPanelEventListeners() {
  // Gap 5: Panel tab switching
  document.querySelectorAll('#election-panel-tabs .panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.activeElectionTab = tab.dataset.panelTab;
      renderElectionPanel();
    });
  });

  // Search input
  const searchInput = document.getElementById('panel-search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.filters.search = e.target.value;
        renderElectionPanel();
      }, 300);
    });
  }

  // B6: Filter chips - combinable (AND logic). Year and category can both be active.
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const filter = chip.dataset.filter;
      if (filter === 'all') {
        // Clear both filters
        state.filters.year = null;
        state.filters.category = 'All';
      } else if (filter.startsWith('year-')) {
        const year = parseInt(filter.replace('year-', ''));
        // Toggle: if already selected, deselect; otherwise select (keep category)
        state.filters.year = (state.filters.year === year) ? null : year;
      } else if (filter.startsWith('cat-')) {
        const cat = filter.replace('cat-', '');
        // Toggle: if already selected, deselect; otherwise select (keep year)
        state.filters.category = (state.filters.category === cat) ? 'All' : cat;
      }
      renderElectionPanel();
    });
  });

  // Election items
  document.querySelectorAll('.election-item').forEach(item => {
    item.addEventListener('click', () => {
      const filename = item.dataset.filename;
      const entry = state.elections.find(e => e.filename === filename);
      if (entry) {
        selectElection(entry);
      }
    });
  });

  // Recent items
  document.querySelectorAll('.recent-item').forEach(item => {
    item.addEventListener('click', () => {
      const filename = item.dataset.filename;
      const entry = state.elections.find(e => e.filename === filename);
      if (entry) {
        selectElection(entry);
      }
    });
  });

  // Clear recent
  const clearRecentBtn = document.getElementById('clear-recent');
  if (clearRecentBtn) {
    clearRecentBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.recentlyViewed = [];
      saveRecentlyViewed();
      renderElectionPanel();
    });
  }

  // Clear election (in forecast section)
  const clearElectionBtn = document.getElementById('clear-election-btn');
  if (clearElectionBtn) {
    clearElectionBtn.addEventListener('click', () => {
      state.currentElection = null;
      state.currentElectionData = null;
      state.simulationResult = null;
      state.sliderState = null;
      state.voterFlipState = null;
      setViewMode('demographics');
      hideInfoCard();
      renderElectionPanel();
      updateURLState();
      updateForecastButton();
    });
  }

  // Group headers
  document.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('click', () => {
      const group = header.closest('.election-group');
      group.classList.toggle('expanded');
    });
  });

  // E1: Export CSV button
  const exportRaceBtn = document.getElementById('export-race-csv');
  if (exportRaceBtn) {
    exportRaceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.currentElectionData && state.currentElection) {
        exportRaceResults(state.currentElectionData, state.currentElection.filename);
        showNotification('Race results exported to CSV');
      }
    });
  }

  // Bookmark stars
  document.querySelectorAll('.bookmark-star').forEach(star => {
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      const filename = star.dataset.bookmark;
      const entry = state.elections.find(el => el.filename === filename);
      if (entry) {
        toggleBookmark(entry);
        renderElectionPanel();
      }
    });
  });
}

// ==========================================================================
// RECENTLY VIEWED
// ==========================================================================
export function loadRecentlyViewed() {
  try {
    const saved = localStorage.getItem('ccd_recently_viewed');
    if (saved) {
      state.recentlyViewed = JSON.parse(saved);
      // Validate against current elections
      state.recentlyViewed = state.recentlyViewed.filter(entry =>
        state.elections.some(e => e.filename === entry.filename)
      );
    }
  } catch {
    state.recentlyViewed = [];
  }
}

function saveRecentlyViewed() {
  try {
    localStorage.setItem('ccd_recently_viewed', JSON.stringify(state.recentlyViewed));
  } catch {
    console.warn('Failed to save recently viewed');
  }
}

export function addToRecentlyViewed(entry) {
  // Remove if already exists
  state.recentlyViewed = state.recentlyViewed.filter(e => e.filename !== entry.filename);
  // Add to front
  state.recentlyViewed.unshift(entry);
  // Keep max 5
  if (state.recentlyViewed.length > 5) {
    state.recentlyViewed = state.recentlyViewed.slice(0, 5);
  }
  saveRecentlyViewed();
  renderElectionPanel();
}
