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
import { categorizeElection } from "./electionFilters.js";
// Import schema definitions and utilities
import { 
  ELECTION_MANIFEST_SCHEMA, 
  normalizeManifestEntry, 
  buildCSVPath 
} from "./electionSchema.js";

// Active boundary set: "original" (252 precincts) or "2026" (273 precincts)
let activeBoundary = "original";

// Data paths per boundary set
let BOUNDARY_CONFIGS = {
  original: {
    geojson: "data/Voting_Precincts.geojson",
    dataDir: "data",
    label: "2024 Boundaries (252)",
  },
  "2026": {
    geojson: "data/Voting_Precincts_2026.geojson",
    dataDir: "data/2026",
    label: "2026 Boundaries (273)",
  },
};

// Data cache to prevent redundant fetches
let dataCache = {
  allData: null,
  elections: {},
  electionsList: null
};

/**
 * Get the active boundary set ID
 */
export function getActiveBoundary() {
  return activeBoundary;
}

/**
 * Get available boundary configs
 */
export function getBoundaryConfigs() {
  return BOUNDARY_CONFIGS;
}

/**
 * Switch to a different boundary set. Clears all cached data.
 * @param {string} boundaryId - "original" or "2026"
 */
export function setActiveBoundary(boundaryId) {
  if (!BOUNDARY_CONFIGS[boundaryId]) {
    throw new Error(`Unknown boundary set: ${boundaryId}`);
  }
  console.log(`[DataLoader] setActiveBoundary: ${boundaryId} (dataDir: ${BOUNDARY_CONFIGS[boundaryId].dataDir})`);
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

  let config = BOUNDARY_CONFIGS[activeBoundary];
  const dir = config.dataDir;

  // 1) Fetch GeoJSON (2026 boundaries use separate file; original uses default)
  const geojsonUrl = activeBoundary === "2026"
    ? "data/Voting_Precincts_2026.geojson"
    : "data/Voting_Precincts.geojson";
  let geojsonPromise = fetch(geojsonUrl).then(function handleGeoJSONResponse(r) {
    if (!r.ok) throw new Error("Failed to fetch GeoJSON");
    return r.json();
  });

  // 2) Fetch DNC Score CSV
  let dncPromise = d3.csv(`${dir}/DNC Score By Precinct.csv`, function parseDNCRow(d) {
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

  // 3) Fetch Racial Numbers CSV
  let racialPromise = d3.csv(`${dir}/Racial Numbers by Precinct.csv`, function parseRacialRow(d) {
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
    metadataPromise = fetch(`${dir}/precinct_metadata.json`)
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}));
  } else {
    metadataPromise = Promise.resolve({});
  }

  // Wait for all data
  let [geojson, dncData, racialData, precinctMetadata] = await Promise.all([
    geojsonPromise,
    dncPromise,
    racialPromise,
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

  // Build path using schema utility (supports subdirectories)
  let entry = typeof filenameOrEntry === 'object' ? filenameOrEntry : { filename };
  const basePath = BOUNDARY_CONFIGS[activeBoundary].dataDir;
  const csvPath = buildCSVPath(entry, basePath);
  
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
  let rows = lines.slice(1).map(function buildRowObject(line) {
    let values = parseCSVLine(line);
    let obj = {};
    for (const [idx, h] of headers.entries()) {
      obj[h] = values[idx] ?? '';
    }
    return obj;
  });

  // Cache the result
  dataCache.elections[cacheKey] = rows;
  
  return rows;
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

  const manifestPath = `${BOUNDARY_CONFIGS[activeBoundary].dataDir}/elections.json`;
  let res = await fetch(manifestPath);
  if (!res.ok) {
    throw new Error(`Failed to load elections manifest: ${res.statusText}`);
  }
  let rawManifest = await res.json();

  // Normalize to ensure consistent format using schema module
  let normalized = normalizeElectionManifest(rawManifest);
  
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
  // Extract filename from objects if needed
  await Promise.all(files.map(function loadEntry(entry) {
    const filename = typeof entry === 'string' ? entry : entry.filename;
    return loadElectionData(filename);
  }));
  return files;
}
