// precinctLayer.js
// --------------------------------------------------------------------------------
// Create a Leaflet GeoJSON layer for all precincts, style them by winningParty,
// attach tooltips and click/hover handlers (delegating the click logic to a callback).
//
// Phase 2 Workstream 3: Enhanced tooltips with mini charts and comparisons
//
// Usage in app.js:
//   import { createPrecinctLayer, generateEnhancedTooltip } from "./precinctLayer.js";
//   const layer = createPrecinctLayer(map, geojson, { onClickPrecinct, onHoverPrecinct });
//
//   where onClickPrecinct(properties, leafletLayer) is your callback to drive sidebar/chart.
//

// ============================================================================
// TOOLTIP HELPER FUNCTIONS
// ============================================================================

/**
 * Get turnout level class based on percentage
 * @param {number} turnout - Turnout percentage (0-100)
 * @returns {string} CSS class name: 'low', 'medium', or 'high'
 */
export function getTurnoutClass(turnout) {
  if (turnout == null || isNaN(turnout)) return 'low';
  if (turnout < 40) return 'low';
  if (turnout < 60) return 'medium';
  return 'high';
}

/**
 * Format share value as percentage
 * @param {number} share - Share value (0-1)
 * @returns {string} Formatted percentage without % sign
 */
export function formatShare(share) {
  if (share == null || isNaN(share)) return '0';
  return (share * 100).toFixed(0);
}

/**
 * Calculate comparison data for tooltip
 * @param {number} value - Current value
 * @param {number} baseline - Baseline value to compare against
 * @returns {Object} { diff, diffClass, diffSign }
 */
export function calculateComparison(value, baseline) {
  if (value == null || baseline == null || isNaN(value) || isNaN(baseline)) {
    return { diff: 0, diffClass: '', diffSign: '' };
  }
  
  const diff = value - baseline;
  const diffClass = diff >= 0 ? 'positive' : 'negative';
  const diffSign = diff >= 0 ? '+' : '';
  
  return { diff, diffClass, diffSign };
}

// ============================================================================
// TOOLTIP CONTENT GENERATORS
// ============================================================================

/**
 * Generate demographics-specific tooltip content
 * @param {Object} properties - Feature properties
 * @returns {string} HTML string
 */
export function generateDemographicsTooltipContent(properties) {
  const repPct = formatShare(properties.repShare);
  const demPct = formatShare(properties.demShare);
  const modPct = formatShare(properties.modShare);
  const winningParty = properties.winningParty || 'Unknown';
  const strength = properties.partyStrength || 1;

  return `
    <div class="tooltip-row">
      <span class="tooltip-label">Party Lean:</span>
      <span class="tooltip-value winner-highlight ${winningParty.toLowerCase()}">${winningParty}</span>
    </div>
    <div class="tooltip-mini-chart" aria-label="Party breakdown: Rep ${repPct}%, Mod ${modPct}%, Dem ${demPct}%">
      <div class="mini-bar rep" style="width: ${repPct}%"></div>
      <div class="mini-bar mod" style="width: ${modPct}%"></div>
      <div class="mini-bar dem" style="width: ${demPct}%"></div>
    </div>
    <div class="tooltip-row">
      <span class="tooltip-label">Strength:</span>
      <span class="tooltip-value">${strength}/3</span>
    </div>
  `.trim();
}

/**
 * Generate election-specific tooltip content
 * @param {Object} properties - Feature properties
 * @param {Object} options - Options including isFlipped
 * @returns {string} HTML string
 */
export function generateElectionTooltipContent(properties, options = {}) {
  const { isFlipped = false } = options;
  const winner = properties.winningCandidate || properties.winningParty || 'Unknown';
  const winningParty = properties.winningParty || '';
  
  let html = `
    <div class="tooltip-row">
      <span class="tooltip-label">Winner:</span>
      <span class="tooltip-value winner-highlight ${winningParty.toLowerCase()}">${winner}</span>
    </div>
  `.trim();

  // Add flipped indicator if applicable
  if (isFlipped) {
    html += `<div class="flipped-indicator">⚡ Flipped</div>`;
  }

  return html;
}

/**
 * Generate turnout-specific tooltip content
 * @param {Object} properties - Feature properties
 * @param {Object} options - Options including turnout, countyAverage, isFlipped
 * @returns {string} HTML string
 */
export function generateTurnoutTooltipContent(properties, options = {}) {
  const { turnout = null, countyAverage = null, isFlipped = false } = options;
  
  let html = '';

  if (turnout != null && !isNaN(turnout)) {
    const turnoutClass = getTurnoutClass(turnout);
    html += `
    <div class="tooltip-row">
      <span class="tooltip-label">Turnout:</span>
      <span class="tooltip-value turnout-badge ${turnoutClass}">${turnout.toFixed(1)}%</span>
    </div>
    `.trim();

    // Add comparison to county average if available
    if (countyAverage != null && !isNaN(countyAverage)) {
      const { diff, diffClass, diffSign } = calculateComparison(turnout, countyAverage);
      
      html += `
    <div class="tooltip-row">
      <span class="tooltip-label">vs County:</span>
      <span class="tooltip-value ${diffClass}">${diffSign}${diff.toFixed(1)}%</span>
    </div>
      `.trim();
    }
  } else {
    html += `
    <div class="tooltip-row">
      <span class="tooltip-label">Turnout:</span>
      <span class="tooltip-value">No Data</span>
    </div>
    `.trim();
  }

  // Add flipped indicator if applicable
  if (isFlipped) {
    html += `<div class="flipped-indicator">⚡ Flipped</div>`;
  }

  return html;
}

