// js/voteShiftPanel.js
// ====================
// Vote Shift Analysis panel for comparing elections and visualizing precinct-level shifts

import { computePrecinctDeltas } from "./electionTrends.js";
import { TREND_COLORS, getTrendColor } from "./electionTrends.js";
import { formatElectionName } from "./electionFilters.js";
import { arrayToCSV, downloadCSV } from "./exportCSV.js";

// ============================================================================
// PANEL HTML GENERATION
// ============================================================================

/**
 * Generates the Vote Shift Analysis panel HTML
 * @param {Array} elections - Array of election entries (objects with filename, displayName, year)
 * @param {Object} options - Optional configuration
 * @returns {string} HTML string for the panel
 */
export function generateVoteShiftPanelHTML(elections, options = {}) {
  let electionOptionsHTML = buildElectionOptionsHTML(elections);

  return `
    <div class="vote-shift-panel">
      <div class="trend-compare-header">
        <h3>Vote Shift Analysis</h3>
        <label class="trend-toggle-label">
          <input type="checkbox" id="trend-toggle" class="trend-toggle-checkbox">
          <span class="trend-toggle-slider"></span>
          <span class="trend-toggle-text">Compare</span>
        </label>
      </div>

      <div class="trend-compare-controls">
        <label for="trend-second-select">Compare to:</label>
        <select id="trend-second-select" class="trend-second-select transition-fast" aria-label="Select second election for comparison">
          <option value="">-- Select election --</option>
          ${electionOptionsHTML}
        </select>
      </div>

      <div class="shift-filter-row" id="shift-filter-row" style="display:none;">
        <label for="shift-magnitude-slider">Min shift:</label>
        <input type="range" id="shift-magnitude-slider" class="shift-magnitude-slider"
          min="0" max="30" value="0" step="1" aria-label="Minimum shift magnitude">
        <span id="shift-magnitude-value" class="shift-magnitude-value">0 pts</span>

        <label for="shift-direction-select">Direction:</label>
        <select id="shift-direction-select" class="shift-direction-select" aria-label="Shift direction filter">
          <option value="both">Both</option>
          <option value="dem">Toward Dem</option>
          <option value="rep">Toward Rep</option>
        </select>
      </div>

      <div id="shift-summary-bar" class="shift-summary-bar" style="display:none;">
        <div class="shift-summary-stat">
          <div class="value" id="shift-avg-value">--</div>
          <div class="label">Avg Shift</div>
        </div>
        <div class="shift-summary-stat">
          <div class="value" id="shift-flipped-value">--</div>
          <div class="label">Flipped</div>
        </div>
        <div class="shift-summary-stat">
          <div class="value" id="shift-vote-change-value">--</div>
          <div class="label">Vote Change</div>
        </div>
        <div class="shift-summary-stat">
          <div class="value" id="shift-precinct-count-value">--</div>
          <div class="label">Precincts</div>
        </div>
      </div>

      <div id="trend-legend" class="trend-legend hidden">
        <div class="trend-legend-title">Shift Legend</div>
        <div class="trend-legend-items">
          <div class="trend-legend-item">
            <span class="trend-legend-color" style="background-color: ${TREND_COLORS.swingDem.default}"></span>
            <span>Swing to Dem</span>
          </div>
          <div class="trend-legend-item">
            <span class="trend-legend-color" style="background-color: ${TREND_COLORS.swingRep.default}"></span>
            <span>Swing to Rep</span>
          </div>
          <div class="trend-legend-item">
            <span class="trend-legend-color" style="background-color: ${TREND_COLORS.neutral}"></span>
            <span>No change</span>
          </div>
          <div class="trend-legend-item">
            <span class="trend-legend-color trend-legend-flipped"></span>
            <span>Flipped</span>
          </div>
        </div>
      </div>

      <div id="trend-error" class="trend-error hidden"></div>

      <div id="shift-leaderboard-container" style="display:none;">
        <h4 style="margin: 12px 0 8px;">Top Shifted Precincts</h4>
        <div id="shift-leaderboard" class="shift-leaderboard"></div>
        <button id="shift-export-btn" class="shift-export-btn" type="button">
          Export Shift CSV
        </button>
      </div>
    </div>
  `;
}

/**
 * Builds grouped <option> elements for election dropdowns
 * @param {Array} elections - Array of election entries
 * @returns {string} HTML options string
 */
function buildElectionOptionsHTML(elections) {
  if (!elections || elections.length === 0) return '';

  // Group elections by year
  let byYear = {};
  for (let entry of elections) {
    let filename = typeof entry === 'string' ? entry : entry.filename;
    let year = typeof entry === 'object' && entry.year ? entry.year : null;
    if (!year) {
      let match = filename.match(/_(\d{4})\.csv$/);
      year = match ? parseInt(match[1], 10) : 0;
    }
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(entry);
  }

  // Sort years descending
  let years = Object.keys(byYear).map(Number).sort((a, b) => b - a);

  let html = '';
  for (let year of years) {
    let entries = byYear[year];
    if (year > 0) {
      html += `<optgroup label="${year}">`;
    }
    for (let entry of entries) {
      let filename = typeof entry === 'string' ? entry : entry.filename;
      let displayName = typeof entry === 'object' && entry.displayName
        ? entry.displayName
        : formatElectionName(filename);
      html += `<option value="${filename}">${displayName}</option>`;
    }
    if (year > 0) {
      html += `</optgroup>`;
    }
  }
  return html;
}

