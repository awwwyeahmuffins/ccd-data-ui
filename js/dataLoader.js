// dataLoader.js
// --------------------------------------------------------------------------------
// Fetch GeoJSON + CSV(s), merge them, and return a typed object for map + sidebar.
// Includes caching to prevent redundant network requests.
//
// Usage in app.js: 
//   import { loadAllData } from "./dataLoader.js";
//   loadAllData()
//     .then(({ geojson, dncLookup, racialLookup }) => { ... });

// Import categorizeElection for normalizing legacy manifest entries
import { categorizeElection, categorizeByOffice } from "./electionFilters.js";
// Import schema definitions and utilities
import {
  normalizeManifestEntry,
  buildCSVPath,
  isV3Manifest,
  normalizeV3Entry
} from "./electionSchema.js";
import { pivotRace, computeWinners } from "./v3Pivot.js";

// ---------------------------------------------------------------------------
// COUNTY LAYER (Collin-focused)
// The app focuses on Collin County (data/tx/counties.json) plus the cross-county
// districts that include Collin (data/tx/districts.json — CD/SD/HD), where the
// non-Collin counties are collapsed to county-level totals. Every registry
// entry is "live" and registry-driven: its `dataRoot` + `boundarySets` describe
// where boundaries, race files, turnout, and profile extras live (v3).
// ---------------------------------------------------------------------------
let activeCounty = "collin"; // county slug from data/tx/counties.json
let activeCountyEntry = null; // cached registry entry for activeCounty
let countyRegistryPromise = null;

/** Get the active county slug (default "collin"). */
export function getActiveCounty() {
  return activeCounty;
}

/** Load (and cache) the registry: Collin County plus the cross-county district
 * views (congressional / state senate / state house) that include Collin —
 * all behave like counties. */
