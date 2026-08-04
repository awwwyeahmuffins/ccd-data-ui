// trendsPage.js
// --------------------------------------------------------------------------------
// Orchestrator for trends.html — how each precinct's partisan balance MOVED from
// one election cycle to the next, as a swing scatter plus a sortable companion
// table. Pure math lives in domain/trends.js; the chart markup lives in
// ui/swingScatter.js. Must not import another page's orchestrator.
//
// WHY A COMPOSITE INDEX AND NOT "THE SAME RACE TWICE":
// Texas staggers its ballot, so NO office runs in both 2022 and 2024 — the
// midterm elects Governor/Lt Gov/AG, the presidential year elects President/US
// Senator, and even the high courts alternate seats. There is no same-race
// pairing to plot. Each cycle's axis is therefore a composite: the precinct's
// mean two-party margin across every race that reached the whole county's
// ballot. Averaging the full ticket cancels candidate-specific noise, so what's
// left is the precinct's own movement.

import { boundary } from "./data/dataService.js";
import { getCandidateColumns } from "./electionSchema.js";
import {
  selectCompositeRaces,
  buildPartisanIndex,
  buildSwingSeries,
  summarizeSwing,
  SWING_EPSILON,
  TINY_ELECTORATE_PER_RACE,
} from "./domain/trends.js";
import {
  swingScatterHTML,
  attachSwingScatter,
  describeSwing,
  swingDirection,
} from "./ui/swingScatter.js";
import { renderDataTable } from "./ui/dataTable.js";
import { escapeHtml } from "./lib/dom.js";
import { formatNumberOrNA } from "./lib/format.js";
import { readParams, writeParams, onChange } from "./lib/urlState.js";

// The two cycles on file with head-to-head Dem/Rep contests. 2025 is nonpartisan
// city/school/bond elections and 2026 is party primaries (no head-to-head), so
// neither can carry a partisan margin. Widen this list when a new general lands.
const CYCLE_A = 2022;
const CYCLE_B = 2024;

// Structural pre-filter, purely to avoid fetching races that cannot possibly
// qualify: City / ISD / MUD contests are sub-county AND nonpartisan by law, so
// none of them can carry a county-wide Dem-vs-Rep margin. This cuts the load
// from 199 race files to 71. It is NOT the gate — selectCompositeRaces' coverage
// test still decides membership, and dropping this filter yields a byte-identical
// composite (verified against the 2026 boundary set: 17 races in 2022, 18 in
// 2024, either way).
const COUNTYWIDE_CATEGORIES = new Set(["Federal", "State", "County"]);

// Races load a few at a time rather than all 71 at once: a burst that wide
// resets connections on the dev server and stalls on a field iPad's cell link.
// A dropped race would silently shrink the composite, so this is correctness
// insurance, not just politeness.
const FETCH_CONCURRENCY = 8;

const pg = {
  series: [],
  summary: null,
  failedRaces: 0,
  composition: { [CYCLE_A]: [], [CYCLE_B]: [] },
  sortKey: "swing",
  sortDir: "asc", // most Republican-ward movement first
  selected: null,
  detach: null,
};

const $ = (id) => document.getElementById(id);
const svc = boundary();
const LABELS = { a: String(CYCLE_A), b: String(CYCLE_B) };

// ---- data ------------------------------------------------------------------

/** Run `fn` over `items` with at most `limit` in flight. Order is not preserved. */
async function mapWithConcurrency(items, limit, fn) {
  const queue = [...items];
  const out = [];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      out.push(await fn(next));
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Load a cycle's candidate races. dataService memoizes each one, so a retry
 * after a dropped connection is cheap and a second visit is free.
 *
 * A race that will not load is COUNTED, not silently dropped: losing one
 * quietly would shift every precinct's index with nothing on screen to say so.
 * The count surfaces in the headline note.
 */
async function loadCycle(entries) {
  const loaded = await mapWithConcurrency(entries, FETCH_CONCURRENCY, async (entry) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rows = await svc.loadRace(entry);
        if (!rows || !rows.length) return null;
        return { entry, rows, candidateCols: getCandidateColumns(Object.keys(rows[0])) };
      } catch (err) {
        if (attempt) {
          console.warn("[trends] race failed to load", entry.filename, err);
          pg.failedRaces += 1;
          return null;
        }
      }
    }
    return null;
  });
  return loaded.filter(Boolean);
}

