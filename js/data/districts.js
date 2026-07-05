// js/data/districts.js
// --------------------------------------------------------------------------------
// Districts as SCOPING, not places (REDESIGN.md §5.2). The pseudo-county
// masquerade (districts.json concatenated into the county registry) dies;
// what survives is:
//
//   - precinct <-> CD/SD/HD membership straight from the boundary GeoJSON's
//     per-precinct CONG/SEN/SHR properties (no crosswalk needed — values are
//     plain district numbers, e.g. CONG: 3, SEN: 8, SHR: 67);
//   - district race results — including the out-of-county "<county>:ALL"
//     aggregate rows and real "<county>:<precinct>" rows that exist nowhere
//     else — loaded from the data/tx/districts/<slug>/ trees.
//
// The loadDistrict* functions are ports of the commandCenter.js originals
// (the lead deletes those when migrating commandCenter). All fetches are
// memoized with the no-cached-rejections rule (see dataService.memoize).

import { memoize, normalizeManifest } from "./dataService.js";

/** The 12 Collin-touching districts we keep data for (data/tx/districts/). */
export const DISTRICT_LIST = Object.freeze([
  { slug: "cd-3", name: "Congressional District 3", group: "Congressional Districts", dataRoot: "data/tx/districts/cd-3" },
  { slug: "cd-4", name: "Congressional District 4", group: "Congressional Districts", dataRoot: "data/tx/districts/cd-4" },
  { slug: "cd-32", name: "Congressional District 32", group: "Congressional Districts", dataRoot: "data/tx/districts/cd-32" },
  { slug: "sd-2", name: "State Senate District 2", group: "State Senate Districts", dataRoot: "data/tx/districts/sd-2" },
  { slug: "sd-8", name: "State Senate District 8", group: "State Senate Districts", dataRoot: "data/tx/districts/sd-8" },
  { slug: "sd-30", name: "State Senate District 30", group: "State Senate Districts", dataRoot: "data/tx/districts/sd-30" },
  { slug: "hd-33", name: "State House District 33", group: "State House Districts", dataRoot: "data/tx/districts/hd-33" },
  { slug: "hd-61", name: "State House District 61", group: "State House Districts", dataRoot: "data/tx/districts/hd-61" },
  { slug: "hd-66", name: "State House District 66", group: "State House Districts", dataRoot: "data/tx/districts/hd-66" },
  { slug: "hd-67", name: "State House District 67", group: "State House Districts", dataRoot: "data/tx/districts/hd-67" },
  { slug: "hd-70", name: "State House District 70", group: "State House Districts", dataRoot: "data/tx/districts/hd-70" },
  { slug: "hd-89", name: "State House District 89", group: "State House Districts", dataRoot: "data/tx/districts/hd-89" },
].map(Object.freeze));

/** District slugs with kept data trees (derived — always in sync with DISTRICT_LIST). */
export const KEPT_DISTRICTS = new Set(DISTRICT_LIST.map((d) => d.slug));

// Boundary GeoJSON property per district kind. Values are district numbers
// (numbers in today's files; zero-padded strings normalize the same way).
// comm = County Commissioner precincts (COMMISH 1–4) — membership/roll-up
// scoping only; there is NO data/tx/districts/comm-* race tree, so comm slugs
// must never reach the district tree loaders below.
const KIND_PROP = Object.freeze({ cd: "CONG", sd: "SEN", hd: "SHR", comm: "COMMISH" });

/**
 * The district kinds the campaign dashboard can roll precincts up by.
 * `prop` is the boundary GeoJSON property; `prefix` builds display labels
 * (e.g. "Commissioner Precinct 3").
 */
export const ROLLUP_KINDS = Object.freeze([
  { id: "hd", label: "State House", prop: "SHR", prefix: "State House District" },
  { id: "sd", label: "State Senate", prop: "SEN", prefix: "State Senate District" },
  { id: "cd", label: "Congressional", prop: "CONG", prefix: "Congressional District" },
  { id: "comm", label: "County Commissioner", prop: "COMMISH", prefix: "Commissioner Precinct" },
].map(Object.freeze));

/**
 * The district slug a precinct feature belongs to, for one district kind.
 * @param {object} feature - GeoJSON precinct feature (CONG/SEN/SHR/COMMISH props)
 * @param {"cd"|"sd"|"hd"|"comm"} kind
 * @returns {string|null} e.g. "cd-3" / "comm-2", or null when unknown/absent
 */
export function districtOfFeature(feature, kind) {
  const prop = KIND_PROP[kind];
  if (!prop) return null;
  const raw = feature?.properties?.[prop];
  if (raw == null || raw === "") return null;
  const n = Number(raw); // normalize numbers AND zero-padded strings ("03" -> 3)
  if (!Number.isFinite(n)) return null;
  return `${kind}-${n}`;
}

/**
 * Precinct codes (as strings) of the features inside a district.
 * @param {string} slug - e.g. "cd-3", "sd-8", "hd-67", "comm-2"
 * @param {Array<object>} geojsonFeatures - boundary GeoJSON features
 * @returns {string[]} precinct codes; [] for an unparseable slug
 */
export function precinctsInDistrict(slug, geojsonFeatures) {
  const m = /^(cd|sd|hd|comm)-(\d+)$/.exec(String(slug ?? ""));
  if (!m) return [];
  const want = `${m[1]}-${Number(m[2])}`;
  const out = [];
  for (const f of geojsonFeatures || []) {
    if (districtOfFeature(f, m[1]) === want) out.push(String(f.properties.PRECINCT));
  }
  return out;
}

/**
 * Federal / state DISTRICT races span multiple counties. Map a Collin race
 * manifest entry to its district slug so the non-Collin counties' results can
 * be pulled in. Returns null for non-district races and districts we don't
 * keep data for. (Ported from commandCenter.js.)
 */
