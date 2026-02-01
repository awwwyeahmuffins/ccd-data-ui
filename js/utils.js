// utils.js
// --------------------------------------------------------------------------------
// Shared utilities: building pie-data arrays, color maps, percentage formatters, etc.

import { ETHNICITY_COLORS, PARTY_COLORS } from "./constants.js";

// Re-export color maps for backward compatibility
export const ethnicityColorMap = ETHNICITY_COLORS;
export const partyColorMap = {
  Rep: PARTY_COLORS.Rep,
  Mod: PARTY_COLORS.Mod,
  Dem: PARTY_COLORS.Dem
};

// 1) Build the array of { label, value } for Chart.js (filter out zeros).
export function buildRacialChartData(props) {
  if (!props || typeof props !== 'object') {
    return [];
  }
  const categories = [
    { label: "Asian", value: Number(props.asian) || 0 },
    { label: "Black", value: Number(props.black) || 0 },
    { label: "Hispanic", value: Number(props.hispanic) || 0 },
    { label: "Others", value: Number(props.others) || 0 },
    { label: "White", value: Number(props.white) || 0 }
  ];
  return categories.filter(d => d.value > 0);
}

// 2) Build party chart data with validation
export function buildPartyChartData(props) {
  if (!props || typeof props !== 'object') {
    return [];
  }
  const categories = [
    { label: "Rep", value: Number(props.rep) || 0 },
    { label: "Mod", value: Number(props.mod) || 0 },
    { label: "Dem", value: Number(props.dem) || 0 }
  ];
  return categories.filter(d => d.value > 0);
}

// 3) Format percentage with input validation
// FIX: Added validation for null, undefined, and NaN values
export function formatPct(fraction) {
  if (fraction == null || isNaN(fraction)) {
    return "N/A";
  }
  return (fraction * 100).toFixed(1) + "%";
}

// 4) Clear map layers utility
export function clearLayers(map) {
  if (!map) return;
  
  // Remove the layers if they exist and reset properties to null
  if (map.currentLayer) {
    map.removeLayer(map.currentLayer);
    map.currentLayer = null;
  }
}

// 5) Safe number parser - returns 0 for invalid values
export function safeNumber(value, defaultValue = 0) {
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

// 6) Format number with locale-aware thousands separator
export function formatNumber(value) {
  const num = safeNumber(value);
  return num.toLocaleString();
}

// 7) Debounce utility for performance-sensitive operations
export function debounce(fn, delay = 100) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}
