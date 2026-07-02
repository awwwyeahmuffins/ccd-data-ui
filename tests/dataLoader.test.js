// dataLoader.test.js
// Tests the REAL js/dataLoader.js module through its public API with a mocked
// global fetch (and a minimal d3.csv test double for the d3-loaded profile
// extras). No inline copies of source logic — regressions in dataLoader.js
// itself now fail these tests.
//
// Module-level state (active county/boundary, registry promise) persists for
// the life of the module instance, so every test starts from
// setActiveCounty('collin') in beforeEach (which also clears the data cache).
// Cold-start behavior (registry fetch counts / registry fetch failure) uses
// jest.isolateModulesAsync to get a fresh module instance.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  getActiveCounty,
  loadCountyRegistry,
  setActiveCounty,
  getBoundaryConfigs,
  getActiveBoundary,
  setActiveBoundary,
  clearDataCache,
  loadPrimaryTurnout,
  safePrecinctName,
  loadPrecinctRaces,
  loadCountyBaselines,
  loadAllData,
  loadElectionData,
  listElectionCSVs,
  preloadAllElections,
} from './dataLoader.js';

// ============================================================================
// FIXTURES
// ============================================================================

const REGISTRY = [
  {
    slug: 'collin',
    name: 'Collin County',
    status: 'live',
    dataRoot: 'data/tx/collin',
    defaultBoundarySet: '2026',
    boundarySets: {
      original: { geojson: 'p2024.geojson', dataDir: '2024', label: '2024 precincts' },
      2026: { geojson: 'p2026.geojson', dataDir: '2026', label: '2026 precincts' },
    },
  },
  {
    slug: 'denton',
    name: 'Denton County',
    status: 'live',
    dataRoot: 'data/tx/denton',
    defaultBoundarySet: 'original',
    boundarySets: {
      original: { geojson: 'p.geojson', dataDir: 'data', label: 'Precincts' },
    },
  },
  {
    slug: 'nowhere',
    name: 'Nowhere County',
    status: 'placeholder',
    dataRoot: 'data/tx/nowhere',
    defaultBoundarySet: 'original',
    boundarySets: {
      original: { geojson: 'p.geojson', dataDir: 'data', label: 'Precincts' },
    },
  },
];

const DISTRICTS = [
  {
    slug: 'cd-3',
    name: 'US Rep District 3',
    status: 'live',
    dataRoot: 'data/tx/cd-3',
    defaultBoundarySet: 'original',
    boundarySets: {
      original: { geojson: 'p.geojson', dataDir: 'data', label: 'Precincts' },
    },
  },
];

// v3 manifest (object wrapper, version field is the format detector)
const MANIFEST = {
  version: 3,
  county: 'collin',
  boundarySet: '2026',
  elections: [
    {
      id: 'gov-2024',
      displayName: 'Governor 2024',
      office: 'Governor',
      district: null,
      year: 2024,
      date: '2024-11-05',
      category: 'State',
      raceFile: 'races/2024-11-05/governor.csv',
      turnoutFile: 'turnout/2024-11-05.csv',
    },
    {
      id: 'ag-2024',
      displayName: 'Attorney General 2024',
      office: 'Attorney General',
      district: null,
      year: 2024,
      date: '2024-11-05',
      category: 'State',
      raceFile: 'races/2024-11-05/attorney_general.csv',
      turnoutFile: 'turnout/2024-11-05.csv',
    },
  ],
};

// Long-format v3 race CSV. Deliberately includes the edge cases the old test
// cared about: a quoted field containing a comma, and a stray blank line.
const GOV_RACE_CSV = [
  'precinct,party,candidate,votes',
  '1,REP,"Abbott, Greg",500',
  "1,DEM,Beto O'Rourke,600",
  '1,,Write-in,3',
  '', // blank interior line must not become a phantom precinct
  '2,REP,"Abbott, Greg",400',
  "2,DEM,Beto O'Rourke,100",
  '',
].join('\n');

const AG_RACE_CSV = [
  'precinct,party,candidate,votes',
  '1,DEM,Justice Person,10',
  '2,DEM,Justice Person,20',
].join('\n');

const TURNOUT_CSV = [
  'precinct,registered,ballots_cast,blank',
  '1,1000,700,5',
  '2,800,450,2',
].join('\n');

