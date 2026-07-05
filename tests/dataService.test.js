// dataService.test.js
// Tests the REAL js/data/dataService.js module through its public API with a
// mocked global fetch (and a minimal d3.csv test double for the d3-loaded
// profile extras). Fixture approach mirrors tests/dataLoader.test.js.
//
// The handle map and every per-handle memo are module-level state, so each
// test gets a FRESH module instance via jest.isolateModulesAsync — no shared
// warmth between tests unless a test creates it deliberately.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ============================================================================
// FIXTURES (paths match js/data/catalog.js — full pre-joined Collin paths)
// ============================================================================

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

// Long-format v3 race CSV with the edge cases that matter: a quoted field
// containing a comma, an RFC-4180 escaped quote, and a blank interior line.
const GOV_RACE_CSV = [
  'precinct,party,candidate,votes',
  '1,REP,"Abbott, Greg",500',
  '1,DEM,"Beto ""B"" O\'Rourke",600',
  '1,,Write-in,3',
  '', // blank interior line must not become a phantom precinct
  '2,REP,"Abbott, Greg",400',
  '2,DEM,"Beto ""B"" O\'Rourke",100',
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

// Legacy wide CSV: CRLF line endings, padded header, quoted comma field,
// RFC-4180 escaped quotes, and a short row (missing trailing values -> '').
const LEGACY_CSV = [
  '  PRECINCT CODE  ,PRECINCT NAME,DEM Jane Doe,REP John Roe',
  '101,"He said ""howdy"", twice",500,300',
  '102,Uptown,250',
].join('\r\n');

// Edge cases for the numeric turnout lookup: quoted thousands separator,
// missing ballots value, and a blank precinct that must be skipped.
const TURNOUT_2022_CSV = [
  'precinct,registered,ballots_cast,blank',
  '1,"1,000",700,5',
  '2,800,,1',
  ',100,50,0',
].join('\n');

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
    'races/2024-11-05/governor.csv': { 'PRECINCT CODE': '1', 'DEM Beto': '600' },
  },
};

const BASELINES = { 'races/2024-11-05/governor.csv': 0.55 };

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
    'collin/2026/elections.json': MANIFEST,
    'collin/2024/elections.json': MANIFEST,
    'collin/2026/races/2024-11-05/governor.csv': GOV_RACE_CSV,
    'collin/2024/races/2024-11-05/governor.csv': GOV_RACE_CSV,
    'races/2024-11-05/attorney_general.csv': AG_RACE_CSV,
    'turnout/2024-11-05.csv': TURNOUT_CSV,
    'turnout/2022.csv': TURNOUT_2022_CSV,
    'Governor_Legacy.csv': LEGACY_CSV,
    'Empty.csv': 'PRECINCT CODE,VOTES',
    'boundaries/2026.geojson': GEOJSON,
    'boundaries/2024.geojson': GEOJSON,
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
    // Deep copy so tests that mutate results (loadAll merges into
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

// What listRaces hands consumers for a v3 manifest entry
function normalizedEntry(e) {
  return { ...e, filename: e.raceFile, _v3: true };
}
const govEntry = () => normalizedEntry(MANIFEST.elections[0]);