/** Every precinct code appearing in any loaded race — the coverage denominator. */
function precinctUniverse(raceGroups) {
  const codes = new Set();
  for (const races of raceGroups) {
    for (const race of races) {
      for (const row of race.rows) {
        const code = row?.["PRECINCT CODE"];
        if (code != null && code !== "") codes.add(String(code));
      }
    }
  }
  return codes.size;
}

/** Qualifying races, ordered by office so the composition list never reshuffles. */
function composite(races, precinctCount) {
  return selectCompositeRaces(races, precinctCount).sort((a, b) =>
    String(a.entry.office).localeCompare(String(b.entry.office))
  );
}

async function load() {
  const races = await svc.listRaces();
  const inCycle = (year) =>
    races.filter((e) => e.year === year && COUNTYWIDE_CATEGORIES.has(e.category));

  const [rawA, rawB] = await Promise.all([loadCycle(inCycle(CYCLE_A)), loadCycle(inCycle(CYCLE_B))]);

  // The coverage denominator comes from the races themselves, not the boundary
  // GeoJSON: that file is 1.9 MB — six times every race CSV combined — and
  // would be fetched solely to count features. The union across these
  // county-wide races is the same 273 precincts.
  const precinctCount = precinctUniverse([rawA, rawB]);
  if (!precinctCount) throw new Error("No precinct results loaded — cannot measure race coverage");

  const selA = composite(rawA, precinctCount);
  const selB = composite(rawB, precinctCount);

  pg.composition[CYCLE_A] = selA;
  pg.composition[CYCLE_B] = selB;
  pg.series = buildSwingSeries(buildPartisanIndex(selA), buildPartisanIndex(selB));
  pg.summary = summarizeSwing(pg.series);
}

// ---- rendering -------------------------------------------------------------

