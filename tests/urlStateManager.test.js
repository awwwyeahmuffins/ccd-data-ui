// urlStateManager.test.js
// Unit tests for URL state management (shareable links)
// Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ============================================================================
// MOCK IMPLEMENTATIONS FOR TESTING
// These mirror the actual implementations that will be in urlStateManager.js
// ============================================================================

const VIEWS = {
  DEMOGRAPHICS: 'demographics',
  ELECTION: 'election'
};

/**
 * Build URL hash string from state object
 * @param {Object} state - { view, race, precinct }
 * @returns {string} URL hash string (without the #)
 */
function buildURLHash(state) {
  const params = new URLSearchParams();
  
  if (state.view) {
    params.set('view', state.view);
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
function parseURLHash(hash) {
  const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!cleanHash) {
    return { view: VIEWS.DEMOGRAPHICS, race: null, precinct: null };
  }
  
  const params = new URLSearchParams(cleanHash);
  return {
    view: params.get('view') || VIEWS.DEMOGRAPHICS,
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
function generateShareableURL(baseUrl, state) {
  const hash = buildURLHash(state);
  return hash ? `${baseUrl}#${hash}` : baseUrl;
}

/**
 * Validate state object has valid values
 * @param {Object} state - { view, race, precinct }
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateState(state) {
  const errors = [];
  
  if (!state || typeof state !== 'object') {
    return { valid: false, errors: ['State must be an object'] };
  }
  
  // View validation
  const validViews = Object.values(VIEWS);
  if (state.view && !validViews.includes(state.view)) {
    errors.push(`Invalid view: ${state.view}. Must be one of: ${validViews.join(', ')}`);
  }
  
  // Race validation (if provided, should be a string)
  if (state.race !== null && state.race !== undefined && typeof state.race !== 'string') {
    errors.push('Race must be a string or null');
  }
  
  // Precinct validation (if provided, should be a string or number)
  if (state.precinct !== null && state.precinct !== undefined) {
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
function sanitizeState(state) {
  if (!state || typeof state !== 'object') {
    return { view: VIEWS.DEMOGRAPHICS, race: null, precinct: null };
  }
  
  const sanitized = {
    view: VIEWS.DEMOGRAPHICS,
    race: null,
    precinct: null
  };
  
  // Sanitize view
  const validViews = Object.values(VIEWS);
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
  if (state.precinct !== null && state.precinct !== undefined) {
    sanitized.precinct = String(state.precinct)
      .replace(/[^a-zA-Z0-9-_]/g, '') // Allow alphanumeric, dash, underscore
      .substring(0, 50);
  }
  
  return sanitized;
}

// ============================================================================
// TESTS FOR buildURLHash
// ============================================================================

describe('buildURLHash', () => {
  it('should build hash with view only', () => {
    const state = { view: 'demographics' };
    const result = buildURLHash(state);
    expect(result).toBe('view=demographics');
  });

  it('should build hash with view and race', () => {
    const state = { view: 'election', race: 'President_Vice_President.csv' };
    const result = buildURLHash(state);
    expect(result).toBe('view=election&race=President_Vice_President.csv');
  });

  it('should build hash with all fields', () => {
    const state = { view: 'election', race: 'Governor.csv', precinct: '123' };
    const result = buildURLHash(state);
    expect(result).toBe('view=election&race=Governor.csv&precinct=123');
  });

  it('should skip null values', () => {
    const state = { view: 'demographics', race: null, precinct: null };
    const result = buildURLHash(state);
    expect(result).toBe('view=demographics');
  });

  it('should skip undefined values', () => {
    const state = { view: 'election', race: undefined };
    const result = buildURLHash(state);
    expect(result).toBe('view=election');
  });

  it('should handle empty state object', () => {
    const state = {};
    const result = buildURLHash(state);
    expect(result).toBe('');
  });

  it('should URL-encode special characters in race name', () => {
    const state = { view: 'election', race: 'U._S._Representative,_District_32.csv' };
    const result = buildURLHash(state);
    expect(result).toContain('race=');
    // URLSearchParams encodes commas and other special chars
    expect(decodeURIComponent(result)).toContain('U._S._Representative,_District_32.csv');
  });
});

// ============================================================================
// TESTS FOR parseURLHash
// ============================================================================

describe('parseURLHash', () => {
  it('should parse hash with view only', () => {
    const result = parseURLHash('view=demographics');
    expect(result).toEqual({
      view: 'demographics',
      race: null,
      precinct: null
    });
  });

  it('should parse hash with all fields', () => {
    const result = parseURLHash('view=election&race=Governor.csv&precinct=456');
    expect(result).toEqual({
      view: 'election',
      race: 'Governor.csv',
      precinct: '456'
    });
  });

  it('should handle hash with leading #', () => {
    const result = parseURLHash('#view=election&race=Sheriff.csv');
    expect(result).toEqual({
      view: 'election',
      race: 'Sheriff.csv',
      precinct: null
    });
  });

  it('should return defaults for empty hash', () => {
    const result = parseURLHash('');
    expect(result).toEqual({
      view: 'demographics',
      race: null,
      precinct: null
    });
  });

  it('should return defaults for hash with only #', () => {
    const result = parseURLHash('#');
    expect(result).toEqual({
      view: 'demographics',
      race: null,
      precinct: null
    });
  });

  it('should decode URL-encoded characters', () => {
    const result = parseURLHash('view=election&race=U._S._Representative%2C_District_32.csv');
    expect(result.race).toBe('U._S._Representative,_District_32.csv');
  });

  it('should handle missing view parameter (default to demographics)', () => {
    const result = parseURLHash('race=Governor.csv&precinct=100');
    expect(result.view).toBe('demographics');
    expect(result.race).toBe('Governor.csv');
  });
});

// ============================================================================
// TESTS FOR generateShareableURL
// ============================================================================

describe('generateShareableURL', () => {
  const baseUrl = 'https://example.com/ccd-data-packet/';

  it('should generate full URL with hash', () => {
    const state = { view: 'election', race: 'Governor.csv', precinct: '42' };
    const result = generateShareableURL(baseUrl, state);
    expect(result).toBe('https://example.com/ccd-data-packet/#view=election&race=Governor.csv&precinct=42');
  });

  it('should return base URL when state is empty', () => {
    const state = {};
    const result = generateShareableURL(baseUrl, state);
    expect(result).toBe('https://example.com/ccd-data-packet/');
  });

  it('should handle demographics view without race', () => {
    const state = { view: 'demographics', precinct: '100' };
    const result = generateShareableURL(baseUrl, state);
    expect(result).toBe('https://example.com/ccd-data-packet/#view=demographics&precinct=100');
  });

  it('should handle base URL with trailing slash', () => {
    const state = { view: 'election' };
    const result = generateShareableURL('https://example.com/', state);
    expect(result).toBe('https://example.com/#view=election');
  });

  it('should handle base URL without trailing slash', () => {
    const state = { view: 'election' };
    const result = generateShareableURL('https://example.com', state);
    expect(result).toBe('https://example.com#view=election');
  });
});

// ============================================================================
// TESTS FOR validateState
// ============================================================================

describe('validateState', () => {
  it('should validate correct state with all fields', () => {
    const state = { view: 'election', race: 'Governor.csv', precinct: '123' };
    const result = validateState(state);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should validate correct state with demographics view', () => {
    const state = { view: 'demographics' };
    const result = validateState(state);
    expect(result.valid).toBe(true);
  });

  it('should reject invalid view', () => {
    const state = { view: 'invalid_view' };
    const result = validateState(state);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid view');
  });

  it('should reject null state', () => {
    const result = validateState(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('State must be an object');
  });

  it('should reject non-object state', () => {
    const result = validateState('string');
    expect(result.valid).toBe(false);
  });

  it('should accept numeric precinct', () => {
    const state = { view: 'election', precinct: 123 };
    const result = validateState(state);
    expect(result.valid).toBe(true);
  });

  it('should reject non-string race', () => {
    const state = { view: 'election', race: 123 };
    const result = validateState(state);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Race must be a string');
  });

  it('should accept null race', () => {
    const state = { view: 'election', race: null };
    const result = validateState(state);
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// TESTS FOR sanitizeState
// ============================================================================

describe('sanitizeState', () => {
  it('should return sanitized state for valid input', () => {
    const state = { view: 'election', race: 'Governor.csv', precinct: '123' };
    const result = sanitizeState(state);
    expect(result).toEqual({
      view: 'election',
      race: 'Governor.csv',
      precinct: '123'
    });
  });

  it('should default to demographics for invalid view', () => {
    const state = { view: 'malicious_view', race: 'Governor.csv' };
    const result = sanitizeState(state);
    expect(result.view).toBe('demographics');
  });

  it('should strip HTML tags from race', () => {
    const state = { view: 'election', race: '<script>alert("xss")</script>Governor.csv' };
    const result = sanitizeState(state);
    expect(result.race).toBe('alert("xss")Governor.csv');
    expect(result.race).not.toContain('<script>');
  });

  it('should limit race length', () => {
    const longRace = 'a'.repeat(300);
    const state = { view: 'election', race: longRace };
    const result = sanitizeState(state);
    expect(result.race.length).toBe(200);
  });

  it('should sanitize precinct to alphanumeric', () => {
    const state = { view: 'election', precinct: '123<script>attack</script>' };
    const result = sanitizeState(state);
    expect(result.precinct).toBe('123scriptattackscript');
    expect(result.precinct).not.toContain('<');
  });

  it('should convert numeric precinct to string', () => {
    const state = { view: 'election', precinct: 456 };
    const result = sanitizeState(state);
    expect(result.precinct).toBe('456');
  });

  it('should return defaults for null state', () => {
    const result = sanitizeState(null);
    expect(result).toEqual({
      view: 'demographics',
      race: null,
      precinct: null
    });
  });

  it('should return defaults for undefined state', () => {
    const result = sanitizeState(undefined);
    expect(result).toEqual({
      view: 'demographics',
      race: null,
      precinct: null
    });
  });

  it('should allow hyphens and underscores in precinct', () => {
    const state = { view: 'election', precinct: 'A-123_B' };
    const result = sanitizeState(state);
    expect(result.precinct).toBe('A-123_B');
  });
});

// ============================================================================
// TESTS FOR round-trip encoding/decoding
// ============================================================================

describe('round-trip encoding', () => {
  it('should preserve state through build/parse cycle', () => {
    const originalState = { view: 'election', race: 'Governor.csv', precinct: '789' };
    const hash = buildURLHash(originalState);
    const parsedState = parseURLHash(hash);
    expect(parsedState).toEqual(originalState);
  });

  it('should handle complex race names with special characters', () => {
    const originalState = { 
      view: 'election', 
      race: 'U._S._Representative,_District_32.csv', 
      precinct: '42' 
    };
    const hash = buildURLHash(originalState);
    const parsedState = parseURLHash(hash);
    expect(parsedState.race).toBe(originalState.race);
  });

  it('should handle race names with unicode characters', () => {
    const originalState = { 
      view: 'election', 
      race: 'Mayor_–_At_Large_–_City_of_Princeton.csv', 
      precinct: null 
    };
    const hash = buildURLHash(originalState);
    const parsedState = parseURLHash(hash);
    expect(parsedState.race).toBe(originalState.race);
  });
});