// ============================================================================
// FILTERED SHIFTS COMPUTATION
// ============================================================================

/**
 * Computes filtered vote shifts between two elections
 * @param {Array} data1 - First election data rows
 * @param {Array} data2 - Second election data rows
 * @param {Array} cands1 - Candidate names from first election
 * @param {Array} cands2 - Candidate names from second election
 * @param {Object} filters - { minDelta: number, direction: 'both'|'dem'|'rep' }
 * @returns {Object} { allDeltas, filteredDeltas, summary, sortedPrecincts }
 */
export function computeFilteredShifts(data1, data2, cands1, cands2, filters = {}) {
  let minDelta = filters.minDelta || 0;
  let direction = filters.direction || 'both';

  // 1. Compute raw deltas using electionTrends
  let allDeltas = computePrecinctDeltas(data1, data2, cands1, cands2, 'Dem');

  // 2. Apply filters
  let filteredDeltas = {};
  for (let [code, delta] of Object.entries(allDeltas)) {
    if (delta.delta == null) continue;

    // Magnitude filter
    if (Math.abs(delta.delta) < minDelta) continue;

    // Direction filter
    if (direction === 'dem' && delta.delta < 0) continue;
    if (direction === 'rep' && delta.delta > 0) continue;

    filteredDeltas[code] = delta;
  }

  // 3. Compute summary
  let filteredEntries = Object.values(filteredDeltas);
  let allEntries = Object.values(allDeltas).filter(d => d.delta != null);

  let avgShift = filteredEntries.length > 0
    ? filteredEntries.reduce((sum, d) => sum + d.delta, 0) / filteredEntries.length
    : 0;

  let flippedCount = filteredEntries.filter(d => d.flipped).length;

  let totalVoteChange = filteredEntries.reduce((sum, d) => {
    return sum + ((d.votes2 || 0) - (d.votes1 || 0));
  }, 0);

  let summary = {
    avgShift,
    flippedCount,
    totalVoteChange,
    precinctCount: filteredEntries.length,
    totalPrecincts: allEntries.length
  };

  // 4. Sort by |delta| descending
  let sortedPrecincts = Object.entries(filteredDeltas)
    .map(function mapEntry([code, delta]) {
      return { code, ...delta };
    })
    .sort(function sortByAbsDelta(a, b) {
      return Math.abs(b.delta) - Math.abs(a.delta);
    });

  return { allDeltas, filteredDeltas, summary, sortedPrecincts };
}

// ============================================================================
// LEADERBOARD HTML
// ============================================================================

/**
 * Generates HTML for the shift leaderboard
 * @param {Array} sortedPrecincts - Array of { code, delta, flipped, winner1, winner2, ... }
 * @param {number} limit - Max number of rows to show
 * @returns {string} HTML string
 */
export function generateShiftLeaderboardHTML(sortedPrecincts, limit = 25) {
  if (!sortedPrecincts || sortedPrecincts.length === 0) {
    return '<p class="shift-no-data">No precincts match the current filters.</p>';
  }

  let rows = sortedPrecincts.slice(0, limit);
  let maxDelta = Math.max(...rows.map(r => Math.abs(r.delta)));
  if (maxDelta === 0) maxDelta = 1;

  let html = '';
  for (let row of rows) {
    let absDelta = Math.abs(row.delta);
    let barWidth = (absDelta / maxDelta) * 100;
    let barClass = row.delta >= 0 ? 'dem' : 'rep';
    let sign = row.delta >= 0 ? '+' : '';
    let directionBadge = row.delta >= 0
      ? '<span class="shift-direction-badge dem">D</span>'
      : '<span class="shift-direction-badge rep">R</span>';
    let flippedMark = row.flipped ? ' *' : '';

    html += `
      <div class="shift-leaderboard-item">
        <span class="shift-precinct-code">${row.code}${flippedMark}</span>
        <div class="shift-bar-container">
          <div class="shift-bar ${barClass}" style="width: ${barWidth.toFixed(1)}%"></div>
        </div>
        <span class="shift-delta-value">${sign}${row.delta.toFixed(1)} pts</span>
        ${directionBadge}
      </div>
    `;
  }

  return html;
}

// ============================================================================
// CSV EXPORT
// ============================================================================

/**
 * Exports shift data as a CSV file
 * @param {Object} deltas - Object of precinctCode -> delta object (from computePrecinctDeltas)
 * @param {string} filename - Output filename
 */