/**
 * Generate enhanced tooltip HTML content
 * @param {Object} properties - Feature properties from GeoJSON
 * @param {Object} options - Additional options
 * @param {number} options.turnout - Current turnout percentage
 * @param {number} options.countyAverage - County average turnout for comparison
 * @param {boolean} options.isFlipped - Whether this precinct flipped in simulation
 * @param {string} options.viewType - Current view type: 'demographics', 'election', 'turnout'
 * @returns {string} HTML string for tooltip content
 */
export function generateEnhancedTooltip(properties, options = {}) {
  if (!properties || typeof properties !== 'object') {
    return '';
  }

  const {
    turnout = null,
    countyAverage = null,
    isFlipped = false,
    viewType = 'demographics'
  } = options;

  const precinctCode = properties.PRECINCT || 'Unknown';
  
  // Base content
  let html = `<strong>Precinct ${precinctCode}</strong>`;

  // Add view-specific content
  switch (viewType) {
    case 'demographics':
      html += generateDemographicsTooltipContent(properties);
      break;
    case 'election':
      html += generateElectionTooltipContent(properties, { isFlipped });
      break;
    case 'turnout':
      html += generateTurnoutTooltipContent(properties, { turnout, countyAverage, isFlipped });
      break;
    default:
      html += generateDemographicsTooltipContent(properties);
  }

  return html;
}

/**
 * Generate simple tooltip (backward compatible)
 * @param {Object} properties - Feature properties
 * @returns {string} HTML string
 */
export function generateSimpleTooltip(properties) {
  const p = properties;
  return `
    <strong>Precinct ${p.PRECINCT}</strong><br/>
    Winner: ${p.winningParty} (Strength ${p.partyStrength})<br/>
    Rep: ${(p.repShare * 100).toFixed(1)}% |
    Mod: ${(p.modShare * 100).toFixed(1)}% |
    Dem: ${(p.demShare * 100).toFixed(1)}%
  `;
}

// ============================================================================
// MAIN LAYER CREATION FUNCTION
// ============================================================================

/**
 * Create a precinct layer with configurable tooltip generation
 * @param {L.Map} map - Leaflet map instance
 * @param {Object} geojson - GeoJSON data
 * @param {Object} options - Configuration options
 * @param {Function} options.styleFn - Style function (feature) => style object
 * @param {Function} options.onClickPrecinct - Click handler (properties, layer) => void
 * @param {Function} options.onHoverPrecinct - Hover handler (properties, layer) => void
 * @param {Function} options.onHoverOut - Hover out handler (properties, layer) => void
 * @param {Function} options.tooltipFn - Custom tooltip function (properties) => string
 * @param {string} options.tooltipClassName - CSS class for tooltip
 * @returns {L.GeoJSON} The created layer
 */
export function createPrecinctLayer(
  map,
  geojson,
  {
    styleFn,       // (feature) => style object
    onClickPrecinct, // (properties, layer) => void
    onHoverPrecinct, // (properties, layer) => void
    onHoverOut,     // (properties, layer) => void
    tooltipFn,      // (properties) => string (optional, defaults to simple tooltip)
    tooltipClassName = "big-tooltip"  // CSS class for tooltip
  }
) {
  function onEachFeature(feature, layer) {
    const p = feature.properties;

    // Use custom tooltip function if provided, otherwise use simple tooltip
    const tooltipContent = tooltipFn 
      ? tooltipFn(p) 
      : generateSimpleTooltip(p);

    // Tooltip:
    layer.bindTooltip(tooltipContent, {
      className: tooltipClassName,
      sticky: true,
      direction: "auto",
      minWidth: 120
    });

    // Hover (mouseover / mouseout)
    layer.on({
      mouseover: () => {
        if (onHoverPrecinct) onHoverPrecinct(p, layer);
      },
      mouseout: () => {
        if (onHoverOut) onHoverOut(p, layer);
      }
    });

    // Click
    layer.on("click", () => {
      if (onClickPrecinct) onClickPrecinct(p, layer);
    });
  }

  // Create the GeoJSON layer
  const precinctLayer = L.geoJSON(geojson, {
    style:         styleFn,
    onEachFeature: onEachFeature
  }).addTo(map);

  // Fit map to bounds
  map.fitBounds(precinctLayer.getBounds());
  map.setMaxBounds(precinctLayer.getBounds());

  return precinctLayer;
}

/**
 * Update tooltips for all features in a layer
 * @param {L.GeoJSON} layer - The GeoJSON layer
 * @param {Function} tooltipFn - Function to generate tooltip content
 * @param {Object} options - Additional options for tooltipFn
 */
export function updateLayerTooltips(layer, tooltipFn, options = {}) {
  if (!layer || !tooltipFn) return;
  
  layer.eachLayer((featureLayer) => {
    const properties = featureLayer.feature?.properties;
    if (properties) {
      const content = tooltipFn(properties, options);
      featureLayer.setTooltipContent(content);
    }
  });
}

/**
 * Create a tooltip generator function for a specific view
 * @param {string} viewType - 'demographics', 'election', or 'turnout'
 * @param {Object} globalOptions - Options applied to all tooltips
 * @returns {Function} Tooltip generator function
 */
export function createTooltipGenerator(viewType, globalOptions = {}) {
  return (properties, instanceOptions = {}) => {
    return generateEnhancedTooltip(properties, {
      viewType,
      ...globalOptions,
      ...instanceOptions
    });
  };
}
