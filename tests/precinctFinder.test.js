// tests/precinctFinder.test.js
// The shared precinct finder (js/ui/precinctFinder.js): number-vs-address
// heuristic, address flow, geolocation flow, and the shared status copy.

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { createPrecinctFinder, isAddressQuery, FINDER_COPY } from '../js/ui/precinctFinder.js';

describe('isAddressQuery', () => {
  it('treats anything with letters as an address', () => {
    expect(isAddressQuery('123 Main St')).toBe(true);
    expect(isAddressQuery('McKinney')).toBe(true);
  });
  it('treats short digit strings as precinct codes', () => {
    expect(isAddressQuery('42')).toBe(false);
    expect(isAddressQuery('3')).toBe(false);
    expect(isAddressQuery('1234')).toBe(false);
  });
  it('treats long digit strings as addresses (street numbers)', () => {
    expect(isAddressQuery('75070')).toBe(true);
  });
});

function makeFinder(overrides = {}) {
  const calls = { found: [], status: [] };
  const finder = createPrecinctFinder({
    getFeatures: () => overrides.features || [],
    hasPrecinct: overrides.hasPrecinct || ((code) => code === '42'),
    onFound: (code) => calls.found.push(code),
    onStatus: (msg) => calls.status.push(msg),
    findPrecinctForAddress: overrides.findPrecinctForAddress || jest.fn(),
    findPrecinctForPoint: overrides.findPrecinctForPoint || jest.fn(),
    viewbox: 'VB',
  });
  return { finder, calls };
}

describe('search routing', () => {
  it('empty input is a no-op', () => {
    const { finder, calls } = makeFinder();
    finder.search('   ');
    expect(calls.found).toEqual([]);
    expect(calls.status).toEqual([]);
  });

  it('a known precinct number selects it directly', () => {
    const { finder, calls } = makeFinder();
    finder.search('42');
    expect(calls.found).toEqual(['42']);
  });

  it('an unknown precinct number explains itself in plain language', () => {
    const { finder, calls } = makeFinder();
    finder.search('99');
    expect(calls.found).toEqual([]);
    expect(calls.status).toEqual([FINDER_COPY.noSuchPrecinct('99')]);
  });
});

describe('address flow', () => {
  beforeEach(() => { globalThis.fetch = jest.fn(); });

  it('resolves an address to a precinct code', async () => {
    const findPrecinctForAddress = jest.fn(async () => ({ code: '17' }));
    const { finder, calls } = makeFinder({ findPrecinctForAddress });
    await finder.searchAddress('123 Main St, McKinney');
    expect(findPrecinctForAddress).toHaveBeenCalledWith('123 Main St, McKinney', [], globalThis.fetch, 'VB');
    expect(calls.status[0]).toBe(FINDER_COPY.addressLooking);
    expect(calls.found).toEqual(['17']);
  });

  it('reports a not-found address with the add-the-city hint', async () => {
    const { finder, calls } = makeFinder({ findPrecinctForAddress: jest.fn(async () => null) });
    await finder.searchAddress('nowhere');
    expect(calls.status[1]).toBe(FINDER_COPY.addressNotFound('nowhere'));
  });

  it('reports an address outside the map', async () => {
    const { finder, calls } = makeFinder({ findPrecinctForAddress: jest.fn(async () => ({ code: null })) });
    await finder.searchAddress('1600 Pennsylvania Ave, DC');
    expect(calls.status[1]).toBe(FINDER_COPY.addressOutside);
  });

  it('reports a geocoder outage without throwing', async () => {
    const { finder, calls } = makeFinder({ findPrecinctForAddress: jest.fn(async () => { throw new Error('down'); }) });
    await finder.searchAddress('123 Main St');
    expect(calls.status[1]).toBe(FINDER_COPY.addressServiceDown);
  });
});

describe('geolocation flow', () => {
  const realGeo = navigator.geolocation;
  afterEach(() => {
    Object.defineProperty(navigator, 'geolocation', { value: realGeo, configurable: true });
  });

  function stubGeolocation(impl) {
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: impl },
      configurable: true,
    });
  }

  it('explains when the browser has no geolocation', async () => {
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    const { finder, calls } = makeFinder();
    await finder.locate();
    expect(calls.status).toEqual([FINDER_COPY.geoUnsupported]);
  });

  it('selects the precinct at the current position', async () => {
    stubGeolocation((ok) => ok({ coords: { latitude: 33.1, longitude: -96.6 } }));
    const findPrecinctForPoint = jest.fn(() => ({ properties: { PRECINCT: 7 } }));
    const { finder, calls } = makeFinder({ findPrecinctForPoint });
    await finder.locate();
    expect(findPrecinctForPoint).toHaveBeenCalledWith(33.1, -96.6, []);
    expect(calls.found).toEqual(['7']);
  });

  it('reports a position outside the map', async () => {
    stubGeolocation((ok) => ok({ coords: { latitude: 0, longitude: 0 } }));
    const { finder, calls } = makeFinder({ findPrecinctForPoint: jest.fn(() => null) });
    await finder.locate();
    expect(calls.status[1]).toBe(FINDER_COPY.geoOutside);
  });

  it('reports a denied/failed position lookup', async () => {
    stubGeolocation((_ok, fail) => fail(new Error('denied')));
    const { finder, calls } = makeFinder();
    await finder.locate();
    expect(calls.status[1]).toBe(FINDER_COPY.geoFailed);
  });
});
