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

// Data cache to prevent redundant fetches
const dataCache = {
  allData: null,
  elections: {},
  electionsList: null
};

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

  // 1) Fetch GeoJSON
  const geojsonPromise = fetch("data/Voting_Precincts.geojson").then(r => {
    if (!r.ok) throw new Error("Failed to fetch GeoJSON");
    return r.json();
  });

  // 2) Fetch DNC Score CSV
  const dncPromise = d3.csv("data/DNC Score By Precinct.csv", d => ({
    precinct: d.Precinct,
    rep: +d["Rep"],
    mod: +d["Mod"],
    dem: +d["Dem"],
    repShare: +d["Rep Share"],
    modShare: +d["Mod Share"],
    demShare: +d["Dem Share"],
    winningParty: d["Winning Party"],
    partyStrength: +d["Party Strength"]
  }));

  // 3) Fetch Racial Numbers CSV
  const racialPromise = d3.csv("data/Racial Numbers by Precinct.csv", d => ({
    precinct: d.precinct,
    asian: +d.asian,
    black: +d.black,
    hispanic: +d.hispanic,
    others: +d.others,
    white: +d.white,
    total: +d.total
  }));

  // Wait for all three
  const [geojson, dncData, racialData] = await Promise.all([
    geojsonPromise,
    dncPromise,
    racialPromise
  ]);

  // Build lookup objects keyed by PRECINCT (string)
  const dncLookup = Object.fromEntries(
    dncData.map(d => [String(d.precinct), d])
  );
  const racialLookup = Object.fromEntries(
    racialData.map(d => [String(d.precinct), d])
  );

  // Merge CSV data into each feature.properties
  geojson.features.forEach(feature => {
    const key = String(feature.properties.PRECINCT);
    if (dncLookup[key]) Object.assign(feature.properties, dncLookup[key]);
    if (racialLookup[key]) Object.assign(feature.properties, racialLookup[key]);
  });

  // Cache the result
  const result = { geojson, dncLookup, racialLookup };
  dataCache.allData = result;
  
  return result;
}

/**
 * Parse a CSV line handling quoted fields with commas
 * @param {string} line - A single CSV line
 * @returns {string[]} - Array of field values
 */
function parseCSVLine(line) {
  const result = [];
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
  const entry = typeof filenameOrEntry === 'object' ? filenameOrEntry : { filename };
  const csvPath = buildCSVPath(entry);
  
  const resp = await fetch(csvPath);
  if (!resp.ok) {
    throw new Error(`Could not load CSV ${csvPath}: ${resp.statusText}`);
  }
  const text = await resp.text();
  
  // Handle Windows CRLF line endings
  const lines = text.trim().replace(/\r\n/g, '\n').split("\n");
  if (lines.length < 2) return []; // no data

  // Parse header and data rows using robust CSV parser
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] ?? '';
    });
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

  return manifest.map(entry => {
    return normalizeManifestEntry(entry, categorizeElection);
  }).filter(entry => entry !== null);
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

  const res = await fetch(ELECTION_MANIFEST_SCHEMA.manifestPath);
  if (!res.ok) {
    throw new Error(`Failed to load elections manifest: ${res.statusText}`);
  }
  const rawManifest = await res.json();
  
  // Normalize to ensure consistent format using schema module
  const normalized = normalizeElectionManifest(rawManifest);
  
  // Cache and return
  dataCache.electionsList = normalized;
  
  return normalized;
}

/**
 * Preload all election data for faster subsequent access
 * Useful for initial app load if you want to cache everything
 */
export async function preloadAllElections() {
  const files = await listElectionCSVs();
  // Extract filename from objects if needed
  await Promise.all(files.map(entry => {
    const filename = typeof entry === 'string' ? entry : entry.filename;
    return loadElectionData(filename);
  }));
  return files;
}
