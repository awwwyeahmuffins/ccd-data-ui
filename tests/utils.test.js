// utils.test.js
// Unit tests for the shared utility libraries in js/lib/ (REDESIGN.md Phase 1).
// These import the REAL modules — no inline copies — so regressions in the
// production code fail here.
// Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js tests/utils.test.js

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

import {
  safeNumber,
  formatNumber,
  formatNumberOrNA,
  formatPct,
  formatPctCompact,
  formatPctWhole,
  formatCurrency,
  populationOf,
  formatPrecinctLabel
} from '../js/lib/format.js';
import { escapeHtml, csvEscape, debounce } from '../js/lib/dom.js';
import { readParams, writeParams, onChange } from '../js/lib/urlState.js';
import {
  PARTY_COLORS,
  PARTY_STRENGTH_COLORS,
  MAP_CONFIG,
  LIGHT_TILE_URL
} from '../js/lib/constants.js';

// ============================================================================
// lib/format.js
// ============================================================================

describe('safeNumber', () => {
  it('should return the number for valid numeric input', () => {
    expect(safeNumber(42)).toBe(42);
    expect(safeNumber(3.14)).toBe(3.14);
    expect(safeNumber(-10)).toBe(-10);
  });

  it('should convert numeric strings', () => {
    expect(safeNumber("42")).toBe(42);
    expect(safeNumber("3.14")).toBe(3.14);
  });

  it('should return 0 for null', () => {
    expect(safeNumber(null)).toBe(0);
  });

  it('should return 0 for undefined', () => {
    expect(safeNumber(undefined)).toBe(0);
  });

  it('should return 0 for NaN', () => {
    expect(safeNumber(NaN)).toBe(0);
  });

  it('should return 0 for non-numeric strings', () => {
    expect(safeNumber("abc")).toBe(0);
  });

  it('should return custom default value when provided', () => {
    expect(safeNumber(NaN, -1)).toBe(-1);
    expect(safeNumber("abc", 100)).toBe(100);
    // Note: Number(null) returns 0, not NaN, so null uses 0 not default
    expect(safeNumber(null, 999)).toBe(0);
    // Only truly invalid values use the default
    expect(safeNumber(undefined, 999)).toBe(999);
  });

  it('should handle empty string', () => {
    expect(safeNumber("")).toBe(0);
  });
});

describe('formatNumber', () => {
  it('should format numbers with thousands separator', () => {
    // Note: toLocaleString() output depends on locale
    expect(formatNumber(1000)).toBe((1000).toLocaleString());
    expect(formatNumber(1000000)).toBe((1000000).toLocaleString());
  });

  it('should handle zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('should handle negative numbers', () => {
    expect(formatNumber(-1000)).toBe((-1000).toLocaleString());
  });

  it('should handle invalid input', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber("abc")).toBe('0');
  });

  it('should handle string numbers', () => {
    expect(formatNumber("1234")).toBe((1234).toLocaleString());
  });
});

describe('formatNumberOrNA', () => {
  it('should format valid numbers with en-US thousands separators', () => {
    expect(formatNumberOrNA(1234)).toBe('1,234');
    expect(formatNumberOrNA(1234567)).toBe('1,234,567');
    expect(formatNumberOrNA(0)).toBe('0');
  });

  it('should return N/A for null and undefined', () => {
    expect(formatNumberOrNA(null)).toBe('N/A');
    expect(formatNumberOrNA(undefined)).toBe('N/A');
  });

  it('should return N/A for NaN and non-numeric strings', () => {
    expect(formatNumberOrNA(NaN)).toBe('N/A');
    expect(formatNumberOrNA('abc')).toBe('N/A');
  });

  it('should coerce numeric strings', () => {
    expect(formatNumberOrNA('5678')).toBe('5,678');
  });
});