// Legacy wide CSV: CRLF line endings, padded header, quoted comma field, and
// a short row (missing trailing values must become '').
const LEGACY_CSV = [
  '  PRECINCT CODE  ,PRECINCT NAME,DEM Jane Doe,REP John Roe',
  '101,"Downtown, East",500,300',
  '102,Uptown,250',
].join('\r\n');

const GEOJSON = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { PRECINCT: '1' }, geometry: null },
    { type: 'Feature', properties: { PRECINCT: '2' }, geometry: null },
  ],
};

const PRECINCT_METADATA = { 2: { quality: 'interpolated' } };

const HISTORY_DOC = {
  precinct: '1',
  races: {
    'races/2024-11-05/governor.csv': { 'PRECINCT CODE': '1', "DEM Beto O'Rourke": '600' },
  },
};

const BASELINES = { 'races/2024-11-05/governor.csv': 0.55 };

// Raw d3.csv row objects (pre-rowFn shape, string values like d3 produces)
const DNC_ROWS = [
  {
    Precinct: '1', Rep: '100', Mod: '50', Dem: '200',
    'Rep Share': '0.29', 'Mod Share': '0.14', 'Dem Share': '0.57',
    'Winning Party': 'Dem', 'Party Strength': '3',
  },
];

const RACIAL_ROWS = [
  {
    precinct: '1', asian: '10', black: '20', hispanic: '30', others: '5',
    white: '100', total: '165', pct_asian: '6.1', pct_black: '12.1',
    pct_hispanic: '18.2', pct_others: '3.0', pct_white: '60.6',
  },
];

const PRIMARY_ROWS = [
  { precinct: '1', year: '2022', dem_ballots: '120', rep_ballots: '300' },
  { precinct: '1', year: '2024', dem_ballots: '150', rep_ballots: '280' },
  { precinct: '', year: '2022', dem_ballots: '1', rep_ballots: '1' }, // skipped
];

// ============================================================================
// FETCH / D3 TEST DOUBLES (routed by URL substring; tests mutate the tables)
// ============================================================================

let fetchRoutes; // { urlSubstring: body } — body null => 404
let d3Routes;    // { pathSubstring: rawRows } — missing => d3.csv throws

function baseFetchRoutes() {
  return {
    'data/tx/counties.json': REGISTRY,
    'data/tx/districts.json': DISTRICTS,
    'elections.json': MANIFEST,
    'races/2024-11-05/governor.csv': GOV_RACE_CSV,
    'races/2024-11-05/attorney_general.csv': AG_RACE_CSV,
    'turnout/2024-11-05.csv': TURNOUT_CSV,
    'Governor_Legacy.csv': LEGACY_CSV,
    'Empty.csv': 'PRECINCT CODE,VOTES',
    'p2026.geojson': GEOJSON,
    'p2024.geojson': GEOJSON,
    'p.geojson': GEOJSON,
    'precinct_metadata.json': PRECINCT_METADATA,
    'history/collin_1.json': HISTORY_DOC,
    'history/county_baselines.json': BASELINES,
  };
}