export function loadCountyRegistry() {
  if (!countyRegistryPromise) {
    countyRegistryPromise = Promise.all([
      fetch("data/tx/counties.json").then(r => {
        if (!r.ok) throw new Error("Failed to fetch county registry");
        return r.json();
      }),
      fetch("data/tx/districts.json").then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([counties, districts]) => [...counties, ...districts]);
  }
  return countyRegistryPromise;
}

/** Resolve (and cache) the registry entry for the active county. */
async function ensureCountyEntry() {
  if (activeCountyEntry && activeCountyEntry.slug === activeCounty) {
    return activeCountyEntry;
  }
  const registry = await loadCountyRegistry();
  activeCountyEntry = registry.find(c => c.slug === activeCounty) || null;
  return activeCountyEntry;
}

/** Switch the active county. Clears all cached data. */
export async function setActiveCounty(slug) {
  const registry = await loadCountyRegistry();
  const entry = registry.find(c => c.slug === slug);
  if (!entry) throw new Error(`Unknown county: ${slug}`);
  console.log(`[DataLoader] setActiveCounty: ${slug} (${entry.status})`);
  activeCounty = slug;
  activeCountyEntry = entry;
  // Reset the boundary set to the county's default
  activeBoundary = entry.defaultBoundarySet ?? "original";
  clearDataCache();
  return entry;
}

// Active boundary set id (e.g. "original" or "2026")
let activeBoundary = "original";

/**
 * Boundary-set configs for the ACTIVE county, derived from its registry entry.
 * Synchronous: relies on the entry being cached by any prior
 * loadAllData()/setActiveCounty() call (both pages load data before using this).
 */
export function getBoundaryConfigs() {
  const entry = activeCountyEntry;
  if (!entry?.boundarySets) return {};
  const configs = {};
  for (const [id, set] of Object.entries(entry.boundarySets)) {
    configs[id] = {
      geojson: `${entry.dataRoot}/${set.geojson}`,
      dataDir: `${entry.dataRoot}/${set.dataDir}`,
      profileDir: `${entry.dataRoot}/${set.dataDir}/profile`,
      label: set.label,
    };
  }
  return configs;
}

function activeConfig() {
  const configs = getBoundaryConfigs();
  return configs[activeBoundary] ?? configs[Object.keys(configs)[0]];
}

// Data cache to prevent redundant fetches
let dataCache = {
  allData: null,
  elections: {},
  electionsList: null,
  turnout: {},
  precinctHistory: {}, // per-precinct pivoted rows, keyed by "<dataDir>/<safe>"
  baselines: {}        // county Dem-share baselines, keyed by dataDir
};

/**
 * Get the active boundary set ID
 */
export function getActiveBoundary() {
  return activeBoundary;
}

/**
 * Switch to a different boundary set of the active county. Clears all cached data.
 * @param {string} boundaryId - e.g. "original" or "2026"
 */
export function setActiveBoundary(boundaryId) {
  const configs = getBoundaryConfigs();
  if (!configs[boundaryId]) {
    throw new Error(`Unknown boundary set: ${boundaryId}`);
  }
  console.log(`[DataLoader] setActiveBoundary: ${boundaryId} (dataDir: ${configs[boundaryId].dataDir})`);
  activeBoundary = boundaryId;
  clearDataCache();
}

/**
 * Clear the data cache (useful for testing or forced refresh)
 */
export function clearDataCache() {
  dataCache.allData = null;
  dataCache.elections = {};
  dataCache.electionsList = null;
  dataCache.turnout = {};
  dataCache.precinctHistory = {};
  dataCache.baselines = {};
}

/**
 * Filesystem/URL-safe precinct file stem. MUST mirror data_processor/
 * build_precinct_history.py safe_name() so the client fetches the file the
 * pipeline wrote (e.g. district code "collin:1" -> "collin_1.json").
 */
export function safePrecinctName(code) {
  return String(code).replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Load a single precinct's precomputed election history and return it in the
 * legacy `allElectionData` shape — { raceFile: [oneRowForThisPrecinct] } — a
 * drop-in for the old loadAllElectionDataForHistory() map, but one small fetch
 * instead of ~587. Every precinct-page consumer only ever looks up this
 * precinct's row, so a 1-element array per race is sufficient. Cached per
 * (dataDir, precinct); missing file (e.g. non-participating precinct) -> {}.
 */
export async function loadPrecinctRaces(precinctCode) {
  await ensureCountyEntry();
  const dir = activeConfig().dataDir;
  const key = `${dir}/${safePrecinctName(precinctCode)}`;
  if (!dataCache.precinctHistory[key]) {
    dataCache.precinctHistory[key] = fetch(`${dir}/history/${safePrecinctName(precinctCode)}.json`)
      .then(r => (r.ok ? r.json() : null))
      .then(doc => {
        const map = {};
        if (doc && doc.races) {
          for (const [raceFile, row] of Object.entries(doc.races)) map[raceFile] = [row];
        }
        return map;
      })
      .catch(() => ({}));
  }
  return dataCache.precinctHistory[key];
}

/**
 * Load the active boundary set's county-wide Dem-share baselines
 * ({ raceFile: share }), used by computePVI (the one genuinely cross-precinct
 * value). Cached per dataDir; missing file -> {}.
 */
export async function loadCountyBaselines() {
  await ensureCountyEntry();
  const dir = activeConfig().dataDir;
  if (!dataCache.baselines[dir]) {
    dataCache.baselines[dir] = fetch(`${dir}/history/county_baselines.json`)
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return dataCache.baselines[dir];
}

/**
 * Load all base data (GeoJSON + DNC + Racial CSVs)
 * Results are cached after first load
 */
export async function loadAllData() {
  // Return cached data if available
  if (dataCache.allData) {
    return dataCache.allData;
  }

  const countyEntry = await ensureCountyEntry();
  if (!countyEntry || countyEntry.status !== "live") {
    throw new Error(`No live data for: ${activeCounty}`);
  }

  let config = activeConfig();
  const dncPath = `${config.profileDir}/dnc_scores.csv`;
  const racialPath = `${config.profileDir}/racial.csv`;

  // 1) Fetch GeoJSON for the active boundary set
  let geojsonPromise = fetch(config.geojson).then(function handleGeoJSONResponse(r) {
    if (!r.ok) throw new Error("Failed to fetch GeoJSON");
    return r.json();
  });

  // 2) Fetch DNC Score CSV (optional — counties without it show N/A)
  let dncPromise = d3.csv(dncPath, function parseDNCRow(d) {
    return {
      precinct: d.Precinct,
      rep: +d["Rep"],
      mod: +d["Mod"],
      dem: +d["Dem"],
      repShare: +d["Rep Share"],
      modShare: +d["Mod Share"],
      demShare: +d["Dem Share"],
      winningParty: d["Winning Party"],
      partyStrength: +d["Party Strength"]
    };
  });

  // 3) Fetch Racial Numbers CSV (optional)
  let racialPromise = d3.csv(racialPath, function parseRacialRow(d) {
    return {
      precinct: d.precinct,
      asian: +d.asian,
      black: +d.black,
      hispanic: +d.hispanic,
      others: +d.others,
      white: +d.white,
      total: +d.total,
      pct_asian: parseFloat(d.pct_asian) / 100 || 0,
      pct_black: parseFloat(d.pct_black) / 100 || 0,
      pct_hispanic: parseFloat(d.pct_hispanic) / 100 || 0,
      pct_others: parseFloat(d.pct_others) / 100 || 0,
      pct_white: parseFloat(d.pct_white) / 100 || 0
    };
  });

  // 4) Fetch precinct metadata (2026 boundaries only — quality/interpolation info)
  let metadataPromise;
  if (activeBoundary === "2026") {
    metadataPromise = fetch(`${config.profileDir}/precinct_metadata.json`)
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}));
  } else {
    metadataPromise = Promise.resolve({});
  }

  // Wait for all data. Profile extras (DNC/racial) are OPTIONAL: a live county
  // without them renders with honest N/A values instead of failing to load.
  let [geojson, dncData, racialData, precinctMetadata] = await Promise.all([
    geojsonPromise,
    dncPromise.catch(() => []),
    racialPromise.catch(() => []),
    metadataPromise
  ]);

  // Build lookup objects keyed by PRECINCT (string)
  let dncLookup = Object.fromEntries(
    dncData.map(d => [String(d.precinct), d])
  );
  let racialLookup = Object.fromEntries(
    racialData.map(d => [String(d.precinct), d])
  );

  // Merge CSV data + metadata into each feature.properties
  for (const feature of geojson.features) {
    const key = String(feature.properties.PRECINCT);
    if (dncLookup[key]) Object.assign(feature.properties, dncLookup[key]);
    if (racialLookup[key]) Object.assign(feature.properties, racialLookup[key]);
    if (precinctMetadata[key]) {
      feature.properties._meta = precinctMetadata[key];
    }
  }

  // Cache the result
  let result = { geojson, dncLookup, racialLookup };
  dataCache.allData = result;

  console.log(`[DataLoader] loadAllData: ${geojson.features.length} features, ${Object.keys(dncLookup).length} DNC entries, ${Object.keys(racialLookup).length} racial entries`);
  return result;
}

