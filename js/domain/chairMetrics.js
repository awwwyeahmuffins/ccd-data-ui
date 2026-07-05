// domain/chairMetrics.js
// --------------------------------------------------------------------------------
// Pure math for the Precinct Chair dashboard (chair.html): turnout-propensity
// bands, the 3x3 universe matrix, the chair's focus badge, the volunteer-pool
// proxy, inactive-voter summaries, and vote-center geometry. No fetch, no DOM — the
// page orchestrator (js/chairPage.js) supplies loaded data as arguments.
//
// Data honesty (repo rule: never fabricate): every function returns null (or
// [] for list shapes) when its inputs are missing, and every count built from
// precinct aggregates is a MODELED ESTIMATE — the only per-voter data on file
// is the dnc_scores Rep/Mod/Dem bucket counts and per-precinct ballot totals.
// The UI labels these estimates as such; keep it that way.

import { formatNumber } from "../lib/format.js";

// ============================================================================
// Turnout propensity bands
// ============================================================================

// Classic two-election propensity decomposition — no invented rates. Given the
// precinct's marquee turnout row (highest-salience election on file, e.g. a
// presidential) and a low-salience row (e.g. a municipal year):
//   high = voted even in the low-salience election  → lowBallots / registered
//   mid  = marquee-only voters                      → (marqueeBallots − lowBallots) / registered
//   low  = sat out even the marquee                 → 1 − marqueeBallots / registered
// The marquee's registered count is the denominator throughout (the most
// recent snapshot); bands are clamped to [0,1] and renormalized because the
// two files' registration snapshots come from different years.
// With only one turnout file, degrades to the single-rate model (mode
// "single"): high = rate, mid = 1 − rate, low = 0.
export function turnoutBands({ marquee, lowSalience } = {}) {
  const reg = toCount(marquee?.registered);
  const marqueeBallots = toCount(marquee?.ballots);
  if (reg == null || reg <= 0 || marqueeBallots == null) return null;

  const marqueeRate = clamp01(marqueeBallots / reg);
  const lowBallots = toCount(lowSalience?.ballots);

  let high, mid, low, mode;
  if (lowBallots == null) {
    mode = "single";
    high = marqueeRate;
    mid = 1 - marqueeRate;
    low = 0;
  } else {
    mode = "two-file";
    high = clamp01(lowBallots / reg);
    mid = clamp01((marqueeBallots - lowBallots) / reg);
    low = clamp01(1 - marqueeRate);
  }

  const sum = high + mid + low;
  if (sum > 0) {
    high /= sum;
    mid /= sum;
    low /= sum;
  }
  return { high, mid, low, marqueeRate, mode };
}

// ============================================================================
// 3x3 universe matrix
// ============================================================================

export const MATRIX_PARTIES = Object.freeze(["dem", "mod", "rep"]);
export const MATRIX_BANDS = Object.freeze(["high", "mid", "low"]);

// Canvassing role per cell — the highlighted universes:
//   base       = strong Dem × high propensity (thank + recruit)
//   gotv       = strong Dem × mid/low propensity (turn them out)
//   persuasion = moderate × high/mid propensity (they vote; they're movable)
const CELL_ROLES = Object.freeze({
  "dem:high": "base",
  "dem:mid": "gotv",
  "dem:low": "gotv",
  "mod:high": "persuasion",
  "mod:mid": "persuasion",
});

// party = a dnc_scores row with { rep, mod, dem } modeled voter COUNTS.
// Cell count = partyCount × bandWeight, rounded — assumes turnout propensity
// is independent of partisanship within the precinct (a modeled estimate; the
// UI must label it).
export function buildUniverseMatrix({ party, bands } = {}) {
  if (!bands) return null;
  const counts = {
    dem: toCount(party?.dem),
    mod: toCount(party?.mod),
    rep: toCount(party?.rep),
  };
  if (MATRIX_PARTIES.every((p) => counts[p] == null)) return null;

  const cells = [];
  const roles = { base: 0, gotv: 0, persuasion: 0 };
  const totals = { dem: 0, mod: 0, rep: 0, all: 0 };

  for (const p of MATRIX_PARTIES) {
    for (const b of MATRIX_BANDS) {
      const role = CELL_ROLES[`${p}:${b}`] || null;
      const count = counts[p] == null ? null : Math.round(counts[p] * bands[b]);
      cells.push({ party: p, band: b, count, role });
      if (count != null) {
        totals[p] += count;
        totals.all += count;
        if (role) roles[role] += count;
      }
    }
  }
  return { cells, totals, roles, mode: bands.mode };
}

// ============================================================================
// Focus badge
// ============================================================================

