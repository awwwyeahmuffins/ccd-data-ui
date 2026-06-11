// boundaryChangesTable.js
// --------------------------------------------------------------------------------
// Bulk boundary-changes table: fetches precinct_metadata.json, renders a filterable
// and sortable table with stats grid and CSV export.

import { escapeHtml, csvEscape } from './utils.js';

const CHANGE_COLORS = {
  unchanged: '#4CAF50',
  split: '#FF9800',
  merged: '#2196F3',
  new_boundary: '#FFC107',
  sliver: '#9E9E9E'
};

const CHANGE_LABELS = {
  unchanged: 'Unchanged',
  split: 'Split',
  merged: 'Merged',
  new_boundary: 'New',
  sliver: 'Sliver'
};

/**
 * Fetch data/2026/precinct_metadata.json and return a flat array of change records.
 * @returns {Promise<Array<{precinctCode: string, changeType: string, sources: Array, dataQuality: string}>>}
 */
export async function loadBoundaryChangeSummary() {
  const resp = await fetch('data/2026/precinct_metadata.json');
  if (!resp.ok) throw new Error(`Failed to load precinct metadata: ${resp.status}`);
  const metadata = await resp.json();

  const result = [];
  for (const [code, entry] of Object.entries(metadata)) {
    result.push({
      precinctCode: code,
      changeType: entry.interpolationType || 'unchanged',
      sources: Array.isArray(entry.sources) ? entry.sources : [],
      dataQuality: entry.dataQuality || 'unknown'
    });
  }
  return result;
}

/**
 * Generate HTML for the boundary changes table.
 * @param {Array} changeData - From loadBoundaryChangeSummary
 * @param {Object} filters - { changeType?: string, sortBy?: string, sortDir?: 'asc'|'desc' }
 * @returns {string} HTML string
 */
export function generateBoundaryTableHTML(changeData, filters = {}) {
  if (!Array.isArray(changeData) || changeData.length === 0) {
    return '<div class="ranker-empty">No boundary change data available.</div>';
  }

  let filtered = changeData;
  if (filters.changeType && filters.changeType !== 'all') {
    filtered = filtered.filter(d => d.changeType === filters.changeType);
  }

  // Sort
  const sortBy = filters.sortBy || 'precinctCode';
  const sortDir = filters.sortDir || 'asc';
  const dirMul = sortDir === 'asc' ? 1 : -1;
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'precinctCode') {
      return (Number(a.precinctCode) - Number(b.precinctCode)) * dirMul;
    }
    return a.changeType.localeCompare(b.changeType) * dirMul;
  });

  // Filter row
  let html = '<div class="boundary-table-filter">';
  html += '<label for="boundary-filter-type" style="font-size:13px;">Filter:</label>';
  html += '<select id="boundary-filter-type">';
  html += `<option value="all"${!filters.changeType || filters.changeType === 'all' ? ' selected' : ''}>All (${changeData.length})</option>`;
  for (const type of ['unchanged', 'split', 'merged', 'new_boundary', 'sliver']) {
    const count = changeData.filter(d => d.changeType === type).length;
    const sel = filters.changeType === type ? ' selected' : '';
    html += `<option value="${type}"${sel}>${CHANGE_LABELS[type]} (${count})</option>`;
  }
  html += '</select>';
  html += `<span style="font-size:12px;color:var(--text-secondary);">Showing ${filtered.length} of ${changeData.length}</span>`;
  html += '</div>';

  // Table
  html += '<table class="boundary-table">';
  html += '<thead><tr>';
  html += `<th data-sort="precinctCode">Precinct ${sortBy === 'precinctCode' ? (sortDir === 'asc' ? '&#9650;' : '&#9660;') : ''}</th>`;
  html += `<th data-sort="changeType">Change Type ${sortBy === 'changeType' ? (sortDir === 'asc' ? '&#9650;' : '&#9660;') : ''}</th>`;
  html += '<th>Source Precincts</th>';
  html += '<th>Weights</th>';
  html += '</tr></thead>';
  html += '<tbody>';

  for (const row of filtered) {
    const badge = `<span class="change-badge ${escapeHtml(row.changeType)}">${escapeHtml(CHANGE_LABELS[row.changeType] || row.changeType)}</span>`;
    const sourceCodes = row.sources.map(s => s.old).join(', ');
    const sourceWeights = row.sources.map(s => {
      const w = typeof s.weight === 'number' ? s.weight : 0;
      return (w * 100).toFixed(1) + '%';
    }).join(', ');

    html += '<tr>';
    html += `<td>${escapeHtml(row.precinctCode)}</td>`;
    html += `<td>${badge}</td>`;
    html += `<td>${escapeHtml(sourceCodes) || '-'}</td>`;
    html += `<td>${escapeHtml(sourceWeights) || '-'}</td>`;
    html += '</tr>';
  }

  html += '</tbody></table>';
  return html;
}

/**
 * Generate summary stat cards HTML.
 * @param {Array} changeData - From loadBoundaryChangeSummary
 * @returns {string} HTML string
 */
export function generateBoundaryStatsHTML(changeData) {
  if (!Array.isArray(changeData)) return '';

  const counts = { unchanged: 0, split: 0, merged: 0, new_boundary: 0, sliver: 0 };
  for (const entry of changeData) {
    if (Object.prototype.hasOwnProperty.call(counts, entry.changeType)) {
      counts[entry.changeType]++;
    }
  }

  let html = '<div class="boundary-stats-grid">';
  for (const [type, count] of Object.entries(counts)) {
    html += `<div class="boundary-stat-card">`;
    html += `<div class="stat-count" style="color:${CHANGE_COLORS[type]}">${count}</div>`;
    html += `<div class="stat-label">${CHANGE_LABELS[type]}</div>`;
    html += `</div>`;
  }
  html += '</div>';
  return html;
}

/**
 * Export boundary change data as CSV download.
 * @param {Array} changeData - From loadBoundaryChangeSummary
 */
export function exportBoundaryCSV(changeData) {
  if (!Array.isArray(changeData) || changeData.length === 0) return;

  const headers = ['New Precinct', 'Change Type', 'Source Precincts', 'Source Weights', 'Data Quality'];

  const rows = [headers.join(',')];
  for (const entry of changeData) {
    const sourceCodes = entry.sources.map(s => s.old).join('; ');
    const sourceWeights = entry.sources.map(s => {
      const w = typeof s.weight === 'number' ? s.weight : 0;
      return (w * 100).toFixed(1) + '%';
    }).join('; ');

    rows.push([
      csvEscape(entry.precinctCode),
      csvEscape(CHANGE_LABELS[entry.changeType] || entry.changeType),
      csvEscape(sourceCodes),
      csvEscape(sourceWeights),
      csvEscape(entry.dataQuality)
    ].join(','));
  }

  const csvContent = rows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'boundary_changes.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
