// ui/swingScatter.js — the precinct swing scatter (Trends page).
// --------------------------------------------------------------------------------
// One mark per precinct: the earlier cycle's composite partisan margin on X, the
// later cycle's on Y. The 45° diagonal is "no change" — a precinct ABOVE the line
// moved toward Democrats, BELOW it moved toward Republicans. The zero lines are
// the tipping point, so the quadrants read as safe-D / safe-R / flipped.
//
// imports: lib + domain only — this is a UI-layer module. It never fetches; the
// series and labels arrive as arguments (trendsPage composes them).
//
// A11y contract (see CLAUDE.md — data encodings are NEVER color-alone):
//   * Direction is carried by SHAPE as well as hue — triangle-up = toward Dem,
//     triangle-down = toward Rep, circle = no real change. The chart survives
//     grayscale and the common color-vision deficiencies.
//   * Every mark is a focusable <g role="img"> with a full-sentence aria-label
//     built by describeSwing(), the SAME sentence the companion table row uses,
//     so the two can never drift apart.
//   * Marks are arrow-key walkable (the map's polygon pattern in map/mapView.js).
//   * Nothing is hover-only: the readout is driven by focus as well as pointer.

import { escapeHtml } from "../lib/dom.js";
import { getTrendColor, SWING_EPSILON } from "../domain/trends.js";

const PAD = { top: 30, right: 56, bottom: 58, left: 88 };

// Mark geometry. Area scales with two-party votes so a 4,000-vote precinct reads
// heavier than a 400-vote one, but the range is clamped: an unbounded scale
// makes the smallest precincts invisible and the largest a blob.
const R_MIN = 3;
const R_MAX = 9;

/**
 * Direction bucket for a swing, in points. Swings inside SWING_EPSILON are
 * "flat" — below the resolution the composite can honestly distinguish.
 * @returns {"dem"|"rep"|"flat"}
 */
export function swingDirection(swing) {
  if (swing == null || isNaN(swing)) return "flat";
  if (swing > SWING_EPSILON) return "dem";
  if (swing < -SWING_EPSILON) return "rep";
  return "flat";
}

// Margin in points -> plain language, e.g. "D+12.4" / "R+3.1" / "even".
function marginLabel(margin) {
  if (margin == null || isNaN(margin)) return "no data";
  if (Math.abs(margin) < 0.05) return "even";
  return `${margin > 0 ? "D" : "R"}+${Math.abs(margin).toFixed(1)}`;
}

/**
 * The ONE plain-language sentence for a precinct's swing. Used verbatim by the
 * scatter's aria-label, the focus/hover readout, and the companion table, so
 * the chart and the table can never disagree about what a precinct did.
 * @param {Object} row - one buildSwingSeries entry
 * @param {{a: string, b: string}} labels - cycle labels, e.g. { a: "2022", b: "2024" }
 * @returns {string}
 */
export function describeSwing(row, labels) {
  const name = `Precinct ${row.precinct}`;
  if (row.swing == null) {
    const known = row.marginA != null ? labels.a : labels.b;
    const value = row.marginA != null ? row.marginA : row.marginB;
    return `${name}: only voted in ${known} (${marginLabel(value)}) — no comparison available.`;
  }
  const dir = swingDirection(row.swing);
  const move =
    dir === "flat"
      ? "essentially unchanged"
      : `moved ${Math.abs(row.swing).toFixed(1)} points toward ${dir === "dem" ? "Democrats" : "Republicans"}`;
  const flip = row.flipped
    ? ` It flipped to ${row.marginB >= 0 ? "Democratic" : "Republican"}.`
    : "";
  // The caveat rides on the sentence itself so it reaches the chart's
  // aria-label, the readout, and the table together — it cannot be dropped by
  // one surface and kept by another.
  const tiny = row.tinyElectorate
    ? " Too few votes are cast here for the percentages to mean much, so it is left off the chart."
    : "";
  return `${name}: ${marginLabel(row.marginA)} in ${labels.a}, ${marginLabel(row.marginB)} in ${labels.b} — ${move}.${flip}${tiny}`;
}

