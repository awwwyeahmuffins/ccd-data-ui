// domain/races.js
// --------------------------------------------------------------------------------
// The one home for race categorization, filtering, search, and family grouping
// (REDESIGN.md §4.1). Pure computation: no fetch, no DOM; imports lib only
// (currently nothing). Consolidates the pure halves of electionFilters.js and
// raceGrouping.js plus precinctHistory's categorizer.
//
// TWO CATEGORIZATION POLICIES, ONE HOME. The catalog policy
// (categorizeElection: 6 categories, County fallback — feeds pickers/chips and
// manifest normalization) and the history policy (categorizeRace: adds
// Propositions, Other fallback — feeds the precinct report's grouped history)
// produce genuinely different outputs for the same filename (e.g. Courts of
// Appeals: State vs County) and both behaviors are load-bearing today. They
// were merged HERE verbatim rather than into one function so neither surface
// changed during the migration; unifying the pattern tables is future work
// that would need a product decision about which grouping wins.

// ============================================================================
// CATEGORY DEFINITIONS
// ============================================================================

export const ELECTION_CATEGORIES = {
  FEDERAL: 'Federal',
  STATE: 'State',
  COUNTY: 'County',
  CITY: 'City',
  ISD: 'ISD',
  MUD: 'MUD',
  ALL: 'All'
};

// Full taxonomy display order (the history policy's section order). The
// elections catalog's chip order (All first, no Propositions/Other) is UI
// config and lives with its page.
export const CATEGORY_ORDER = ['Federal', 'State', 'County', 'City', 'ISD', 'MUD', 'Propositions', 'Other'];

// ============================================================================
// CROSS-COUNTY DISTRICT VIEWS
// ============================================================================

// A race that IS a district's own contest, mapped to its cross-county district
// view slug (data/tx/districts.json). Office spellings vary by county and year
// ("U S Representative District 3", "United States Representative District 3",
// "U.S. House District 4"), so match normalized office text.
const DISTRICT_VIEW_PATTERNS = [
  { prefix: 'cd', rx: /\b(u s|united states)\b.*\b(representative|rep|house|congress\w*)\b/ },
  { prefix: 'sd', rx: /\bstate sen(ator|ate)?\b/ },
  { prefix: 'hd', rx: /\bstate (rep(resentative)?|house)\b/ },
];

/**
 * Returns the cross-county district view slug ("cd-3", "sd-8", "hd-66") for a
 * race entry that is a federal/state district's own contest, or null.
 * @param {object} entry - normalized election entry ({ office, district })
 */