let svc; // fresh js/data/dataService.js module for each test

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  fetchRoutes = baseFetchRoutes();
  d3Routes = baseD3Routes();
  installMocks();
  await jest.isolateModulesAsync(async () => {
    svc = await import('../js/data/dataService.js');
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ============================================================================
// boundary() — handle identity and memoization
// ============================================================================

describe('boundary', () => {
  it('defaults to the 2026 boundary set and exposes id/label/config', () => {
    const h = svc.boundary();
    expect(h.id).toBe('2026');
    expect(h.label).toBe('2026 Boundaries (273)');
    expect(h.config).toEqual({
      label: '2026 Boundaries (273)',
      geojson: 'data/tx/collin/boundaries/2026.geojson',
      dataDir: 'data/tx/collin/2026',
      profileDir: 'data/tx/collin/2026/profile',
    });
  });

  it('memoizes handles: two boundary("2026") calls → the same handle, one fetch', async () => {
    const a = svc.boundary('2026');
    const b = svc.boundary('2026');
    expect(b).toBe(a);

    await Promise.all([a.listRaces(), b.listRaces()]);
    expect(fetchCalls('collin/2026/elections.json')).toBe(1);
  });

  it('throws on an unknown boundary id', () => {
    expect(() => svc.boundary('bogus')).toThrow('Unknown boundary set: bogus');
  });

  it('keeps both boundaries warm independently — no global cache wipe', async () => {
    const h26 = svc.boundary('2026');
    const h24 = svc.boundary('original');

    const first26 = await h26.loadAll();
    await h24.loadAll(); // loading the OTHER boundary must not wipe 2026
    global.fetch.mockClear();
    global.d3.csv.mockClear();

    const again26 = await h26.loadAll();
    const again24 = await h24.loadAll();
    expect(again26).toBe(first26); // still the same warm object
    expect(again24).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(global.d3.csv).not.toHaveBeenCalled();
  });

  it('resolves each boundary against its own data directory', async () => {
    await svc.boundary('2026').loadRace(govEntry());
    await svc.boundary('original').loadRace(govEntry());
    const urls = global.fetch.mock.calls.map(([u]) => String(u));
    expect(urls).toContain('data/tx/collin/2026/races/2024-11-05/governor.csv');
    expect(urls).toContain('data/tx/collin/2024/races/2024-11-05/governor.csv');
  });
});

// ============================================================================
// Retry-after-failure (the no-cached-rejection fix)
// ============================================================================

describe('failed loads are not cached', () => {
  it('loadAll: a failed GeoJSON fetch rejects, then a retry refetches and succeeds', async () => {
    const h = svc.boundary('2026');
    fetchRoutes['boundaries/2026.geojson'] = null;
    await expect(h.loadAll()).rejects.toThrow('Failed to fetch GeoJSON');

    fetchRoutes['boundaries/2026.geojson'] = GEOJSON;
    const { geojson } = await h.loadAll(); // dataLoader would replay the rejection forever
    expect(geojson.features).toHaveLength(2);
    expect(fetchCalls('boundaries/2026.geojson')).toBe(2);
  });

  it('listRaces: a failed manifest fetch rejects, then a retry refetches', async () => {
    const h = svc.boundary('2026');
    fetchRoutes['collin/2026/elections.json'] = null;
    await expect(h.listRaces()).rejects.toThrow('Failed to load elections manifest');

    fetchRoutes['collin/2026/elections.json'] = MANIFEST;
    const list = await h.listRaces();
    expect(list).toHaveLength(2);
    expect(fetchCalls('collin/2026/elections.json')).toBe(2);
  });

  it('loadRace: a failed race fetch rejects, then a retry refetches', async () => {
    const h = svc.boundary('2026');
    fetchRoutes['collin/2026/races/2024-11-05/governor.csv'] = null;
    await expect(h.loadRace(govEntry())).rejects.toThrow(/Could not load CSV/);

    fetchRoutes['collin/2026/races/2024-11-05/governor.csv'] = GOV_RACE_CSV;
    const rows = await h.loadRace(govEntry());
    expect(rows).toHaveLength(2);
    expect(fetchCalls('collin/2026/races/2024-11-05/governor.csv')).toBe(2);
  });
});

// ============================================================================
// listRaces
// ============================================================================

describe('listRaces', () => {
  it('normalizes v3 manifest entries to the app shape', async () => {
    const list = await svc.boundary().listRaces();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      filename: 'races/2024-11-05/governor.csv',
      raceFile: 'races/2024-11-05/governor.csv',
      turnoutFile: 'turnout/2024-11-05.csv',
      displayName: 'Governor 2024',
      year: 2024,
      category: 'State', // manifest category kept verbatim — no override
      raceKey: 'gov-2024',
      _v3: true,
    });
  });

  it('caches the manifest (one fetch for two calls)', async () => {
    const h = svc.boundary();
    await h.listRaces();
    await h.listRaces();
    expect(fetchCalls('elections.json')).toBe(1);
  });

  it('still normalizes a legacy bare-array manifest (category falls back)', async () => {
    fetchRoutes['collin/2026/elections.json'] = ['Governor_2024.csv'];
    const list = await svc.boundary().listRaces();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ filename: 'Governor_2024.csv', year: 2024, category: 'County' });
    expect(list[0]._v3).toBeUndefined();
  });
});