function baseD3Routes() {
  return {
    'collin/2026/profile/dnc_scores.csv': DNC_ROWS,
    'collin/2026/profile/racial.csv': RACIAL_ROWS,
    'collin/2026/profile/primary_turnout.csv': PRIMARY_ROWS,
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
    // Deep copy so tests that mutate results (loadAllData merges into
    // feature.properties) can't contaminate the shared fixtures.
    json: async () => JSON.parse(typeof body === 'string' ? body : JSON.stringify(body)),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function installMocks() {
  global.fetch = jest.fn(async (url) => makeResponse(findRoute(fetchRoutes, String(url)), String(url)));
  global.d3 = {
    csv: jest.fn(async (path, rowFn) => {
      const rows = findRoute(d3Routes, String(path));
      if (!rows) throw new Error(`d3.csv 404: ${path}`);
      return rows.map((d) => rowFn({ ...d }));
    }),
  };
}

/** Count fetch calls whose URL contains the given substring. */
function fetchCalls(substring) {
  return global.fetch.mock.calls.filter(([u]) => String(u).includes(substring)).length;
}

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  fetchRoutes = baseFetchRoutes();
  d3Routes = baseD3Routes();
  installMocks();
  // Normalize persistent module state: active county back to collin, boundary
  // back to collin's default, all data caches cleared.
  await setActiveCounty('collin');
  clearDataCache();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ============================================================================
// COUNTY REGISTRY
// ============================================================================

describe('loadCountyRegistry', () => {
  it('merges counties.json and districts.json and caches the promise', async () => {
    const registry = await loadCountyRegistry();
    expect(registry.map((c) => c.slug)).toEqual(['collin', 'denton', 'nowhere', 'cd-3']);

    await loadCountyRegistry();
    // Registry promise was cached before this test's mocks were cleared, so no
    // fetch at all should happen here.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches each registry file exactly once on a cold module', async () => {
    await jest.isolateModulesAsync(async () => {
      const fresh = await import('./dataLoader.js');
      const [a, b] = await Promise.all([fresh.loadCountyRegistry(), fresh.loadCountyRegistry()]);
      await fresh.loadCountyRegistry();
      expect(a).toEqual(b);
      expect(fetchCalls('data/tx/counties.json')).toBe(1);
      expect(fetchCalls('data/tx/districts.json')).toBe(1);
      // Fresh module also starts on the documented defaults
      expect(fresh.getActiveCounty()).toBe('collin');
      expect(fresh.getActiveBoundary()).toBe('original');
    });
  });

  it('rejects when counties.json is unavailable (and caches the rejection)', async () => {
    await jest.isolateModulesAsync(async () => {
      const fresh = await import('./dataLoader.js');
      fetchRoutes['data/tx/counties.json'] = null;
      await expect(fresh.loadCountyRegistry()).rejects.toThrow('Failed to fetch county registry');
      // Documented current behavior: the rejected promise stays cached — a
      // transient failure is never retried for the life of the module.
      fetchRoutes['data/tx/counties.json'] = REGISTRY;
      await expect(fresh.loadCountyRegistry()).rejects.toThrow('Failed to fetch county registry');
      expect(fetchCalls('data/tx/counties.json')).toBe(1);
    });
  });

  it('tolerates a missing districts.json (counties only)', async () => {
    await jest.isolateModulesAsync(async () => {
      const fresh = await import('./dataLoader.js');
      fetchRoutes['data/tx/districts.json'] = null;
      const registry = await fresh.loadCountyRegistry();
      expect(registry.map((c) => c.slug)).toEqual(['collin', 'denton', 'nowhere']);
    });
  });
});

describe('setActiveCounty / boundary configs', () => {
  it('switches the active county and resets the boundary to its default', async () => {
    expect(getActiveCounty()).toBe('collin');
    expect(getActiveBoundary()).toBe('2026'); // collin's defaultBoundarySet

    const entry = await setActiveCounty('denton');
    expect(entry.slug).toBe('denton');
    expect(getActiveCounty()).toBe('denton');
    expect(getActiveBoundary()).toBe('original');
  });

  it('rejects an unknown county slug and keeps the current county', async () => {
    await expect(setActiveCounty('bogus')).rejects.toThrow('Unknown county: bogus');
    expect(getActiveCounty()).toBe('collin');
  });

  // What listElectionCSVs hands consumers for a v3 manifest entry
  const govEntry = () => ({
    ...MANIFEST.elections[0],
    filename: MANIFEST.elections[0].raceFile,
    _v3: true,
  });

  it('clears cached election data when switching counties', async () => {
    const entry = govEntry();
    await loadElectionData(entry);
    expect(fetchCalls('races/2024-11-05/governor.csv')).toBe(1);

    await setActiveCounty('collin'); // same county — still clears the cache
    await loadElectionData(entry);
    expect(fetchCalls('races/2024-11-05/governor.csv')).toBe(2);
  });

  it('getBoundaryConfigs derives paths from the registry entry', () => {
    const configs = getBoundaryConfigs();
    expect(Object.keys(configs).sort()).toEqual(['2026', 'original']);
    expect(configs.original).toEqual({
      geojson: 'data/tx/collin/p2024.geojson',
      dataDir: 'data/tx/collin/2024',
      profileDir: 'data/tx/collin/2024/profile',
      label: '2024 precincts',
    });
    expect(configs['2026'].dataDir).toBe('data/tx/collin/2026');
  });

  it('setActiveBoundary switches the data directory and clears the cache', async () => {
    const entry = govEntry();
    await loadElectionData(entry);
    expect(global.fetch.mock.calls[0][0]).toBe('data/tx/collin/2026/races/2024-11-05/governor.csv');

    setActiveBoundary('original');
    expect(getActiveBoundary()).toBe('original');

    await loadElectionData(entry); // cache was cleared → refetches from the other dir
    const urls = global.fetch.mock.calls.map(([u]) => String(u));
    expect(urls).toContain('data/tx/collin/2024/races/2024-11-05/governor.csv');
  });

  it('setActiveBoundary throws on an unknown boundary id', () => {
    expect(() => setActiveBoundary('bogus')).toThrow('Unknown boundary set: bogus');
    expect(getActiveBoundary()).toBe('2026');
  });
});

// ============================================================================
// ELECTION MANIFEST (listElectionCSVs)
// ============================================================================

describe('listElectionCSVs', () => {
  it('normalizes v3 manifest entries to the app shape', async () => {
    const list = await listElectionCSVs();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      filename: 'races/2024-11-05/governor.csv',
      raceFile: 'races/2024-11-05/governor.csv',
      turnoutFile: 'turnout/2024-11-05.csv',
      displayName: 'Governor 2024',
      year: 2024,
      category: 'State',
      raceKey: 'gov-2024',
      _v3: true,
    });
  });

  it('caches the manifest (one fetch for two calls)', async () => {
    await listElectionCSVs();
    await listElectionCSVs();
    expect(fetchCalls('elections.json')).toBe(1);
  });

  it('returns an empty list for a non-live county without fetching a manifest', async () => {
    await setActiveCounty('nowhere');
    const list = await listElectionCSVs();
    expect(list).toEqual([]);
    expect(fetchCalls('elections.json')).toBe(0);
  });

  it('throws when the manifest fetch fails', async () => {
    fetchRoutes['elections.json'] = null;
    await expect(listElectionCSVs()).rejects.toThrow('Failed to load elections manifest');
  });

  it('still normalizes a legacy bare-array manifest', async () => {
    fetchRoutes['elections.json'] = ['Governor_2024.csv'];
    const list = await listElectionCSVs();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ filename: 'Governor_2024.csv', year: 2024 });
    expect(list[0]._v3).toBeUndefined();
  });
});

