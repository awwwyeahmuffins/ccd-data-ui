// marginView.js
// Margin-of-victory coloring for election view.
// Precincts are colored on a gradient from deep red (blowout R) to deep blue (blowout D)
// based on how competitive the margin was between the top two candidates.

// ============================================================================
// COLOR SCALE
// ============================================================================

export const MARGIN_COLORS = {
  strongR: '#B91C1C',   // >30% R margin
  solidR: '#DC2626',    // 15-30% R margin
  leanR: '#F87171',     // 5-15% R margin
  tossupR: '#FCA5A5',   // 0-5% R margin
  tossupD: '#93C5FD',   // 0-5% D margin
  leanD: '#60A5FA',     // 5-15% D margin
  solidD: '#2563EB',    // 15-30% D margin
  strongD: '#1D4ED8',   // >30% D margin
  noData: '#D1D5DB',    // no data / non-participating
};

// ============================================================================
// HELPERS
// ============================================================================

const PRECINCT_KEYS = ['PRECINCT CODE', 'Precinct', 'precinct', 'PRECINCT'];

/**
 * Find the row in electionData matching a given precinct code.
 */
function findPrecinctRow(electionData, precinctCode) {
  const code = String(precinctCode);
  for (const row of electionData) {
    for (const key of PRECINCT_KEYS) {
      if (key in row && String(row[key]) === code) {
        return row;
      }
    }
  }
  return null;
}

/**
 * Determine the party from a candidate column name prefix.
 * Returns 'R', 'D', or null.
 */
function getParty(columnName) {
  if (columnName.startsWith('Rep')) return 'R';
  if (columnName.startsWith('Dem')) return 'D';
  return null;
}

/**
 * Pick a fill color based on margin percentage and winning party.
 */
function colorFromMargin(margin, winnerParty) {
  if (winnerParty === 'R') {
    if (margin > 0.30) return MARGIN_COLORS.strongR;
    if (margin > 0.15) return MARGIN_COLORS.solidR;
    if (margin > 0.05) return MARGIN_COLORS.leanR;
    return MARGIN_COLORS.tossupR;
  }
  if (winnerParty === 'D') {
    if (margin > 0.30) return MARGIN_COLORS.strongD;
    if (margin > 0.15) return MARGIN_COLORS.solidD;
    if (margin > 0.05) return MARGIN_COLORS.leanD;
    return MARGIN_COLORS.tossupD;
  }
  return MARGIN_COLORS.noData;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Return a Leaflet style object with gradient fill color based on the margin
 * between the top two candidates in a precinct.
 *
 * @param {Object} feature - GeoJSON feature (has properties.PRECINCT)
 * @param {Array<Object>} electionData - array of CSV row objects for the election
 * @param {Array<string>} candidateColumns - candidate column names
 * @returns {Object} Leaflet path style
 */
export function getMarginStyle(feature, electionData, candidateColumns) {
  const baseStyle = { fillOpacity: 0.75, color: '#666', weight: 1 };

  const row = findPrecinctRow(electionData, feature.properties.PRECINCT);
  if (!row) {
    return { ...baseStyle, fillColor: MARGIN_COLORS.noData };
  }

  // Gather vote totals per candidate column
  const results = candidateColumns.map((col) => ({
    column: col,
    votes: parseFloat(row[col]) || 0,
    party: getParty(col),
  }));

  // Sort descending by votes
  results.sort((a, b) => b.votes - a.votes);

  const totalVotes = results.reduce((sum, r) => sum + r.votes, 0);
  if (totalVotes === 0) {
    return { ...baseStyle, fillColor: MARGIN_COLORS.noData };
  }

  const winner = results[0];
  const runnerUp = results.length > 1 ? results[1] : { votes: 0 };
  const margin = (winner.votes - runnerUp.votes) / totalVotes;

  const fillColor = colorFromMargin(margin, winner.party);
  return { ...baseStyle, fillColor };
}

/**
 * Return HTML string for a legend showing the margin gradient scale.
 * @returns {string}
 */
export function getMarginLegendHTML() {
  return `
    <h4 class="legend-title">Margin of Victory</h4>
    <div class="legend-items">
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${MARGIN_COLORS.strongR}"></span>
        <span class="legend-label">Strong R (&gt;30%)</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${MARGIN_COLORS.solidR}"></span>
        <span class="legend-label">Solid R (15-30%)</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${MARGIN_COLORS.leanR}"></span>
        <span class="legend-label">Lean R (5-15%)</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${MARGIN_COLORS.tossupR}"></span>
        <span class="legend-label">Toss-up R (0-5%)</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${MARGIN_COLORS.tossupD}"></span>
        <span class="legend-label">Toss-up D (0-5%)</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${MARGIN_COLORS.leanD}"></span>
        <span class="legend-label">Lean D (5-15%)</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${MARGIN_COLORS.solidD}"></span>
        <span class="legend-label">Solid D (15-30%)</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${MARGIN_COLORS.strongD}"></span>
        <span class="legend-label">Strong D (&gt;30%)</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${MARGIN_COLORS.noData}"></span>
        <span class="legend-label">No data</span>
      </div>
    </div>
  `.trim();
}
