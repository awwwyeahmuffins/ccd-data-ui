// districts.test.js
// Tests the REAL js/data/districts.js module: district membership from
// boundary-GeoJSON props (CONG/SEN/SHR), race→district slug mapping, and the
// district-tree fetch helpers ported from commandCenter.js.
//
// The module-level fetch cache persists for the life of a module instance,
// so each test gets a FRESH module via jest.isolateModulesAsync.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ============================================================================
// FIXTURES
// ============================================================================

// Precinct features as they appear in data/tx/collin/boundaries/*.geojson:
// CONG/SEN/SHR are plain district numbers (verified: numbers in today's
// files; one fixture uses a zero-padded string to prove normalization).
const FEATURES = [
  { type: 'Feature', properties: { PRECINCT: 1, CONG: 3, SEN: 8, SHR: 67, COMMISH: 1 }, geometry: null },
  { type: 'Feature', properties: { PRECINCT: '2', CONG: '03', SEN: 30, SHR: 33, COMMISH: 1 }, geometry: null },
  { type: 'Feature', properties: { PRECINCT: 3, CONG: 4, SEN: 2, SHR: 61, COMMISH: 4 }, geometry: null },
  { type: 'Feature', properties: { PRECINCT: 4, CONG: 32, SEN: 8, SHR: 89 }, geometry: null }, // no COMMISH prop
];

// District race CSV in the long v3 layout (precinct,party,candidate,votes)
// with the district trees' "<county>:<precinct>" codes: Collin rows skipped,
// no-colon rows skipped, empty-party (Over/Under/Write-in) rows skipped,
// ":ALL" rows fold into county totals only, real precinct rows into both.
// NOTE: the ported parser is the commandCenter original's naive split(",") —
// candidate names never contain commas in the pipeline-written district CSVs.
const DISTRICT_RACE_CSV = [
  'precinct,party,candidate,votes',
  'collin:1,REP,Alice Smith,100', // collin → skipped entirely
  '1,REP,Alice Smith,50',         // no county prefix → skipped
  'hunt:101,REP,Alice Smith,10',
  'hunt:101,DEM,Bob Jones,4',
  'hunt:101,,Write-in,3',         // empty party → skipped
  'rockwall:ALL,REP,Alice Smith,200',
  'rockwall:ALL,DEM,Bob Jones,300',
  'fannin:ALL,REP,Alice Smith,0', // total 0 → dropped from byCounty
].join('\n');

const DISTRICT_MANIFEST = {
  version: 3,
  county: 'cd-3',
  boundarySet: 'original',
  elections: [
    {
      id: 'us-rep-3-2024',
      displayName: 'United States Representative District 3 (2024)',
      office: 'United States Representative District 3',
      district: '3',
      year: 2024,
      date: null,
      category: 'Federal',
      raceFile: 'races/United_States_Representative_District_3_2024.csv',
      turnoutFile: 'turnout/United_States_Representative_District_3_2024.csv',
    },
  ],
};

const OUTLINES_GEOJSON = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { code: 'hunt:ALL' }, geometry: null }],
};

const PRECINCT_GEOJSON = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { PRECINCT: 'hunt:101', countySlug: 'hunt' }, geometry: null }],
};

// ============================================================================
// FETCH TEST DOUBLE (routed by URL substring)
// ============================================================================

let fetchRoutes; // { urlSubstring: body } — body null => 404

function baseFetchRoutes() {
  return {
    'districts/cd-3/data/races/US_Rep_3_2024.csv': DISTRICT_RACE_CSV,
    'districts/cd-3/data/elections.json': DISTRICT_MANIFEST,
    'districts/cd-3/boundaries/county_outlines.geojson': OUTLINES_GEOJSON,
    'districts/cd-3/boundaries/other_precincts.geojson': PRECINCT_GEOJSON,
  };
}

function findRoute(table, url) {
  const key = Object.keys(table).find((k) => url.includes(k));
  return key === undefined ? undefined : table[key];
}