export function exportShiftCSV(deltas, filename) {
  let rows = [];

  for (let [code, d] of Object.entries(deltas)) {
    if (d.delta == null) continue;

    let demPct1 = d.margin1 != null ? ((d.margin1 + 100) / 2).toFixed(2) : '';
    let demPct2 = d.margin2 != null ? ((d.margin2 + 100) / 2).toFixed(2) : '';
    let directionLabel = d.delta >= 0 ? 'Toward Dem' : 'Toward Rep';
    let winner1Party = d.winner1 ? d.winner1.split(' ')[0] : '';
    let winner2Party = d.winner2 ? d.winner2.split(' ')[0] : '';

    rows.push({
      Precinct: code,
      'Year1 Dem%': demPct1,
      'Year2 Dem%': demPct2,
      Delta: d.delta.toFixed(2),
      Direction: directionLabel,
      Flipped: d.flipped ? 'Yes' : 'No',
      'Winner Year1': winner1Party,
      'Winner Year2': winner2Party,
      'Votes Year1': d.votes1 || 0,
      'Votes Year2': d.votes2 || 0
    });
  }

  // Sort by absolute delta descending
  rows.sort(function sortCSVRows(a, b) {
    return Math.abs(parseFloat(b.Delta)) - Math.abs(parseFloat(a.Delta));
  });

  let csvString = arrayToCSV(rows);
  let blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  let url = URL.createObjectURL(blob);

  let a = document.createElement('a');
  a.href = url;
  a.download = filename || 'vote_shift_export.csv';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function revokeURL() { URL.revokeObjectURL(url); }, 100);
}

// ============================================================================
// MAP STYLE FUNCTION
// ============================================================================

/**
 * Returns a Leaflet style function for vote shift visualization
 * @param {Object} deltas - Object of precinctCode -> delta object
 * @param {Object} filters - { minDelta: number, direction: 'both'|'dem'|'rep' }
 * @returns {Function} Leaflet style function (feature) => style
 */
export function getShiftMapStyleFunction(deltas, filters = {}) {
  let minDelta = filters.minDelta || 0;
  let direction = filters.direction || 'both';

  return function shiftStyleFunction(feature) {
    let code = String(feature.properties?.PRECINCT ?? '');
    let delta = code ? deltas[code] : null;

    // Default style for precincts with no data
    let baseStyle = {
      color: '#444',
      weight: 1,
      fillOpacity: 0.7
    };

    if (!delta || delta.delta == null) {
      return {
        ...baseStyle,
        fillColor: TREND_COLORS.noData,
        fillOpacity: 0.3
      };
    }

    let absDelta = Math.abs(delta.delta);

    // Gray out precincts below magnitude threshold
    if (absDelta < minDelta) {
      return {
        ...baseStyle,
        fillColor: '#e0e0e0',
        fillOpacity: 0.2
      };
    }

    // Filter by direction
    if (direction === 'dem' && delta.delta < 0) {
      return {
        ...baseStyle,
        fillColor: '#e0e0e0',
        fillOpacity: 0.2
      };
    }
    if (direction === 'rep' && delta.delta > 0) {
      return {
        ...baseStyle,
        fillColor: '#e0e0e0',
        fillOpacity: 0.2
      };
    }

    // Color by shift direction and magnitude
    let fillColor = getTrendColor(delta.delta, 'Dem');

    let style = {
      ...baseStyle,
      fillColor
    };

    // Dashed border for flipped precincts
    if (delta.flipped) {
      style.color = TREND_COLORS.flipped;
      style.weight = 3;
      style.dashArray = '5, 5';
    }

    return style;
  };
}

// ============================================================================
// SUMMARY BAR UPDATE
// ============================================================================

/**
 * Updates the summary stats bar in the DOM
 * @param {Object} summary - { avgShift, flippedCount, totalVoteChange, precinctCount }
 */
export function updateShiftSummaryBar(summary) {
  let avgEl = document.getElementById('shift-avg-value');
  let flippedEl = document.getElementById('shift-flipped-value');
  let voteChangeEl = document.getElementById('shift-vote-change-value');
  let countEl = document.getElementById('shift-precinct-count-value');

  if (avgEl) {
    let sign = summary.avgShift >= 0 ? '+' : '';
    avgEl.textContent = sign + summary.avgShift.toFixed(1) + ' pts';
    avgEl.style.color = summary.avgShift >= 0 ? TREND_COLORS.swingDem.default : TREND_COLORS.swingRep.default;
  }
  if (flippedEl) {
    flippedEl.textContent = summary.flippedCount.toString();
  }
  if (voteChangeEl) {
    let sign = summary.totalVoteChange >= 0 ? '+' : '';
    voteChangeEl.textContent = sign + summary.totalVoteChange.toLocaleString();
  }
  if (countEl) {
    countEl.textContent = summary.precinctCount.toString();
  }
}