export function districtViewSlugForRace(entry) {
  if (!entry) return null;
  const office = String(entry.office || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const match = DISTRICT_VIEW_PATTERNS.find(({ rx }) => rx.test(office));
  if (!match) return null;
  let n = parseInt(String(entry.district ?? '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) {
    // number embedded in office text instead of the district field, e.g.
    // "State Senator, District No. 24", "State House 74 Dist 74", and the
    // source typo "Disttrict 88" (dist\w* absorbs it)
    const m = office.match(/\bdist\w*\s+(?:no\s+)?(\d+)\b/);
    n = m ? parseInt(m[1], 10) : NaN;
    if (!Number.isFinite(n) || n <= 0) return null;
  }
  return `${match.prefix}-${n}`;
}

/**
 * Office-based category for a normalized election entry, or null when the
 * office isn't conclusive. County manifests outside Collin often miscategorize
 * federal/state races as "County" (filename-based categorization only knows
 * Collin's naming) — this override keys off the office text instead.
 * @param {object} entry - normalized election entry ({ office, district })
 */
export function categorizeByOffice(entry) {
  const slug = districtViewSlugForRace(entry);
  if (slug) {
    return slug.startsWith('cd-') ? ELECTION_CATEGORIES.FEDERAL : ELECTION_CATEGORIES.STATE;
  }
  const o = String(entry?.office || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!o) return null;
  if (/\bpresident\b/.test(o)) return ELECTION_CATEGORIES.FEDERAL;
  if (/\bsenat/.test(o) && /\b(u s|united states|us)\b/.test(o)) return ELECTION_CATEGORIES.FEDERAL;
  if (/court of appeals|ct of app|justice of the peace/.test(o)) return null; // regional/local courts
  if (/^governor\b|\blieutenant governor\b|\battorney general\b|\bcomptroller\b|land office|land commissioner|\bagriculture\b|\brailroad\b|supreme court|criminal appeals/.test(o)) {
    return ELECTION_CATEGORIES.STATE;
  }
  return null;
}

// ============================================================================
// CATEGORIZATION — catalog policy
// ============================================================================

/**
 * Determines the category of an election based on its filename.
 * Catalog policy: 6 categories, defaults to County.
 * @param {string} filename - The election CSV filename
 * @returns {string} The category (Federal, State, County, City, ISD, MUD)
 */
export function categorizeElection(filename) {
  if (!filename || typeof filename !== 'string') {
    return ELECTION_CATEGORIES.COUNTY; // Default fallback
  }

  let normalized = filename.toLowerCase();

  // Federal races - President, US Senator, US Representatives
  if (
    normalized.includes('president') ||
    normalized.includes('united_states_senator') ||
    normalized.includes('u._s._representative') ||
    normalized.includes('united_states_representative')
  ) {
    return ELECTION_CATEGORIES.FEDERAL;
  }

  // MUD races (check before City to avoid false positives from city names)
  if (normalized.includes('_mud_') || normalized.includes('mud_no')) {
    return ELECTION_CATEGORIES.MUD;
  }

  // ISD races (check before City)
  if (normalized.includes('_isd_') || normalized.includes('_isd-') || normalized.includes('for_school_trustee')) {
    return ELECTION_CATEGORIES.ISD;
  }

  // City races - City_of_, Mayor, City_Council, Seat_No_ (council seats), Alderman
  if (
    normalized.includes('_city_of_') ||
    normalized.includes(',_city_of_') ||
    normalized.includes('mayor_') ||
    normalized.includes('city_council') ||
    normalized.includes('seat_no_') ||
    normalized.includes('alderman')
  ) {
    return ELECTION_CATEGORIES.CITY;
  }

  // State races - Governor, Lt Gov, AG, Comptroller, Commissioners, State Rep/Senator, State Courts
  if (
    normalized.includes('governor') ||
    normalized.includes('lieutenant_governor') ||
    normalized.includes('attorney_general') ||
    normalized.includes('comptroller') ||
    normalized.includes('commissioner_of_') ||
    normalized.includes('railroad_commissioner') ||
    normalized.includes('state_representative') ||
    normalized.includes('state_senator') ||
    normalized.includes('state_board_of_education') ||
    normalized.includes('court_of_criminal_appeals') ||
    normalized.includes('supreme_court') ||
    normalized.includes('court_of_appeals_district')
  ) {
    return ELECTION_CATEGORIES.STATE;
  }

  // County races - County_, District_, Sheriff, Constable, Justice_of_the_Peace
  if (
    normalized.includes('county_') ||
    normalized.includes('district_') ||
    normalized.includes('sheriff') ||
    normalized.includes('constable') ||
    normalized.includes('justice_of_the_peace')
  ) {
    return ELECTION_CATEGORIES.COUNTY;
  }

  // Default to County for unmatched races
  return ELECTION_CATEGORIES.COUNTY;
}

// ============================================================================
// CATEGORIZATION — history policy
// ============================================================================

// Order matters: more specific patterns should be checked before general ones.
// Case-SENSITIVE on purpose (matches the raw CSV filenames this policy has
// always seen); do not merge with the catalog policy above without a product
// decision — see the header note.
const RACE_CATEGORIES = {
  Federal: ['President', 'U._S._Representative', 'United_States_Representative', 'United_States_Senator'],
  State: ['Governor', 'Lieutenant_Governor', 'Attorney_General', 'Comptroller', 'Commissioner_of',
          'State_Representative', 'State_Senator', 'Railroad_Commissioner', 'Member,_State_Board',
          'Justice,_Supreme_Court', 'Judge,_Court_of_Criminal_Appeals', 'Presiding_Judge'],
  // MUD/ISD should be checked before County/City to avoid false matches
  ISD: ['_ISD_', 'School_Trustee'],
  MUD: ['_MUD_', 'MMD_'],
  County: ['County_Judge', 'County_Commissioner', 'County_Tax', 'District_Judge', 'District_Clerk',
           'Sheriff', 'Constable', 'Justice_of_the_Peace', 'Justice,_5th_Court_of_Appeals', 'Chief_Justice'],
  City: ['City_of', 'Mayor', 'City_Council', 'Alderman'],
  Propositions: ['Proposition_', 'Local_Option', 'Home_Rule', 'Home-Rule']
};

/**
 * Categorize a race filename into a type.
 * History policy: adds Propositions, defaults to Other.
 * @param {string} filename - Election CSV filename
 * @returns {string} - Category name
 */
export function categorizeRace(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'Other';
  }

  for (const [category, patterns] of Object.entries(RACE_CATEGORIES)) {
    for (const pattern of patterns) {
      if (filename.includes(pattern)) {
        return category;
      }
    }
  }
  return 'Other';
}

// ============================================================================
// FILTERING FUNCTIONS
// ============================================================================

/**
 * Filters elections by category
 * @param {Array<string|Object>} elections - Array of election filenames or objects
 * @param {string} category - Category to filter by (or 'All')
 * @returns {Array} Filtered array (same type as input)
 */
export function filterByCategory(elections, category) {
  if (!elections || !Array.isArray(elections)) {
    return [];
  }

  if (!category || category === ELECTION_CATEGORIES.ALL) {
    return elections;
  }

  return elections.filter(function matchCategory(entry) {
    let filename = typeof entry === 'string' ? entry : entry.filename;
    let entryCategory = typeof entry === 'object' && entry.category
      ? entry.category
      : categorizeElection(filename);
    return entryCategory === category;
  });
}

/**
 * Filters elections by year
 * @param {Array<Object>} elections - Array of election objects with { filename, year, ... }
 * @param {number|null} year - Year to filter by (null = all years)
 * @returns {Array<Object>} Filtered array
 */
export function filterByYear(elections, year) {
  if (!elections || !Array.isArray(elections)) {
    return [];
  }

  if (year == null) {
    return elections;
  }

  return elections.filter(function matchYear(entry) {
    // Handle both object format and legacy string format
    if (typeof entry === 'string') {
      // Try to extract year from filename
      let yearMatch = entry.match(/_(\d{4})\.csv$/);
      if (yearMatch) {
        return parseInt(yearMatch[1], 10) === year;
      }
      return false; // No year in filename, exclude if filtering by year
    }

    return entry.year === year;
  });
}

/**
 * Searches elections by query string (fuzzy matching)
 * @param {Array<string|Object>} elections - Array of election filenames or objects
 * @param {string} query - Search query
 * @returns {Array} Matching entries (same type as input)
 */
export function searchElections(elections, query) {
  if (!elections || !Array.isArray(elections)) {
    return [];
  }

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return elections;
  }

  let normalizedQuery = query.toLowerCase().trim();
  let queryWords = normalizedQuery.split(/\s+/);

  return elections.filter(function matchSearch(entry) {
    // Extract filename and displayName from entry (string or object)
    let filename = typeof entry === 'string' ? entry : entry.filename;
    let displayName = typeof entry === 'object' ? entry.displayName : null;

    // Replace underscores with spaces for better matching
    let normalizedFilename = filename
      .toLowerCase()
      .replace(/\.csv$/, '')
      .replace(/_/g, ' ');

    // Also search displayName if available
    let normalizedDisplayName = displayName
      ? displayName.toLowerCase()
      : '';

    // All query words must be found in filename OR displayName (AND logic per word)
    return queryWords.every(word =>
      normalizedFilename.includes(word) || normalizedDisplayName.includes(word)
    );
  });
}