describe('formatPct', () => {
  it('should format 0.5 as 50.0%', () => {
    expect(formatPct(0.5)).toBe('50.0%');
  });

  it('should format 1 as 100.0%', () => {
    expect(formatPct(1)).toBe('100.0%');
  });

  it('should format 0 as 0.0%', () => {
    expect(formatPct(0)).toBe('0.0%');
  });

  it('should handle decimal precision', () => {
    expect(formatPct(0.333)).toBe('33.3%');
    expect(formatPct(0.3333)).toBe('33.3%');
    expect(formatPct(0.3335)).toBe('33.4%'); // rounds up
  });

  it('should handle values > 1 (over 100%)', () => {
    expect(formatPct(1.5)).toBe('150.0%');
  });

  it('should handle negative values', () => {
    expect(formatPct(-0.25)).toBe('-25.0%');
  });

  it('should return N/A for null', () => {
    expect(formatPct(null)).toBe('N/A');
  });

  it('should return N/A for undefined', () => {
    expect(formatPct(undefined)).toBe('N/A');
  });

  it('should handle numeric string input (coercion works)', () => {
    expect(formatPct("0.5")).toBe('50.0%');
  });

  it('should return N/A for non-numeric strings', () => {
    expect(formatPct("abc")).toBe('N/A');
  });

  it('should return N/A for NaN', () => {
    expect(formatPct(NaN)).toBe('N/A');
  });
});

describe('formatPctCompact', () => {
  it('should drop the trailing .0 on whole percentages', () => {
    expect(formatPctCompact(0.52)).toBe('52%');
    expect(formatPctCompact(1)).toBe('100%');
    expect(formatPctCompact(0)).toBe('0%');
  });

  it('should keep one decimal when non-zero', () => {
    expect(formatPctCompact(0.523)).toBe('52.3%');
    expect(formatPctCompact(0.333)).toBe('33.3%');
  });

  it('should return N/A for invalid input', () => {
    expect(formatPctCompact(null)).toBe('N/A');
    expect(formatPctCompact(undefined)).toBe('N/A');
    expect(formatPctCompact(NaN)).toBe('N/A');
  });
});

describe('formatPctWhole', () => {
  it('should round to the nearest whole percent', () => {
    expect(formatPctWhole(0.523)).toBe('52%');
    expect(formatPctWhole(0.525)).toBe('53%'); // Math.round on 52.5
    expect(formatPctWhole(0.5)).toBe('50%');
    expect(formatPctWhole(0)).toBe('0%');
  });

  it('should return N/A for invalid input', () => {
    expect(formatPctWhole(null)).toBe('N/A');
    expect(formatPctWhole(undefined)).toBe('N/A');
    expect(formatPctWhole(NaN)).toBe('N/A');
  });
});

describe('formatCurrency', () => {
  it('should format millions as $X.XM', () => {
    expect(formatCurrency(1200000)).toBe('$1.2M');
    expect(formatCurrency(1000000)).toBe('$1.0M');
  });

  it('should format >= $10K as $XK, dropping a trailing .0', () => {
    expect(formatCurrency(45000)).toBe('$45K');
    expect(formatCurrency(45300)).toBe('$45.3K');
    expect(formatCurrency(10000)).toBe('$10K');
  });

  it('should format small amounts with en-US separators', () => {
    expect(formatCurrency(1234)).toBe('$1,234');
    expect(formatCurrency(9999)).toBe('$9,999');
    expect(formatCurrency(0)).toBe('$0');
  });

  it('should return N/A for invalid input', () => {
    expect(formatCurrency(null)).toBe('N/A');
    expect(formatCurrency(undefined)).toBe('N/A');
    expect(formatCurrency(NaN)).toBe('N/A');
  });
});