// ============================================================================
// loadRace — v3 pivot path
// ============================================================================

describe('loadRace — v3 pivot path', () => {
  it('pivots race + turnout CSVs into legacy rows with winners', async () => {
    const rows = await svc.boundary().loadRace(govEntry());
    expect(rows).toHaveLength(2); // blank CSV line must not create a phantom row

    expect(rows[0]).toEqual({
      'PRECINCT CODE': '1',
      'REGISTERED VOTERS TOTAL': '1000',
      'BALLOTS CAST TOTAL': '700',
      'BALLOTS CAST BLANK': '5',
      'Write-in': '3',
      'DEM Beto "B" O\'Rourke': '600', // RFC-4180 "" unescaped by the parser
      'REP Abbott, Greg': '500',       // quoted comma survived
      'Winning Candidate': 'DEM Beto "B" O\'Rourke',
      'Winning Party': 'DEM',
    });
    expect(rows[1]['Winning Candidate']).toBe('REP Abbott, Greg');
    expect(rows[1]['Write-in']).toBe('0'); // filled default when column exists
    expect(rows[1]['BALLOTS CAST TOTAL']).toBe('450');
  });

  it('resolves a bare filename string through this handle\'s manifest, awaited internally', async () => {
    // NO prior listRaces() call — the handle must await its own manifest
    // instead of silently falling through to the legacy wide-CSV shape.
    const rows = await svc.boundary().loadRace('races/2024-11-05/governor.csv');
    expect(fetchCalls('collin/2026/elections.json')).toBe(1);
    expect(rows[0]['PRECINCT CODE']).toBe('1');
    expect(rows[0]['Winning Party']).toBe('DEM'); // pivoted → v3 route was taken
  });

  it('rejects a bare filename that is not in the manifest', async () => {
    await expect(svc.boundary().loadRace('typo.csv')).rejects.toThrow(
      'Unknown race in 2026 manifest: typo.csv'
    );
  });

  it('caches per race file (two loads → one fetch, same array)', async () => {
    const h = svc.boundary();
    const first = await h.loadRace(govEntry());
    const second = await h.loadRace(govEntry());
    expect(second).toBe(first);
    expect(fetchCalls('governor.csv')).toBe(1);
  });

  it('fetches a shared turnout file only once across races', async () => {
    const h = svc.boundary();
    await h.loadRace(govEntry());
    await h.loadRace(normalizedEntry(MANIFEST.elections[1]));
    expect(fetchCalls('turnout/2024-11-05.csv')).toBe(1);
  });

  it('leaves turnout columns as honest empty strings when there is no turnout file', async () => {
    const rows = await svc.boundary().loadRace({ ...govEntry(), turnoutFile: null });
    expect(rows[0]['REGISTERED VOTERS TOTAL']).toBe('');
    expect(rows[0]['BALLOTS CAST TOTAL']).toBe('');
    expect(fetchCalls('turnout/')).toBe(0);
  });

  it('survives a missing turnout file (warns, turnout columns empty, votes intact)', async () => {
    fetchRoutes['turnout/2024-11-05.csv'] = null;
    const rows = await svc.boundary().loadRace(govEntry());
    expect(rows[0]['BALLOTS CAST TOTAL']).toBe('');
    expect(rows[0]['Winning Party']).toBe('DEM');
  });

  it('rejects invalid arguments', async () => {
    const h = svc.boundary();
    await expect(h.loadRace(null)).rejects.toThrow(
      'loadRace requires a filename string or manifest entry object'
    );
    await expect(h.loadRace({})).rejects.toThrow(/requires a filename/);
  });
});

// ============================================================================
// loadRace — legacy wide-CSV path + CSV parsing
// ============================================================================

