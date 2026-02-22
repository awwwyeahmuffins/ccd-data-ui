// universeBuilder.js
// --------------------------------------------------------------------------------
// Multi-criteria universe builder: filter precincts by election, census,
// and DNC data, then highlight on map and export.

export const FILTER_FIELDS = [
  { id: 'demPct', label: 'Dem Vote %', source: 'election', range: [0, 100], type: 'number' },
  { id: 'repPct', label: 'Rep Vote %', source: 'election', range: [0, 100], type: 'number' },
  { id: 'margin', label: 'Margin (pts)', source: 'election', range: [0, 100], type: 'number' },
  { id: 'turnoutPct', label: 'Turnout %', source: 'election', range: [0, 100], type: 'number' },
  { id: 'registeredVoters', label: 'Registered Voters', source: 'election', range: [0, 20000], type: 'number' },
  { id: 'population', label: 'Population', source: 'census', range: [0, 30000], type: 'number' },
  { id: 'medianIncome', label: 'Median Income ($)', source: 'census', range: [0, 300000], type: 'number' },
  { id: 'collegePct', label: 'College Degree %', source: 'census', range: [0, 100], type: 'number' },
  { id: 'partyLean', label: 'Party Lean', source: 'dnc', type: 'enum', values: ['Rep', 'Dem', 'Mod'] }
];

const OPERATOR_LABELS = {
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  eq: '=',
  between: 'between'
};

/**
 * Merge data from multiple sources into a unified precinct record.
 * @param {string} code - Precinct code
 * @param {Object} electionRow - CSV row object for this precinct
 * @param {Object} dncRow - DNC score data for this precinct
 * @param {Object} censusProfile - Census profile object
 * @param {Array} candidates - Candidate column names
 * @returns {Object} Unified record
 */
export function buildPrecinctRecord(code, electionRow, dncRow, censusProfile, candidates) {
  let demPct = null;
  let repPct = null;
  let margin = null;
  let turnoutPct = null;
  let registeredVoters = null;

  if (electionRow && Array.isArray(candidates) && candidates.length > 0) {
    let totalVotes = 0;
    let demVotes = 0;
    let repVotes = 0;

    for (const col of candidates) {
      const votes = Number(electionRow[col]) || 0;
      totalVotes += votes;
      const party = col.split(' ')[0];
      if (party === 'Dem') demVotes += votes;
      if (party === 'Rep') repVotes += votes;
    }

    if (totalVotes > 0) {
      demPct = (demVotes / totalVotes) * 100;
      repPct = (repVotes / totalVotes) * 100;
      margin = Math.abs(repPct - demPct);
    }

    const rv = Number(electionRow['REGISTERED VOTERS TOTAL']) ||
               Number(electionRow['REGISTERED VOTERS - TOTAL']) || 0;
    const bc = Number(electionRow['BALLOTS CAST TOTAL']) ||
               Number(electionRow['BALLOTS CAST - TOTAL']) || 0;
    registeredVoters = rv || null;
    turnoutPct = rv > 0 ? (bc / rv) * 100 : null;
  }

  let population = null;
  let medianIncome = null;
  let collegePct = null;

  if (censusProfile) {
    population = censusProfile.population ?? null;
    medianIncome = censusProfile.income?.medianHousehold ?? null;
    const bachelors = censusProfile.education?.bachelors ?? 0;
    const grad = censusProfile.education?.graduateProfessional ?? 0;
    collegePct = (bachelors + grad) * 100;
  }

  let partyLean = null;
  if (dncRow) {
    partyLean = dncRow.winningParty || dncRow.partyLean || null;
  }

  return {
    code,
    demPct: demPct != null ? Math.round(demPct * 10) / 10 : null,
    repPct: repPct != null ? Math.round(repPct * 10) / 10 : null,
    margin: margin != null ? Math.round(margin * 10) / 10 : null,
    turnoutPct: turnoutPct != null ? Math.round(turnoutPct * 10) / 10 : null,
    registeredVoters,
    population,
    medianIncome,
    collegePct: collegePct != null ? Math.round(collegePct * 10) / 10 : null,
    partyLean
  };
}

/**
 * Apply filter criteria to precinct records.
 * @param {Array} records - Array of unified precinct records
 * @param {Array} criteria - Array of { field, operator, value }
 * @returns {Array} Filtered records
 */
export function applyFilters(records, criteria) {
  if (!Array.isArray(criteria) || criteria.length === 0) return records;
  if (!Array.isArray(records)) return [];

  return records.filter(record => {
    return criteria.every(criterion => {
      const val = record[criterion.field];
      if (val == null) return false;

      switch (criterion.operator) {
        case 'gt': return val > criterion.value;
        case 'lt': return val < criterion.value;
        case 'gte': return val >= criterion.value;
        case 'lte': return val <= criterion.value;
        case 'eq': return String(val) === String(criterion.value);
        case 'between': {
          if (!Array.isArray(criterion.value) || criterion.value.length < 2) return false;
          return val >= criterion.value[0] && val <= criterion.value[1];
        }
        default: return true;
      }
    });
  });
}

