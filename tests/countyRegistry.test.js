// countyRegistry.test.js
// Integrity checks for the Collin-focused county registry (data/tx/counties.json):
// Collin County plus the cross-county districts that include it. Every entry is
// "live" and must point at real data on disk.

import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';

const counties = JSON.parse(readFileSync('data/tx/counties.json', 'utf-8'));
const districts = JSON.parse(readFileSync('data/tx/districts.json', 'utf-8'));

describe('county registry (Collin-focused)', () => {
  it('is Collin County only', () => {
    expect(counties).toHaveLength(1);
    expect(counties[0].slug).toBe('collin');
    expect(counties[0].fips).toBe('48085');
    expect(counties[0].status).toBe('live');
  });

  it('keeps only the Collin-touching districts, all live', () => {
    const slugs = districts.map(d => d.slug).sort();
    expect(slugs).toEqual(
      ['cd-3', 'cd-32', 'cd-4', 'hd-33', 'hd-61', 'hd-66', 'hd-67', 'hd-70', 'hd-89', 'sd-2', 'sd-30', 'sd-8'].sort()
    );
    for (const d of districts) {
      expect(d.status).toBe('live');
      expect(d.kind).toBe('district');
    }
  });

  it('has unique slugs across counties + districts', () => {
    const all = [...counties, ...districts].map(c => c.slug);
    expect(new Set(all).size).toBe(all.length);
  });

  it('every entry has its boundary + manifest files on disk', () => {
    for (const c of [...counties, ...districts]) {
      for (const set of Object.values(c.boundarySets)) {
        expect(existsSync(`${c.dataRoot}/${set.geojson}`)).toBe(true);
        expect(existsSync(`${c.dataRoot}/${set.dataDir}/elections.json`)).toBe(true);
      }
    }
  });

  it('gives every entry a dataRoot + valid boundarySets', () => {
    for (const c of [...counties, ...districts]) {
      expect(typeof c.dataRoot).toBe('string');
      expect(typeof c.defaultBoundarySet).toBe('string');
      expect(c.boundarySets[c.defaultBoundarySet]).toBeDefined();
      for (const set of Object.values(c.boundarySets)) {
        expect(typeof set.label).toBe('string');
        expect(set.geojson).toMatch(/\.geojson$/);
        expect(typeof set.dataDir).toBe('string');
      }
    }
  });
});