function makeResponse(body, url) {
  if (body == null) {
    return { ok: false, status: 404, statusText: `Not Found (${url})` };
  }
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => JSON.parse(typeof body === 'string' ? body : JSON.stringify(body)),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** Count fetch calls whose URL contains the given substring. */
function fetchCalls(substring) {
  return global.fetch.mock.calls.filter(([u]) => String(u).includes(substring)).length;
}

let districts; // fresh js/data/districts.js module for each test

beforeEach(async () => {
  fetchRoutes = baseFetchRoutes();
  global.fetch = jest.fn(async (url) => makeResponse(findRoute(fetchRoutes, String(url)), String(url)));
  await jest.isolateModulesAsync(async () => {
    districts = await import('../js/data/districts.js');
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ============================================================================
// DISTRICT_LIST + membership from GeoJSON props
// ============================================================================

describe('DISTRICT_LIST', () => {
  it('holds the 12 Collin-touching districts, frozen', () => {
    expect(districts.DISTRICT_LIST.map((d) => d.slug)).toEqual([
      'cd-3', 'cd-4', 'cd-32', 'sd-2', 'sd-8', 'sd-30',
      'hd-33', 'hd-61', 'hd-66', 'hd-67', 'hd-70', 'hd-89',
    ]);
    expect(Object.isFrozen(districts.DISTRICT_LIST)).toBe(true);
    expect(Object.isFrozen(districts.DISTRICT_LIST[0])).toBe(true);
    expect(districts.DISTRICT_LIST[0]).toEqual({
      slug: 'cd-3',
      name: 'Congressional District 3',
      group: 'Congressional Districts',
      dataRoot: 'data/tx/districts/cd-3',
    });
    expect(districts.KEPT_DISTRICTS).toEqual(new Set(districts.DISTRICT_LIST.map((d) => d.slug)));
  });
});

describe('districtOfFeature', () => {
  it('reads CONG/SEN/SHR by kind', () => {
    expect(districts.districtOfFeature(FEATURES[0], 'cd')).toBe('cd-3');
    expect(districts.districtOfFeature(FEATURES[0], 'sd')).toBe('sd-8');
    expect(districts.districtOfFeature(FEATURES[0], 'hd')).toBe('hd-67');
  });

  it('normalizes zero-padded string values', () => {
    expect(districts.districtOfFeature(FEATURES[1], 'cd')).toBe('cd-3'); // CONG: '03'
  });

  it('reads COMMISH for the comm kind (roll-up scoping)', () => {
    expect(districts.districtOfFeature(FEATURES[0], 'comm')).toBe('comm-1');
    expect(districts.districtOfFeature(FEATURES[2], 'comm')).toBe('comm-4');
    expect(districts.districtOfFeature(FEATURES[3], 'comm')).toBeNull(); // prop absent
  });

  it('returns null for unknown kinds and missing props', () => {
    expect(districts.districtOfFeature(FEATURES[0], 'sed')).toBeNull();
    expect(districts.districtOfFeature({ properties: {} }, 'cd')).toBeNull();
    expect(districts.districtOfFeature(null, 'cd')).toBeNull();
    expect(districts.districtOfFeature({ properties: { CONG: 'abc' } }, 'cd')).toBeNull();
  });
});

describe('precinctsInDistrict', () => {
  it('returns the precinct codes (as strings) of member features', () => {
    expect(districts.precinctsInDistrict('cd-3', FEATURES)).toEqual(['1', '2']);
    expect(districts.precinctsInDistrict('sd-8', FEATURES)).toEqual(['1', '4']);
    expect(districts.precinctsInDistrict('hd-89', FEATURES)).toEqual(['4']);
  });

  it('handles a zero-padded slug number the same as the props', () => {
    expect(districts.precinctsInDistrict('cd-03', FEATURES)).toEqual(['1', '2']);
  });

  it('returns [] for empty membership, bad slugs, and missing features', () => {
    expect(districts.precinctsInDistrict('cd-99', FEATURES)).toEqual([]);
    expect(districts.precinctsInDistrict('nonsense', FEATURES)).toEqual([]);
    expect(districts.precinctsInDistrict('cd-3', null)).toEqual([]);
  });

  it('resolves comm slugs from COMMISH props', () => {
    expect(districts.precinctsInDistrict('comm-1', FEATURES)).toEqual(['1', '2']);
    expect(districts.precinctsInDistrict('comm-4', FEATURES)).toEqual(['3']);
  });
});

describe('ROLLUP_KINDS', () => {
  it('lists the four roll-up kinds with their GeoJSON props, frozen', () => {
    expect(districts.ROLLUP_KINDS.map((k) => k.id)).toEqual(['hd', 'sd', 'cd', 'comm']);
    expect(districts.ROLLUP_KINDS.find((k) => k.id === 'comm').prop).toBe('COMMISH');
    expect(Object.isFrozen(districts.ROLLUP_KINDS)).toBe(true);
    expect(Object.isFrozen(districts.ROLLUP_KINDS[0])).toBe(true);
  });

  it('comm stays out of the district data trees (no race tree exists for it)', () => {
    // districtSlugFor gates on KEPT_DISTRICTS, which never contains comm slugs —
    // a commissioner race entry must not route to data/tx/districts/comm-*.
    expect(districts.KEPT_DISTRICTS.has('comm-1')).toBe(false);
    expect(
      districts.districtSlugFor({ office: 'County Commissioner Precinct 1', district: '1' })
    ).toBeNull();
  });
});

// ============================================================================
// districtSlugFor (race entry → district slug)
// ============================================================================

describe('districtSlugFor', () => {
  it('maps US House, State Senate, and State House offices', () => {
    expect(districts.districtSlugFor({ office: 'United States Representative District 3', district: '3' })).toBe('cd-3');
    expect(districts.districtSlugFor({ office: 'U.S. Representative', district: '4' })).toBe('cd-4');
    expect(districts.districtSlugFor({ office: 'State Senator, District 8', district: '8' })).toBe('sd-8');
    expect(districts.districtSlugFor({ office: 'State Representative District 67', district: '67' })).toBe('hd-67');
  });

  it('maps party-prefixed primary offices with a bare "US" token to cd-', () => {
    // The 2026 primary races are named "DEM US Representative District 4" —
    // no "united states"/"u.s"/"u s" substring, so they used to fall through
    // to the state-house branch (hd-4, not kept) and lose their district data.
    expect(districts.districtSlugFor({ office: 'DEM US Representative District 4', district: '4' })).toBe('cd-4');
    expect(districts.districtSlugFor({ office: 'REP US Representative District 4', district: '4' })).toBe('cd-4');
  });

  it('returns null for non-district races and districts we do not keep', () => {
    expect(districts.districtSlugFor({ office: 'Governor', district: null })).toBeNull();
    expect(districts.districtSlugFor({ office: 'State Representative District 1', district: '1' })).toBeNull(); // hd-1 not kept
    expect(districts.districtSlugFor({ office: 'County Judge', district: '3' })).toBeNull(); // no office match
    // "us" must match only as a standalone token — offices merely containing
    // the letters (Justice…) or state-house primaries stay off the cd- branch.
    expect(districts.districtSlugFor({ office: 'DEM State Representative District 33', district: '33' })).toBe('hd-33');
    expect(districts.districtSlugFor({ office: 'Justice, Supreme Court, Place 4', district: '4' })).toBeNull();
  });
});

// ============================================================================
// loadDistrictAggregates
// ============================================================================

describe('loadDistrictAggregates', () => {
  it('folds non-Collin rows into byCounty totals and real precinct rows into byPrecinct', async () => {
    const { byCounty, byPrecinct } = await districts.loadDistrictAggregates('cd-3', 'races/US_Rep_3_2024.csv');

    expect(byCounty).toEqual([
      { county: 'hunt', rep: 10, dem: 4, total: 14, winner: 'Rep' },
      { county: 'rockwall', rep: 200, dem: 300, total: 500, winner: 'Dem' },
      // fannin dropped: total 0; collin + no-colon + empty-party rows skipped
    ]);

    expect(byPrecinct).toEqual({
      'hunt:101': { rep: 10, dem: 4, total: 14, winner: 'Rep', margin: (10 - 4) / 14 },
    });
    // ":ALL" aggregate rows never appear per-precinct
    expect(byPrecinct['rockwall:ALL']).toBeUndefined();
  });

  it('memoizes per (slug, raceFile)', async () => {
    const first = await districts.loadDistrictAggregates('cd-3', 'races/US_Rep_3_2024.csv');
    const second = await districts.loadDistrictAggregates('cd-3', 'races/US_Rep_3_2024.csv');
    expect(second).toBe(first);
    expect(fetchCalls('races/US_Rep_3_2024.csv')).toBe(1);

    await districts.loadDistrictAggregates('cd-3', 'races/Other.csv'); // different race → own fetch
    expect(fetchCalls('races/Other.csv')).toBe(1);
  });

  it('returns empty results for a missing race file', async () => {
    const result = await districts.loadDistrictAggregates('cd-3', 'races/Missing.csv');
    expect(result).toEqual({ byCounty: [], byPrecinct: {} });
  });
});

// ============================================================================
// listDistrictRaces
// ============================================================================

describe('listDistrictRaces', () => {
  it('normalizes the district tree\'s v3 manifest and memoizes per slug', async () => {
    const list = await districts.listDistrictRaces('cd-3');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      filename: 'races/United_States_Representative_District_3_2024.csv',
      raceFile: 'races/United_States_Representative_District_3_2024.csv',
      displayName: 'United States Representative District 3 (2024)',
      year: 2024,
      category: 'Federal', // manifest category kept verbatim
      raceKey: 'us-rep-3-2024',
      _v3: true,
    });

    await districts.listDistrictRaces('cd-3');
    expect(fetchCalls('cd-3/data/elections.json')).toBe(1);
  });

  it('throws on an unknown district slug without fetching', async () => {
    await expect(districts.listDistrictRaces('cd-99')).rejects.toThrow('Unknown district: cd-99');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not cache a failed manifest fetch (retry refetches)', async () => {
    fetchRoutes['districts/cd-3/data/elections.json'] = null;
    await expect(districts.listDistrictRaces('cd-3')).rejects.toThrow('Failed to load district manifest');

    fetchRoutes['districts/cd-3/data/elections.json'] = DISTRICT_MANIFEST;
    const list = await districts.listDistrictRaces('cd-3');
    expect(list).toHaveLength(1);
    expect(fetchCalls('cd-3/data/elections.json')).toBe(2);
  });
});

// ============================================================================
// loadDistrictOutlines / loadDistrictPrecinctGeo
// ============================================================================

describe('district geometry helpers', () => {
  it('loadDistrictOutlines returns the GeoJSON and memoizes', async () => {
    const geo = await districts.loadDistrictOutlines('cd-3');
    expect(geo.features[0].properties.code).toBe('hunt:ALL');
    await districts.loadDistrictOutlines('cd-3');
    expect(fetchCalls('county_outlines.geojson')).toBe(1);
  });

  it('loadDistrictPrecinctGeo returns the GeoJSON when sourced', async () => {
    const geo = await districts.loadDistrictPrecinctGeo('cd-3');
    expect(geo.features[0].properties.countySlug).toBe('hunt');
  });

  it('both return null when the file is absent', async () => {
    expect(await districts.loadDistrictOutlines('hd-61')).toBeNull();
    expect(await districts.loadDistrictPrecinctGeo('hd-61')).toBeNull();
  });
});
