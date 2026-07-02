// dataLoader.test.js
// The LEGACY SHIM contract (Phase 3): dataLoader.js delegates every data call
// to js/data/dataService.js's per-boundary handles and keeps the old stateful
// API alive for the remaining library-module importers. The real data-layer
// coverage lives in tests/dataService.test.js — this suite only pins the
// shim's own behavior (delegation targets, boundary pointer, Collin-only).

import { describe, it, expect } from '@jest/globals';
import {
  getActiveCounty,
  loadCountyRegistry,
  setActiveCounty,
  getBoundaryConfigs,
  getActiveBoundary,
  setActiveBoundary,
  clearDataCache,
  safePrecinctName,
} from '../js/dataLoader.js';
import { BOUNDARY_SETS, DEFAULT_BOUNDARY, COUNTY } from '../js/data/catalog.js';

describe('Collin-only county surface', () => {
  it('the active county is always collin', () => {
    expect(getActiveCounty()).toBe('collin');
  });

  it('the registry is the one synthesized Collin entry (no fetch)', async () => {
    const registry = await loadCountyRegistry();
    expect(registry).toHaveLength(1);
    expect(registry[0]).toMatchObject({ slug: 'collin', name: COUNTY.name, status: 'live' });
  });

  it('setActiveCounty accepts only collin and throws otherwise', async () => {
    await expect(setActiveCounty('collin')).resolves.toMatchObject({ slug: 'collin' });
    // Districts are a scope now, not a county — legacy deep-link paths rely
    // on this rejection to fall back to defaults.
    await expect(setActiveCounty('cd-3')).rejects.toThrow('Unknown county: cd-3');
    await expect(setActiveCounty('dallas')).rejects.toThrow('Unknown county: dallas');
  });
});

describe('boundary pointer', () => {
  it('defaults to the catalog default (2026) and reflects the catalog config', () => {
    expect(getActiveBoundary()).toBe(DEFAULT_BOUNDARY);
    const configs = getBoundaryConfigs();
    expect(Object.keys(configs).sort()).toEqual(Object.keys(BOUNDARY_SETS).sort());
    expect(configs['2026'].profileDir).toBe(BOUNDARY_SETS['2026'].profileDir);
    expect(configs.original.label).toBe(BOUNDARY_SETS.original.label);
  });

  it('setActiveBoundary repoints without wiping anything, and validates ids', () => {
    setActiveBoundary('original');
    expect(getActiveBoundary()).toBe('original');
    setActiveBoundary('2026');
    expect(getActiveBoundary()).toBe('2026');
    expect(() => setActiveBoundary('1999')).toThrow('Unknown boundary set: 1999');
  });

  it('setActiveCounty resets the boundary pointer to the default', async () => {
    setActiveBoundary('original');
    await setActiveCounty('collin');
    expect(getActiveBoundary()).toBe(DEFAULT_BOUNDARY);
  });
});

describe('inert legacy helpers', () => {
  it('clearDataCache is a harmless no-op (no global cache exists)', () => {
    expect(() => clearDataCache()).not.toThrow();
  });

  it('safePrecinctName re-exports the service implementation', () => {
    expect(safePrecinctName('collin:1')).toBe('collin_1');
    expect(safePrecinctName('42')).toBe('42');
  });
});