// ============================================================================
// ELECTION DATA (v3 pivot path)
// ============================================================================

describe('loadElectionData — v3 pivot path', () => {
  const govEntry = MANIFEST.elections[0];

  it('pivots race + turnout CSVs into legacy rows with winners', async () => {
    const rows = await loadElectionData(normalizedGov());
    expect(rows).toHaveLength(2); // blank CSV line must not create a phantom row

    expect(rows[0]).toEqual({
      'PRECINCT CODE': '1',
      'REGISTERED VOTERS TOTAL': '1000',
      'BALLOTS CAST TOTAL': '700',
      'BALLOTS CAST BLANK': '5',
      'Write-in': '3',
      "DEM Beto O'Rourke": '600',
      'REP Abbott, Greg': '500', // quoted comma survived the real CSV parser
      'Winning Candidate': "DEM Beto O'Rourke",
      'Winning Party': 'DEM',
    });
    expect(rows[1]['Winning Candidate']).toBe('REP Abbott, Greg');
    expect(rows[1]['Winning Party']).toBe('REP');
    expect(rows[1]['Write-in']).toBe('0'); // filled default when column exists
    expect(rows[1]['BALLOTS CAST TOTAL']).toBe('450');
  });

  it('resolves a bare filename string through the cached manifest', async () => {
    await listElectionCSVs();
    const rows = await loadElectionData('races/2024-11-05/governor.csv');
    // Pivoted legacy shape (not raw long rows) proves the v3 route was taken
    expect(rows[0]['PRECINCT CODE']).toBe('1');
    expect(rows[0]['Winning Party']).toBe('DEM');
  });

  it('caches per race file (two loads → one fetch, same array)', async () => {
    const first = await loadElectionData(normalizedGov());
    const second = await loadElectionData(normalizedGov());
    expect(second).toBe(first);
    expect(fetchCalls('races/2024-11-05/governor.csv')).toBe(1);
  });

  it('fetches a shared turnout file only once across races', async () => {
    await loadElectionData(normalizedGov());
    await loadElectionData(normalizeEntry(MANIFEST.elections[1]));
    expect(fetchCalls('turnout/2024-11-05.csv')).toBe(1);
  });

  it('leaves turnout columns as honest empty strings when there is no turnout file', async () => {
    const rows = await loadElectionData({ ...normalizedGov(), turnoutFile: null });
    expect(rows[0]['REGISTERED VOTERS TOTAL']).toBe('');
    expect(rows[0]['BALLOTS CAST TOTAL']).toBe('');
    expect(fetchCalls('turnout/')).toBe(0);
  });

  it('survives a missing turnout file (warns, turnout columns empty)', async () => {
    fetchRoutes['turnout/2024-11-05.csv'] = null;
    const rows = await loadElectionData(normalizedGov());
    expect(rows[0]['BALLOTS CAST TOTAL']).toBe('');
    expect(rows[0]['Winning Party']).toBe('DEM'); // votes still intact
  });

  it('rejects when the race file itself is missing', async () => {
    fetchRoutes['races/2024-11-05/governor.csv'] = null;
    await expect(loadElectionData(normalizedGov())).rejects.toThrow(/Could not load CSV/);
  });

  it('rejects invalid arguments', async () => {
    await expect(loadElectionData(null)).rejects.toThrow(
      'loadElectionData requires a filename string or manifest entry object'
    );
    await expect(loadElectionData({})).rejects.toThrow(/requires a filename/);
  });

  // Helper: what listElectionCSVs would hand consumers for the gov entry
  function normalizedGov() {
    return normalizeEntry(govEntry);
  }
  function normalizeEntry(e) {
    return { ...e, filename: e.raceFile, _v3: true };
  }
});

