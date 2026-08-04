// map/swingLayer.js — the Trends page's swing map.
// --------------------------------------------------------------------------------
// A precinct polygon layer plus one ARROW per precinct showing how it MOVED
// between two cycles, sharing the app's one Leaflet stack (mapView).
//
// imports: lib + domain + the rest of map/ — never fetches, never touches page
// state. The GeoJSON and the swing series arrive as arguments.
//
// "Never colour alone" (CLAUDE.md): the reading is carried by GEOMETRY. Arrows
// sit on one 45 degree axis and point in opposite directions along it —
// Democratic movement up-and-right, Republican down-and-left — so direction
// survives greyscale and colour-vision deficiency. Length is the size of the
// move. Polygons stay quiet so the arrows read; the states that have NO arrow
// are the ones that get a pattern:
//
//   too few votes  -> dense cross-hatch (a margin off one or two ballots)
//   no comparison  -> light cross-hatch (on one cycle's ballot only)
//   filtered out   -> flat paper, no pattern (absence, not a value)
//
// Three silences that must not be confused, drawn differently on purpose:
// FILTERED OUT is hidden by the user's own question, TOO FEW VOTES has data
// that cannot support a percentage, NO COMPARISON was on one ballot only.

import { TREND_COLORS, SWING_BINS, swingBin } from "../domain/trends.js";
import { patternFill } from "./mapPatterns.js";
import { MAP_COSMETICS } from "./mapStyles.js";

// Bin index -> the fill colour from the shared trend ramp. Index order matches
// SWING_BINS: strong Rep, Rep, flat, Dem, strong Dem.
const BIN_COLORS = [
  TREND_COLORS.swingRep.dark,
  TREND_COLORS.swingRep.medium,
  TREND_COLORS.neutral,
  TREND_COLORS.swingDem.medium,
  TREND_COLORS.swingDem.dark,
];

// Pattern geometry for the two DATA SILENCES only. The swing bands themselves
// are drawn as arrows, not fills.
const SILENCE_PATTERNS = { tooFew: ["cross", 3], noComparison: ["cross", 1] };

// The three silences, kept visually distinct (see the header note).
const FILTERED_OUT = "#F2EEE6";
const NO_COMPARISON_BG = "#EFEBE2";
const TOO_FEW_BG = "#DCD4C4";

/**
 * Fill for one precinct.
 * @param {Object|null} row - that precinct's swing series row, or null
 * @param {Object} env - { svg } — the overlay SVG the patterns live in
 * @param {boolean} visible - false when the current filters exclude it
 */
// Precincts that DO have a swing sit on quiet paper: the arrows carry the
// reading, and a saturated fill underneath them would fight for the same
// attention and make the arrowheads hard to pick out.
const HAS_ARROW_BG = "#FBF8F2";

// The other maps stroke precincts in near-white (MAP_COSMETICS.stroke): their
// fills are saturated party colours, so a pale hairline reads as the divider.
// Here every fill is paper, and that stroke is LIGHTER than the fill it
// separates — the precincts stop having visible shapes at all. This map needs
// its own boundary: a warm grey at 3.5:1 on the paper fill, dark enough to
// draw the shape, recessive enough that the arrows still lead.
const SWING_STROKE = "#8C8477";

export function swingFill(row, env, visible = true) {
  if (!visible) return FILTERED_OUT;
  if (!row || row.swing == null) {
    return env?.svg ? patternFill(env.svg, "cross", 1, NO_COMPARISON_BG) : NO_COMPARISON_BG;
  }
  // A margin off one or two ballots per race is arithmetic, not a measurement.
  // Drawing it as a long arrow would be the map's biggest lie, so it gets its
  // own mark and no arrow at all.
  if (row.tinyElectorate) {
    return env?.svg ? patternFill(env.svg, "cross", 3, TOO_FEW_BG) : TOO_FEW_BG;
  }
  return HAS_ARROW_BG;
}

// ---------------------------------------------------------------------------
// Arrows
// ---------------------------------------------------------------------------
// Direction is the arrow's own geometry: up-and-right = moved Democratic,
// down-and-left = moved Republican. Length is the size of the move. Colour
// repeats what the shape already says, so the map survives greyscale.

