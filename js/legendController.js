// legendController.js
// Controls the map legend display based on current view
// Workstream 3: Map Legend & Tooltip Improvements

import { PARTY_COLORS, TURNOUT_CONFIG } from './constants.js';

// ============================================================================
// LEGEND CONTENT GENERATORS
// ============================================================================

/**
 * Generate demographics view legend HTML
 * @returns {string} HTML string for demographics legend
 */
export function generateDemographicsLegend() {
  return `
    <h4 class="legend-title">Party Lean</h4>
    <div class="legend-items">
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-rep"></span>
        <span class="legend-label">Republican</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-dem"></span>
        <span class="legend-label">Democrat</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-mod"></span>
        <span class="legend-label">Moderate</span>
      </div>
    </div>
    <p class="legend-note">Color intensity indicates strength</p>
  `.trim();
}

/**
 * Generate election view legend HTML
 * @param {Object} options - Configuration options
 * @param {boolean} options.showSimulationFlipped - Whether to show flipped precinct indicator
 * @param {number} options.flippedCount - Number of flipped precincts (if simulation active)
 * @returns {string} HTML string for election legend
 */
export function generateElectionLegend(options = {}) {
  const { showSimulationFlipped = false, flippedCount = 0 } = options;
  
  let html = `
    <h4 class="legend-title">Election Results</h4>
    <div class="legend-items">
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${PARTY_COLORS.Rep}"></span>
        <span class="legend-label">Republican</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${PARTY_COLORS.Dem}"></span>
        <span class="legend-label">Democrat</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${PARTY_COLORS.For}"></span>
        <span class="legend-label">For/Passed</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${PARTY_COLORS.Against}"></span>
        <span class="legend-label">Against/Failed</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-no-data"></span>
        <span class="legend-label">Not in Race</span>
      </div>
    </div>
  `.trim();

  // Add flipped precinct indicator when simulation is active
  if (showSimulationFlipped) {
    html += generateSimulationSection(flippedCount);
  }

  return html;
}

/**
 * Generate turnout view legend HTML with gradient bar
 * @param {Object} options - Configuration options
 * @param {number} options.minTurnout - Minimum turnout percentage to show (default: 0)
 * @param {number} options.maxTurnout - Maximum turnout percentage to show (default: 100)
 * @param {boolean} options.showSimulationFlipped - Whether to show flipped precinct indicator
 * @param {number} options.flippedCount - Number of flipped precincts
 * @returns {string} HTML string for turnout legend
 */
export function generateTurnoutLegend(options = {}) {
  const { 
    minTurnout = 0, 
    maxTurnout = 100, 
    showSimulationFlipped = false, 
    flippedCount = 0 
  } = options;

  const midTurnout = Math.round((minTurnout + maxTurnout) / 2);

  let html = `
    <h4 class="legend-title">Voter Turnout</h4>
    <div class="legend-gradient-container">
      <div class="legend-gradient-bar" aria-label="Turnout gradient from ${minTurnout}% to ${maxTurnout}%"></div>
      <div class="legend-gradient-labels">
        <span>${minTurnout}%</span>
        <span>${midTurnout}%</span>
        <span>${maxTurnout}%</span>
      </div>
    </div>
    <div class="legend-items">
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-low-turnout"></span>
        <span class="legend-label">Low Turnout</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-medium-turnout"></span>
        <span class="legend-label">Medium</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-high-turnout"></span>
        <span class="legend-label">High Turnout</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-no-data"></span>
        <span class="legend-label">No Data</span>
      </div>
    </div>
  `.trim();

  // Add flipped precinct indicator when simulation is active
  if (showSimulationFlipped) {
    html += generateSimulationSection(flippedCount);
  }

  return html;
}

/**
 * Generate simulation section HTML for flipped precincts
 * @param {number} flippedCount - Number of flipped precincts
 * @returns {string} HTML string for simulation section
 */