function pts(value, decimals = 1) {
  if (value == null || isNaN(value)) return "N/A";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(decimals)}`;
}

function marginText(margin) {
  if (margin == null || isNaN(margin)) return "N/A";
  if (Math.abs(margin) < 0.05) return "even";
  return `${margin > 0 ? "D" : "R"}+${Math.abs(margin).toFixed(1)}`;
}

function renderHeadline() {
  const s = pg.summary;
  if (!s || !s.comparablePrecincts) {
    $("tr-headline").innerHTML = `<p class="empty-note">No precinct has comparable results in both cycles.</p>`;
    return;
  }
  const tinyCount = pg.series.filter((r) => r.swing != null && r.tinyElectorate).length;
  const dir = swingDirection(s.voteWeightedSwing);
  const movement =
    dir === "flat"
      ? `barely moved (${pts(s.voteWeightedSwing)} points)`
      : `moved ${Math.abs(s.voteWeightedSwing).toFixed(1)} points toward ${dir === "dem" ? "Democrats" : "Republicans"}`;

  // Both figures are shown because they answer different questions and can
  // point opposite ways: the vote-weighted number is what happened to the
  // county's electorate, the median is what happened to the typical precinct.
  $("tr-headline").innerHTML =
    `<p class="tr-lede">Between ${LABELS.a} and ${LABELS.b}, Collin County ${escapeHtml(movement)}.</p>` +
    `<ul class="tr-stats">` +
    `<li><span class="tr-stat-n">${pts(s.voteWeightedSwing)}</span><span class="tr-stat-l">points, county-wide (vote-weighted)</span></li>` +
    `<li><span class="tr-stat-n">${pts(s.medianSwing)}</span><span class="tr-stat-l">points, the typical precinct (median)</span></li>` +
    `<li><span class="tr-stat-n">${s.towardDem}</span><span class="tr-stat-l">precincts moved toward Democrats</span></li>` +
    `<li><span class="tr-stat-n">${s.towardRep}</span><span class="tr-stat-l">precincts moved toward Republicans</span></li>` +
    `<li><span class="tr-stat-n">${s.flippedToDem + s.flippedToRep}</span><span class="tr-stat-l">changed which party led (${s.flippedToDem} to Dem, ${s.flippedToRep} to Rep)</span></li>` +
    `</ul>` +
    `<p class="tr-note">Based on ${s.comparablePrecincts} of ${s.totalPrecincts} precincts — the rest were on only one cycle's ballot. ` +
    // "Of those" — the thin precincts are a subset of the comparable ones, not
    // an extra group on top of them.
    (tinyCount
      ? `Of those, ${tinyCount} ${tinyCount === 1 ? "casts" : "cast"} fewer than ${TINY_ELECTORATE_PER_RACE} votes per race, ` +
        `where a single ballot swings the percentage — ${tinyCount === 1 ? "it stays" : "they stay"} in the table but off the chart. `
      : "") +
    `Movement under ${SWING_EPSILON} points counts as no real change.` +
    (pg.failedRaces
      ? ` <strong>${pg.failedRaces} race ${pg.failedRaces === 1 ? "file" : "files"} could not be loaded</strong>, so these figures are incomplete — reload to try again.`
      : "") +
    `</p>`;
}

function renderComposition() {
  const list = (year) => {
    const races = pg.composition[year];
    if (!races.length) return `<li>No qualifying races found.</li>`;
    return races
      .map(
        (r) =>
          `<li>${escapeHtml(r.entry.office)} <span class="tr-cov">${(r.coverage * 100).toFixed(1)}% of precincts</span></li>`
      )
      .join("");
  };
  $("tr-composition").innerHTML =
    `<div class="tr-comp-col"><h3>${LABELS.a} — ${pg.composition[CYCLE_A].length} races</h3><ul>${list(CYCLE_A)}</ul></div>` +
    `<div class="tr-comp-col"><h3>${LABELS.b} — ${pg.composition[CYCLE_B].length} races</h3><ul>${list(CYCLE_B)}</ul></div>`;
}

function renderReadout() {
  const row = pg.series.find((r) => String(r.precinct) === String(pg.selected));
  if (!row) {
    $("tr-readout").innerHTML = `<p class="tr-readout-empty">Select a precinct on the chart — or use the arrow keys — to see its numbers.</p>`;
    return;
  }
  $("tr-readout").innerHTML =
    `<p class="tr-readout-line">${escapeHtml(describeSwing(row, LABELS))}</p>` +
    `<p class="tr-readout-meta">` +
    `${formatNumberOrNA(row.votesA)} two-party votes across ${row.raceCountA} ${LABELS.a} races · ` +
    `${formatNumberOrNA(row.votesB)} across ${row.raceCountB} ${LABELS.b} races · ` +
    `<a href="precinct.html#precinct=${encodeURIComponent(row.precinct)}">Open precinct ${escapeHtml(row.precinct)} report</a>` +
    `</p>`;
}

