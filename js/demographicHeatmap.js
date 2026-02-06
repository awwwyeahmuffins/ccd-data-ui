// demographicHeatmap.js
// --------------------------------------------------------------------------------
// Demographic heat-mapping module — colors the precinct map by any census variable.
// Provides metric definitions, style functions, legend HTML, and a metric selector.

// ============================================================================
// COLOR SCALES
// ============================================================================

const COLOR_SCALES = {
  blue:   ['#EFF6FF', '#BFDBFE', '#60A5FA', '#2563EB', '#1E3A8A'],
  green:  ['#F0FDF4', '#BBF7D0', '#4ADE80', '#16A34A', '#14532D'],
  orange: ['#FFF7ED', '#FED7AA', '#FB923C', '#EA580C', '#7C2D12'],
  purple: ['#FAF5FF', '#E9D5FF', '#A78BFA', '#7C3AED', '#4C1D95'],
  red:    ['#FEF2F2', '#FECACA', '#F87171', '#DC2626', '#7F1D1D'],
};

const NO_DATA_COLOR = '#D1D5DB';

// ============================================================================
// FORMAT HELPERS
// ============================================================================

function formatPct(value) {
  return value.toFixed(1) + '%';
}

function formatCurrency(value) {
  return '$' + Math.round(value).toLocaleString();
}

function formatPlain(value) {
  return value.toFixed(1);
}

// ============================================================================
// METRIC DEFINITIONS
// ============================================================================

export const HEATMAP_METRICS = [
  {
    id: 'hispanicPct',
    label: '% Hispanic',
    getValue: (precinctCode, censusProfiles, featureProperties) => {
      const pct = featureProperties.pct_hispanic;
      return pct != null ? pct * 100 : null;
    },
    format: formatPct,
    colorScale: 'green',
    unit: '%',
  },
  {
    id: 'asianPct',
    label: '% Asian',
    getValue: (precinctCode, censusProfiles, featureProperties) => {
      const pct = featureProperties.pct_asian;
      return pct != null ? pct * 100 : null;
    },
    format: formatPct,
    colorScale: 'blue',
    unit: '%',
  },
  {
    id: 'blackPct',
    label: '% Black',
    getValue: (precinctCode, censusProfiles, featureProperties) => {
      const pct = featureProperties.pct_black;
      return pct != null ? pct * 100 : null;
    },
    format: formatPct,
    colorScale: 'orange',
    unit: '%',
  },
  {
    id: 'whitePct',
    label: '% White',
    getValue: (precinctCode, censusProfiles, featureProperties) => {
      const pct = featureProperties.pct_white;
      return pct != null ? pct * 100 : null;
    },
    format: formatPct,
    colorScale: 'purple',
    unit: '%',
  },
  {
    id: 'medianIncome',
    label: 'Median Household Income',
    getValue: (precinctCode, censusProfiles) => {
      const profile = censusProfiles?.[String(precinctCode)];
      return profile?.income?.medianHousehold ?? null;
    },
    format: formatCurrency,
    colorScale: 'green',
    unit: '$',
  },
  {
    id: 'collegePct',
    label: '% College Educated',
    getValue: (precinctCode, censusProfiles) => {
      const profile = censusProfiles?.[String(precinctCode)];
      if (!profile?.education) return null;
      const bachelors = profile.education.bachelors || 0;
      const grad = profile.education.graduateProfessional || 0;
      return (bachelors + grad) * 100;
    },
    format: formatPct,
    colorScale: 'blue',
    unit: '%',
  },
  {
    id: 'homeownerPct',
    label: '% Homeowners',
    getValue: (precinctCode, censusProfiles) => {
      const profile = censusProfiles?.[String(precinctCode)];
      const val = profile?.housing?.ownerOccupied;
      return val != null ? val * 100 : null;
    },
    format: formatPct,
    colorScale: 'orange',
    unit: '%',
  },
  {
    id: 'medianAge',
    label: 'Median Age',
    getValue: (precinctCode, censusProfiles) => {
      const profile = censusProfiles?.[String(precinctCode)];
      return profile?.age?.medianAge ?? null;
    },
    format: formatPlain,
    colorScale: 'purple',
    unit: '',
  },
  {
    id: 'medianHomeValue',
    label: 'Median Home Value',
    getValue: (precinctCode, censusProfiles) => {
      const profile = censusProfiles?.[String(precinctCode)];
      return profile?.housing?.medianHomeValue ?? null;
    },
    format: formatCurrency,
    colorScale: 'green',
    unit: '$',
  },
  {
    id: 'spanishPct',
    label: '% Spanish Speakers',
    getValue: (precinctCode, censusProfiles) => {
      const profile = censusProfiles?.[String(precinctCode)];
      const val = profile?.language?.spanish;
      return val != null ? val * 100 : null;
    },
    format: formatPct,
    colorScale: 'red',
    unit: '%',
  },
  {
    id: 'veteranPct',
    label: '% Veterans',
    getValue: (precinctCode, censusProfiles) => {
      const profile = censusProfiles?.[String(precinctCode)];
      const val = profile?.veterans?.share;
      return val != null ? val * 100 : null;
    },
    format: formatPct,
    colorScale: 'blue',
    unit: '%',
  },
  {
    id: 'povertyPct',
    label: '% Poverty Rate',
    getValue: (precinctCode, censusProfiles) => {
      const profile = censusProfiles?.[String(precinctCode)];
      const val = profile?.income?.povertyRate;
      return val != null ? val * 100 : null;
    },
    format: formatPct,
    colorScale: 'red',
    unit: '%',
  },
];

