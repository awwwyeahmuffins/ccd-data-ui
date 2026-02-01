// js/recentlyViewed.js
// =====================
// Recently Viewed Manager - Workstream B
// Manages recently viewed races with localStorage persistence

const STORAGE_KEY = 'ccd_recently_viewed';
const MAX_ITEMS = 5;
const EXPIRATION_DAYS = 30; // Entries expire after 30 days

/**
 * Adds an election entry to recently viewed list
 * @param {Object} entry - Election entry with { filename, year, category, displayName }
 */
export function addRecentlyViewed(entry) {
  if (!entry || !entry.filename) {
    return;
  }

  try {
    const list = getRecentlyViewedRaw();
    
    // Remove existing entry with same filename (dedupe)
    const filtered = list.filter(item => item.filename !== entry.filename);
    
    // Add new entry at the beginning with timestamp
    const newEntry = {
      filename: entry.filename,
      year: entry.year || null,
      category: entry.category || null,
      displayName: entry.displayName || entry.filename.replace(/\.csv$/, '').replace(/_/g, ' '),
      timestamp: Date.now(),
      ...entry // Preserve any additional properties
    };
    
    filtered.unshift(newEntry);
    
    // Keep only MAX_ITEMS
    const trimmed = filtered.slice(0, MAX_ITEMS);
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error('Error saving recently viewed:', error);
    // Fail silently - localStorage might be disabled
  }
}

/**
 * Gets raw recently viewed list from localStorage (may include stale entries)
 * @returns {Array<Object>} Array of recently viewed entries
 */
function getRecentlyViewedRaw() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }
    return JSON.parse(stored);
  } catch (error) {
    console.error('Error reading recently viewed:', error);
    return [];
  }
}

/**
 * Gets validated recently viewed list (filtered against manifest)
 * @param {Array<Object>} manifest - Current election manifest for validation
 * @returns {Array<Object>} Validated array of manifest entries
 */
export function getRecentlyViewed(manifest = []) {
  try {
    const raw = getRecentlyViewedRaw();
    const now = Date.now();
    const expirationMs = EXPIRATION_DAYS * 24 * 60 * 60 * 1000;
    
    // Filter out expired entries
    const valid = raw.filter(item => {
      const age = now - (item.timestamp || 0);
      return age < expirationMs;
    });
    
    // If manifest provided, validate entries exist in manifest
    if (manifest && manifest.length > 0) {
      const manifestFilenames = new Set(manifest.map(e => e.filename));
      return valid
        .filter(item => manifestFilenames.has(item.filename))
        .map(item => {
          // Merge manifest entry with localStorage entry (preserving timestamp)
          const manifestEntry = manifest.find(e => e.filename === item.filename);
          return {
            ...manifestEntry,
            timestamp: item.timestamp // Preserve the original timestamp
          };
        });
    }
    
    return valid;
  } catch (error) {
    console.error('Error getting recently viewed:', error);
    return [];
  }
}

/**
 * Clears the recently viewed list
 */
export function clearRecentlyViewed() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing recently viewed:', error);
  }
}

/**
 * Gets the count of recently viewed items
 * @param {Array<Object>} manifest - Optional manifest for validation
 * @returns {number} Count of recently viewed items
 */
export function getRecentlyViewedCount(manifest = []) {
  return getRecentlyViewed(manifest).length;
}

/**
 * Validates and cleans up recently viewed entries against manifest
 * Removes entries that no longer exist in manifest
 * @param {Array<Object>} manifest - Current election manifest
 */
export function validateRecentlyViewed(manifest) {
  if (!manifest || !Array.isArray(manifest)) {
    return;
  }

  try {
    const valid = getRecentlyViewed(manifest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
  } catch (error) {
    console.error('Error validating recently viewed:', error);
  }
}