const COLUMNS = [
  {
    id: "precinct",
    label: "Precinct",
    pinned: true,
    cellHTML: (r) =>
      `<td class="pin-col pin-col-0 tr-cell-precinct"><a href="precinct.html#precinct=${encodeURIComponent(r.precinct)}">${escapeHtml(r.precinct)}</a></td>`,
  },
  { id: "marginA", label: `${CYCLE_A} margin`, cellClass: "num", format: marginText },
  { id: "marginB", label: `${CYCLE_B} margin`, cellClass: "num", format: marginText },
  {
    id: "swing",
    label: "Swing (points)",
    cellHTML: (r) => {
      const dir = swingDirection(r.swing);
      const text = r.swing == null ? "N/A" : pts(r.swing);
      // The arrow is a second, non-colour channel for direction — same reason
      // the scatter uses triangles.
      const arrow = r.swing == null ? "" : dir === "dem" ? "↑ " : dir === "rep" ? "↓ " : "→ ";
      return `<td class="num tr-swing tr-swing-${dir}">${arrow}${escapeHtml(text)}</td>`;
    },
  },
  {
    id: "flipped",
    label: "Flipped?",
    format: (_v, r) => (r.flipped ? (r.marginB >= 0 ? "→ Dem" : "→ Rep") : ""),
  },
  { id: "votesB", label: `${CYCLE_B} two-party votes`, cellClass: "num", format: formatNumberOrNA },
];

function sortedRows() {
  const dir = pg.sortDir === "asc" ? 1 : -1;
  return [...pg.series].sort((a, b) => {
    const av = a[pg.sortKey];
    const bv = b[pg.sortKey];
    // Precincts with no comparison sort last in BOTH directions — they are
    // missing, not extreme, and letting them top the list would misread.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv)) * dir;
    }
    return (av - bv) * dir;
  });
}

function renderTable() {
  renderDataTable({
    head: $("tr-head"),
    body: $("tr-body"),
    columns: COLUMNS,
    rows: sortedRows(),
    sort: { key: pg.sortKey, dir: pg.sortDir },
    onSort: (id) => {
      if (pg.sortKey === id) pg.sortDir = pg.sortDir === "asc" ? "desc" : "asc";
      else {
        pg.sortKey = id;
        pg.sortDir = id === "precinct" ? "asc" : "desc";
      }
      renderTable();
    },
    rowAttrs: (r) => {
      const cls = [
        String(r.precinct) === String(pg.selected) ? "row-highlight" : "",
        r.tinyElectorate ? "tiny-row" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return cls ? { class: cls } : null;
    },
    emptyMessage: "No precinct results to compare.",
    batch: 60,
  });
}

function renderScatter() {
  pg.detach?.();
  $("tr-chart").innerHTML = swingScatterHTML(pg.series, { labels: LABELS, selected: pg.selected });
  pg.detach = attachSwingScatter($("tr-chart"), { onSelect: select });
}

function select(precinct) {
  if (String(pg.selected) === String(precinct)) return;
  pg.selected = precinct == null ? null : String(precinct);
  writeParams({ precinct: pg.selected || null });
  const chart = $("tr-chart");
  chart.querySelectorAll(".sc-mark.is-selected").forEach((el) => el.classList.remove("is-selected"));
  // Matched by walking the marks rather than building a selector — precinct
  // codes are data, and interpolating them into a selector string is how an
  // odd code becomes a syntax error.
  for (const el of chart.querySelectorAll(".sc-mark")) {
    if (el.dataset.precinct === pg.selected) {
      el.classList.add("is-selected");
      break;
    }
  }
  renderReadout();
  renderTable();
}

// ---- boot ------------------------------------------------------------------

async function init() {
  try {
    await load();
  } catch (err) {
    console.error("[trends] failed to load", err);
    $("tr-chart").innerHTML = `<p class="empty-note">Could not load election results. Reload the page to try again.</p>`;
    $("tr-body").innerHTML = `<tr><td class="empty-note" colspan="${COLUMNS.length}">No data.</td></tr>`;
    return;
  }

  const params = readParams();
  if (params.precinct) pg.selected = String(params.precinct);

  renderHeadline();
  renderComposition();
  renderScatter();
  renderReadout();
  renderTable();

  // Hash-only navigation (a shared link, the back button) never reloads the
  // document, so the selection has to follow the hash as well as seed from it.
  onChange((next) => select(next.precinct ? String(next.precinct) : null));
}

init();
