// constants.js
// --------------------------------------------------------------------------------
// Centralized configuration and constant values used across the application.
// This eliminates magic numbers and provides a single source of truth.

// Party colors for election visualization
export const PARTY_COLORS = {
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
};

// Ethnicity colors for racial demographics chart
export const ETHNICITY_COLORS = {
  Asian: "#1f77b4",
  Black: "#ff7f0e",
  Hispanic: "#2ca02c",
  Others: "#d62728",
  White: "#9467bd"
};

// Map configuration
export const MAP_CONFIG = {
  center: [33.1, -96.6],
  zoom: 10,           // Start closer to Collin County (was 9)
  minZoom: 8,
  maxZoom: 14,
  zoomDelta: 0.25,
  zoomSnap: 0
};

// Party strength colors for demographics view
export const PARTY_STRENGTH_COLORS = {
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
};

// Import schema module for metadata columns
// Re-export for backward compatibility with existing code
import { getMetadataColumnsSet } from "./electionSchema.js";

// Metadata columns to exclude when identifying candidates
// Now sourced from electionSchema.js for single source of truth
export const ELECTION_META_KEYS = getMetadataColumnsSet();

// Precinct layer styling defaults
export const PRECINCT_STYLE = {
  default: {
    color: "#444",
    weight: 1,
    fillOpacity: 0.7
  },
  notInRace: {
    color: "#ccc",
    weight: 0.5,
    fillColor: "#f5f5f5",
    fillOpacity: 0.05
  },
  selected: {
    weight: 4,
    color: "#000"
  },
  hover: {
    weightIncrease: 1
  }
};

// Chart configuration
export const CHART_CONFIG = {
  pie: {
    responsive: true,
    maintainAspectRatio: true,
    animation: {
      animateRotate: true,
      duration: 600
    }
  },
  datalabels: {
    color: "#fff",
    font: {
      size: 16,
      weight: "bold"
    },
    textStrokeColor: "#000",
    textStrokeWidth: 2
  },
  legend: {
    position: "bottom",
    labels: {
      boxWidth: 12,
      padding: 10,
      font: {
        size: 14,
        weight: "bold"
      }
    }
  }
};

// Party label mappings for display
export const PARTY_LABELS = {
  Rep: "Republican",
  Dem: "Democrat",
  Mod: "Moderate",
  Lib: "Libertarian",
  Grn: "Green",
  Ind: "Independent",
  Con: "Constitution",
  "Non-Partisan": "Non-Partisan"
};

// Turnout view colors and configuration
export const TURNOUT_CONFIG = {
  // Color scale from red (low turnout) to green (high turnout)
  colors: {
    low: { r: 231, g: 76, b: 60 },      // #E74C3C - Red
    medium: { r: 241, g: 196, b: 15 },   // #F1C40F - Yellow
    high: { r: 39, g: 174, b: 96 }       // #27AE60 - Green
  },
  // Gray color for invalid/no data
  invalidColor: '#f5f5f5',
  // Style for precincts
  style: {
    default: {
      color: '#444',
      weight: 1,
      fillOpacity: 0.7
    },
    selected: {
      weight: 4,
      color: '#000'
    },
    noData: {
      color: '#ccc',
      weight: 0.5,
      fillColor: '#f5f5f5',
      fillOpacity: 0.05
    }
  },
  // Leaderboard settings
  leaderboard: {
    defaultCount: 10,
    maxCount: 25
  }
};