describe('loadRace — legacy wide CSV path', () => {
  it('parses CRLF, padded headers, quoted commas, RFC-4180 quotes, and short rows', async () => {
    const rows = await svc.boundary().loadRace({ filename: 'Governor_Legacy.csv' });
    expect(global.fetch.mock.calls[0][0]).toBe('data/tx/collin/2026/Governor_Legacy.csv');

    expect(rows).toHaveLength(2);
    expect(rows[0]['PRECINCT CODE']).toBe('101'); // header whitespace trimmed
    expect(rows[0]['PRECINCT NAME']).toBe('He said "howdy", twice'); // "" → literal "
    expect(rows[0]['REP John Roe']).toBe('300');
    // Short row: missing trailing values become '' (never undefined)
    expect(rows[1]['DEM Jane Doe']).toBe('250');
    expect(rows[1]['REP John Roe']).toBe('');
  });

  it('returns [] for a header-only CSV', async () => {
    const rows = await svc.boundary().loadRace({ filename: 'Empty.csv' });
    expect(rows).toEqual([]);
  });
});

describe('parseCSVLine (RFC-4180)', () => {
  it('unescapes doubled quotes inside quoted fields', () => {
    expect(svc.parseCSVLine('a,"b""c",d')).toEqual(['a', 'b"c', 'd']);
    expect(svc.parseCSVLine('"She said ""hi"", twice",2')).toEqual(['She said "hi", twice', '2']);
    expect(svc.parseCSVLine('""""')).toEqual(['"']);
  });

  it('still handles plain quoted commas and unquoted fields', () => {
    expect(svc.parseCSVLine('1,"Abbott, Greg",500')).toEqual(['1', 'Abbott, Greg', '500']);
    expect(svc.parseCSVLine('a, b ,c')).toEqual(['a', 'b', 'c']);
  });
});

// ============================================================================
// loadAll
// ============================================================================

describe('loadAll', () => {
  it('merges GeoJSON with DNC, racial, and precinct metadata (2026)', async () => {
    const { geojson, dncLookup, racialLookup } = await svc.boundary().loadAll();

    expect(geojson.features).toHaveLength(2);
    const p1 = geojson.features[0].properties;
    expect(p1).toMatchObject({ PRECINCT: '1', rep: 100, dem: 200, winningParty: 'Dem' });
    expect(p1.pct_asian).toBeCloseTo(0.061);
    expect(p1.total).toBe(165);

    // Metadata only exists for precinct 2
    expect(geojson.features[1].properties._meta).toEqual({ quality: 'interpolated' });
    expect(geojson.features[0].properties._meta).toBeUndefined();

    expect(Object.keys(dncLookup)).toEqual(['1']);
    expect(Object.keys(racialLookup)).toEqual(['1']);
  });

  it('caches the merged result (second call → no extra fetch)', async () => {
    const h = svc.boundary();
    const first = await h.loadAll();
    global.fetch.mockClear();
    global.d3.csv.mockClear();
    const second = await h.loadAll();
    expect(second).toBe(first);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(global.d3.csv).not.toHaveBeenCalled();
  });

  it('treats profile extras as optional and skips metadata off the 2026 set', async () => {
    // No d3 routes exist for the 2024 profile dir → dnc/racial rejections
    const { geojson, dncLookup, racialLookup } = await svc.boundary('original').loadAll();
    expect(geojson.features).toHaveLength(2);
    expect(dncLookup).toEqual({});
    expect(racialLookup).toEqual({});
    expect(geojson.features[0].properties.rep).toBeUndefined();
    // Non-2026 boundary: metadata is never even requested
    expect(fetchCalls('precinct_metadata.json')).toBe(0);
  });
});

// ============================================================================
// PRIMARY TURNOUT (optional profile extra)
// ============================================================================

describe('loadPrimaryTurnout', () => {
  it('builds a precinct → year → {dem, rep} lookup, skipping blank precincts', async () => {
    const lookup = await svc.boundary().loadPrimaryTurnout();
    expect(lookup).toEqual({
      1: {
        2022: { dem: 120, rep: 300 },
        2024: { dem: 150, rep: 280 },
      },
    });
  });

  it('caches the lookup (one d3.csv read)', async () => {
    const h = svc.boundary();
    await h.loadPrimaryTurnout();
    await h.loadPrimaryTurnout();
    expect(global.d3.csv).toHaveBeenCalledTimes(1);
  });

  it('returns null when the file is absent, and caches the null', async () => {
    const h = svc.boundary('original'); // no primary_turnout route for 2024
    expect(await h.loadPrimaryTurnout()).toBeNull();
    global.d3.csv.mockClear();
    expect(await h.loadPrimaryTurnout()).toBeNull();
    expect(global.d3.csv).not.toHaveBeenCalled();
  });
});

