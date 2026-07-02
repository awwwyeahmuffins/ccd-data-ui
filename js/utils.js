// utils.js — LEGACY SHIM (deleted in Phase 6, REDESIGN.md §4.2 move policy).
// The real implementations live in js/lib/. New code imports js/lib/format.js
// and js/lib/dom.js directly; existing importers keep working through these
// re-exports until the last one migrates.
//
// Deleted with Phase 1 (dead code — no callers): partyColorMap,
// buildRacialChartData, buildPartyChartData, clearLayers, getRowPrecinctCode.

export { escapeHtml, csvEscape, debounce } from "./lib/dom.js";
export {
  safeNumber,
  formatNumber,
  formatPct,
  populationOf,
  formatPrecinctLabel
} from "./lib/format.js";