const ARROW_MIN = 10; // px, a just-visible move
const ARROW_MAX = 34; // px at SWING_FULL_SCALE and beyond
const SWING_FULL_SCALE = 25; // points; past this the arrow stops growing

/** Arrow pixel length for a swing in POINTS, clamped so one outlier can't dominate. */
export function arrowLength(swing) {
  const magnitude = Math.min(Math.abs(swing || 0), SWING_FULL_SCALE);
  return ARROW_MIN + (ARROW_MAX - ARROW_MIN) * (magnitude / SWING_FULL_SCALE);
}

/**
 * Build the arrow-length function for a set of rows.
 *
 * `impact` (the default) scales by NET VOTES, which is the honest answer to
 * "does this matter?" — a forty-point swing across ten ballots draws a stub
 * while a three-point swing across four thousand draws a long arrow. Sizing by
 * points instead makes the map's loudest marks its least consequential ones.
 *
 * The impact scale is set by the 95th percentile rather than the maximum, so a
 * single outsized precinct can't shrink every other arrow to nothing.
 *
 * @param {Array<Object>} rows - the rows about to be drawn
 * @param {"impact"|"points"} sizeBy
 * @returns {(row: Object) => number} pixel length
 */
export function makeArrowScale(rows, sizeBy = "impact") {
  if (sizeBy !== "impact") return (row) => arrowLength(row.swing);
  const magnitudes = (Array.isArray(rows) ? rows : [])
    .map((r) => Math.abs(r.netVotes ?? 0))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const p95 = magnitudes.length
    ? magnitudes[Math.min(magnitudes.length - 1, Math.floor(magnitudes.length * 0.95))]
    : 0;
  if (!p95) return () => ARROW_MIN;
  return (row) => {
    const magnitude = Math.min(Math.abs(row.netVotes ?? 0), p95);
    return ARROW_MIN + (ARROW_MAX - ARROW_MIN) * (magnitude / p95);
  };
}

// Arrows lie on ONE 45° axis, pointing in opposite directions along it:
// Democratic movement goes up-and-right, Republican down-and-left. A single
// axis reads as a single quantity — a field of arrows shows which way the
// county leans at a glance, and two precincts moving opposite ways are visibly
// opposite rather than merely different.
const DEM_DIR = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }; // north-east (SVG y grows downward)
const REP_DIR = { x: -Math.SQRT1_2, y: Math.SQRT1_2 }; // south-west
const HEAD_LEN = 9;
const HEAD_HALF_WIDTH = 5.5;

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * One precinct's arrow as standalone SVG markup for a Leaflet divIcon.
 *
 * Geometry is built from a direction VECTOR rather than a hardcoded up/down, so
 * the shaft and the head stay consistent at any angle and the axis can be
 * changed in one place.
 *
 * Returns "" when the precinct has earned no arrow — no comparison, too few
 * votes, or movement inside the shared no-change epsilon.
 * @param {Object} row - a buildSwingSeries row
 * @param {(row) => number} [scale] - from makeArrowScale
 */
export function arrowSVG(row, scale = null) {
  if (!row || row.swing == null || row.tinyElectorate) return "";
  const bin = swingBin(row.swing);
  if (bin < 0 || SWING_BINS[bin].key === "flat") return "";

  const dem = row.swing > 0;
  const dir = dem ? DEM_DIR : REP_DIR;
  const len = scale ? scale(row) : arrowLength(row.swing);
  const color = dem ? TREND_COLORS.swingDem.dark : TREND_COLORS.swingRep.dark;

  // Square canvas, arrow centred on it. The diagonal span is len/√2 per axis,
  // so a side of len + head width always contains it whatever the angle.
  const side = Math.ceil(len + HEAD_HALF_WIDTH * 2 + 4);
  const c = side / 2;
  const half = len / 2;
  const tail = { x: c - dir.x * half, y: c - dir.y * half };
  const head = { x: c + dir.x * half, y: c + dir.y * half };
  const base = { x: head.x - dir.x * HEAD_LEN, y: head.y - dir.y * HEAD_LEN };
  const perp = { x: -dir.y, y: dir.x };
  const w1 = { x: base.x + perp.x * HEAD_HALF_WIDTH, y: base.y + perp.y * HEAD_HALF_WIDTH };
  const w2 = { x: base.x - perp.x * HEAD_HALF_WIDTH, y: base.y - perp.y * HEAD_HALF_WIDTH };

  return (
    `<svg width="${side}" height="${side}" viewBox="0 0 ${side} ${side}" aria-hidden="true" class="tr-arrow-svg">` +
    `<line x1="${r2(tail.x)}" y1="${r2(tail.y)}" x2="${r2(base.x)}" y2="${r2(base.y)}" stroke="${color}" stroke-width="3" stroke-linecap="round" />` +
    `<polygon points="${r2(head.x)},${r2(head.y)} ${r2(w1.x)},${r2(w1.y)} ${r2(w2.x)},${r2(w2.y)}" fill="${color}" />` +
    `</svg>`
  );
}