// ============================================================================
// TURNOUT LOOKUP (campaign dashboard baselines)
// ============================================================================

describe('loadTurnoutLookup', () => {
  it('builds a numeric {registered, ballots} lookup keyed by precinct string', async () => {
    const lookup = await svc.boundary().loadTurnoutLookup('turnout/2024-11-05.csv');
    expect(lookup).toEqual({
      1: { registered: 1000, ballots: 700 },
      2: { registered: 800, ballots: 450 },
    });
  });

  it('parses quoted thousands separators, keeps blanks null, skips blank precincts', async () => {
    const lookup = await svc.boundary().loadTurnoutLookup('turnout/2022.csv');
    expect(lookup['1']).toEqual({ registered: 1000, ballots: 700 });
    expect(lookup['2']).toEqual({ registered: 800, ballots: null }); // honest null, not 0
    expect(Object.keys(lookup)).toEqual(['1', '2']); // blank precinct row skipped
  });

  it('caches per file (two calls → one fetch)', async () => {
    const h = svc.boundary();
    await h.loadTurnoutLookup('turnout/2022.csv');
    await h.loadTurnoutLookup('turnout/2022.csv');
    expect(fetchCalls('turnout/2022.csv')).toBe(1);
  });

  it('shares the raw turnout cache with loadRace (same file → one fetch)', async () => {
    const h = svc.boundary();
    await h.loadRace(govEntry()); // fetches turnout/2024-11-05.csv
    await h.loadTurnoutLookup('turnout/2024-11-05.csv');
    expect(fetchCalls('turnout/2024-11-05.csv')).toBe(1);
  });

  it('resolves null for a missing file and for no filename', async () => {
    fetchRoutes['turnout/2022.csv'] = null;
    expect(await svc.boundary().loadTurnoutLookup('turnout/2022.csv')).toBeNull();
    expect(await svc.boundary().loadTurnoutLookup(null)).toBeNull();
  });
});

// ============================================================================
// PRECINCT HISTORY + BASELINES + safePrecinctName
// ============================================================================

describe('safePrecinctName', () => {
  it('sanitizes codes the way the pipeline does', () => {
    expect(svc.safePrecinctName('collin:1')).toBe('collin_1');
    expect(svc.safePrecinctName('PCT 12/A')).toBe('PCT_12_A');
    expect(svc.safePrecinctName('A-1_b.2')).toBe('A-1_b.2'); // allowed chars kept
    expect(svc.safePrecinctName(42)).toBe('42');
  });
});

describe('loadPrecinctRaces', () => {
  it('fetches the sanitized history file and wraps each race row in a 1-element array', async () => {
    const map = await svc.boundary().loadPrecinctRaces('collin:1');
    expect(fetchCalls('2026/history/collin_1.json')).toBe(1);
    expect(map).toEqual({
      'races/2024-11-05/governor.csv': [
        { 'PRECINCT CODE': '1', 'DEM Beto': '600' },
      ],
    });
  });

  it('caches per precinct', async () => {
    const h = svc.boundary();
    await h.loadPrecinctRaces('collin:1');
    await h.loadPrecinctRaces('collin:1');
    expect(fetchCalls('history/collin_1.json')).toBe(1);
  });

  it('returns {} for a precinct with no history file', async () => {
    expect(await svc.boundary().loadPrecinctRaces('999')).toEqual({});
  });
});

describe('loadCountyBaselines', () => {
  it('returns the parsed baseline map and caches it', async () => {
    const h = svc.boundary();
    const baselines = await h.loadCountyBaselines();
    expect(baselines).toEqual(BASELINES);
    await h.loadCountyBaselines();
    expect(fetchCalls('history/county_baselines.json')).toBe(1);
  });

  it('returns {} when the file is missing', async () => {
    fetchRoutes['history/county_baselines.json'] = null;
    expect(await svc.boundary().loadCountyBaselines()).toEqual({});
  });
});
