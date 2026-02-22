// js/raceGrouping.js
// ===================
// Race Family Grouping Logic - Workstream A
// Groups elections by race family (e.g., "Governor" groups all Governor elections across years)

/**
 * Normalizes a race family key by stripping year and normalizing punctuation/spacing
 * @param {Object} entry - Election entry with { filename, year, category, displayName }
 * @returns {string} Normalized race family key
 */
export function getRaceFamily(entry) {
  if (!entry || !entry.filename) {
    return '';
  }

  const filename = entry.filename;
  const displayName = entry.displayName || filename;

  // Remove year suffix (e.g., "_2024.csv" or " (2024)")
  let normalized = displayName
    .replace(/\.csv$/, '')
    .replace(/\s*\(?\d{4}\)?\s*$/, '') // Remove trailing year in parentheses or underscore format
    .replace(/_\d{4}$/, '') // Remove trailing _YYYY
    .trim();

  // Normalize common patterns
  normalized = normalized
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .replace(/\s*-\s*/g, ' - ') // Normalize hyphens
    .replace(/_/g, ' ') // Replace underscores with spaces
    .trim();

  // Handle special cases for district/precinct numbers
  // Preserve "Precinct No 1" but normalize "Precinct_No_1" or "Precinct No. 1"
  normalized = normalized
    .replace(/Precinct\s*[Nn]o\.?\s*(\d+)/gi, 'Precinct No $1')
    .replace(/District\s*[Nn]o\.?\s*(\d+)/gi, 'District No $1')
    .replace(/Place\s*(\d+)/gi, 'Place $1')
    .replace(/Ward\s*(\d+)/gi, 'Ward $1')
    .replace(/Seat\s*[Nn]o\.?\s*(\d+)/gi, 'Seat No $1');

  // Handle abbreviations
  normalized = normalized
    .replace(/\bLt\b/gi, 'Lieutenant')
    .replace(/\bGov\b/gi, 'Governor')
    .replace(/\bRep\b/gi, 'Representative')
    .replace(/\bSen\b/gi, 'Senator')
    .replace(/\bAt\s*Large\b/gi, 'At Large');

  return normalized;
}

/**
 * Groups elections by race family
 * @param {Array<Object>} manifest - Array of election entries
 * @returns {Object} Grouped structure: { "Governor": { category, entries, totalYears, latestYear }, ... }
 */
export function groupElectionsByFamily(manifest) {
  if (!manifest || !Array.isArray(manifest)) {
    return {};
  }

  let grouped = {};

  for (const entry of manifest) {
    let familyKey = getRaceFamily(entry);

    if (!familyKey) {
      continue; // Skip invalid entries
    }

    if (!grouped[familyKey]) {
      grouped[familyKey] = {
        category: entry.category || 'County',
        entries: [],
        totalYears: 0,
        latestYear: null
      };
    }

    grouped[familyKey].entries.push({
      filename: entry.filename,
      year: entry.year || null,
      displayName: entry.displayName || entry.filename.replace(/\.csv$/, '').replace(/_/g, ' '),
      category: entry.category || 'County',
      ...entry // Preserve any additional properties
    });

    // Update metadata
    let years = grouped[familyKey].entries
      .map(e => e.year)
      .filter(y => y != null);

    grouped[familyKey].totalYears = new Set(years).size;
    grouped[familyKey].latestYear = years.length > 0 ? Math.max(...years) : null;
  }

  // Sort entries within each family by year descending
  for (const familyKey of Object.keys(grouped)) {
    grouped[familyKey].entries.sort((a, b) => {
      const yearA = a.year || 0;
      const yearB = b.year || 0;
      return yearB - yearA; // Descending
    });
  }

  return grouped;
}

/**
 * Sorts race families by the specified sort option
 * @param {Object} grouped - Grouped elections from groupElectionsByFamily
 * @param {string} sortBy - Sort option: 'alphabetical', 'category', 'latestYear'
 * @returns {Array} Sorted array of { familyKey, ...grouped[familyKey] }
 */
export function sortFamilies(grouped, sortBy = 'alphabetical') {
  if (!grouped || typeof grouped !== 'object') {
    return [];
  }

  let families = Object.keys(grouped).map(familyKey => ({
    familyKey,
    ...grouped[familyKey]
  }));

  // Category order for sorting
  let categoryOrder = {
    'Federal': 1,
    'State': 2,
    'County': 3,
    'City': 4,
    'ISD': 5,
    'MUD': 6
  };

  switch (sortBy) {
    case 'category':
      return families.sort((a, b) => {
        const orderA = categoryOrder[a.category] || 99;
        const orderB = categoryOrder[b.category] || 99;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        // Within same category, sort alphabetically
        return a.familyKey.localeCompare(b.familyKey);
      });

    case 'latestYear':
      return families.sort((a, b) => {
        const yearA = a.latestYear || 0;
        const yearB = b.latestYear || 0;
        if (yearB !== yearA) {
          return yearB - yearA; // Most recent first
        }
        // Same year, sort alphabetically
        return a.familyKey.localeCompare(b.familyKey);
      });

    case 'alphabetical':
    default:
      return families.sort((a, b) => a.familyKey.localeCompare(b.familyKey));
  }
}

/**
 * Gets human-readable display name for a race family key
 * @param {string} familyKey - Race family key
 * @returns {string} Human-readable display name
 */
export function getRaceFamilyDisplayName(familyKey) {
  if (!familyKey || typeof familyKey !== 'string') {
    return '';
  }

  // Capitalize first letter of each word
  return familyKey
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
