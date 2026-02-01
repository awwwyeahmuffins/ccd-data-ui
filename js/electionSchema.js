// electionSchema.js
// --------------------------------------------------------------------------------
// Centralized schema definitions for election data manifest and CSV files.
// This module serves as the single source of truth for data structure definitions,
// making it easier to adapt to schema changes in the future.
//
// This module implements the data contract specified in DATA_LAYOUT_SPEC.md.
// When updating this file, ensure consistency with the specification document.
//
// Usage:
//   import { ELECTION_MANIFEST_SCHEMA, CSV_SCHEMA, getCandidateColumns } from "./electionSchema.js";
//
// See DATA_LAYOUT_SPEC.md for complete documentation of the data layout.

/**
 * Manifest entry shape definition
 * @typedef {Object} ElectionManifestEntry
 * @property {string} filename - CSV filename (path relative to data/ directory, e.g. "Governor_2024.csv" or "2024/Governor.csv")
 * @property {number|null} year - Election year (number or null)
 * @property {string} [category] - Election category: "Federal", "State", "County", "City", "ISD", "MUD"
 * @property {string} [displayName] - Human-readable display name (optional)
 * @property {string} [raceKey] - Unique race identifier (optional, for trends/comparison)
 * @property {string} [sourceUrl] - Source URL for the data (optional)
 */

/**
 * Manifest schema configuration
 */
export const ELECTION_MANIFEST_SCHEMA = {
  /**
   * Path to the manifest file relative to app root
   */
  manifestPath: "data/elections.json",
  
  /**
   * Required fields in a manifest entry
   */
  requiredFields: ["filename"],
  
  /**
   * Optional fields in a manifest entry
   */
  optionalFields: ["year", "category", "displayName", "raceKey", "sourceUrl"],
  
  /**
   * Default values for optional fields
   */
  defaults: {
    year: null,
    category: null,
    displayName: undefined,
    raceKey: undefined,
    sourceUrl: undefined
  }
};

/**
 * CSV schema configuration
 * Defines the structure of election CSV files
 * 
 * See DATA_LAYOUT_SPEC.md Section 3 for complete CSV schema documentation.
 */
export const CSV_SCHEMA = {
  /**
   * Metadata columns that are NOT candidate vote columns.
   * These columns contain precinct information, turnout data, and race metadata.
   * 
   * Candidate columns are detected as all columns NOT in this list.
   * 
   * @see DATA_LAYOUT_SPEC.md Section 3.1-3.3 for column descriptions
   */
  metadataColumns: [
    "COUNTY NUMBER",
    "PRECINCT CODE",
    "PRECINCT NAME",
    "REGISTERED VOTERS TOTAL",
    "BALLOTS CAST TOTAL",
    "BALLOTS CAST BLANK",
    "Write-in",
    "OVER VOTES",
    "UNDER VOTES",
    "Winning Candidate",
    "Winning Party"
  ],
  
  /**
   * Required metadata columns that must be present in every CSV
   * These are the minimum columns needed for the application to function.
   */
  requiredMetadataColumns: [
    "PRECINCT CODE",
    "PRECINCT NAME"
  ],
  
  /**
   * Columns that contain vote counts (candidate columns)
   * These are dynamically detected as all columns NOT in metadataColumns
   * 
   * Candidate column naming pattern: "{PARTY_ABBREV} {Candidate Name}"
   * Examples: "REP Greg Abbott", "DEM Beto O'Rourke", "LIB Mark Tippetts"
   * 
   * Supported party abbreviations: REP/Rep, DEM/Dem, LIB/Lib, GRN/Grn, MOD/Mod, IND/Ind, CON/Con
   */
  candidateColumnRule: "all columns except metadataColumns",
  
  /**
   * Expected data types for metadata columns
   * Used for validation and type conversion
   */
  columnTypes: {
    "COUNTY NUMBER": "string",
    "PRECINCT CODE": "string",
    "PRECINCT NAME": "string",
    "REGISTERED VOTERS TOTAL": "number",
    "BALLOTS CAST TOTAL": "number",
    "BALLOTS CAST BLANK": "number",
    "Write-in": "number",
    "OVER VOTES": "number",
    "UNDER VOTES": "number",
    "Winning Candidate": "string",
    "Winning Party": "string"
  },
  
  /**
   * Valid election categories
   * Used for validation and filtering
   */
  validCategories: ["Federal", "State", "County", "City", "ISD", "MUD"],
  
  /**
   * Candidate column naming pattern
   * Format: "{PARTY_ABBREV} {Candidate Name}"
   * The first word is the party abbreviation, followed by the candidate's full name
   */
  candidateColumnPattern: /^([A-Z]{2,4})\s+(.+)$/i
};