/**
 * Generate the Universe Builder UI HTML.
 * @param {Array} criteria - Current filter criteria
 * @param {number} matchCount - Number of matching precincts
 * @param {number} totalCount - Total number of precincts
 * @returns {string} HTML string
 */
export function generateUniverseBuilderHTML(criteria = [], matchCount = 0, totalCount = 0) {
  let html = '<div class="universe-builder">';

  // Header
  html += '<div class="universe-builder-header" id="universe-builder-toggle">';
  html += '<h4>Universe Builder</h4>';
  html += '<button class="universe-builder-toggle" aria-label="Toggle universe builder">&#9660;</button>';
  html += '</div>';

  // Body
  html += '<div class="universe-builder-body" id="universe-builder-body">';

  // Filter pills
  if (criteria.length > 0) {
    html += '<div class="filter-pills">';
    criteria.forEach((c, i) => {
      const field = FILTER_FIELDS.find(f => f.id === c.field);
      const label = field ? field.label : c.field;
      const opLabel = OPERATOR_LABELS[c.operator] || c.operator;
      const valLabel = Array.isArray(c.value) ? c.value.join('-') : c.value;
      html += `<span class="filter-pill">`;
      html += `${label} ${opLabel} ${valLabel}`;
      html += `<button class="filter-pill-remove" data-filter-index="${i}" aria-label="Remove filter">&times;</button>`;
      html += `</span>`;
    });
    html += '</div>';
  }

  // Add filter row
  html += '<div class="filter-add-row">';
  html += '<select id="universe-field-select">';
  for (const f of FILTER_FIELDS) {
    html += `<option value="${f.id}">${f.label}</option>`;
  }
  html += '</select>';
  html += '<select id="universe-operator-select">';
  html += '<option value="gte">>=</option>';
  html += '<option value="lte"><=</option>';
  html += '<option value="gt">></option>';
  html += '<option value="lt"><</option>';
  html += '<option value="eq">=</option>';
  html += '</select>';
  html += '<input type="text" id="universe-value-input" placeholder="Value">';
  html += '<button class="filter-add-btn" id="universe-add-filter">Add</button>';
  html += '</div>';

  // Match count
  html += `<div class="universe-match-count"><span class="count">${matchCount}</span> of ${totalCount} precincts match</div>`;

  // Highlight toggle
  html += '<label class="universe-highlight-toggle">';
  html += '<input type="checkbox" id="universe-highlight-toggle">';
  html += '<span>Highlight on Map</span>';
  html += '</label>';

  // Export button
  html += '<button class="universe-export-btn" id="universe-export-btn">Export Matching Precincts</button>';

  html += '</div>'; // .universe-builder-body
  html += '</div>'; // .universe-builder
  return html;
}

/**
 * Export filtered precinct records as CSV download.
 * @param {Array} filteredRecords - Filtered precinct records
 * @param {string} filename - Output filename
 */
export function exportUniverseCSV(filteredRecords, filename = 'universe_export.csv') {
  if (!Array.isArray(filteredRecords) || filteredRecords.length === 0) return;

  const headers = ['Precinct', 'Dem %', 'Rep %', 'Margin', 'Turnout %', 'Registered Voters',
    'Population', 'Median Income', 'College %', 'Party Lean'];

  const csvEscape = (val) => {
    if (val == null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const rows = [headers.join(',')];
  for (const r of filteredRecords) {
    rows.push([
      csvEscape(r.code),
      csvEscape(r.demPct),
      csvEscape(r.repPct),
      csvEscape(r.margin),
      csvEscape(r.turnoutPct),
      csvEscape(r.registeredVoters),
      csvEscape(r.population),
      csvEscape(r.medianIncome),
      csvEscape(r.collegePct),
      csvEscape(r.partyLean)
    ].join(','));
  }

  const csvContent = rows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Highlight matching precincts on map, dim non-matching ones.
 * @param {Object} layer - Leaflet GeoJSON layer
 * @param {Array} matchingCodes - Array of precinct code strings
 */
export function highlightUniverseOnMap(layer, matchingCodes) {
  if (!layer) return;
  const codeSet = new Set(matchingCodes.map(String));

  layer.eachLayer(function(featureLayer) {
    const code = String(
      featureLayer.feature?.properties?.PRECINCT ??
      featureLayer.feature?.properties?.precinct ?? ''
    );
    if (codeSet.has(code)) {
      featureLayer.setStyle({ fillOpacity: 0.7, opacity: 1 });
    } else {
      featureLayer.setStyle({ fillColor: '#cccccc', fillOpacity: 0.15, opacity: 0.3 });
    }
  });
}