function generateSimulationSection(flippedCount) {
  const precinctLabel = flippedCount === 1 ? 'Precinct' : 'Precincts';
  const countBadge = flippedCount > 0 
    ? `<span class="legend-count">${flippedCount}</span>` 
    : '';

  return `
    <div class="legend-divider"></div>
    <div class="legend-simulation-section">
      <h5 class="legend-subtitle">Simulation Active</h5>
      <div class="legend-item legend-flipped-item">
        <span class="legend-swatch legend-swatch-flipped"></span>
        <span class="legend-label">Flipped ${precinctLabel}</span>
        ${countBadge}
      </div>
    </div>
  `.trim();
}

// ============================================================================
// MAIN LEGEND CONTENT GENERATOR
// ============================================================================

/**
 * Generate legend HTML content for a specific view type
 * @param {string} viewType - 'demographics', 'election', or 'turnout'
 * @param {Object} options - Optional configuration
 * @returns {string} HTML string for the legend content
 */
export function generateLegendContent(viewType, options = {}) {
  if (!viewType || typeof viewType !== 'string') {
    return '';
  }

  switch (viewType) {
    case 'demographics':
      return generateDemographicsLegend();
    case 'election':
      return generateElectionLegend(options);
    case 'turnout':
      return generateTurnoutLegend(options);
    default:
      return '';
  }
}

// ============================================================================
// DOM MANIPULATION
// ============================================================================

/**
 * Update the map legend based on the current view
 * @param {string} viewType - 'demographics', 'election', or 'turnout'
 * @param {Object} options - Optional configuration for the legend
 * @returns {boolean} True if update was successful
 */
export function updateLegend(viewType, options = {}) {
  let legendContainer = document.getElementById('map-legend');
  if (!legendContainer) return false;

  const content = generateLegendContent(viewType, options);
  if (!content) return false;

  legendContainer.innerHTML = content;

  // Add/remove simulation class for additional styling
  if (options.showSimulationFlipped) {
    legendContainer.classList.add('simulation-active');
  } else {
    legendContainer.classList.remove('simulation-active');
  }

  return true;
}

/**
 * Convenience method: Update legend for demographics view
 */
export function updateLegendForDemographics() {
  return updateLegend('demographics');
}

/**
 * Convenience method: Update legend for election view
 * @param {Object} options - Optional configuration
 */
export function updateLegendForElection(options = {}) {
  return updateLegend('election', options);
}

/**
 * Convenience method: Update legend for turnout view
 * @param {Object} options - Optional configuration
 */
export function updateLegendForTurnout(options = {}) {
  return updateLegend('turnout', options);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if the legend currently indicates simulation is active
 * @returns {boolean}
 */
export function isSimulationIndicatorActive() {
  let legendContainer = document.getElementById('map-legend');
  if (!legendContainer) return false;
  return legendContainer.classList.contains('simulation-active');
}

/**
 * Show flipped precinct indicator on the legend
 * @param {string} viewType - Current view type
 * @param {number} flippedCount - Number of flipped precincts
 */
export function showFlippedIndicator(viewType, flippedCount) {
  return updateLegend(viewType, { 
    showSimulationFlipped: true, 
    flippedCount 
  });
}

/**
 * Hide flipped precinct indicator from the legend
 * @param {string} viewType - Current view type
 */
export function hideFlippedIndicator(viewType) {
  return updateLegend(viewType, { 
    showSimulationFlipped: false 
  });
}

/**
 * Update turnout legend with dynamic range
 * @param {number} minTurnout - Minimum turnout percentage
 * @param {number} maxTurnout - Maximum turnout percentage
 * @param {Object} simulationOptions - Optional simulation options
 */
export function updateTurnoutLegendWithRange(minTurnout, maxTurnout, simulationOptions = {}) {
  return updateLegend('turnout', {
    minTurnout,
    maxTurnout,
    ...simulationOptions
  });
}