/**
 * Get the set of metadata column names (for efficient lookup)
 * @returns {Set<string>} Set of metadata column names
 */
export function getMetadataColumnsSet() {
  return new Set(CSV_SCHEMA.metadataColumns);
}

/**
 * Identify candidate columns from CSV headers
 * Candidate columns are all columns that are NOT in the metadata columns list
 * 
 * @param {string[]} headers - Array of CSV column headers
 * @returns {string[]} Array of candidate column names
 * 
 * @example
 * const headers = ["PRECINCT CODE", "PRECINCT NAME", "REP Greg Abbott", "DEM Beto O'Rourke"];
 * const candidates = getCandidateColumns(headers);
 * // Returns: ["REP Greg Abbott", "DEM Beto O'Rourke"]
 */
export function getCandidateColumns(headers) {
  if (!Array.isArray(headers)) {
    return [];
  }
  const metadataSet = getMetadataColumnsSet();
  return headers.filter(header => !metadataSet.has(header));
}

/**
 * Extract party abbreviation from candidate column name
 * Candidate columns follow pattern: "{PARTY_ABBREV} {Candidate Name}"
 * 
 * @param {string} candidateColumn - Candidate column name (e.g., "REP Greg Abbott")
 * @returns {string|null} Party abbreviation (e.g., "REP") or null if pattern doesn't match
 * 
 * @example
 * extractPartyFromColumn("REP Greg Abbott") // Returns "REP"
 * extractPartyFromColumn("DEM Beto O'Rourke") // Returns "DEM"
 * extractPartyFromColumn("Write-in") // Returns null (not a candidate column)
 */
export function extractPartyFromColumn(candidateColumn) {
  if (!candidateColumn || typeof candidateColumn !== 'string') {
    return null;
  }
  
  // Split by first space - first word is party abbreviation
  const parts = candidateColumn.trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  
  return parts[0].toUpperCase();
}

/**
 * Extract candidate name from candidate column name
 * Removes the party abbreviation prefix
 * 
 * @param {string} candidateColumn - Candidate column name (e.g., "REP Greg Abbott")
 * @returns {string} Candidate name without party prefix (e.g., "Greg Abbott")
 * 
 * @example
 * extractCandidateName("REP Greg Abbott") // Returns "Greg Abbott"
 * extractCandidateName("DEM Beto O'Rourke") // Returns "Beto O'Rourke"
 */
export function extractCandidateName(candidateColumn) {
  if (!candidateColumn || typeof candidateColumn !== 'string') {
    return '';
  }
  
  // Split by first space and return everything after the party abbreviation
  const parts = candidateColumn.trim().split(/\s+/);
  if (parts.length < 2) {
    return candidateColumn; // Return as-is if no space found
  }
  
  return parts.slice(1).join(' ');
}

/**
 * Validate that a manifest entry has required fields
 * 
 * @param {Object} entry - Manifest entry to validate
 * @returns {boolean} True if valid, false otherwise
 * 
 * @example
 * validateManifestEntry({ filename: "Governor_2024.csv" }) // Returns true
 * validateManifestEntry({ year: 2024 }) // Returns false (missing filename)
 * validateManifestEntry(null) // Returns false
 */
export function validateManifestEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  
  // Check required fields
  for (const field of ELECTION_MANIFEST_SCHEMA.requiredFields) {
    if (!(field in entry)) {
      return false;
    }
  }
  
  // Validate category if present
  if (entry.category && !CSV_SCHEMA.validCategories.includes(entry.category)) {
    return false;
  }
  
  return true;
}

/**
 * Validate CSV row structure
 * Checks that required metadata columns are present
 * 
 * @param {Object} row - CSV row object (parsed from CSV)
 * @returns {Object} Validation result with { valid: boolean, missingColumns: string[] }
 * 
 * @example
 * const row = { "PRECINCT CODE": "1", "PRECINCT NAME": "PCT 001", "REP John Doe": 100 };
 * const result = validateCSVRow(row);
 * // Returns: { valid: true, missingColumns: [] }
 */
