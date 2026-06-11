// geoLookup.test.js
// Unit tests for address → precinct helpers (imports the real module).

import { describe, it, expect, jest } from '@jest/globals';
import {
  geocodeAddress,
  pointInGeometry,
  findPrecinctForPoint,
  findPrecinctForAddress,
} from '../js/geoLookup.js';

// Simple 1×1 degree square around origin, GeoJSON [lng, lat]
const SQUARE = {
  type: 'Polygon',
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
};

const SQUARE_WITH_HOLE = {
  type: 'Polygon',
  coordinates: [
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
    [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]], // hole
  ],
};

const MULTI = {
  type: 'MultiPolygon',
  coordinates: [
    [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
  ],
};

describe('pointInGeometry', () => {
  it('detects points inside and outside a polygon', () => {
    expect(pointInGeometry(0.5, 0.5, SQUARE)).toBe(true);
    expect(pointInGeometry(1.5, 0.5, SQUARE)).toBe(false);
    expect(pointInGeometry(0.5, -0.1, SQUARE)).toBe(false);
  });

  it('respects holes', () => {
    expect(pointInGeometry(2, 2, SQUARE_WITH_HOLE)).toBe(false); // in the hole
    expect(pointInGeometry(0.5, 0.5, SQUARE_WITH_HOLE)).toBe(true); // in the rim
  });

  it('handles MultiPolygon', () => {
    expect(pointInGeometry(10.5, 10.5, MULTI)).toBe(true);
    expect(pointInGeometry(5, 5, MULTI)).toBe(false);
  });

  it('returns false for missing/unsupported geometry', () => {
    expect(pointInGeometry(0, 0, null)).toBe(false);
    expect(pointInGeometry(0, 0, { type: 'Point', coordinates: [0, 0] })).toBe(false);
  });
});

describe('findPrecinctForPoint', () => {
  const features = [
    { properties: { PRECINCT: 1 }, geometry: SQUARE },
    { properties: { PRECINCT: 2 }, geometry: MULTI },
  ];

  it('returns the containing feature', () => {
    expect(findPrecinctForPoint(0.5, 0.5, features).properties.PRECINCT).toBe(1);
    expect(findPrecinctForPoint(10.5, 10.5, features).properties.PRECINCT).toBe(2);
  });

  it('returns null when no feature contains the point', () => {
    expect(findPrecinctForPoint(50, 50, features)).toBeNull();
    expect(findPrecinctForPoint(0.5, 0.5, null)).toBeNull();
  });
});

describe('geocodeAddress', () => {
  it('returns coordinates from the first geocoder match', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '33.24', lon: '-96.63', display_name: 'McKinney, TX' }],
    });
    const result = await geocodeAddress('2300 Bloomdale Rd', fetchImpl);
    expect(result).toEqual({ lat: 33.24, lng: -96.63, label: 'McKinney, TX' });
    const url = fetchImpl.mock.calls[0][0];
    expect(url).toContain('nominatim.openstreetmap.org');
    expect(url).toContain('bounded=1');
  });

  it('returns null for empty queries without calling the network', async () => {
    const fetchImpl = jest.fn();
    expect(await geocodeAddress('   ', fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when the geocoder has no matches', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => [] });
    expect(await geocodeAddress('nowhere', fetchImpl)).toBeNull();
  });

  it('throws on geocoder HTTP errors', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(geocodeAddress('x', fetchImpl)).rejects.toThrow('503');
  });
});

describe('findPrecinctForAddress', () => {
  const features = [{ properties: { PRECINCT: 42 }, geometry: SQUARE }];

  it('resolves an address to a precinct code', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '0.5', lon: '0.5', display_name: 'Inside' }],
    });
    const r = await findPrecinctForAddress('somewhere inside', features, fetchImpl);
    expect(r.code).toBe('42');
    expect(r.label).toBe('Inside');
  });

  it('returns code null when the address is outside every precinct', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '50', lon: '50', display_name: 'Far away' }],
    });
    const r = await findPrecinctForAddress('far away', features, fetchImpl);
    expect(r.code).toBeNull();
    expect(r.label).toBe('Far away');
  });

  it('returns null when geocoding fails to match', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => [] });
    expect(await findPrecinctForAddress('??', features, fetchImpl)).toBeNull();
  });
});