// Both axes SHARE one domain — that is what makes the 45° line a true diagonal
// and the vertical distance from it a readable swing. The domain is the data's
// own range (padded and rounded out), NOT a fixed ±100: Collin's precincts run
// from about R+85 to D+45, and forcing the full theoretical range would squash
// every precinct onto the diagonal and hide the movement this chart exists to
// show. Falls back to ±10 for a degenerate series.
export function computeExtent(rows) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    for (const v of [r.marginA, r.marginB]) {
      if (v == null || isNaN(v)) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (!isFinite(lo) || !isFinite(hi)) return { lo: -10, hi: 10 };
  if (hi - lo < 1) return { lo: lo - 10, hi: hi + 10 };
  const pad = (hi - lo) * 0.06;
  return { lo: Math.floor((lo - pad) / 5) * 5, hi: Math.ceil((hi + pad) / 5) * 5 };
}

// Roughly 8 ticks across the range, snapped to a friendly step, always
// including 0 (the tipping point, the one tick that carries meaning).
export function ticksFor({ lo, hi }) {
  const range = hi - lo;
  const raw = range / 8;
  const step = [5, 10, 20, 25, 50].find((s) => s >= raw) || 100;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  if (lo < 0 && hi > 0 && !out.includes(0)) out.push(0);
  return out.sort((a, b) => a - b);
}

// Vote-scaled radius. sqrt so AREA (not radius) tracks votes — a radius-linear
// scale overstates big precincts by squaring their apparent weight.
function radiusScale(rows) {
  let max = 0;
  for (const r of rows) max = Math.max(max, (r.votesA || 0) + (r.votesB || 0));
  if (max <= 0) return () => R_MIN;
  return (votes) => {
    const v = Math.max(0, votes || 0);
    return R_MIN + (R_MAX - R_MIN) * Math.sqrt(v / max);
  };
}