describe('populationOf', () => {
  it('should prefer the racial-data total when positive', () => {
    expect(populationOf({ total: 4200 }, { population: 5000 })).toBe(4200);
  });

  it('should coerce string totals', () => {
    expect(populationOf({ total: '4200' }, { population: 5000 })).toBe(4200);
  });

  it('should fall back to census.population when the racial total is missing or zero', () => {
    expect(populationOf(null, { population: 5000 })).toBe(5000);
    expect(populationOf({ total: 0 }, { population: 5000 })).toBe(5000);
    expect(populationOf({}, { population: 5000 })).toBe(5000);
  });

  it('should return null when neither source is available', () => {
    expect(populationOf(null, null)).toBeNull();
    expect(populationOf({ total: 0 }, { population: 0 })).toBeNull();
    expect(populationOf(null, undefined)).toBeNull();
  });

  it('should allow omitting the census argument (the map path)', () => {
    expect(populationOf({ total: 4200 })).toBe(4200);
    expect(populationOf({ total: 0 })).toBeNull();
    expect(populationOf(null)).toBeNull();
  });
});

describe('formatPrecinctLabel', () => {
  it('should label plain-county precincts with the bare code', () => {
    expect(formatPrecinctLabel({ PRECINCT: '42' })).toBe('Precinct 42');
    expect(formatPrecinctLabel({ PRECINCT: 42 })).toBe('Precinct 42');
  });

  it('should prefix cross-county district codes with the county name', () => {
    expect(formatPrecinctLabel({ PRECINCT: 'collin:42', COUNTY: 'Collin' }))
      .toBe('Collin · Precinct 42');
  });

  it('should label county-level aggregate units as counties', () => {
    // PRECINCT = county slug (non-numeric), COUNTY = county name
    expect(formatPrecinctLabel({ PRECINCT: 'hunt', COUNTY: 'Hunt' }))
      .toBe('Hunt County');
  });

  it('should use the bare code when COUNTY is present but the code is numeric', () => {
    expect(formatPrecinctLabel({ PRECINCT: '42', COUNTY: 'Collin' }))
      .toBe('Precinct 42');
  });

  it('should tolerate missing props', () => {
    expect(formatPrecinctLabel(null)).toBe('Precinct ');
    expect(formatPrecinctLabel({})).toBe('Precinct ');
  });
});

// ============================================================================
// lib/dom.js
// ============================================================================

describe('escapeHtml', () => {
  it('should escape all five HTML special characters', () => {
    expect(escapeHtml('<script>alert("x&y\'s")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&amp;y&#39;s&quot;)&lt;/script&gt;');
  });

  it('should pass plain text through unchanged', () => {
    expect(escapeHtml('Precinct 42')).toBe('Precinct 42');
  });

  it('should stringify non-string input', () => {
    expect(escapeHtml(42)).toBe('42');
  });

  it('should render null and undefined as empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('should escape ampersands first (no double-escaping)', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('csvEscape', () => {
  it('should return simple values unchanged', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(42)).toBe('42');
  });

  it('should return empty string for null and undefined', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('should quote values containing commas', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  it('should quote and double embedded quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('should quote values containing newlines', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('should prefix formula-injection characters with an apostrophe', () => {
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvEscape('+1234')).toBe("'+1234");
    expect(csvEscape('-cmd')).toBe("'-cmd");
    expect(csvEscape('@import')).toBe("'@import");
    expect(csvEscape('\tx')).toBe("'\tx");
    expect(csvEscape('\rx')).toBe("'\rx");
  });

  it('should NOT prefix negative numbers (only strings get the guard)', () => {
    expect(csvEscape(-42)).toBe('-42');
  });

  it('should both prefix and quote a formula containing a comma', () => {
    expect(csvEscape('=SUM(A1,B1)')).toBe('"\'=SUM(A1,B1)"');
  });
});

