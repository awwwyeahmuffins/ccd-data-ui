// sidebarTemplates.js
// --------------------------------------------------------------------------------
// Build small HTML snippets (strings) that represent pieces of the sidebar.
// We can then assemble them in sidebarController.js.
//
// Workstream 2: Card-based design system
// ============================================================================

// ============================================================================
// CARD SYSTEM COMPONENTS (Workstream 2)
// ============================================================================

/**
 * Creates a reusable card component with optional icon
 * @param {string} title - Card title
 * @param {string|null} icon - SVG icon string or null
 * @param {string} content - HTML content for the card body
 * @param {Object} options - Optional configuration (colorClass, collapsed, etc.)
 * @returns {string} HTML string for the card
 */
export function createCard(title, icon, content, options = {}) {
  const { colorClass = 'blue', collapsed = false } = options;
  
  if (!title || typeof title !== 'string') {
    return '';
  }
  
  const iconHtml = icon 
    ? `<div class="ui-card-icon ${colorClass}">${icon}</div>` 
    : '';
  
  const collapsedClass = collapsed ? ' collapsed' : '';
  
  return `
    <div class="ui-card${collapsedClass}">
      <div class="ui-card-header">
        ${iconHtml}
        <div class="ui-card-title-group">
          <h3 class="ui-card-title">${title}</h3>
        </div>
      </div>
      <div class="ui-card-body">
        ${content || ''}
      </div>
    </div>
  `.trim();
}

/**
 * Creates a card with a subtitle under the title
 * @param {string} title - Main title
 * @param {string} subtitle - Subtitle text
 * @param {string|null} icon - Optional SVG icon string
 * @param {string} content - Card body content
 * @param {Object} options - Additional options (colorClass)
 * @returns {string} HTML string
 */
export function createCardWithSubtitle(title, subtitle, icon, content, options = {}) {
  const { colorClass = 'blue' } = options;
  
  if (!title || typeof title !== 'string') {
    return '';
  }
  
  const iconHtml = icon 
    ? `<div class="ui-card-icon ${colorClass}">${icon}</div>` 
    : '';
  
  const subtitleHtml = subtitle 
    ? `<p class="ui-card-subtitle">${subtitle}</p>` 
    : '';
  
  return `
    <div class="ui-card">
      <div class="ui-card-header">
        ${iconHtml}
        <div class="ui-card-title-group">
          <h3 class="ui-card-title">${title}</h3>
          ${subtitleHtml}
        </div>
      </div>
      <div class="ui-card-body">
        ${content || ''}
      </div>
    </div>
  `.trim();
}

/**
 * Creates a statistics grid layout
 * @param {Array} stats - Array of stat objects with { label, value, colorClass? }
 * @returns {string} HTML string for the stat grid
 */
export function createStatGrid(stats) {
  if (!Array.isArray(stats) || stats.length === 0) {
    return '';
  }
  
  let statItems = stats
    .filter(stat => stat && stat.label && stat.value !== undefined)
    .map(function formatStatItem(stat) {
      const colorClass = stat.colorClass ? ` ${stat.colorClass}` : '';
      return `
        <div class="stat-item">
          <span class="stat-value${colorClass}">${stat.value}</span>
          <span class="stat-label">${stat.label}</span>
        </div>
      `.trim();
    })
    .join('\n');
  
  return `<div class="stat-grid">${statItems}</div>`;
}

/**
 * Creates a section divider with optional label
 * @param {string} label - Optional divider label
 * @returns {string} HTML string for the divider
 */
export function createDivider(label = '') {
  if (label) {
    return `<div class="ui-divider"><span class="ui-divider-label">${label}</span></div>`;
  }
  return `<div class="ui-divider"></div>`;
}

// ============================================================================
// COMMON ICONS (SVG strings for use with card components)
// ============================================================================

