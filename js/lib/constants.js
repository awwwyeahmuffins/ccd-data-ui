// lib/constants.js
// --------------------------------------------------------------------------------
// Frozen configuration literals (REDESIGN.md §4.1). This layer imports nothing.
// Party colors are DATA ENCODINGS shared with the legend and patterns — do not
// change them. Deep-frozen so no consumer can mutate shared config at runtime
// (the old constants.js exported mutable `let` bindings).

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") deepFreeze(value);
  }
  return Object.freeze(obj);
}

// Party colors for election visualization
export const PARTY_COLORS = deepFreeze({
  // Partisan races - mixed case (from candidate names)
  Rep: "#E81B23",    // Republican red
  Dem: "#00AEF3",    // Democrat blue
  Mod: "#800080",    // Moderate purple
  Lib: "#FFC800",    // Libertarian gold
  Grn: "#17AA5C",    // Green party green
  Ind: "#9B59B6",    // Independent purple
  Con: "#FF6B35",    // Constitution orange

  // Partisan races - uppercase (from Winning Party column)
  REP: "#E81B23",
  DEM: "#00AEF3",
  LIB: "#FFC800",
  GRN: "#17AA5C",
  IND: "#9B59B6",
  CON: "#FF6B35",

  // Propositions / ballot measures
  For: "#2ECC71",    // Green for "For" (passed)
  FOR: "#2ECC71",
  Against: "#E74C3C", // Red for "Against" (failed)
  AGAINST: "#E74C3C",

  // Non-partisan races
  "Non-Partisan": "#9B59B6",

  // Default fallback
  default: "#888888"
});

// Party strength colors for demographics view
export const PARTY_STRENGTH_COLORS = deepFreeze({
  Rep: {
    1: "#fc9a9a", // very light, pinkish red
    2: "#d13636", // medium-light red
    3: "#630202", // dark red
    default: "#E06666"
  },
  Dem: {
    1: "#D6EAF8", // very light blue
    2: "#6D9EEB", // medium blue
    3: "#27408B", // dark blue
    default: "#6D9EEB"
  },
  Mod: {
    1: "#DDCCFF", // light lavender
    2: "#B19CD9", // medium purple
    3: "#5E2A7E", // darkest purple
    default: "#B19CD9"
  }
});

// Map configuration
export const MAP_CONFIG = deepFreeze({
  center: [33.1, -96.6],
  zoom: 10,           // Start closer to Collin County
  minZoom: 8,
  maxZoom: 14,
  zoomDelta: 0.25,
  zoomSnap: 0
});

// The one basemap (light-only since the June 2026 civic-plain redesign).
export const LIGHT_TILE_URL =
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

// Texas Secretary of State online address-change portal (SOSACManager) — the
// door-knock quick-share target for voters in inactive status. One frozen
// literal shared by the chair dashboard, its print packet, and the domain math.
export const SOS_ADDRESS_CHANGE_URL =
  "https://txapps.texas.gov/tolapp/sos/SOSACManager";