// Mark path centred on (cx, cy). Shape encodes direction independently of hue.
function markPath(dir, cx, cy, r) {
  if (dir === "dem") {
    // triangle up
    const h = r * 1.5;
    return `<polygon points="${cx},${cy - h} ${cx - r * 1.3},${cy + h * 0.6} ${cx + r * 1.3},${cy + h * 0.6}" />`;
  }
  if (dir === "rep") {
    // triangle down
    const h = r * 1.5;
    return `<polygon points="${cx},${cy + h} ${cx - r * 1.3},${cy - h * 0.6} ${cx + r * 1.3},${cy - h * 0.6}" />`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" />`;
}

/**
 * The precincts this chart can honestly position.
 *
 * Two exclusions, both about not drawing a claim the data can't support:
 *   * no comparison (one cycle only) — plotting it anywhere would invent a
 *     position, and plotting it at zero would read as "no change";
 *   * a tiny electorate — a margin off one or two ballots per race is
 *     arithmetic noise, and at ±100 it would stretch the axes so far that the
 *     other 265 precincts collapse onto the diagonal.
 * Both stay in the companion table with their real vote counts.
 * @param {Array<Object>} series - buildSwingSeries output
 */
export function plottableRows(series) {
  return (Array.isArray(series) ? series : []).filter((r) => r.swing != null && !r.tinyElectorate);
}

/**
 * Build the scatter's SVG markup.
 *
 * @param {Array<Object>} series - buildSwingSeries output; see plottableRows
 *   for what is excluded and why
 * @param {Object} opts
 * @param {{a: string, b: string}} opts.labels - cycle labels
 * @param {number} [opts.width=760]
 * @param {string|null} [opts.selected] - precinct code to render as selected
 * @returns {string} SVG markup
 */
export function swingScatterHTML(series, { labels, width = 760, selected = null } = {}) {
  const rows = plottableRows(series);
  // The plot area MUST be square. Both axes share one domain, so equal pixel
  // extents are what make the no-change line a true 45° and the distance from
  // it a readable swing. Height is derived, never passed in — a caller picking
  // a non-square size would quietly tilt the reference line.
  const plotW = width - PAD.left - PAD.right;
  const plotH = plotW;
  const height = plotH + PAD.top + PAD.bottom;

  if (!rows.length) {
    return `<p class="empty-note">No precinct has comparable results in both cycles, so there is nothing to plot.</p>`;
  }

  const extent = computeExtent(rows);
  const span = extent.hi - extent.lo;
  const x = (v) => PAD.left + ((v - extent.lo) / span) * plotW;
  const y = (v) => PAD.top + plotH - ((v - extent.lo) / span) * plotH;
  const radius = radiusScale(rows);
  const ticks = ticksFor(extent);

  const gridlines = ticks
    .map((t) => {
      const zero = t === 0;
      const cls = zero ? "sc-axis-zero" : "sc-grid";
      return (
        `<line class="${cls}" x1="${x(t)}" y1="${PAD.top}" x2="${x(t)}" y2="${PAD.top + plotH}" />` +
        `<line class="${cls}" x1="${PAD.left}" y1="${y(t)}" x2="${PAD.left + plotW}" y2="${y(t)}" />`
      );
    })
    .join("");

  const tickLabels = ticks
    .map(
      (t) =>
        `<text class="sc-tick" x="${x(t)}" y="${PAD.top + plotH + 20}" text-anchor="middle">${marginLabel(t)}</text>` +
        `<text class="sc-tick" x="${PAD.left - 10}" y="${y(t) + 5}" text-anchor="end">${marginLabel(t)}</text>`
    )
    .join("");

  // The no-change diagonal, corner to corner of the shared domain — a true 45°
  // line, so any vertical distance from it IS the swing. The label sits at the
  // lower-left end, the sparse corner in a county whose precincts cluster
  // toward the middle.
  // Label rides ON the line, rotated to match it — which only reads correctly
  // because the plot area is square. Placed a fifth of the way up from the
  // bottom-left, clear of the axis ticks and of the dense middle band.
  const labelAt = extent.lo + (extent.hi - extent.lo) * 0.2;
  const lx = x(labelAt);
  const ly = y(labelAt);
  const diagonal = `<line class="sc-diagonal" x1="${x(extent.lo)}" y1="${y(extent.lo)}" x2="${x(extent.hi)}" y2="${y(extent.hi)}" />`;
  // Drawn AFTER the marks — the band along the diagonal is exactly where the
  // precincts pile up, so a label underneath them is a label nobody reads.
  const diagonalLabel = `<text class="sc-diagonal-label" transform="rotate(-45 ${lx} ${ly})" x="${lx}" y="${ly - 9}" text-anchor="middle">no change</text>`;

  // Paint order, largest first. Two reasons, both about not losing precincts in
  // the dense band along the diagonal: a big mark drawn last completely hides
  // (and steals the clicks of) any smaller mark beneath it, and small precincts
  // are exactly the ones a chair is hunting for. Selected goes last of all so
  // its ring is never overdrawn.
  const votesOf = (r) => (r.votesA || 0) + (r.votesB || 0);
  const isSelected = (r) => (selected != null && String(selected) === String(r.precinct) ? 1 : 0);
  const ordered = [...rows].sort(
    (a, b) => isSelected(a) - isSelected(b) || votesOf(b) - votesOf(a)
  );

  const marks = ordered
    .map((r) => {
      const dir = swingDirection(r.swing);
      const cx = x(r.marginA);
      const cy = y(r.marginB);
      const rad = radius((r.votesA || 0) + (r.votesB || 0));
      const isSel = selected != null && String(selected) === String(r.precinct);
      const fill = getTrendColor(r.swing, "Dem");
      const label = describeSwing(r, labels);
      return (
        `<g class="sc-mark sc-mark-${dir}${isSel ? " is-selected" : ""}" role="img"` +
        ` tabindex="-1" data-precinct="${escapeHtml(r.precinct)}"` +
        ` aria-label="${escapeHtml(label)}" fill="${fill}">` +
        markPath(dir, cx, cy, rad) +
        `</g>`
      );
    })
    .join("");

  return (
    `<svg class="swing-scatter" viewBox="0 0 ${width} ${height}" role="application"` +
    ` aria-label="Precinct swing scatter. Use arrow keys to move between precincts."` +
    ` preserveAspectRatio="xMidYMid meet">` +
    `<rect class="sc-plot-bg" x="${PAD.left}" y="${PAD.top}" width="${plotW}" height="${plotH}" />` +
    gridlines +
    diagonal +
    tickLabels +
    `<text class="sc-axis-title" x="${PAD.left + plotW / 2}" y="${height - 14}" text-anchor="middle">${escapeHtml(labels.a)} margin →</text>` +
    `<text class="sc-axis-title" transform="rotate(-90 16 ${PAD.top + plotH / 2})" x="16" y="${PAD.top + plotH / 2}" text-anchor="middle">${escapeHtml(labels.b)} margin →</text>` +
    `<g class="sc-marks">${marks}</g>` +
    diagonalLabel +
    `</svg>`
  );
}

/**
 * Wire focus/pointer selection and arrow-key walking onto a rendered scatter.
 * Kept separate from the markup so the HTML builder stays pure and testable.
 *
 * @param {HTMLElement} container - element containing the <svg>
 * @param {Object} opts
 * @param {(precinct: string|null) => void} opts.onSelect - fired on focus/click
 * @returns {() => void} teardown
 */
export function attachSwingScatter(container, { onSelect } = {}) {
  const svg = container?.querySelector(".swing-scatter");
  if (!svg) return () => {};
  // DOM order is PAINT order (largest mark first) — walking the keyboard
  // through it would jump around by precinct size. Navigation follows precinct
  // number instead: predictable, and the same order the companion table uses.
  const marks = [...svg.querySelectorAll(".sc-mark")].sort((a, b) => {
    const na = Number(a.dataset.precinct);
    const nb = Number(b.dataset.precinct);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a.dataset.precinct).localeCompare(String(b.dataset.precinct));
  });
  if (!marks.length) return () => {};

  // Roving tabindex: the group is one tab stop, arrows move within it (the
  // map's polygon convention). Tabbing through 267 marks would be a trap.
  let index = marks.findIndex((m) => m.classList.contains("is-selected"));
  if (index < 0) index = 0;
  marks.forEach((m, i) => m.setAttribute("tabindex", i === index ? "0" : "-1"));

  const focusAt = (next) => {
    const clamped = (next + marks.length) % marks.length;
    marks[index].setAttribute("tabindex", "-1");
    index = clamped;
    marks[index].setAttribute("tabindex", "0");
    marks[index].focus();
  };

  const select = (el) => {
    if (!el) return;
    onSelect?.(el.dataset.precinct);
  };

  function onKeyDown(event) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      focusAt(index + step);
      select(marks[index]);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusAt(event.key === "Home" ? 0 : marks.length - 1);
      select(marks[index]);
    }
  }

  function onFocusIn(event) {
    const mark = event.target.closest?.(".sc-mark");
    if (mark) select(mark);
  }

  function onClick(event) {
    const mark = event.target.closest?.(".sc-mark");
    if (!mark) return;
    const at = marks.indexOf(mark);
    if (at >= 0) focusAt(at);
    select(mark);
  }

  svg.addEventListener("keydown", onKeyDown);
  svg.addEventListener("focusin", onFocusIn);
  svg.addEventListener("click", onClick);
  return () => {
    svg.removeEventListener("keydown", onKeyDown);
    svg.removeEventListener("focusin", onFocusIn);
    svg.removeEventListener("click", onClick);
  };
}
