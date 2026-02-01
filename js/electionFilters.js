// js/electionFilters.js
// =====================
// Module for election filtering, categorization, and search functionality
// Supports Workstream 2: Election Discovery and Filtering
// Enhanced with Workstream C: Grouping and search highlights

// Import race grouping functions (Workstream A)
import {
  groupElectionsByFamily,
  sortFamilies
} from "./raceGrouping.js";

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

// Category display order for tabs
export const CATEGORY_ORDER = [
  ELECTION_CATEGORIES.ALL,
  ELECTION_CATEGORIES.FEDERAL,
  ELECTION_CATEGORIES.STATE,
  ELECTION_CATEGORIES.COUNTY,
  ELECTION_CATEGORIES.CITY,
  ELECTION_CATEGORIES.ISD,
  ELECTION_CATEGORIES.MUD
];

// ============================================================================
// CATEGORIZATION FUNCTIONS
// ============================================================================

/**
 * Determines the category of an election based on its filename
 * @param {string} filename - The election CSV filename
 * @returns {string} The category (Federal, State, County, City, ISD, MUD)
 */
export function categorizeElection(filename) {
  if (!filename || typeof filename !== 'string') {
    return ELECTION_CATEGORIES.COUNTY; // Default fallback
  }

  const normalized = filename.toLowerCase();

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

  return elections.filter(entry => {
    const filename = typeof entry === 'string' ? entry : entry.filename;
    const entryCategory = typeof entry === 'object' && entry.category 
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

  if (year === null || year === undefined) {
    return elections;
  }

  return elections.filter(entry => {
    // Handle both object format and legacy string format
    if (typeof entry === 'string') {
      // Try to extract year from filename
      const yearMatch = entry.match(/_(\d{4})\.csv$/);
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

  const normalizedQuery = query.toLowerCase().trim();
  const queryWords = normalizedQuery.split(/\s+/);

  return elections.filter(entry => {
    // Extract filename from entry (string or object)
    const filename = typeof entry === 'string' ? entry : entry.filename;
    
    // Replace underscores with spaces for better matching
    const normalizedFilename = filename
      .toLowerCase()
      .replace(/\.csv$/, '')
      .replace(/_/g, ' ');
    
    // All query words must be found in the filename (AND logic)
    return queryWords.every(word => normalizedFilename.includes(word));
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

  const counts = {
    [ELECTION_CATEGORIES.ALL]: elections.length,
    [ELECTION_CATEGORIES.FEDERAL]: 0,
    [ELECTION_CATEGORIES.STATE]: 0,
    [ELECTION_CATEGORIES.COUNTY]: 0,
    [ELECTION_CATEGORIES.CITY]: 0,
    [ELECTION_CATEGORIES.ISD]: 0,
    [ELECTION_CATEGORIES.MUD]: 0
  };

  elections.forEach(entry => {
    const filename = typeof entry === 'string' ? entry : entry.filename;
    const category = (typeof entry === 'object' && entry.category) 
      ? entry.category 
      : categorizeElection(filename);
    if (counts.hasOwnProperty(category)) {
      counts[category]++;
    }
  });

  return counts;
}

/**
 * Gets list of available years from election manifest
 * @param {Array<Object>} elections - Array of election objects with { filename, year, ... }
 * @returns {Array<number>} Sorted array of unique years (descending)
 */
export function getAvailableYears(elections) {
  if (!elections || !Array.isArray(elections)) {
    return [];
  }

  const years = new Set();
  elections.forEach(entry => {
    if (typeof entry === 'object' && entry.year !== null && entry.year !== undefined) {
      years.add(entry.year);
    } else if (typeof entry === 'string') {
      // Try to extract year from filename
      const yearMatch = entry.match(/_(\d{4})\.csv$/);
      if (yearMatch) {
        years.add(parseInt(yearMatch[1], 10));
      }
    }
  });

  return Array.from(years).sort((a, b) => b - a); // Descending order
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
 * Highlights search matches in text
 * @param {string} text - Text to highlight
 * @param {string} query - Search query
 * @returns {string} HTML with highlighted matches
 */
export function highlightMatches(text, query) {
  if (!text || !query || typeof text !== 'string' || typeof query !== 'string') {
    return text || '';
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery === '') {
    return text;
  }

  const words = trimmedQuery.split(/\s+/);
  let result = text;

  words.forEach(word => {
    if (word) {
      // Escape special regex characters for safe matching
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedWord})`, 'gi');
      result = result.replace(regex, '<mark>$1</mark>');
    }
  });

  return result;
}

// ============================================================================
// UI COMPONENT FUNCTIONS
// ============================================================================

/**
 * Creates the filter UI HTML (tabs + search box)
 * @param {Object} counts - Category counts from getCategoryCounts
 * @param {string} activeCategory - Currently active category
 * @param {string} searchQuery - Current search query
 * @returns {string} HTML string for filter UI
 */
export function createFilterUI(counts, activeCategory = ELECTION_CATEGORIES.ALL, searchQuery = '') {
  const tabsHTML = CATEGORY_ORDER.map(category => {
    const isActive = category === activeCategory;
    const count = counts[category] || 0;
    return `
      <button 
        class="category-tab ${isActive ? 'active' : ''}" 
        data-category="${category}"
        aria-pressed="${isActive}"
        aria-label="${category} elections: ${count} races"
      >
        ${category}
        <span class="tab-count">${count}</span>
      </button>
    `;
  }).join('');

  return `
    <div class="election-filters" role="search" aria-label="Filter elections">
      <div class="search-container">
        <input 
          type="text" 
          id="election-search" 
          class="election-search-input"
          placeholder="Search elections..." 
          value="${escapeHTML(searchQuery)}"
          aria-label="Search elections"
          autocomplete="off"
        >
        <button 
          id="clear-search" 
          class="clear-search-btn ${searchQuery ? '' : 'hidden'}"
          aria-label="Clear search"
        >×</button>
      </div>
      <div class="category-tabs" role="tablist" aria-label="Election categories">
        ${tabsHTML}
      </div>
    </div>
  `;
}

/**
 * Escapes HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHTML(text) {
  if (!text || typeof text !== 'string') return '';
  const div = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (div) {
    div.textContent = text;
    return div.innerHTML;
  }
  // Fallback for Node.js environment
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// FILTER STATE MANAGER CLASS
// ============================================================================

/**
 * Manages filter state and provides reactive updates
 */
export class ElectionFilterManager {
  constructor(elections = []) {
    this.allElections = elections;
    this.activeCategory = ELECTION_CATEGORIES.ALL;
    this.searchQuery = '';
    this.selectedYear = null; // null = "All years"
    this.onChangeCallbacks = [];
  }

  /**
   * Sets the full election list
   * @param {string[]} elections - Array of election filenames
   */
  setElections(elections) {
    this.allElections = elections || [];
    this._notifyChange();
  }

  /**
   * Sets the active category
   * @param {string} category - Category to filter by
   */
  setCategory(category) {
    if (this.activeCategory !== category) {
      this.activeCategory = category;
      this._notifyChange();
    }
  }

  /**
   * Sets the search query
   * @param {string} query - Search query
   */
  setSearchQuery(query) {
    if (this.searchQuery !== query) {
      this.searchQuery = query;
      this._notifyChange();
    }
  }

  /**
   * Sets the selected year
   * @param {number|null} year - Year to filter by (null = "All years")
   */
  setYear(year) {
    if (this.selectedYear !== year) {
      this.selectedYear = year;
      this._notifyChange();
    }
  }

  /**
   * Gets the selected year
   * @returns {number|null} Selected year or null for "All years"
   */
  getYear() {
    return this.selectedYear;
  }

  /**
   * Clears all filters
   */
  clearFilters() {
    this.activeCategory = ELECTION_CATEGORIES.ALL;
    this.searchQuery = '';
    this.selectedYear = null;
    this._notifyChange();
  }

  /**
   * Gets the filtered elections based on current state
   * @returns {Array<Object>} Filtered election entries (objects with filename, year, category, etc.)
   */
  getFilteredElections() {
    let filtered = this.allElections;
    
    // Apply year filter first
    filtered = filterByYear(filtered, this.selectedYear);
    
    // Apply category filter
    filtered = filterByCategory(filtered, this.activeCategory);
    
    // Apply search filter
    filtered = searchElections(filtered, this.searchQuery);
    
    return filtered;
  }

  /**
   * Gets category counts for the full election list
   * @returns {Object} Category counts
   */
  getCategoryCounts() {
    return getCategoryCounts(this.allElections);
  }

  /**
   * Gets category counts for currently filtered elections (after search)
   * @returns {Object} Category counts for search results
   */
  getFilteredCategoryCounts() {
    const searchFiltered = searchElections(this.allElections, this.searchQuery);
    return getCategoryCounts(searchFiltered);
  }

  /**
   * Registers a callback for filter changes
   * @param {Function} callback - Function to call when filters change
   */
  onChange(callback) {
    if (typeof callback === 'function') {
      this.onChangeCallbacks.push(callback);
    }
  }

  /**
   * Removes a change callback
   * @param {Function} callback - Function to remove
   */
  offChange(callback) {
    this.onChangeCallbacks = this.onChangeCallbacks.filter(cb => cb !== callback);
  }

  /**
   * Gets available years from the election list
   * @returns {Array<number>} Sorted array of unique years (descending)
   */
  getAvailableYears() {
    return getAvailableYears(this.allElections);
  }

  /**
   * Gets grouped and filtered elections (Workstream C)
   * Applies filters, then groups by race family
   * @param {string} sortBy - Sort option: 'alphabetical', 'category', 'latestYear'
   * @returns {Object} Grouped elections object
   */
  getGroupedFilteredElections(sortBy = 'alphabetical') {
    const filtered = this.getFilteredElections();
    const grouped = groupElectionsByFamily(filtered);
    return sortFamilies(grouped, sortBy);
  }

  /**
   * Gets filter counts for chips (Workstream C)
   * @returns {Object} Counts object with years, categories, and total
   */
  getFilterCounts() {
    const years = this.getAvailableYears();
    const yearCounts = {};
    
    // Count elections by year
    years.forEach(year => {
      const filtered = filterByYear(this.allElections, year);
      yearCounts[year] = filtered.length;
    });
    
    // Add "All" count
    yearCounts[null] = this.allElections.length;
    
    // Category counts
    const categoryCounts = this.getCategoryCounts();
    
    return {
      years: yearCounts,
      categories: categoryCounts,
      total: this.allElections.length
    };
  }

  /**
   * Gets search highlight positions for text matching (Workstream C)
   * @param {string} query - Search query
   * @param {string} text - Text to search in
   * @returns {Array<{start: number, end: number}>} Array of match positions
   */
  getSearchHighlights(query, text) {
    if (!query || !text || typeof query !== 'string' || typeof text !== 'string') {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();
    if (normalizedQuery === '') {
      return [];
    }

    const normalizedText = text.toLowerCase();
    const matches = [];
    const words = normalizedQuery.split(/\s+/);

    words.forEach(word => {
      if (!word) return;
      
      let startIndex = 0;
      while (true) {
        const index = normalizedText.indexOf(word, startIndex);
        if (index === -1) break;
        
        matches.push({
          start: index,
          end: index + word.length
        });
        
        startIndex = index + 1;
      }
    });

    // Merge overlapping matches
    return mergeOverlappingMatches(matches);
  }

  /**
   * Notifies all registered callbacks of a change
   * @private
   */
  _notifyChange() {
    const state = {
      category: this.activeCategory,
      searchQuery: this.searchQuery,
      selectedYear: this.selectedYear,
      filteredElections: this.getFilteredElections(),
      counts: this.getCategoryCounts(),
      filteredCounts: this.getFilteredCategoryCounts(),
      availableYears: this.getAvailableYears(),
      groupedFiltered: this.getGroupedFilteredElections(),
      filterCounts: this.getFilterCounts()
    };

    this.onChangeCallbacks.forEach(cb => {
      try {
        cb(state);
      } catch (e) {
        console.error('Error in filter change callback:', e);
      }
    });
  }
}

/**
 * Merges overlapping match positions
 * @param {Array<{start: number, end: number}>} matches - Array of match positions
 * @returns {Array<{start: number, end: number}>} Merged matches
 */
function mergeOverlappingMatches(matches) {
  if (matches.length === 0) return [];
  
  // Sort by start position
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    
    if (current.start <= last.end) {
      // Overlapping or adjacent - merge
      last.end = Math.max(last.end, current.end);
    } else {
      // Non-overlapping - add new match
      merged.push(current);
    }
  }
  
  return merged;
}

// ============================================================================
// KEYBOARD NAVIGATION HELPERS
// ============================================================================

/**
 * Handles keyboard navigation in the dropdown
 * @param {KeyboardEvent} event - The keyboard event
 * @param {HTMLSelectElement} selectEl - The select element
 * @param {Function} onSelect - Callback when selection changes
 */
export function handleDropdownKeyboard(event, selectEl, onSelect) {
  if (!selectEl) return;

  const options = Array.from(selectEl.options);
  const currentIndex = selectEl.selectedIndex;

  switch (event.key) {
    case 'ArrowDown':
    case 'j': // vim-style navigation
      event.preventDefault();
      if (currentIndex < options.length - 1) {
        selectEl.selectedIndex = currentIndex + 1;
        if (onSelect) onSelect(selectEl.value);
      }
      break;

    case 'ArrowUp':
    case 'k': // vim-style navigation
      event.preventDefault();
      if (currentIndex > 0) {
        selectEl.selectedIndex = currentIndex - 1;
        if (onSelect) onSelect(selectEl.value);
      }
      break;

    case 'Home':
      event.preventDefault();
      selectEl.selectedIndex = 0;
      if (onSelect) onSelect(selectEl.value);
      break;

    case 'End':
      event.preventDefault();
      selectEl.selectedIndex = options.length - 1;
      if (onSelect) onSelect(selectEl.value);
      break;

    case 'Enter':
      event.preventDefault();
      if (onSelect) onSelect(selectEl.value);
      break;
  }
}
