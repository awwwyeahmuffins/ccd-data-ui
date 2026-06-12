// countyRegistry.test.js
// Integrity checks for the statewide county registry (data/tx/counties.json)
// and its boundary file. These guard the placeholder contract: every county
// is selectable, but only "live" counties may point at real data.

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';

const registry = JSON.parse(readFileSync('data/tx/counties.json', 'utf-8'));
const boundaries = JSON.parse(readFileSync('data/tx/county-boundaries.geojson', 'utf-8'));

describe('Texas county registry', () => {
  it('has all 254 Texas counties', () => {
    expect(registry).toHaveLength(254);
  });

  it('has unique FIPS codes and slugs', () => {
    expect(new Set(registry.map(c => c.fips)).size).toBe(254);
    expect(new Set(registry.map(c => c.slug)).size).toBe(254);
  });

  it('uses valid Texas FIPS codes (48xxx)', () => {
    for (const c of registry) {
      expect(c.fips).toMatch(/^48\d{3}$/);
    }
  });

  it('only allows known statuses', () => {
    for (const c of registry) {
      expect(['live', 'placeholder']).toContain(c.status);
    }
  });

  it('marks exactly the expected counties as live (update as counties go live)', () => {
    const live = registry.filter(c => c.status === 'live').map(c => c.name);
    expect(live).toEqual(['Bastrop', 'Collin']);
  });

  it('gives every live county a dataRoot + boundarySets and every placeholder none', () => {
    for (const c of registry) {
      if (c.status === 'live') {
        expect(typeof c.dataRoot).toBe('string');
        expect(typeof c.defaultBoundarySet).toBe('string');
        expect(c.boundarySets).toBeDefined();
        expect(c.boundarySets[c.defaultBoundarySet]).toBeDefined();
        for (const set of Object.values(c.boundarySets)) {
          expect(typeof set.label).toBe('string');
          expect(set.geojson).toMatch(/\.geojson$/);
          expect(typeof set.dataDir).toBe('string');
        }
      } else {
        expect(c.dataRoot).toBeNull();
      }
    }
  });

  it('has a boundary feature for every registry entry', () => {
    const slugs = new Set(boundaries.features.map(f => f.properties.SLUG));
    for (const c of registry) {
      expect(slugs.has(c.slug)).toBe(true);
    }
  });
});