export let ICONS = {
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
    <circle cx="9" cy="7" r="4"></circle>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
  </svg>`,
  
  pieChart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
    <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
  </svg>`,
  
  barChart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"></line>
    <line x1="12" y1="20" x2="12" y2="4"></line>
    <line x1="6" y1="20" x2="6" y2="14"></line>
  </svg>`,
  
  mapPin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
    <circle cx="12" cy="10" r="3"></circle>
  </svg>`,
  
  vote: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
    <polyline points="22 4 12 14.01 9 11.01"></polyline>
  </svg>`,
  
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="16" x2="12" y2="12"></line>
    <line x1="12" y1="8" x2="12.01" y2="8"></line>
  </svg>`,
  
  trending: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
    <polyline points="17 6 23 6 23 12"></polyline>
  </svg>`
};

// ============================================================================
// LEGACY TEMPLATE FUNCTIONS (preserved for backward compatibility)
// ============================================================================

export function precinctHeader(precinctNumber) {
  return `<h3>Precinct ${precinctNumber}</h3>`;
}

export function precinctListItem(label, value) {
  return `<li><strong>${label}:</strong> ${value}</li>`;
}

// Compose the full sidebar HTML for party info.
export function precinctPartyInfoHTML(p) {
  // p is the feature.properties
  return `
    <p><strong>Party Lean:</strong> ${p.winningParty}</p>
    <p><strong>Party Strength:</strong> ${p.partyStrength}</p>
  `;
}

// Optionally, you can provide a function to wrap a <ul> of demographic items:
export function precinctDemographicsListHTML(p) {
  // if you want to list rep/mod/dem percentages
  return `
    <ul>
      ${precinctListItem("Rep Share", (p.repShare * 100).toFixed(1) + "%")}
      ${precinctListItem("Mod Share", (p.modShare * 100).toFixed(1) + "%")}
      ${precinctListItem("Dem Share", (p.demShare * 100).toFixed(1) + "%")}
    </ul>
  `;
}

// ============================================================================
// ENHANCED PRECINCT CARD (uses new card system)
// ============================================================================

/**
 * Creates a precinct info card using the new card system
 * @param {Object} p - Precinct properties
 * @returns {string} HTML string for the precinct card
 */
export function precinctInfoCard(p) {
  let stats = [
    { label: 'Party Lean', value: p.winningParty || 'N/A' },
    { label: 'Strength', value: p.partyStrength || 'N/A' }
  ];

  let partyShares = createStatGrid([
    { label: 'Rep', value: ((p.repShare || 0) * 100).toFixed(1) + '%', colorClass: 'rep' },
    { label: 'Mod', value: ((p.modShare || 0) * 100).toFixed(1) + '%', colorClass: 'mod' },
    { label: 'Dem', value: ((p.demShare || 0) * 100).toFixed(1) + '%', colorClass: 'dem' }
  ]);
  
  const content = `
    ${createStatGrid(stats)}
    ${createDivider('Party Distribution')}
    ${partyShares}
  `;
  
  return createCard(`Precinct ${p.PRECINCT}`, ICONS.mapPin, content, { colorClass: 'blue' });
}

// ============================================================================
// EMPTY STATE ILLUSTRATIONS (Phase 2 - Workstream 2)
// ============================================================================

/**
 * Renders empty search results illustration
 * Used when search/filter returns no elections
 * @returns {string} HTML string for empty search state
 */
export function emptySearchResultsHTML() {
  return `
    <div class="empty-illustration">
      <svg class="empty-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="28" cy="28" r="16"/>
        <line x1="40" y1="40" x2="52" y2="52"/>
        <line x1="20" y1="28" x2="36" y2="28"/>
      </svg>
      <h4>No elections found</h4>
      <p>Try adjusting your search or filter criteria.</p>
    </div>
  `;
}

/**
 * Renders prompt for user to click a precinct on the map
 * Used as initial state in sidebar before any precinct is selected
 * @returns {string} HTML string for precinct selection prompt
 */
export function clickPrecinctPromptHTML() {
  return `
    <div class="empty-illustration">
      <svg class="empty-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M32 8 C20 8 12 18 12 28 C12 42 32 56 32 56 C32 56 52 42 52 28 C52 18 44 8 32 8Z"/>
        <circle cx="32" cy="28" r="6"/>
        <path d="M26 48 L32 56 L38 48" stroke-linecap="round"/>
      </svg>
      <h4>Select a Precinct</h4>
      <p>Click on any precinct on the map to view detailed results and statistics.</p>
    </div>
  `;
}

/**
 * Renders no data available state for a specific precinct
 * Used when a precinct didn't participate in a selected election
 * @param {string|number} precinctCode - The precinct identifier
 * @returns {string} HTML string for no data state
 */
export function noDataAvailableHTML(precinctCode) {
  return `
    <div class="empty-illustration">
      <svg class="empty-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="12" y="8" width="40" height="48" rx="4"/>
        <line x1="20" y1="20" x2="44" y2="20"/>
        <line x1="20" y1="28" x2="44" y2="28"/>
        <line x1="20" y1="36" x2="32" y2="36"/>
        <circle cx="40" cy="44" r="8"/>
        <line x1="36" y1="44" x2="44" y2="44"/>
      </svg>
      <h4>No Data Available</h4>
      <p>Precinct ${precinctCode} did not participate in this election.</p>
    </div>
  `;
}

/**
 * Renders error state with custom message and retry action
 * Used when data loading fails or other errors occur
 * @param {string} message - Error message to display
 * @param {string} retryAction - JavaScript function call string for retry button
 * @returns {string} HTML string for error state
 */
export function errorStateHTML(message, retryAction) {
  return `
    <div class="empty-illustration error">
      <svg class="empty-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="32" cy="32" r="24"/>
        <line x1="32" y1="20" x2="32" y2="36"/>
        <circle cx="32" cy="44" r="2" fill="currentColor"/>
      </svg>
      <h4>Something went wrong</h4>
      <p>${message}</p>
      <button class="retry-btn" onclick="${retryAction}">Try Again</button>
    </div>
  `;
}