/**
 * Parse a CSV line handling quoted fields with commas
 * @param {string} line - A single CSV line
 * @returns {string[]} - Array of field values
 */
function parseCSVLine(line) {
  let result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Load election data from a specific CSV file
 * Results are cached per filename
 * Supports both flat filenames (e.g., "Governor_2024.csv") and subdirectory paths (e.g., "2024/Governor.csv")
 * @param {string|Object} filenameOrEntry - The election CSV filename (string) or manifest entry (object)
 */
export async function loadElectionData(filenameOrEntry) {
  // Determine filename and cache key
  let filename;
  let cacheKey;
  
  if (typeof filenameOrEntry === 'string') {
    // Legacy: filename as string
    filename = filenameOrEntry;
    cacheKey = filename;
  } else if (filenameOrEntry && typeof filenameOrEntry === 'object' && 'filename' in filenameOrEntry) {
    // New: manifest entry object
    filename = filenameOrEntry.filename;
    cacheKey = filename;
  } else {
    throw new Error("loadElectionData requires a filename string or manifest entry object");
  }
  
  // Return cached data if available
  if (dataCache.elections[cacheKey]) {
    return dataCache.elections[cacheKey];
  }

  // Resolve the manifest entry: a bare string may name a v3 race, so look it
  // up in the cached manifest before falling back to a legacy {filename} stub
  let entry;
  if (typeof filenameOrEntry === 'object') {
    entry = filenameOrEntry;
  } else {
    entry = dataCache.electionsList?.find(e => e.filename === filename) ?? { filename };
  }

  const basePath = activeConfig().dataDir;

  // v3 path: long race file + optional turnout file, pivoted to legacy rows
  if (entry._v3) {
    const [longRows, turnoutRows] = await Promise.all([
      fetchCSVRows(`${basePath}/${entry.raceFile}`),
      loadTurnoutFile(basePath, entry.turnoutFile),
    ]);
    const rows = computeWinners(pivotRace(longRows, turnoutRows));
    dataCache.elections[cacheKey] = rows;
    return rows;
  }

  // Legacy path: wide per-race CSV
  const csvPath = buildCSVPath(entry, basePath);
  const rows = await fetchCSVRows(csvPath);
  dataCache.elections[cacheKey] = rows;
  return rows;
}

/** Fetch and parse a CSV into row objects (string values). */
async function fetchCSVRows(csvPath) {
  let resp = await fetch(csvPath);
  if (!resp.ok) {
    throw new Error(`Could not load CSV ${csvPath}: ${resp.statusText}`);
  }
  const text = await resp.text();

  // Handle Windows CRLF line endings
  let lines = text.trim().replace(/\r\n/g, '\n').split("\n");
  if (lines.length < 2) return []; // no data

  // Parse header and data rows using robust CSV parser
  let headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(function buildRowObject(line) {
    let values = parseCSVLine(line);
    let obj = {};
    for (const [idx, h] of headers.entries()) {
      obj[h] = values[idx] ?? '';
    }
    return obj;
  });
}

/** Fetch a v3 turnout file, cached per path (many races share one). */
async function loadTurnoutFile(basePath, turnoutFile) {
  if (!turnoutFile) return null; // honest gap — pivot leaves turnout columns ''
  const path = `${basePath}/${turnoutFile}`;
  if (!dataCache.turnout[path]) {
    dataCache.turnout[path] = fetchCSVRows(path).catch(err => {
      console.warn(`[DataLoader] turnout file missing: ${path}`, err);
      return null;
    });
  }
  return dataCache.turnout[path];
}

/**
 * Normalizes election manifest entries to ensure consistent format
 * Supports both legacy (array of strings) and new (array of objects) formats
 * Uses schema module for normalization
 * @param {Array<string|Object>} manifest - Raw manifest from JSON
 * @returns {Array<Object>} Normalized array of objects with { filename, year, category?, displayName? }
 */
function normalizeElectionManifest(manifest) {
  if (!Array.isArray(manifest)) {
    return [];
  }

  return manifest.map(function normalizeEntry(entry) {
    return normalizeManifestEntry(entry, categorizeElection);
  }).filter(entry => entry != null);
}

/**
 * List available election CSV files
 * Results are cached after first load
 * Returns normalized array of objects: { filename, year, category?, displayName? }
 */
export async function listElectionCSVs() {
  // Return cached list if available
  if (dataCache.electionsList) {
    return dataCache.electionsList;
  }

  // Placeholder counties have no election data yet — an empty list, never fakes
  const countyEntry = await ensureCountyEntry();
  if (!countyEntry || countyEntry.status !== "live") {
    dataCache.electionsList = [];
    return dataCache.electionsList;
  }

  const manifestPath = `${activeConfig().dataDir}/elections.json`;
  let res = await fetch(manifestPath);
  if (!res.ok) {
    throw new Error(`Failed to load elections manifest: ${res.statusText}`);
  }
  let rawManifest = await res.json();

  // Normalize: v3 manifests are an object wrapper; legacy is a bare array
  let normalized = isV3Manifest(rawManifest)
    ? rawManifest.elections.map(e => normalizeV3Entry(e, categorizeElection)).filter(Boolean)
    : normalizeElectionManifest(rawManifest);

  // Office-based category override: non-Collin manifests often mislabel
  // federal/state races as "County" (their categories were derived from
  // filenames only Collin uses) — fix conclusively-identifiable offices
  normalized = normalized.map(e => {
    const byOffice = categorizeByOffice(e);
    return byOffice && byOffice !== e.category ? { ...e, category: byOffice } : e;
  });

  // Cache and return
  dataCache.electionsList = normalized;
  
  return normalized;
}

/**
 * Preload all election data for faster subsequent access
 * Useful for initial app load if you want to cache everything
 */
export async function preloadAllElections() {
  let files = await listElectionCSVs();
  await Promise.all(files.map(function loadEntry(entry) {
    return loadElectionData(entry);
  }));
  return files;
}
