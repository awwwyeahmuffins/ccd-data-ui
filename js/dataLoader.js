// dataLoader.js — LEGACY SHIM (Phase 3, REDESIGN.md §5.1; deleted in Phase 6).
// The real data layer is js/data/dataService.js: memoized per-boundary handles,
// no global cache, no cache wipes. This shim keeps the old stateful API alive
// for the library modules that still import it (precinctLookup, precinctHistory,
// precinctProfile, fieldOnePager, precinctExport) by pointing their calls at
// the handle for a module-level "active boundary" (default: the 2026 set).
//
// The county concept is gone — the app is Collin-only (districts are a scope,
// not a subject). setActiveCounty accepts only "collin" and throws otherwise,
// which is exactly how legacy #county= deep-link code paths expect to fail.

import { boundary, safePrecinctName } from "./data/dataService.js";
import { COUNTY, BOUNDARY_SETS, DEFAULT_BOUNDARY } from "./data/catalog.js";

export { safePrecinctName };

let activeBoundary = DEFAULT_BOUNDARY;
const svc = () => boundary(activeBoundary);

export function getActiveCounty() {
  return COUNTY.slug;
}

// One synthesized registry entry — enough for the branding lookups that remain.
const REGISTRY = [{ slug: COUNTY.slug, name: COUNTY.name, status: "live", kind: "county", fips: COUNTY.fips, defaultBoundarySet: DEFAULT_BOUNDARY }];

export function loadCountyRegistry() {
  return Promise.resolve(REGISTRY);
}

export async function setActiveCounty(slug) {
  if (slug !== COUNTY.slug) throw new Error(`Unknown county: ${slug}`);
  activeBoundary = DEFAULT_BOUNDARY;
  return REGISTRY[0];
}

export function getBoundaryConfigs() {
  const configs = {};
  for (const [id, set] of Object.entries(BOUNDARY_SETS)) {
    configs[id] = { geojson: set.geojson, dataDir: set.dataDir, profileDir: set.profileDir, label: set.label };
  }
  return configs;
}

export function getActiveBoundary() {
  return activeBoundary;
}

// Switching just repoints the shim at a different (already-warm) handle —
// nothing is wiped; switch-back is instant.
export function setActiveBoundary(boundaryId) {
  if (!BOUNDARY_SETS[boundaryId]) throw new Error(`Unknown boundary set: ${boundaryId}`);
  activeBoundary = boundaryId;
}

// No global cache exists anymore; kept because old tests/paths may call it.
export function clearDataCache() {}

export const loadAllData = () => svc().loadAll();
export const listElectionCSVs = () => svc().listRaces();
export const loadElectionData = (filenameOrEntry) => svc().loadRace(filenameOrEntry);
export const loadPrecinctRaces = (precinctCode) => svc().loadPrecinctRaces(precinctCode);
export const loadCountyBaselines = () => svc().loadCountyBaselines();
export const loadPrimaryTurnout = () => svc().loadPrimaryTurnout();