// ============================================================================
// ELECTION DATA (legacy wide-CSV path)
// ============================================================================

describe('loadElectionData — legacy wide CSV path', () => {
  it('parses CRLF, padded headers, quoted commas, and short rows via the real parser', async () => {
    const rows = await loadElectionData({ filename: 'Governor_Legacy.csv' });
    expect(global.fetch.mock.calls[0][0]).toBe('data/tx/collin/2026/Governor_Legacy.csv');

    expect(rows).toHaveLength(2);
    expect(rows[0]['PRECINCT CODE']).toBe('101'); // header whitespace trimmed
    expect(rows[0]['PRECINCT NAME']).toBe('Downtown, East'); // quoted comma kept
    expect(rows[0]['REP John Roe']).toBe('300');
    // Short row: missing trailing values become '' (never undefined)
    expect(rows[1]['DEM Jane Doe']).toBe('250');
    expect(rows[1]['REP John Roe']).toBe('');
  });

  it('returns [] for a header-only CSV', async () => {
    const rows = await loadElectionData({ filename: 'Empty.csv' });
    expect(rows).toEqual([]);
  });
});

// ============================================================================
// preloadAllElections
// ============================================================================

describe('preloadAllElections', () => {
  it('loads every manifest race once and warms the cache', async () => {
    const files = await preloadAllElections();
    expect(files).toHaveLength(2);
    expect(fetchCalls('races/2024-11-05/governor.csv')).toBe(1);
    expect(fetchCalls('races/2024-11-05/attorney_general.csv')).toBe(1);
    expect(fetchCalls('turnout/2024-11-05.csv')).toBe(1);

    global.fetch.mockClear();
    await loadElectionData(files[0]);
    expect(global.fetch).not.toHaveBeenCalled(); // served from cache
  });
});

// ============================================================================
// loadAllData
// ============================================================================