// ============================================================================
// COUNTING FUNCTIONS
// ============================================================================

/**
 * Gets counts for each category
 * @param {Array<string|Object>} elections - Array of election filenames or objects
 * @returns {Object} Object with category counts
 */
export function getCategoryCounts(elections) {
  if (!elections || !Array.isArray(elections)) {
    return {
      [ELECTION_CATEGORIES.ALL]: 0,
      [ELECTION_CATEGORIES.FEDERAL]: 0,
      [ELECTION_CATEGORIES.STATE]: 0,
      [ELECTION_CATEGORIES.COUNTY]: 0,
      [ELECTION_CATEGORIES.CITY]: 0,
      [ELECTION_CATEGORIES.ISD]: 0,
      [ELECTION_CATEGORIES.MUD]: 0
    };
  }

  let counts = {
    [ELECTION_CATEGORIES.ALL]: elections.length,
    [ELECTION_CATEGORIES.FEDERAL]: 0,
    [ELECTION_CATEGORIES.STATE]: 0,
    [ELECTION_CATEGORIES.COUNTY]: 0,
    [ELECTION_CATEGORIES.CITY]: 0,
    [ELECTION_CATEGORIES.ISD]: 0,
    [ELECTION_CATEGORIES.MUD]: 0
  };

  for (let entry of elections) {
    let filename = typeof entry === 'string' ? entry : entry.filename;
    let category = (typeof entry === 'object' && entry.category)
      ? entry.category
      : categorizeElection(filename);
    if (Object.prototype.hasOwnProperty.call(counts, category)) {
      counts[category]++;
    }
  }

  return counts;
}

// ============================================================================
// FORMATTING FUNCTIONS
// ============================================================================

/**
 * Formats election filename for display
 * @param {string} filename - The election CSV filename
 * @returns {string} Human-readable election name
 */
export function formatElectionName(filename) {
  if (!filename || typeof filename !== 'string') {
    return '';
  }

  return filename
    .replace(/\.csv$/, '')
    .replace(/_/g, ' ')
    .replace(/\s+-\s+/g, ' - ') // Ensure proper spacing around hyphens
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
}

/**
 * Highlights search matches in text. NOTE: does not HTML-escape the input —
 * callers must escapeHtml untrusted text first (js/lib/dom.js).
 * @param {string} text - Text to highlight
 * @param {string} query - Search query
 * @returns {string} HTML with highlighted matches
 */
export function highlightMatches(text, query) {
  if (!text || !query || typeof text !== 'string' || typeof query !== 'string') {
    return text || '';
  }

  let trimmedQuery = query.trim();
  if (trimmedQuery === '') {
    return text;
  }

  let words = trimmedQuery.split(/\s+/);
  let result = text;

  for (let word of words) {
    if (word) {
      // Escape special regex characters for safe matching
      let escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let regex = new RegExp(`(${escapedWord})`, 'gi');
      result = result.replace(regex, '<mark>$1</mark>');
    }
  }

  return result;
}

// ============================================================================
// RACE FAMILY GROUPING (from raceGrouping.js)
// ============================================================================

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