// The chair's two working modes plus a long-game fallback, collapsed from
// precinctLookup's classifyStrategy decision tree (mobilize when the Dem base
// is big, persuade when the precinct is competitive) using only the data this
// page has on hand (dnc shares + turnout bands — no PVI here).
//   lean = demShare − repShare
//   lean ≥ +15 pts            → Turnout Focus (win by turning out the base)
//   lean in (−10, +15) pts    → Persuasion Focus (margins are tight)
//   lean ≤ −10 pts            → Build & Register (long-term growth)
export function classifyChairFocus({ party, bands } = {}) {
  const demShare = toShare(party?.demShare);
  const repShare = toShare(party?.repShare);
  if (demShare == null || repShare == null) return null;

  const lean = demShare - repShare;
  const pts = (x) => Math.abs(Math.round(x * 100));

  if (lean >= 0.15) {
    const turnoutNote =
      bands && bands.marqueeRate < 0.55
        ? " and turnout has room to grow"
        : "";
    return {
      id: "turnout",
      label: "Turnout Focus",
      rationale: `Democrats outnumber Republicans here by about ${pts(lean)} points${turnoutNote} — getting your own voters to the polls is the whole game.`,
    };
  }
  if (lean > -0.1) {
    return {
      id: "persuasion",
      label: "Persuasion Focus",
      rationale: `The two parties are about ${pts(lean)} points apart — close enough that conversations with undecided voters can decide it.`,
    };
  }
  return {
    id: "build",
    label: "Build & Register",
    rationale: `Republicans lead here by about ${pts(lean)} points — the best use of time is registering new voters and building for future cycles.`,
  };
}

// ============================================================================
// Likely-volunteer proxy
// ============================================================================

// There is no volunteer-propensity data on file. This is the standard field
// proxy — strong partisans who vote in nearly every election are the pool
// chairs recruit from — and it must always render with its method label.
export function estimateVolunteerPool({ party, bands } = {}) {
  const dem = toCount(party?.dem);
  if (dem == null || !bands) return null;
  return {
    pool: Math.round(dem * bands.high),
    method:
      "Strong Democratic voters who vote in nearly every election — the usual pool volunteers come from",
  };
}

// ============================================================================
// Inactive voters
// ============================================================================

// row = a field_ops.csv row as loaded: { active, inactive, share }.
// inactive may be blank in the CSV (small-cell suppression) — that's null,
// not zero.
export function summarizeInactive(row) {
  const count = toCount(row?.inactive);
  if (count == null) return null;
  const activeCount = toCount(row?.active);
  const share =
    activeCount != null && activeCount + count > 0
      ? count / (activeCount + count)
      : null;
  return { count, activeCount, share };
}

// Plain-text snippet a chair can paste into a text message at the door. The
// count line is omitted when no count is on file — never fabricate.
export function inactiveDoorSnippet({ code, count, sosUrl } = {}) {
  if (!sosUrl) return null;
  const lines = [];
  if (code != null && code !== "") {
    lines.push(`Precinct ${code} neighbor —`);
  }
  if (toCount(count) != null) {
    lines.push(
      `About ${formatNumber(count)} voters in this precinct are marked "inactive," usually because the county has an old address for them.`
    );
  } else {
    lines.push(
      `If you've moved since you last voted, the county may have an old address for you ("inactive" status).`
    );
  }
  lines.push(
    `You can fix your voter registration address online in about 2 minutes:`,
    sosUrl,
    `It's free, official (Texas Secretary of State), and keeps your ballot from being delayed.`
  );
  return lines.join("\n");
}

// ============================================================================
// Geometry — nearest vote centers (plain math, no d3)
// ============================================================================

// Shoelace-weighted centroid of the largest outer ring. Good enough for
// "which vote centers are closest" — this is not a surveying tool.
// Accepts GeoJSON Polygon or MultiPolygon geometry; returns { lat, lng } | null.
export function featureCentroid(geometry) {
  const rings = outerRings(geometry);
  if (!rings.length) return null;

  let best = null;
  let bestArea = 0;
  for (const ring of rings) {
    const c = ringCentroid(ring);
    if (c && Math.abs(c.area) > bestArea) {
      bestArea = Math.abs(c.area);
      best = c;
    }
  }
  return best ? { lat: best.lat, lng: best.lng } : null;
}

// Great-circle distance in miles between two { lat, lng } points.
export function haversineMiles(a, b) {
  if (!isPoint(a) || !isPoint(b)) return null;
  const R = 3958.8; // Earth radius, miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// centers = voting_info.json voteCenters. Skips entries without finite
// coordinates; returns [] when the centroid or the list is missing.
export function nearestVoteCenters(centroid, centers, limit = 3) {
  if (!isPoint(centroid) || !Array.isArray(centers)) return [];
  return centers
    .filter((c) => isPoint({ lat: Number(c?.lat), lng: Number(c?.lng) }))
    .map((c) => ({
      ...c,
      distanceMiles: haversineMiles(centroid, {
        lat: Number(c.lat),
        lng: Number(c.lng),
      }),
    }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, limit);
}

// ============================================================================
// Internals
// ============================================================================

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function toCount(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toShare(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? clamp01(n) : null;
}

function isPoint(p) {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

function outerRings(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === "Polygon") {
    return geometry.coordinates.length ? [geometry.coordinates[0]] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((poly) => poly && poly[0]).filter(Boolean);
  }
  return [];
}

// Standard shoelace centroid over a [lng, lat] ring. Falls back to the vertex
// mean for degenerate (near-zero-area) rings.
function ringCentroid(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-12) {
    const n = ring.length;
    const mx = ring.reduce((s, p) => s + p[0], 0) / n;
    const my = ring.reduce((s, p) => s + p[1], 0) / n;
    return { lng: mx, lat: my, area: 0 };
  }
  return { lng: cx / (6 * area), lat: cy / (6 * area), area };
}