describe('debounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should delay function execution', () => {
    const fn = jest.fn();
    const debouncedFn = debounce(fn, 100);

    debouncedFn();
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should only execute once for rapid calls', () => {
    const fn = jest.fn();
    const debouncedFn = debounce(fn, 100);

    debouncedFn();
    debouncedFn();
    debouncedFn();

    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should pass arguments to the debounced function', () => {
    const fn = jest.fn();
    const debouncedFn = debounce(fn, 100);

    debouncedFn('arg1', 'arg2');
    jest.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('should use default delay of 100ms', () => {
    const fn = jest.fn();
    const debouncedFn = debounce(fn);

    debouncedFn();
    jest.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should reset timer on subsequent calls', () => {
    const fn = jest.fn();
    const debouncedFn = debounce(fn, 100);

    debouncedFn();
    jest.advanceTimersByTime(50);
    debouncedFn();
    jest.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// lib/urlState.js
// ============================================================================

describe('urlState', () => {
  beforeEach(() => {
    // Reset to a clean URL with no hash before each test
    history.replaceState(null, '', window.location.pathname);
  });

  describe('readParams', () => {
    it('should parse hash params and decode values', () => {
      window.location.hash = '#a=1&b=two%20words';
      expect(readParams()).toEqual({ a: '1', b: 'two words' });
    });

    it('should return {} for an empty hash', () => {
      expect(readParams()).toEqual({});
    });

    it('should skip keys with empty values', () => {
      window.location.hash = '#a=1&b=';
      expect(readParams()).toEqual({ a: '1' });
    });
  });

  describe('writeParams', () => {
    it('should omit null and empty values (replace default)', () => {
      writeParams({ a: 1, b: null, c: '' });
      expect(window.location.hash).toBe('#a=1');
    });

    it('should write via replaceState by default (no history entry)', () => {
      const before = history.length;
      writeParams({ a: 1 });
      expect(window.location.hash).toBe('#a=1');
      expect(history.length).toBe(before);
    });

    it('should set location.hash (push semantics) with replace:false', () => {
      writeParams({ a: 'x' }, { replace: false });
      expect(window.location.hash).toBe('#a=x');
    });

    it('should round-trip values through readParams', () => {
      const input = { race: 'Governor 2026', precinct: '42', view: 'list' };
      writeParams(input);
      expect(readParams()).toEqual(input);
    });

    it('should clear the hash back to the pathname for {}', () => {
      writeParams({ a: 1 });
      expect(window.location.hash).toBe('#a=1');
      writeParams({});
      expect(window.location.hash).toBe('');
      expect(window.location.pathname).toBe('/');
    });

    it('should URL-encode values on write', () => {
      writeParams({ b: 'two words' });
      expect(window.location.hash).toBe('#b=two%20words');
    });
  });

  describe('onChange', () => {
    it('should invoke the handler with parsed params on hashchange and stop after unsubscribe', () => {
      const fn = jest.fn();
      const off = onChange(fn);

      window.location.hash = '#a=1';
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
      expect(fn).toHaveBeenCalledWith({ a: '1' });

      off();
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================================
// lib/constants.js
// ============================================================================

describe('constants', () => {
  it('should deep-freeze PARTY_COLORS', () => {
    expect(Object.isFrozen(PARTY_COLORS)).toBe(true);
    // ESM is strict mode, so assignment to a frozen object throws
    expect(() => { PARTY_COLORS.Rep = '#000000'; }).toThrow(TypeError);
    expect(PARTY_COLORS.Rep).toBe('#E81B23');
  });

  it('should deep-freeze nested strength-color objects', () => {
    expect(Object.isFrozen(PARTY_STRENGTH_COLORS)).toBe(true);
    expect(Object.isFrozen(PARTY_STRENGTH_COLORS.Rep)).toBe(true);
    expect(Object.isFrozen(PARTY_STRENGTH_COLORS.Dem)).toBe(true);
    expect(() => { PARTY_STRENGTH_COLORS.Rep[1] = '#000000'; }).toThrow(TypeError);
  });

  it('should freeze MAP_CONFIG and export the light tile URL', () => {
    expect(Object.isFrozen(MAP_CONFIG)).toBe(true);
    expect(MAP_CONFIG.center).toEqual([33.1, -96.6]);
    expect(typeof LIGHT_TILE_URL).toBe('string');
    expect(LIGHT_TILE_URL).toContain('{z}/{x}/{y}');
  });
});
