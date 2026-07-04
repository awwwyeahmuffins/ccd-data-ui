// js/data/dataService.js
// --------------------------------------------------------------------------------
// The data layer's per-boundary service (REDESIGN.md §5.1) — replaces
// dataLoader.js's global-wipe singleton. Each boundary set gets one memoized
// handle; switching boundaries is just asking for a different handle, nothing
// is ever wiped, and the old handle stays warm (instant switch-back).
//
// Usage:
//   import { boundary } from "./data/dataService.js";
//   const svc = boundary("2026");            // or boundary() for the default
//   const { geojson } = await svc.loadAll();
//   const races = await svc.listRaces();
//   const rows = await svc.loadRace(races[0]);
//
// Memoization contract: every load is cached per handle, but a REJECTED load
// clears its cache slot so the next call refetches (dataLoader cached
// rejections forever — a transient network error bricked the app until
// reload; that bug is fixed here for every memo slot).

import { BOUNDARY_SETS, DEFAULT_BOUNDARY, COUNTY } from "./catalog.js";
import {
  isV3Manifest,
  normalizeV3Entry,
  normalizeManifestEntry,
  buildCSVPath,
} from "../electionSchema.js";
import { pivotRace, computeWinners } from "../v3Pivot.js";

// ---------------------------------------------------------------------------
// Shared helpers (also used by ./districts.js — same layer)
// ---------------------------------------------------------------------------

/**
 * Memoize a promise-producing function in `cache` under `key`, with the
 * no-cached-rejections rule: if the produced promise rejects, its slot is
 * cleared so a retry refetches instead of replaying the stale failure.
 * @param {Map<string, Promise>} cache
 * @param {string} key
 * @param {() => Promise<any>|any} producer
 * @returns {Promise<any>}
 */
export function memoize(cache, key, producer) {
  if (!cache.has(key)) {
    const promise = Promise.resolve().then(producer);
    promise.catch(() => {
      if (cache.get(key) === promise) cache.delete(key);
    });
    cache.set(key, promise);
  }
  return cache.get(key);
}

/**
 * Normalize a raw elections manifest (v3 object wrapper or legacy bare array)
 * into the app's entry shape.
 *
 * Layering note (REDESIGN.md §4.2): js/data may not import js/domain, so the
 * real categorizeElection is unavailable here BY DESIGN. That is safe:
 * every Collin v3 manifest entry carries an explicit `category` (verified
 * 587/587 in 2026, 450/450 in 2024, and all district manifests), so the
 * injected categorizer is dead weight on the v3 path. The trivial "County"
 * fallback only fires for a hypothetical legacy entry with no category.
 * The old categorizeByOffice override existed only for pseudo-county
 * manifests and is deleted with them (REDESIGN.md §5.1).
 * @param {object|Array} rawManifest
 * @returns {Array<object>} normalized entries
 */
export function normalizeManifest(rawManifest) {
  const fallbackCategorize = () => "County";
  if (isV3Manifest(rawManifest)) {
    return rawManifest.elections
      .map((e) => normalizeV3Entry(e, fallbackCategorize))
      .filter(Boolean);
  }
  if (!Array.isArray(rawManifest)) return [];
  return rawManifest
    .map((e) => normalizeManifestEntry(e, fallbackCategorize))
    .filter((e) => e != null);
}

/**
 * Filesystem/URL-safe precinct file stem. MUST mirror data_processor/
 * build_precinct_history.py safe_name() so the client fetches the file the
 * pipeline wrote (e.g. district code "collin:1" -> "collin_1.json").
 */