// ============================================================================
// MIN/MAX CACHE
// ============================================================================

const minMaxCache = new Map();

export function clearMinMaxCache() {
  minMaxCache.clear();
}

function getMinMax(metricId, censusProfiles, allFeatures) {
  const cacheKey = metricId;
  if (minMaxCache.has(cacheKey)) {
    return minMaxCache.get(cacheKey);
  }

  const metric = HEATMAP_METRICS.find(m => m.id === metricId);
  if (!metric) return { min: 0, max: 1 };

  let min = Infinity;
  let max = -Infinity;

  for (const feature of allFeatures) {
    const code = feature.properties?.PRECINCT;
    if (code == null) continue;
    const val = metric.getValue(code, censusProfiles, feature.properties);
    if (val == null || isNaN(val)) continue;
    if (val < min) min = val;
    if (val > max) max = val;
  }

  if (min === Infinity || max === -Infinity) {
    min = 0;
    max = 1;
  }

  const result = { min, max };
  minMaxCache.set(cacheKey, result);
  return result;
}

// ============================================================================
// COLOR MAPPING
// ============================================================================

function normalizeValue(value, min, max) {
  if (max === min) return 0.5;
  const normalized = (value - min) / (max - min);
  return Math.max(0, Math.min(1, normalized));
}

function getColorForNormalized(normalized, scaleName) {
  const stops = COLOR_SCALES[scaleName] || COLOR_SCALES.blue;
  // Map 0-1 to 5 stops: 0-0.2 -> stop[0], 0.2-0.4 -> stop[1], etc.
  const index = Math.min(Math.floor(normalized * 5), 4);
  return stops[index];
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function getHeatmapStyle(feature, metricId, censusProfiles, allFeatures) {
  const metric = HEATMAP_METRICS.find(m => m.id === metricId);
  if (!metric) {
    return { fillColor: NO_DATA_COLOR, fillOpacity: 0.75, color: '#666', weight: 1 };
  }

  const code = feature.properties?.PRECINCT;
  const value = code != null
    ? metric.getValue(code, censusProfiles, feature.properties)
    : null;

  if (value == null || isNaN(value)) {
    return { fillColor: NO_DATA_COLOR, fillOpacity: 0.75, color: '#666', weight: 1 };
  }

  const { min, max } = getMinMax(metricId, censusProfiles, allFeatures);
  const normalized = normalizeValue(value, min, max);
  const fillColor = getColorForNormalized(normalized, metric.colorScale);

  return { fillColor, fillOpacity: 0.75, color: '#666', weight: 1 };
}

export function getHeatmapLegendHTML(metricId, censusProfiles, allFeatures) {
  const metric = HEATMAP_METRICS.find(m => m.id === metricId);
  if (!metric) return '';

  const { min, max } = getMinMax(metricId, censusProfiles, allFeatures);
  const stops = COLOR_SCALES[metric.colorScale] || COLOR_SCALES.blue;
  const gradient = stops.join(', ');

  return `
    <h4 class="legend-title">${metric.label}</h4>
    <div class="legend-gradient-container">
      <div class="legend-gradient-bar" style="background: linear-gradient(to right, ${gradient}); height: 14px; border-radius: 3px;" aria-label="${metric.label} gradient from ${metric.format(min)} to ${metric.format(max)}"></div>
      <div class="legend-gradient-labels">
        <span>${metric.format(min)}</span>
        <span>${metric.format(max)}</span>
      </div>
    </div>
    <div class="legend-items">
      <div class="legend-item">
        <span class="legend-swatch" style="background: ${NO_DATA_COLOR}"></span>
        <span class="legend-label">No Data</span>
      </div>
    </div>
  `.trim();
}

export function buildMetricSelectorHTML() {
  let html = '<select id="heatmap-metric-select">';
  for (const metric of HEATMAP_METRICS) {
    html += `<option value="${metric.id}">${metric.label}</option>`;
  }
  html += '</select>';
  return html;
}