describe('loadAllData', () => {
  it('merges GeoJSON with DNC, racial, and precinct metadata', async () => {
    const { geojson, dncLookup, racialLookup } = await loadAllData();

    expect(geojson.features).toHaveLength(2);
    const p1 = geojson.features[0].properties;
    expect(p1).toMatchObject({ PRECINCT: '1', rep: 100, dem: 200, winningParty: 'Dem' });
    expect(p1.pct_asian).toBeCloseTo(0.061);
    expect(p1.total).toBe(165);

    // Metadata only exists for precinct 2 (2026 boundaries fetch it)
    expect(geojson.features[1].properties._meta).toEqual({ quality: 'interpolated' });
    expect(geojson.features[0].properties._meta).toBeUndefined();

    expect(Object.keys(dncLookup)).toEqual(['1']);
    expect(Object.keys(racialLookup)).toEqual(['1']);
  });

  it('caches the merged result (second call → no extra fetch)', async () => {
    const first = await loadAllData();
    global.fetch.mockClear();
    global.d3.csv.mockClear();
    const second = await loadAllData();
    expect(second).toBe(first);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(global.d3.csv).not.toHaveBeenCalled();
  });

  it('treats profile extras as optional (county without them still loads)', async () => {
    await setActiveCounty('denton'); // no d3 routes → dnc/racial rejections
    const { geojson, dncLookup, racialLookup } = await loadAllData();
    expect(geojson.features).toHaveLength(2);
    expect(dncLookup).toEqual({});
    expect(racialLookup).toEqual({});
    expect(geojson.features[0].properties.rep).toBeUndefined();
    // Non-2026 boundary: metadata is never even requested
    expect(fetchCalls('precinct_metadata.json')).toBe(0);
  });

  it('rejects when the GeoJSON fetch fails', async () => {
    fetchRoutes['p2026.geojson'] = null;
    await expect(loadAllData()).rejects.toThrow('Failed to fetch GeoJSON');
  });

  it('rejects for a county without live data', async () => {
    await setActiveCounty('nowhere');
    await expect(loadAllData()).rejects.toThrow('No live data for: nowhere');
  });
});

// ============================================================================
// PRIMARY TURNOUT (optional profile extra)
// ============================================================================

describe('loadPrimaryTurnout', () => {
  it('builds a precinct → year → {dem, rep} lookup, skipping blank precincts', async () => {
    const lookup = await loadPrimaryTurnout();
    expect(lookup).toEqual({
      1: {
        2022: { dem: 120, rep: 300 },
        2024: { dem: 150, rep: 280 },
      },
    });
  });

  it('caches the lookup (one d3.csv read)', async () => {
    await loadPrimaryTurnout();
    await loadPrimaryTurnout();
    expect(global.d3.csv).toHaveBeenCalledTimes(1);
  });

  it('returns null when the file is absent, and caches the null', async () => {
    await setActiveCounty('denton'); // no primary_turnout route
    expect(await loadPrimaryTurnout()).toBeNull();
    global.d3.csv.mockClear();
    expect(await loadPrimaryTurnout()).toBeNull();
    expect(global.d3.csv).not.toHaveBeenCalled();
  });
});

// ============================================================================
// PRECINCT HISTORY + BASELINES + safePrecinctName
// ============================================================================

describe('safePrecinctName', () => {
  it('sanitizes codes the way the pipeline does', () => {
    expect(safePrecinctName('collin:1')).toBe('collin_1');
    expect(safePrecinctName('PCT 12/A')).toBe('PCT_12_A');
    expect(safePrecinctName('A-1_b.2')).toBe('A-1_b.2'); // allowed chars kept
    expect(safePrecinctName(42)).toBe('42');
  });
});

describe('loadPrecinctRaces', () => {
  it('fetches the sanitized history file and wraps each race row in a 1-element array', async () => {
    const map = await loadPrecinctRaces('collin:1');
    expect(fetchCalls('2026/history/collin_1.json')).toBe(1);
    expect(map).toEqual({
      'races/2024-11-05/governor.csv': [
        { 'PRECINCT CODE': '1', "DEM Beto O'Rourke": '600' },
      ],
    });
  });

  it('caches per precinct', async () => {
    await loadPrecinctRaces('collin:1');
    await loadPrecinctRaces('collin:1');
    expect(fetchCalls('history/collin_1.json')).toBe(1);
  });

  it('returns {} for a precinct with no history file', async () => {
    expect(await loadPrecinctRaces('999')).toEqual({});
  });
});

describe('loadCountyBaselines', () => {
  it('returns the parsed baseline map and caches per data dir', async () => {
    const baselines = await loadCountyBaselines();
    expect(baselines).toEqual(BASELINES);
    await loadCountyBaselines();
    expect(fetchCalls('history/county_baselines.json')).toBe(1);
  });

  it('returns {} when the file is missing', async () => {
    fetchRoutes['history/county_baselines.json'] = null;
    expect(await loadCountyBaselines()).toEqual({});
  });
});