/**
 * Leaflet style function for a precinct feature.
 * @param {Object} ctx - { byPrecinct, visible: Set|null, selected, env }
 */
export function swingStyle(feature, ctx) {
  const code = String(feature?.properties?.PRECINCT ?? "");
  const row = ctx.byPrecinct?.[code] || null;
  const isVisible = !ctx.visible || ctx.visible.has(code);
  const isSelected = ctx.selected != null && String(ctx.selected) === code;
  return {
    fillColor: swingFill(row, ctx.env, isVisible),
    fillOpacity: isVisible ? 0.92 : 0.5,
    color: isSelected ? MAP_COSMETICS.sel : SWING_STROKE,
    weight: isSelected ? 3.5 : 1,
    // The selected precinct is raised above its neighbours; without this its
    // outline is drawn over by whichever polygon happens to come next.
    ...(isSelected ? { className: "swing-selected" } : {}),
  };
}

/**
 * Legend rows for the current map, in the order they are drawn.
 * `count` lets the page show how many precincts sit in each band — a legend
 * that also answers "how many?" saves a trip to the table.
 * @param {Array<Object>} rows - the FILTERED series (what the map is showing)
 */
export function swingLegend(rows) {
  const counts = new Array(SWING_BINS.length).fill(0);
  let noComparison = 0;
  let tooFew = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const bin = swingBin(r.swing);
    if (bin < 0) noComparison += 1;
    else if (r.tinyElectorate) tooFew += 1;
    else counts[bin] += 1;
  }
  // The key describes what an arrow MEANS — its direction — not how long it is.
  // Length is a separate, switchable channel (net votes or points), so binding
  // the key's arrow lengths to the point-bands would state a mapping the map
  // isn't using. The strong-move counts ride along as a parenthetical instead.
  const byKey = Object.fromEntries(SWING_BINS.map((b, i) => [b.key, counts[i]]));
  const bands = [
    {
      key: "dem",
      name: "Moved toward Democrats",
      arrow: "up",
      color: BIN_COLORS[4],
      count: byKey.dem + byKey["dem-strong"],
      strong: byKey["dem-strong"],
    },
    {
      key: "rep",
      name: "Moved toward Republicans",
      arrow: "down",
      color: BIN_COLORS[0],
      count: byKey.rep + byKey["rep-strong"],
      strong: byKey["rep-strong"],
    },
    { key: "flat", name: "No real change", arrow: null, color: BIN_COLORS[2], count: byKey.flat, strong: 0 },
  ];
  return {
    bands,
    noComparison,
    tooFew,
    // The two data silences, so the page can render them from one place.
    silences: [
      { key: "too-few", name: "Too few votes to say", range: "a handful of ballots per race",
        kind: SILENCE_PATTERNS.tooFew[0], level: SILENCE_PATTERNS.tooFew[1], color: TOO_FEW_BG, count: tooFew },
      { key: "no-comparison", name: "No comparison", range: "on one year's ballot only",
        kind: SILENCE_PATTERNS.noComparison[0], level: SILENCE_PATTERNS.noComparison[1], color: NO_COMPARISON_BG, count: noComparison },
    ].filter((s) => s.count > 0),
  };
}
