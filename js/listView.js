// listView.js — the linear alternative to the map (index.html "List" view).
//
// Same county, same race, same mode, same data — but as a scrollable list of
// plain-language cards a volunteer can simply read top to bottom, with no
// spatial interaction, pinch-zoom, or pointer precision required. This is
// also the canonical screen-reader path (the map's skip link lands here).
//
// Row text comes from the SAME describePrecinct() formatter the map's
// aria-labels and readout card use (mapBins.js), so map and list can never
// disagree. Pure row-model builders here are unit-tested; commandCenter.js
// owns the wiring (selection sync, view toggle, hash).

import { describePrecinct } from "./mapBins.js";
import { escapeHtml } from "./utils.js";

// ---------------------------------------------------------------------------
// Pure row model
// ---------------------------------------------------------------------------
export function buildRows(features, ctx = {}) {
  return features.map((f) => {
    const p = f.properties;
    const code = String(p.PRECINCT);
    const hasParty = p.winningParty && p.demShare != null && !isNaN(p.demShare);
    const margin = hasParty ? Math.abs(p.demShare - p.repShare) : null;
    const race = ctx.race ? ctx.race.byPrecinct?.[code] : null;
    const onBallot = ctx.race ? !!(race && race.total > 0 && race.winner) : true;
    let lean = null;
    if (hasParty) {
      const r = Math.round(p.repShare * 100);
      const d = Math.round(p.demShare * 100);
      lean = { rep: r, dem: d, mod: Math.max(0, 100 - r - d) };
    }
    return {
      code,
      text: describePrecinct(p, ctx),
      lean,
      margin,
      nonWhite: p.pct_white == null || isNaN(p.pct_white) ? null : 1 - p.pct_white,
      population: p.total == null || isNaN(p.total) ? null : +p.total,
      onBallot,
      codeNum: parseInt(code, 10) || 0,
    };
  });
}

export const SORTS = [
  { id: "code", label: "Precinct number" },
  { id: "margin", label: "Closest margin first" },
  { id: "diverse", label: "Most diverse first" },
  { id: "population", label: "Largest population first" },
];

// N/A always sorts last — missing data never outranks real data.
export function sortRows(rows, sortId) {
  const val = {
    code: (r) => r.codeNum,
    margin: (r) => r.margin,
    diverse: (r) => (r.nonWhite == null ? null : -r.nonWhite),
    population: (r) => (r.population == null ? null : -r.population),
  }[sortId] || ((r) => r.codeNum);
  return [...rows].sort((a, b) => {
    // off-ballot rows sink below on-ballot rows in a race view
    if (a.onBallot !== b.onBallot) return a.onBallot ? -1 : 1;
    const va = val(a), vb = val(b);
    if (va == null && vb == null) return a.codeNum - b.codeNum;
    if (va == null) return 1;
    if (vb == null) return -1;
    return va - vb || a.codeNum - b.codeNum;
  });
}

export function countLine(rows, sortId) {
  const label = (SORTS.find((s) => s.id === sortId) || SORTS[0]).label.toLowerCase();
  return `${rows.length} precincts, sorted by ${label}`;
}

// ---------------------------------------------------------------------------
// Rendering (chunked — district views can reach ~1,500 rows)
// ---------------------------------------------------------------------------
function cardHTML(row, countySlug) {
  const report = `precinct.html#county=${encodeURIComponent(countySlug)}&precinct=${encodeURIComponent(row.code)}`;
  const lean = row.lean
    ? `<div class="cc-leanbar cc-leanbar-slim" role="img" aria-label="${row.lean.rep}% Republican, ${row.lean.mod}% moderate or other, ${row.lean.dem}% Democratic">
         ${row.lean.rep > 0 ? `<span class="seg-rep" style="flex:${row.lean.rep}"></span>` : ""}
         ${row.lean.mod > 0 ? `<span class="seg-mod" style="flex:${row.lean.mod}"></span>` : ""}
         ${row.lean.dem > 0 ? `<span class="seg-dem" style="flex:${row.lean.dem}"></span>` : ""}
       </div>`
    : "";
  return `
    <article class="cc-card${row.onBallot ? "" : " off-ballot"}" data-code="${escapeHtml(row.code)}">
      <p class="cc-card-text">${escapeHtml(row.text)}</p>
      ${lean}
      <div class="cc-card-actions">
        <button type="button" class="cc-card-details" data-code="${escapeHtml(row.code)}">Show on map</button>
        <a class="cc-card-report" href="${report}">Full report</a>
      </div>
    </article>`;
}

// Render rows into `container` in animation-frame batches. Returns a cancel fn.
export function renderRows(container, rows, countySlug, { batch = 80 } = {}) {
  container.innerHTML = "";
  let i = 0;
  let cancelled = false;
  function step() {
    if (cancelled || i >= rows.length) return;
    const slice = rows.slice(i, i + batch);
    container.insertAdjacentHTML("beforeend", slice.map((r) => cardHTML(r, countySlug)).join(""));
    i += batch;
    if (i < rows.length) requestAnimationFrame(step);
  }
  step();
  return () => { cancelled = true; };
}
