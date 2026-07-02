// constants.js — LEGACY SHIM (deleted in Phase 6, REDESIGN.md §4.2 move policy).
// Frozen literals live in js/lib/constants.js. ELECTION_META_KEYS stays here
// because it derives from electionSchema (the data layer) — lib imports nothing.
//
// Deleted with Phase 1 (dead code — no callers): ETHNICITY_COLORS,
// PRECINCT_STYLE, CHART_CONFIG, PARTY_LABELS, TURNOUT_CONFIG.

export { PARTY_COLORS, PARTY_STRENGTH_COLORS, MAP_CONFIG } from "./lib/constants.js";

import { getMetadataColumnsSet } from "./electionSchema.js";

// Metadata columns to exclude when identifying candidates
// Sourced from electionSchema.js for single source of truth
export const ELECTION_META_KEYS = getMetadataColumnsSet();