export function validateCSVRow(row) {
  if (!row || typeof row !== 'object') {
    return { valid: false, missingColumns: CSV_SCHEMA.requiredMetadataColumns };
  }
  
  const missingColumns = CSV_SCHEMA.requiredMetadataColumns.filter(
    col => !(col in row)
  );
  
  return {
    valid: missingColumns.length === 0,
    missingColumns
  };
}

/**
 * Build CSV file path from manifest entry
 * Supports both flat filenames (e.g., "Governor_2024.csv") and subdirectory paths (e.g., "2024/Governor.csv")
 * 
 * @param {Object} entry - Manifest entry with filename property
 * @param {string} [basePath="data"] - Base path for data directory
 * @returns {string} Full path to CSV file
 * 
 * @example
 * buildCSVPath({ filename: "Governor_2024.csv" }) // Returns "data/Governor_2024.csv"
 * buildCSVPath({ filename: "2024/Governor.csv" }) // Returns "data/2024/Governor.csv"
 * buildCSVPath({ filename: "/State/Governor.csv" }) // Returns "data/State/Governor.csv"
 * 
 * @see DATA_LAYOUT_SPEC.md Section 2 for path building rules
 */
export function buildCSVPath(entry, basePath = "data") {
  if (!entry || !entry.filename) {
    throw new Error("Manifest entry must have a filename property");
  }
  
  // If filename already includes path separators (e.g., "2024/Governor.csv"), use as-is
  // Otherwise, treat as flat filename (e.g., "Governor_2024.csv")
  const filename = entry.filename;
  
  // Remove leading slash if present
  const normalizedFilename = filename.startsWith('/') ? filename.slice(1) : filename;
  
  // Build path: basePath/filename
  return `${basePath}/${normalizedFilename}`;
}

/**
 * Normalize manifest entry to ensure all fields are present
 * @param {string|Object} entry - Raw manifest entry (string or object)
 * @param {Function} categorizeFn - Function to categorize election from filename
 * @returns {ElectionManifestEntry|null} Normalized entry or null if invalid
 */
export function normalizeManifestEntry(entry, categorizeFn) {
  // If already an object with filename, ensure required fields
  if (typeof entry === 'object' && entry !== null && 'filename' in entry) {
    return {
      filename: entry.filename,
      year: entry.year ?? ELECTION_MANIFEST_SCHEMA.defaults.year,
      category: entry.category ?? categorizeFn?.(entry.filename) ?? ELECTION_MANIFEST_SCHEMA.defaults.category,
      displayName: entry.displayName ?? ELECTION_MANIFEST_SCHEMA.defaults.displayName,
      raceKey: entry.raceKey ?? ELECTION_MANIFEST_SCHEMA.defaults.raceKey,
      sourceUrl: entry.sourceUrl ?? ELECTION_MANIFEST_SCHEMA.defaults.sourceUrl
    };
  }
  
  // Legacy format: string filename
  if (typeof entry === 'string') {
    // Try to extract year from filename (e.g., "Governor_2024.csv" -> 2024)
    let year = null;
    const yearMatch = entry.match(/_(\d{4})\.csv$/);
    if (yearMatch) {
      year = parseInt(yearMatch[1], 10);
    }
    
    return {
      filename: entry,
      year: year,
      category: categorizeFn?.(entry) ?? ELECTION_MANIFEST_SCHEMA.defaults.category,
      displayName: ELECTION_MANIFEST_SCHEMA.defaults.displayName,
      raceKey: ELECTION_MANIFEST_SCHEMA.defaults.raceKey,
      sourceUrl: ELECTION_MANIFEST_SCHEMA.defaults.sourceUrl
    };
  }
  
  // Invalid entry
  return null;
}

/**
 * Get race key from manifest entry
 * Race key is used for identifying the same race across different elections (for trends/comparison)
 * 
 * @param {Object} entry - Manifest entry
 * @returns {string} Race key (e.g., "governor-2024") or filename if raceKey not provided
 * 
 * @example
 * getRaceKey({ filename: "Governor_2024.csv", raceKey: "governor-2024" }) // Returns "governor-2024"
 * getRaceKey({ filename: "Governor_2024.csv" }) // Returns "Governor_2024.csv"
 */
export function getRaceKey(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  
  // Use explicit raceKey if provided
  if (entry.raceKey) {
    return entry.raceKey;
  }
  
  // Fallback to filename
  return entry.filename || null;
}
