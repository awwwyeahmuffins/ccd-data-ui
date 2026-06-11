// urlStateManager.js
// URL state management for shareable links
// Handles building, parsing, and validating URL hash parameters

// View state constants (shared with app.js)
export let VIEWS = {
  DEMOGRAPHICS: 'demographics',
  ELECTION: 'election'
};

/**
 * Build URL hash string from state object
 * @param {Object} state - { view, race, precinct }
 * @returns {string} URL hash string (without the #)
 */
export function buildURLHash(state) {
  let params = new URLSearchParams();
  
  if (state.view) {
    params.set('view', state.view);
  }
  if (state.county) {
    params.set('county', state.county);
  }
  if (state.race) {
    params.set('race', state.race);
  }
  if (state.precinct) {
    params.set('precinct', state.precinct);
  }
  
  return params.toString();
}

/**
 * Parse URL hash string and return state object
 * @param {string} hash - URL hash string (with or without #)
 * @returns {Object} - { view, race, precinct }
 */
export function parseURLHash(hash) {
  const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!cleanHash) {
    return { view: VIEWS.DEMOGRAPHICS, county: null, race: null, precinct: null };
  }
  
  let params = new URLSearchParams(cleanHash);
  return {
    view: params.get('view') || VIEWS.DEMOGRAPHICS,
    county: params.get('county') || null,
    race: params.get('race') || null,
    precinct: params.get('precinct') || null
  };
}

/**
 * Generate a shareable URL from current state
 * @param {string} baseUrl - Base URL (e.g., window.location.origin + pathname)
 * @param {Object} state - { view, race, precinct }
 * @returns {string} Full shareable URL
 */
export function generateShareableURL(baseUrl, state) {
  const hash = buildURLHash(state);
  return hash ? `${baseUrl}#${hash}` : baseUrl;
}

/**
 * Validate state object has valid values
 * @param {Object} state - { view, race, precinct }
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
export function validateState(state) {
  let errors = [];
  
  if (!state || typeof state !== 'object') {
    return { valid: false, errors: ['State must be an object'] };
  }
  
  // View validation
  let validViews = Object.values(VIEWS);
  if (state.view && !validViews.includes(state.view)) {
    errors.push(`Invalid view: ${state.view}. Must be one of: ${validViews.join(', ')}`);
  }
  
  // Race validation (if provided, should be a string)
  if (state.race != null && typeof state.race !== 'string') {
    errors.push('Race must be a string or null');
  }

  // Precinct validation (if provided, should be a string or number)
  if (state.precinct != null) {
    const type = typeof state.precinct;
    if (type !== 'string' && type !== 'number') {
      errors.push('Precinct must be a string, number, or null');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Sanitize state values to prevent XSS and invalid data
 * @param {Object} state - { view, race, precinct }
 * @returns {Object} Sanitized state
 */
export function sanitizeState(state) {
  if (!state || typeof state !== 'object') {
    return { view: VIEWS.DEMOGRAPHICS, race: null, precinct: null };
  }
  
  let sanitized = {
    view: VIEWS.DEMOGRAPHICS,
    race: null,
    precinct: null
  };
  
  // Sanitize view
  let validViews = Object.values(VIEWS);
  if (state.view && validViews.includes(state.view)) {
    sanitized.view = state.view;
  }
  
  // Sanitize race (remove any HTML/script tags, limit length)
  if (state.race && typeof state.race === 'string') {
    sanitized.race = state.race
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .substring(0, 200); // Limit length
  }
  
  // Sanitize precinct (convert to string, remove non-alphanumeric)
  if (state.precinct != null) {
    sanitized.precinct = String(state.precinct)
      .replace(/[^a-zA-Z0-9-_]/g, '') // Allow alphanumeric, dash, underscore
      .substring(0, 50);
  }
  
  return sanitized;
}

/**
 * Get current state from URL
 * @returns {Object} - { view, race, precinct }
 */
export function getCurrentURLState() {
  return parseURLHash(location.hash);
}

/**
 * Copy URL to clipboard
 * @param {string} url - URL to copy
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function copyToClipboard(url) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      return { success: true };
    } else {
      // Fallback for older browsers
      let textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const result = document.execCommand('copy');
      document.body.removeChild(textArea);
      return { success: result };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Generate shareable URL for current page state
 * @param {Object} state - { view, race, precinct }
 * @returns {string} Full shareable URL
 */
export function getShareableURL(state) {
  const baseUrl = window.location.origin + window.location.pathname;
  return generateShareableURL(baseUrl, state);
}

/**
 * Copy current state as shareable link to clipboard
 * @param {Object} state - { view, race, precinct }
 * @returns {Promise<{success: boolean, url: string, error?: string}>}
 */
export async function copyShareableLink(state) {
  const url = getShareableURL(state);
  let result = await copyToClipboard(url);
  return { ...result, url };
}
