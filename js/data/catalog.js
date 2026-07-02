// js/data/catalog.js
// --------------------------------------------------------------------------------
// Inline Collin County config (REDESIGN.md §5.1). Replaces the frontend's
// counties.json registry fetch — one fewer request, no registry machinery.
// The JSON registry (data/tx/counties.json) stays on disk for the Python
// pipeline until Phase 6. Values mirror the registry's collin entry, with
// every path pre-joined against its dataRoot.

export const COUNTY = Object.freeze({
  slug: "collin",
  name: "Collin",
  fips: "48085",
  dataRoot: "data/tx/collin",
});

export const BOUNDARY_SETS = Object.freeze({
  original: Object.freeze({
    label: "2024 Boundaries (252)",
    geojson: "data/tx/collin/boundaries/2024.geojson",
    dataDir: "data/tx/collin/2024",
    profileDir: "data/tx/collin/2024/profile",
  }),
  2026: Object.freeze({
    label: "2026 Boundaries (273)",
    geojson: "data/tx/collin/boundaries/2026.geojson",
    dataDir: "data/tx/collin/2026",
    profileDir: "data/tx/collin/2026/profile",
  }),
});

export const DEFAULT_BOUNDARY = "2026";