export function safePrecinctName(code) {
  return String(code).replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Parse a single CSV line, handling quoted fields with commas and RFC-4180
 * escaped quotes ("" inside a quoted field -> a literal ").
 * @param {string} line
 * @returns {string[]} field values
 */
export function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'; // RFC-4180 escaped quote
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/** Fetch and parse a CSV into row objects (string values). */
async function fetchCSVRows(csvPath) {
  const resp = await fetch(csvPath);
  if (!resp.ok) {
    throw new Error(`Could not load CSV ${csvPath}: ${resp.statusText}`);
  }
  const text = await resp.text();

  // Handle Windows CRLF line endings
  const lines = text.trim().replace(/\r\n/g, "\n").split("\n");
  if (lines.length < 2) return []; // no data

  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(function buildRowObject(line) {
    const values = parseCSVLine(line);
    const obj = {};
    for (const [idx, h] of headers.entries()) {
      obj[h] = values[idx] ?? "";
    }
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Per-boundary handles
// ---------------------------------------------------------------------------

const handles = new Map(); // boundaryId -> handle

/**
 * Get the memoized handle for a boundary set. Throws on an unknown id.
 * @param {string} [id] - "original" | "2026" (defaults to DEFAULT_BOUNDARY)
 */
export function boundary(id = DEFAULT_BOUNDARY) {
  if (!BOUNDARY_SETS[id]) {
    throw new Error(`Unknown boundary set: ${id}`);
  }
  if (!handles.has(id)) handles.set(id, makeHandle(id));
  return handles.get(id);
}

function makeHandle(id) {
  const config = BOUNDARY_SETS[id];
  const memo = new Map(); // every per-handle cache slot lives here

  /**
   * Load all base data (GeoJSON + DNC + racial profile extras), merged into
   * feature.properties. Profile extras are OPTIONAL — absent files render as
   * honest N/A, never a load failure. Precinct quality metadata is merged as
   * `_meta` on the 2026 boundaries only (the only set that has it).
   * @returns {Promise<{geojson, dncLookup, racialLookup}>}
   */
  function loadAll() {
    return memoize(memo, "allData", async () => {
      const geojsonPromise = fetch(config.geojson).then(function handleGeoJSONResponse(r) {
        if (!r.ok) throw new Error("Failed to fetch GeoJSON");
        return r.json();
      });

      const dncPromise = globalThis.d3.csv(
        `${config.profileDir}/dnc_scores.csv`,
        function parseDNCRow(d) {
          return {
            precinct: d.Precinct,
            rep: +d["Rep"],
            mod: +d["Mod"],
            dem: +d["Dem"],
            repShare: +d["Rep Share"],
            modShare: +d["Mod Share"],
            demShare: +d["Dem Share"],
            winningParty: d["Winning Party"],
            partyStrength: +d["Party Strength"],
          };
        }
      );

      const racialPromise = globalThis.d3.csv(
        `${config.profileDir}/racial.csv`,
        function parseRacialRow(d) {
          return {
            precinct: d.precinct,
            asian: +d.asian,
            black: +d.black,
            hispanic: +d.hispanic,
            others: +d.others,
            white: +d.white,
            total: +d.total,
            pct_asian: parseFloat(d.pct_asian) / 100 || 0,
            pct_black: parseFloat(d.pct_black) / 100 || 0,
            pct_hispanic: parseFloat(d.pct_hispanic) / 100 || 0,
            pct_others: parseFloat(d.pct_others) / 100 || 0,
            pct_white: parseFloat(d.pct_white) / 100 || 0,
          };
        }
      );

      const metadataPromise =
        id === "2026"
          ? fetch(`${config.profileDir}/precinct_metadata.json`)
              .then((r) => (r.ok ? r.json() : {}))
              .catch(() => ({}))
          : Promise.resolve({});

      const [geojson, dncData, racialData, precinctMetadata] = await Promise.all([
        geojsonPromise,
        dncPromise.catch(() => []),
        racialPromise.catch(() => []),
        metadataPromise,
      ]);

      const dncLookup = Object.fromEntries(dncData.map((d) => [String(d.precinct), d]));
      const racialLookup = Object.fromEntries(racialData.map((d) => [String(d.precinct), d]));

      for (const feature of geojson.features) {
        const key = String(feature.properties.PRECINCT);
        if (dncLookup[key]) Object.assign(feature.properties, dncLookup[key]);
        if (racialLookup[key]) Object.assign(feature.properties, racialLookup[key]);
        if (precinctMetadata[key]) {
          feature.properties._meta = precinctMetadata[key];
        }
      }

      console.log(
        `[DataService:${id}] loadAll: ${geojson.features.length} features, ` +
          `${Object.keys(dncLookup).length} DNC entries, ${Object.keys(racialLookup).length} racial entries`
      );
      return { geojson, dncLookup, racialLookup };
    });
  }

  /**
   * List this boundary set's races as normalized manifest entries.
   * @returns {Promise<Array<object>>}
   */
  function listRaces() {
    return memoize(memo, "races", async () => {
      const res = await fetch(`${config.dataDir}/elections.json`);
      if (!res.ok) {
        throw new Error(`Failed to load elections manifest: ${res.statusText}`);
      }
      return normalizeManifest(await res.json());
    });
  }

  /** Fetch a v3 turnout file, cached per path (many races share one). */
  function loadTurnoutFile(turnoutFile) {
    if (!turnoutFile) return null; // honest gap — pivot leaves turnout columns ''
    const path = `${config.dataDir}/${turnoutFile}`;
    return memoize(memo, `turnout:${path}`, () =>
      fetchCSVRows(path).catch((err) => {
        console.warn(`[DataService:${id}] turnout file missing: ${path}`, err);
        return null;
      })
    );
  }

  /**
   * Load one race's results as pivoted legacy rows (one object per precinct
   * with "<PARTY> <Candidate>" columns + winners). Cached per race file.
   *
   * A bare-string filename ALWAYS resolves through THIS handle's manifest
   * (awaited internally) — never a silent fall-through to the legacy
   * wide-CSV path with the wrong shape, which was a latent dataLoader bug
   * when the manifest wasn't warm yet.
   * @param {string|object} entryOrFilename - manifest entry, or its filename
   */
  async function loadRace(entryOrFilename) {
    let entry;
    if (typeof entryOrFilename === "string") {
      const races = await listRaces();
      entry = races.find((e) => e.filename === entryOrFilename);
      if (!entry) {
        throw new Error(`Unknown race in ${id} manifest: ${entryOrFilename}`);
      }
    } else if (
      entryOrFilename &&
      typeof entryOrFilename === "object" &&
      "filename" in entryOrFilename
    ) {
      entry = entryOrFilename;
    } else {
      throw new Error("loadRace requires a filename string or manifest entry object");
    }

    return memoize(memo, `race:${entry.filename}`, async () => {
      // v3 path: long race file + optional turnout file, pivoted to legacy rows
      if (entry._v3) {
        const [longRows, turnoutRows] = await Promise.all([
          fetchCSVRows(`${config.dataDir}/${entry.raceFile}`),
          loadTurnoutFile(entry.turnoutFile),
        ]);
        return computeWinners(pivotRace(longRows, turnoutRows));
      }
      // Legacy path: wide per-race CSV
      return fetchCSVRows(buildCSVPath(entry, config.dataDir));
    });
  }

  /**
   * Load a single precinct's precomputed election history in the legacy
   * `allElectionData` shape — { raceFile: [oneRowForThisPrecinct] }. Cached
   * per precinct; missing file (e.g. non-participating precinct) -> {}.
   */
  function loadPrecinctRaces(precinctCode) {
    const safe = safePrecinctName(precinctCode);
    return memoize(memo, `precinct:${safe}`, () =>
      fetch(`${config.dataDir}/history/${safe}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((doc) => {
          const map = {};
          if (doc && doc.races) {
            for (const [raceFile, row] of Object.entries(doc.races)) map[raceFile] = [row];
          }
          return map;
        })
        .catch(() => ({}))
    );
  }

  /**
   * Census profile extras (profile/census_profiles.json — optional; absent
   * throws and callers render N/A). Moved here from the dissolved
   * precinctProfile.js: fetch + per-boundary caching is this layer's job.
   */
  function loadCensusProfiles() {
    return memoize(memo, "censusProfiles", async () => {
      const resp = await fetch(`${config.profileDir}/census_profiles.json`);
      if (!resp.ok) throw new Error(`Failed to load census profiles: ${resp.status}`);
      return resp.json();
    });
  }

  /**
   * County-wide Dem-share baselines ({ raceFile: share }), used by computePVI.
   * Missing file -> {}.
   */
  function loadCountyBaselines() {
    return memoize(memo, "baselines", () =>
      fetch(`${config.dataDir}/history/county_baselines.json`)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))
    );
  }

  /**
   * Party-primary turnout by precinct (profile extra — optional, N/A when
   * absent). Resolves { [precinct]: { [year]: { dem, rep } } } or null when
   * not on file (the null is cached — absence is an answer, not a failure).
   */
  function loadPrimaryTurnout() {
    return memoize(memo, "primaryTurnout", async () => {
      try {
        const rows = await globalThis.d3.csv(
          `${config.profileDir}/primary_turnout.csv`,
          (d) => ({
            precinct: String(d.precinct),
            year: +d.year,
            dem: +d.dem_ballots,
            rep: +d.rep_ballots,
          })
        );
        const lookup = {};
        for (const r of rows) {
          if (!r.precinct || !r.year) continue;
          (lookup[r.precinct] ||= {})[r.year] = { dem: r.dem, rep: r.rep };
        }
        return Object.keys(lookup).length ? lookup : null;
      } catch (_) {
        return null; // not on file for this boundary set
      }
    });
  }

  /**
   * Field-ops aggregates by precinct (profile extra — optional, N/A when
   * absent; generated by data_processor/build_field_ops.py from the local
   * voter file). Resolves { [precinct]: { active, suspense, share } } or null
   * when not on file (the null is cached — absence is an answer, not a
   * failure). A blank suspense cell (small-cell suppression) stays null,
   * never zero.
   */
  function loadFieldOps() {
    return memoize(memo, "fieldOps", async () => {
      try {
        const rows = await globalThis.d3.csv(
          `${config.profileDir}/field_ops.csv`,
          (d) => ({
            precinct: String(d.precinct),
            active: d.active_voters === "" ? null : +d.active_voters,
            suspense: d.suspense_voters === "" ? null : +d.suspense_voters,
            share: d.suspense_share === "" ? null : +d.suspense_share,
          })
        );
        const lookup = {};
        for (const r of rows) {
          if (r.precinct) lookup[r.precinct] = r;
        }
        return Object.keys(lookup).length ? lookup : null;
      } catch (_) {
        return null; // not on file for this boundary set
      }
    });
  }

  /**
   * County-level voting information (election dates, early-voting window,
   * countywide vote centers) from the hand-maintained
   * data/tx/collin/voting_info.json. County-level because Collin runs
   * countywide vote centers — boundary vintage is irrelevant — but exposed on
   * the handle so pages keep a single data-service import. Absent or
   * malformed file resolves null (cached); callers render honest fallbacks,
   * never invented dates.
   */
  function loadVotingInfo() {
    return memoize(memo, "votingInfo", async () => {
      try {
        const resp = await fetch(COUNTY.votingInfo);
        if (!resp.ok) return null;
        const info = await resp.json();
        if (!info || typeof info !== "object") return null;
        if (!Array.isArray(info.voteCenters)) info.voteCenters = [];
        return info;
      } catch (_) {
        return null; // not on file
      }
    });
  }

  return {
    id,
    label: config.label,
    config,
    loadAll,
    listRaces,
    loadRace,
    loadPrecinctRaces,
    loadCensusProfiles,
    loadCountyBaselines,
    loadPrimaryTurnout,
    loadFieldOps,
    loadVotingInfo,
  };
}