export function districtSlugFor(entry) {
  const office = (entry.office || "").toLowerCase();
  const d = entry.district;
  if (d == null || d === "") return null;
  let slug = null;
  if (office.includes("representative") && (office.includes("united states") || office.includes("u.s") || office.includes("u s") || office.includes("congress"))) slug = `cd-${d}`;
  else if (office.includes("senator") || office.includes("senate")) slug = `sd-${d}`;
  else if (office.includes("representative")) slug = `hd-${d}`; // state house (after US handled)
  return slug && KEPT_DISTRICTS.has(slug) ? slug : null;
}

// ---------------------------------------------------------------------------
// District tree fetches (memoized; rejections never cached)
// ---------------------------------------------------------------------------

const cache = new Map();

/**
 * List a district tree's extra races as normalized manifest entries —
 * powers "district scope adds that district's extra races". Memoized per
 * slug; throws on an unknown slug or a failed manifest fetch.
 * @param {string} slug - e.g. "cd-3"
 * @returns {Promise<Array<object>>}
 */
export async function listDistrictRaces(slug) {
  const district = DISTRICT_LIST.find((d) => d.slug === slug);
  if (!district) throw new Error(`Unknown district: ${slug}`);
  return memoize(cache, `races:${slug}`, async () => {
    const res = await fetch(`${district.dataRoot}/data/elections.json`);
    if (!res.ok) {
      throw new Error(`Failed to load district manifest for ${slug}: ${res.statusText}`);
    }
    return normalizeManifest(await res.json());
  });
}

/**
 * Load the non-Collin counties' results for a district race. The district
 * data keeps Collin at precinct level and every other county either collapsed
 * to "<county>:ALL" rows or at real "<county>:<precinct>" granularity —
 * exactly the multi-county info to fold back in. (Ported verbatim from
 * commandCenter.js; memoized per (slug, raceFile).)
 * @param {string} slug - district slug, e.g. "cd-3"
 * @param {string} raceFile - manifest raceFile, e.g. "races/Governor_2022.csv"
 * @returns {Promise<{byCounty: Array, byPrecinct: Object}>}
 */
export function loadDistrictAggregates(slug, raceFile) {
  return memoize(cache, `agg:${slug}/${raceFile}`, async () => {
    try {
      const txt = await fetch(`data/tx/districts/${slug}/data/${raceFile}`).then((r) => (r.ok ? r.text() : null));
      if (!txt) return { byCounty: [], byPrecinct: {} };
      const lines = txt.trim().split("\n");
      const agg = {};       // countySlug -> running county total
      const pre = {};       // full code "hunt:101" -> { rep, dem, total }
      for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(",");
        const pc = c[0];
        // Fold in every non-Collin row — whether a collapsed "<county>:ALL" total
        // or real "<county>:<precinct>" rows (e.g. Hunt's official Clarity data) —
        // so the county outline/dock total is correct at any granularity.
        if (!pc || !pc.includes(":")) continue;
        const county = pc.split(":")[0];
        if (county === "collin") continue;
        const party = (c[1] || "").toUpperCase();
        if (!party) continue; // skip Over/Under/Write-in
        const votes = +c[3] || 0;
        const a = agg[county] || (agg[county] = { county, rep: 0, dem: 0, total: 0 });
        a.total += votes;
        if (party === "REP") a.rep += votes;
        else if (party === "DEM") a.dem += votes;
        if (!pc.endsWith(":ALL")) { // real precinct row → keep per-precinct result too
          const p = pre[pc] || (pre[pc] = { rep: 0, dem: 0, total: 0 });
          p.total += votes;
          if (party === "REP") p.rep += votes;
          else if (party === "DEM") p.dem += votes;
        }
      }
      const byCounty = Object.values(agg).filter((a) => a.total > 0).map((a) => ({ ...a, winner: a.rep >= a.dem ? "Rep" : "Dem" }));
      const byPrecinct = {};
      for (const code in pre) {
        const p = pre[code];
        if (p.total <= 0) continue;
        byPrecinct[code] = { ...p, winner: p.rep >= p.dem ? "Rep" : "Dem", margin: Math.abs(p.rep - p.dem) / p.total };
      }
      return { byCounty, byPrecinct };
    } catch (_) {
      return { byCounty: [], byPrecinct: {} };
    }
  });
}

/**
 * Real precinct geometry for non-Collin counties we've sourced (Hunt CD-3 so
 * far, data_processor/fetch_district_county_precincts.py). Absent → those
 * counties fall back to a county outline. (Ported from commandCenter.js.)
 * @returns {Promise<object|null>} GeoJSON or null
 */
export function loadDistrictPrecinctGeo(slug) {
  return memoize(cache, `precinctGeo:${slug}`, async () => {
    try {
      return await fetch(`data/tx/districts/${slug}/boundaries/other_precincts.geojson`).then((r) => (r.ok ? r.json() : null));
    } catch (_) {
      return null;
    }
  });
}

/**
 * Dissolved outline of each non-Collin county's portion of the district
 * (built from the pre-reduction precinct geometry —
 * data_processor/build_district_county_outlines.py). One feature per county,
 * keyed "<county-slug>:ALL" to join the aggregate result. (Ported from
 * commandCenter.js.)
 * @returns {Promise<object|null>} GeoJSON or null
 */
export function loadDistrictOutlines(slug) {
  return memoize(cache, `outlines:${slug}`, async () => {
    try {
      return await fetch(`data/tx/districts/${slug}/boundaries/county_outlines.geojson`).then((r) => (r.ok ? r.json() : null));
    } catch (_) {
      return null;
    }
  });
}
