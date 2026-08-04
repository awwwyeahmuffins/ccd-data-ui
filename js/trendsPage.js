// trendsPage.js
// --------------------------------------------------------------------------------
// Orchestrator for trends.html — how each precinct's partisan balance MOVED
// from one cycle to the next, shown three ways at once (map, scatter, table)
// off one filter set. Pure maths lives in domain/trends.js; the scatter in
// ui/swingScatter.js; the choropleth in map/swingLayer.js.
//
// TWO METRICS, because the data supports two different questions:
//
//   General election margin — the two-party margin of the whole county-wide
//   ticket, averaged. Texas staggers its ballot, so NO office runs in both
//   2022 and 2024 (the midterm elects Governor/Lt Gov/AG, the presidential
//   year President/US Senator, and even the high courts alternate seats).
//   There is no same-race pairing, hence the composite — and exactly ONE
//   comparable pair, 2022 → 2024.
//
//   Primary participation — which party's primary ballot voters asked for,
//   on file for 2022, 2024 and 2026. Behavioural rather than modelled, and
//   the only measure with enough cycles for a real year-to-year picker. It
//   measures ENGAGEMENT, not vote share: primary turnout is a fraction of a
//   general electorate and swings on whether a contested race was on either
//   party's ballot that year. The page says so wherever the metric is shown.

import { boundary } from "./data/dataService.js";
import { getCandidateColumns } from "./electionSchema.js";
import {
  selectCompositeRaces,
  buildPartisanIndex,
  buildPrimaryIndex,
  primaryYearsAvailable,
  buildSwingSeries,
  summarizeSwing,
  filterSwingSeries,
  EMPTY_FILTERS,
  SWING_EPSILON,
  TINY_ELECTORATE_PER_RACE,
} from "./domain/trends.js";
import {
  swingScatterHTML,
  attachSwingScatter,
  describeSwing,
  swingDirection,
} from "./ui/swingScatter.js";
import { swingStyle, swingLegend, arrowSVG, makeArrowScale } from "./map/swingLayer.js";
import { patternFill, swatchSVG } from "./map/mapPatterns.js";
import { createMapView, decoratePrecinctPaths, wirePrecinctKeyboard, fitToLayer } from "./map/mapView.js";
import { renderDataTable } from "./ui/dataTable.js";
import { escapeHtml, debounce } from "./lib/dom.js";
import { formatNumberOrNA } from "./lib/format.js";
import { readParams, writeParams, onChange } from "./lib/urlState.js";

// The general-election composite exists only for cycles with head-to-head
// Dem/Rep contests: 2025 is nonpartisan city/school/bond, 2026 is primaries.
const GENERAL_YEARS = [2022, 2024];

// Structural pre-filter, purely to avoid fetching races that cannot qualify:
// City / ISD / MUD contests are sub-county AND nonpartisan by law. Cuts the
// load from 199 race files to 71. NOT the gate — selectCompositeRaces' coverage
// test still decides, and dropping this yields a byte-identical composite.
const COUNTYWIDE_CATEGORIES = new Set(["Federal", "State", "County"]);

const FETCH_CONCURRENCY = 8;

const METRICS = {
  general: {
    id: "general",
    label: "General election margin",
    blurb:
      "The two-party margin across every race on the whole county's ballot, averaged. Different offices each year — Texas staggers its ballot — so this is the ticket as a whole, not one contest.",
    unitPhrase: "",
  },
  primary: {
    id: "primary",
    label: "Primary participation",
    blurb:
      "Which party's primary ballot voters asked for. This measures engagement, not vote share — primary turnout is a fraction of a general electorate and moves with whether a contested race was on either ballot.",
    unitPhrase: " in primary participation",
  },
};

const pg = {
  metric: "general",
  yearA: 2022,
  yearB: 2024,
  general: {}, // year -> index
  primary: {}, // year -> index
  primaryYears: [],
  composition: {}, // year -> selected races (general only)
  failedRaces: 0,
  geojson: null,
  series: [],
  filtered: [],
  summary: null,
  filters: { ...EMPTY_FILTERS },
  sortKey: "swing",
  sortDir: "asc",
  selected: null,
  detachScatter: null,
  map: null,
  layer: null,
  arrows: null, // L.LayerGroup of the direction arrows
  arrowSizeBy: "impact",
  env: { svg: null },
  kb: [],
};

const $ = (id) => document.getElementById(id);
const svc = boundary();

// ---- data ------------------------------------------------------------------

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
 * Load a cycle's candidate races. A race that will not load is COUNTED, not
 * silently dropped: losing one quietly would shift every precinct's index with
 * nothing on screen to say so.
 */
async function loadCycleRaces(entries) {
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

function precinctUniverse(groups) {
  const codes = new Set();
  for (const races of groups) {
    for (const race of races) {
      for (const row of race.rows) {
        const code = row?.["PRECINCT CODE"];
        if (code != null && code !== "") codes.add(String(code));
      }
    }
  }
  return codes.size;
}

async function load() {
  const [races, all, primaryTurnout] = await Promise.all([
    svc.listRaces(),
    svc.loadAll(), // the map needs the boundaries anyway
    svc.loadPrimaryTurnout(),
  ]);
  pg.geojson = all?.geojson || null;

  const inCycle = (year) =>
    races.filter((e) => e.year === year && COUNTYWIDE_CATEGORIES.has(e.category));
  const raw = {};
  await Promise.all(
    GENERAL_YEARS.map(async (y) => {
      raw[y] = await loadCycleRaces(inCycle(y));
    })
  );

  const precinctCount = precinctUniverse(Object.values(raw));
  if (!precinctCount) throw new Error("No precinct results loaded — cannot measure race coverage");

  for (const y of GENERAL_YEARS) {
    const selected = selectCompositeRaces(raw[y], precinctCount).sort((a, b) =>
      String(a.entry.office).localeCompare(String(b.entry.office))
    );
    pg.composition[y] = selected;
    pg.general[y] = buildPartisanIndex(selected);
  }

  pg.primaryYears = primaryYearsAvailable(primaryTurnout);
  for (const y of pg.primaryYears) pg.primary[y] = buildPrimaryIndex(primaryTurnout, y);
}

// ---- metric / year model ---------------------------------------------------

/** Years the current metric can offer. */
function yearsFor(metric) {
  return metric === "primary" ? pg.primaryYears : GENERAL_YEARS;
}

/**
 * Snap yearA/yearB to a pair the current metric actually supports. The picker
 * can then never express an impossible comparison — the alternative (letting a
 * bad pair through and warning) puts an empty chart on screen and makes the
 * user work out why.
 */
function normalizeYears() {
  const years = yearsFor(pg.metric);
  if (years.length < 2) return;
  if (!years.includes(pg.yearA) || !years.includes(pg.yearB) || pg.yearA >= pg.yearB) {
    pg.yearA = years[years.length - 2];
    pg.yearB = years[years.length - 1];
  }
}

function indexFor(metric, year) {
  return (metric === "primary" ? pg.primary : pg.general)[year] || {};
}

function derive() {
  normalizeYears();
  pg.series = buildSwingSeries(indexFor(pg.metric, pg.yearA), indexFor(pg.metric, pg.yearB));
  pg.filtered = filterSwingSeries(pg.series, pg.filters);
  // The headline describes what is ON SCREEN. Filtering to 20 precincts and
  // still reporting the county-wide number would answer a question nobody asked.
  pg.summary = summarizeSwing(pg.filtered);
}

const labels = () => ({ a: String(pg.yearA), b: String(pg.yearB) });

// ---- formatting ------------------------------------------------------------

function pts(value, decimals = 1) {
  if (value == null || isNaN(value)) return "N/A";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(decimals)}`;
}

function marginText(margin) {
  if (margin == null || isNaN(margin)) return "N/A";
  if (Math.abs(margin) < 0.05) return "even";
  return `${margin > 0 ? "D" : "R"}+${Math.abs(margin).toFixed(1)}`;
}

// ---- rendering: controls ---------------------------------------------------

function renderControls() {
  const years = yearsFor(pg.metric);
  const opts = (selected, list) =>
    list
      .map((y) => `<option value="${y}"${y === selected ? " selected" : ""}>${y}</option>`)
      .join("");

  // yearB only offers years AFTER yearA — the comparison is directional and an
  // inverted pair would silently flip every sign on the page.
  const laterYears = years.filter((y) => y > pg.yearA);

  $("tr-metric").innerHTML = Object.values(METRICS)
    .map(
      (m) =>
        `<button type="button" data-metric="${m.id}" aria-pressed="${m.id === pg.metric}">${escapeHtml(m.label)}</button>`
    )
    .join("");
  $("tr-year-a").innerHTML = opts(pg.yearA, years.slice(0, -1));
  $("tr-year-b").innerHTML = opts(pg.yearB, laterYears);
  $("tr-metric-blurb").textContent = METRICS[pg.metric].blurb;

  const f = pg.filters;
  $("tr-direction").value = f.direction;
  $("tr-flipped").checked = f.flippedOnly;
  $("tr-include-tiny").checked = f.includeTiny;
  $("tr-swing-min").value = f.swingMin ?? "";
  $("tr-swing-max").value = f.swingMax ?? "";
  $("tr-close").value = f.maxAbsMarginB ?? "";
  $("tr-min-votes").value = f.minVotes ?? "";
  $("tr-min-net").value = f.minNetVotes ?? "";
  $("tr-base").value = f.base;
  $("tr-arrow-size").value = pg.arrowSizeBy;
  $("tr-precincts").value = f.precincts ? [...f.precincts].join(", ") : "";
}

/**
 * Has the USER narrowed anything? Compared against EMPTY_FILTERS rather than
 * against the row count, because hiding tiny electorates is the page's default,
 * not a choice anyone made — counting it as a filter would put a "Clear
 * filters" button on an untouched page and rename the county in the headline.
 */
function filtersActive() {
  return Object.keys(EMPTY_FILTERS).some((k) => {
    const now = pg.filters[k];
    if (k === "precincts") return Boolean(now && now.size);
    return now !== EMPTY_FILTERS[k];
  });
}

function renderCount() {
  const active = filtersActive();
  $("tr-count").innerHTML =
    `Showing <strong>${pg.filtered.length}</strong> of ${pg.series.length} precincts` +
    (active ? ` <button type="button" id="tr-clear">Clear filters</button>` : "");
  if (active) $("tr-clear").addEventListener("click", clearFilters);
}

// ---- rendering: headline ---------------------------------------------------

function renderHeadline() {
  const s = pg.summary;
  const unitPhrase = METRICS[pg.metric].unitPhrase;
  if (!s || !s.comparablePrecincts) {
    $("tr-headline").innerHTML = `<p class="empty-note">No precinct matches these filters with results in both ${pg.yearA} and ${pg.yearB}.</p>`;
    return;
  }
  const scope = filtersActive() ? "the precincts you picked" : "Collin County";
  const dir = swingDirection(s.voteWeightedSwing);
  const movement =
    dir === "flat"
      ? `barely moved (${pts(s.voteWeightedSwing)} points)`
      : `moved ${Math.abs(s.voteWeightedSwing).toFixed(1)} points toward ${dir === "dem" ? "Democrats" : "Republicans"}`;

  const tinyCount = pg.filtered.filter((r) => r.swing != null && r.tinyElectorate).length;

  // Both figures are shown because they answer different questions and can
  // point opposite ways: the vote-weighted number is what happened to the
  // electorate, the median is what happened to the typical precinct.
  $("tr-headline").innerHTML =
    `<p class="tr-lede">Between ${pg.yearA} and ${pg.yearB}, ${escapeHtml(scope)} ${escapeHtml(movement)}${escapeHtml(unitPhrase)}.</p>` +
    `<ul class="tr-stats">` +
    `<li><span class="tr-stat-n">${pts(s.voteWeightedSwing)}</span><span class="tr-stat-l">points, vote-weighted</span></li>` +
    `<li><span class="tr-stat-n">${pts(s.medianSwing)}</span><span class="tr-stat-l">points, the typical precinct</span></li>` +
    `<li><span class="tr-stat-n">${s.towardDem}</span><span class="tr-stat-l">precincts moved toward Democrats</span></li>` +
    `<li><span class="tr-stat-n">${s.towardRep}</span><span class="tr-stat-l">precincts moved toward Republicans</span></li>` +
    `<li><span class="tr-stat-n">${votes(s.netVotes)}</span><span class="tr-stat-l">net votes, Dem minus Rep</span></li>` +
    `<li><span class="tr-stat-n">${s.flippedToDem + s.flippedToRep}</span><span class="tr-stat-l">precincts changed which party led (${s.flippedToDem} D, ${s.flippedToRep} R)</span></li>` +
    `</ul>` +
    // Both bases on their own. This is the sentence the margin cannot tell you,
    // and on this data it is the most surprising true thing on the page.
    `<p class="tr-bases">Democratic votes ${s.demChange >= 0 ? "grew" : "fell"} by ` +
    `<strong class="tr-swing-dem">${votes(Math.abs(s.demChange) * (s.demChange < 0 ? -1 : 1)).replace("+", "")}</strong>` +
    ` while Republican votes ${s.repChange >= 0 ? "grew" : "fell"} by ` +
    `<strong class="tr-swing-rep">${votes(Math.abs(s.repChange) * (s.repChange < 0 ? -1 : 1)).replace("+", "")}</strong>. ` +
    (s.demGrewButMovedRep
      ? `<strong>${s.demGrewButMovedRep}</strong> precinct${s.demGrewButMovedRep === 1 ? "" : "s"} added Democratic votes and still moved Republican` +
        (s.repGrewButMovedDem
          ? `, and ${s.repGrewButMovedDem} did the mirror image`
          : "") +
        ` — a share can fall while a base grows.`
      : "") +
    `</p>` +
    `<p class="tr-note">${s.comparablePrecincts} of these ${s.totalPrecincts} have results in both years. ` +
    `Movement under ${SWING_EPSILON} points counts as no real change.` +
    (tinyCount
      ? ` ${tinyCount} cast fewer than ${TINY_ELECTORATE_PER_RACE} votes per race, where a single ballot swings the percentage — ${tinyCount === 1 ? "it keeps its" : "they keep their"} row and real counts, but ${tinyCount === 1 ? "is" : "are"} left off the chart and marked "too few votes" on the map.`
      : "") +
    (pg.failedRaces
      ? ` <strong>${pg.failedRaces} race ${pg.failedRaces === 1 ? "file" : "files"} could not be loaded</strong>, so these figures are incomplete — reload to try again.`
      : "") +
    `</p>`;
}

function renderComposition() {
  const wrap = $("tr-what-body");
  if (pg.metric === "primary") {
    wrap.innerHTML =
      `<p>Each year's number is the share of that precinct's primary voters who asked for a Democratic ballot, against those who asked for a Republican one. Nobody is scored or modelled — this is what people actually did.</p>` +
      `<p>It is <strong>not</strong> a general-election result. Primary turnout is a fraction of a general electorate, and it moves sharply with whether a contested race was on either party's ballot that year. County-wide the Democratic share ran 31% in 2022, 26% in 2024 and 48% in 2026 — a genuine shift in who turned out, not a forecast of a November margin.</p>`;
    return;
  }
  const list = (year) => {
    const races = pg.composition[year] || [];
    if (!races.length) return `<li>No qualifying races found.</li>`;
    return races
      .map(
        (r) =>
          `<li>${escapeHtml(r.entry.office)} <span class="tr-cov">${(r.coverage * 100).toFixed(1)}%</span></li>`
      )
      .join("");
  };
  wrap.innerHTML =
    `<p>Texas staggers its ballot, so no office runs in both ${GENERAL_YEARS[0]} and ${GENERAL_YEARS[1]} — the midterm elects the Governor, Lieutenant Governor and Attorney General, the presidential year the President and a US Senator, and even the high courts alternate seats. There is no single race to follow across the two years.</p>` +
    `<p>So each year's number is a <strong>composite</strong>: a precinct's average two-party margin across every contest that reached the whole county's ballot. Averaging the full ticket cancels the effect of any one candidate being unusually popular. Third-party votes are left out of both sides.</p>` +
    `<p>A midterm and a presidential electorate are not the same people, so part of any movement is <em>who turned out</em> rather than <em>who changed their mind</em>.</p>` +
    `<div class="tr-composition">` +
    GENERAL_YEARS.map(
      (y) =>
        `<div class="tr-comp-col"><h3>${y} — ${(pg.composition[y] || []).length} races</h3><ul>${list(y)}</ul></div>`
    ).join("") +
    `</div>`;
}

// ---- rendering: map --------------------------------------------------------

function byPrecinct() {
  const out = {};
  for (const r of pg.series) out[String(r.precinct)] = r;
  return out;
}

function visibleSet() {
  return new Set(pg.filtered.map((r) => String(r.precinct)));
}

function describeFeature(props) {
  const code = String(props?.PRECINCT ?? "");
  const row = pg.series.find((r) => String(r.precinct) === code);
  if (!row) return `Precinct ${code} — no results on file.`;
  return describeSwing(row, labels());
}

function initMap() {
  if (pg.map || !pg.geojson) return;
  const view = createMapView({ containerId: "tr-map" });
  pg.map = view.map;
  pg.env.svg = view.svgRoot();

  const ctx = { byPrecinct: byPrecinct(), visible: visibleSet(), selected: pg.selected, env: pg.env };
  pg.layer = L.geoJSON(pg.geojson, {
    style: (f) => swingStyle(f, ctx),
    onEachFeature: (feature, lyr) => {
      const code = String(feature.properties.PRECINCT);
      lyr.on("click", () => select(code));
      // The readout card carries the same sentence and link, but it sits below
      // BOTH panels — on a tablet that is a scroll away from the polygon you
      // just tapped. The popup puts the way onward where the tap happened.
      // Content is a function so it re-reads the current metric and years
      // instead of freezing whatever was true when the layer was built.
      lyr.bindPopup(() => precinctPopupHTML(code), { className: "tr-popup", maxWidth: 280 });
    },
  }).addTo(pg.map);

  fitToLayer(pg.map, pg.layer);
  pg.kb = decoratePrecinctPaths(pg.layer, { describe: describeFeature });
  wirePrecinctKeyboard($("tr-map"), { getKb: () => pg.kb, onPick: select });

  // Leaflet only creates the overlay SVG when the first layer lands on the
  // map, so svgRoot() is null during that first style pass and every polygon
  // silently falls back to a FLAT colour — which would break the "never colour
  // alone" rule the whole map depends on. Grab it now and restyle once so the
  // patterns actually attach.
  pg.env.svg = view.svgRoot();
  if (pg.env.svg) restyleMap();
}

/** What a tapped precinct says on the map: the reading, then the way onward. */
function precinctPopupHTML(code) {
  const row = pg.series.find((r) => String(r.precinct) === String(code));
  const line = row
    ? describeSwing(row, labels())
    : `Precinct ${code}: no results for ${pg.yearA} and ${pg.yearB}.`;
  return (
    `<p class="tr-pop-line">${escapeHtml(line)}</p>` +
    `<p class="tr-pop-link"><a href="precinct.html#precinct=${encodeURIComponent(code)}">Open precinct ${escapeHtml(String(code))} report</a></p>`
  );
}

/**
 * Draw one arrow per visible precinct at its polygon's centre.
 *
 * Arrows are non-interactive: the polygon underneath already owns the click,
 * the keyboard focus and the aria-label, and a second focusable thing on top of
 * it would just be a duplicate tab stop announcing the same precinct twice.
 */
function renderArrows() {
  if (!pg.map || !pg.layer) return;
  if (!pg.arrows) pg.arrows = L.layerGroup().addTo(pg.map);
  pg.arrows.clearLayers();

  const visible = visibleSet();
  const rows = pg.filtered.filter((r) => r.swing != null && !r.tinyElectorate);
  const scale = makeArrowScale(rows, pg.arrowSizeBy);
  const byCode = {};
  for (const r of rows) byCode[String(r.precinct)] = r;

  pg.layer.eachLayer((lyr) => {
    const code = String(lyr.feature?.properties?.PRECINCT ?? "");
    if (!visible.has(code)) return;
    const row = byCode[code];
    if (!row) return;
    const html = arrowSVG(row, scale);
    if (!html) return;
    L.marker(lyr.getBounds().getCenter(), {
      interactive: false,
      keyboard: false,
      // The inner wrapper carries the centring transform: Leaflet owns the
      // outer element's transform for positioning, so putting ours there too
      // would fight it and the arrow would land off its precinct.
      icon: L.divIcon({ className: "tr-arrow", html: `<div class="tr-arrow-inner">${html}</div>`, iconSize: null }),
    }).addTo(pg.arrows);
  });
}

/**
 * Restyle in place rather than rebuilding the layer. Rebuilding 273 polygons
 * on every filter keystroke drops frames on an iPad and throws away the
 * keyboard decoration; a restyle keeps both.
 */
function restyleMap() {
  if (!pg.layer) return;
  const ctx = { byPrecinct: byPrecinct(), visible: visibleSet(), selected: pg.selected, env: pg.env };
  pg.layer.eachLayer((lyr) => lyr.setStyle(swingStyle(lyr.feature, ctx)));
  for (const lyr of pg.kb) {
    lyr._path?.setAttribute("aria-label", describeFeature(lyr.feature.properties));
  }
  renderArrows();
}

function renderLegend() {
  const { bands, silences } = swingLegend(pg.filtered);
  // Swatches reference the SAME pattern defs the polygons use (url(#id)
  // resolves document-wide), so the legend can never drift from the map — a
  // flat-colour legend beside a hatched map is a legend that lies.
  // Band rows draw the SAME arrow the map draws (via the same arrowSVG), so
  // the key can never describe a mark the map isn't making. Silence rows keep
  // their pattern swatch — they have no arrow by definition.
  // Key arrows are drawn at ONE fixed length: they name the direction, while
  // length is the switchable channel the caption below explains.
  const KEY_ARROW = 18;
  const swatch = (b) =>
    b.arrow
      ? arrowSVG({ swing: b.arrow === "up" ? 10 : -10, tinyElectorate: false }, () => KEY_ARROW)
      : b.kind
        ? swatchSVG(patternFill(pg.env.svg, b.kind, b.level, b.color), { size: 22 })
        : `<span class="tr-sw-flat" aria-hidden="true"></span>`;
  const row = (b) =>
    `<li>${swatch(b)}<span class="tr-legend-name">${escapeHtml(b.name)}</span>` +
    `<span class="tr-legend-range">${escapeHtml(
      b.range ?? (b.strong ? `${b.strong} by more than 10 points` : "")
    )}</span>` +
    `<span class="tr-legend-count">${b.count}</span></li>`;
  const lengthNote =
    pg.arrowSizeBy === "impact"
      ? "Arrow length is net votes moved — a big percentage swing in a small precinct draws a short arrow."
      : "Arrow length is the swing in percentage points, regardless of how many votes that is.";
  $("tr-legend").innerHTML =
    `<ul class="tr-legend-list">${[...bands, ...silences].map(row).join("")}</ul>` +
    `<p class="tr-legend-note">${escapeHtml(lengthNote)}</p>`;
}

// ---- rendering: scatter, readout, table ------------------------------------

function renderScatter() {
  pg.detachScatter?.();
  $("tr-chart").innerHTML = swingScatterHTML(pg.filtered, {
    labels: labels(),
    selected: pg.selected,
  });
  pg.detachScatter = attachSwingScatter($("tr-chart"), { onSelect: select });
}

function renderReadout() {
  const row = pg.series.find((r) => String(r.precinct) === String(pg.selected));
  if (!row) {
    $("tr-readout").innerHTML = `<p class="tr-readout-empty">Pick a precinct on the map or the chart — or use the arrow keys — to see its numbers.</p>`;
    return;
  }
  const inView = pg.filtered.some((r) => String(r.precinct) === String(row.precinct));
  $("tr-readout").innerHTML =
    `<p class="tr-readout-line">${escapeHtml(describeSwing(row, labels()))}</p>` +
    (inView ? "" : `<p class="tr-readout-flag">This precinct is filtered out of the current view.</p>`) +
    // The per-precinct version of the base story: raw votes for each party in
    // each year, so "the margin moved Rep" and "we gained Democratic votes" can
    // both be read off the same card instead of contradicting each other.
    (row.demA != null && row.demB != null
      ? `<table class="tr-base-table"><caption>Votes per race</caption><tr><th></th><th>${pg.yearA}</th><th>${pg.yearB}</th><th>Change</th></tr>` +
        `<tr><th scope="row" class="tr-swing-dem">Dem</th><td>${formatNumberOrNA(Math.round(row.demA))}</td><td>${formatNumberOrNA(Math.round(row.demB))}</td><td class="tr-swing-dem">${escapeHtml(votes(row.demChange))}</td></tr>` +
        `<tr><th scope="row" class="tr-swing-rep">Rep</th><td>${formatNumberOrNA(Math.round(row.repA))}</td><td>${formatNumberOrNA(Math.round(row.repB))}</td><td class="tr-swing-rep">${escapeHtml(votes(row.repChange))}</td></tr>` +
        `<tr><th scope="row">Net</th><td colspan="2"></td><td class="tr-swing-${(row.netVotes ?? 0) >= 0 ? "dem" : "rep"}"><strong>${escapeHtml(votes(row.netVotes))}</strong></td></tr>` +
        `</table>`
      : "") +
    (row.demGrewButMovedRep
      ? `<p class="tr-readout-flag">The Democratic base here grew — the margin moved Republican because the Republican base grew faster.</p>`
      : "") +
    (row.repGrewButMovedDem
      ? `<p class="tr-readout-flag">The Republican base here grew — the margin moved Democratic because the Democratic base grew faster.</p>`
      : "") +
    `<p class="tr-readout-meta">` +
    `<a href="precinct.html#precinct=${encodeURIComponent(row.precinct)}">Open precinct ${escapeHtml(row.precinct)} report</a>` +
    `</p>`;
}

// Signed vote count: "+312" / "−87". Rounded because the composite averages
// across races and a fractional vote is not a thing anyone can act on.
function votes(value) {
  if (value == null || isNaN(value)) return "N/A";
  const n = Math.round(value);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString()}`;
}

function columns() {
  return [
    {
      id: "precinct",
      label: "Precinct",
      pinned: true,
      cellHTML: (r) =>
        `<td class="pin-col pin-col-0 tr-cell-precinct"><a href="precinct.html#precinct=${encodeURIComponent(r.precinct)}">${escapeHtml(r.precinct)}</a></td>`,
    },
    { id: "marginA", label: `${pg.yearA}`, cellClass: "num", format: marginText },
    { id: "marginB", label: `${pg.yearB}`, cellClass: "num", format: marginText },
    {
      id: "swing",
      label: "Swing (points)",
      cellHTML: (r) => {
        const dir = swingDirection(r.swing);
        const text = r.swing == null ? "N/A" : pts(r.swing);
        // The arrow is a second, non-colour channel for direction — same
        // reason the scatter uses triangles and the map uses hatching.
        const arrow = r.swing == null ? "" : dir === "dem" ? "↑ " : dir === "rep" ? "↓ " : "→ ";
        return `<td class="num tr-swing tr-swing-${dir}">${arrow}${escapeHtml(text)}</td>`;
      },
    },
    {
      id: "netVotes",
      label: "Net votes",
      headerAttrs: { title: "Change in the Democratic-minus-Republican vote gap. This is impact: a big swing in a tiny precinct barely moves it." },
      cellHTML: (r) => {
        const cls = r.netVotes == null ? "flat" : r.netVotes > 0 ? "dem" : r.netVotes < 0 ? "rep" : "flat";
        // Its own class, not `tr-swing`: two columns sharing one selector makes
        // every "the swing cell" query ambiguous.
        return `<td class="num tr-net tr-swing-${cls}">${escapeHtml(votes(r.netVotes))}</td>`;
      },
    },
    {
      id: "demChange",
      label: "Dem votes",
      headerAttrs: { title: "Change in Democratic votes on their own — a precinct can gain Democratic votes and still move Republican." },
      cellClass: "num tr-swing-dem",
      format: votes,
    },
    { id: "repChange", label: "Rep votes", cellClass: "num tr-swing-rep", format: votes },
    {
      id: "flipped",
      label: "Flipped?",
      format: (_v, r) => (r.flipped ? (r.marginB >= 0 ? "→ Dem" : "→ Rep") : ""),
    },
    {
      id: "votesPerRaceB",
      label: `${pg.yearB} votes cast`,
      cellClass: "num",
      format: (v) => formatNumberOrNA(v == null ? null : Math.round(v)),
    },
  ];
}

function sortedRows() {
  const dir = pg.sortDir === "asc" ? 1 : -1;
  return [...pg.filtered].sort((a, b) => {
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
    columns: columns(),
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
    emptyMessage: "No precinct matches these filters.",
    batch: 60,
  });
}

// ---- state changes ---------------------------------------------------------

/**
 * The "Go to precinct" list. Offers EVERY precinct in the series, not just the
 * filtered ones: someone who types a number they already care about should land
 * on it rather than be told it does not exist, so a hidden pick is selected and
 * labelled as hidden instead of refused. Each option carries its swing so the
 * open dropdown is a readable index, not 268 bare numbers.
 */
function renderPrecinctOptions() {
  const cycle = labels();
  const rows = [...pg.series].sort(
    (a, b) => (Number(a.precinct) || 0) - (Number(b.precinct) || 0)
  );
  $("tr-precinct-options").innerHTML = rows
    .map((r) => {
      const dir = r.swing == null ? null : swingDirection(r.swing);
      const note =
        r.swing == null
          ? `only voted in ${r.marginA != null ? cycle.a : cycle.b}`
          : dir === "flat"
            ? "essentially unchanged"
            : `${Math.abs(r.swing).toFixed(1)} pts toward ${dir === "dem" ? "Democrats" : "Republicans"}`;
      return `<option value="${escapeHtml(String(r.precinct))}" label="${escapeHtml(`Precinct ${r.precinct} — ${note}`)}"></option>`;
    })
    .join("");
}

/** Keep the jump box showing whatever is selected, however it got selected. */
function syncPrecinctJump() {
  const box = $("tr-precinct-jump");
  if (!box) return;
  if (document.activeElement !== box) box.value = pg.selected || "";
  const hidden =
    pg.selected != null &&
    pg.series.some((r) => String(r.precinct) === String(pg.selected)) &&
    !pg.filtered.some((r) => String(r.precinct) === String(pg.selected));
  const note = $("tr-jump-note");
  if (note) note.remove();
  if (hidden) {
    box.insertAdjacentHTML(
      "afterend",
      `<p class="tr-jump-miss" id="tr-jump-note">Precinct ${escapeHtml(String(pg.selected))} is hidden by your filters.</p>`
    );
  }
}

function renderAll() {
  derive();
  renderControls();
  renderPrecinctOptions();
  renderCount();
  renderHeadline();
  renderComposition();
  renderScatter();
  renderLegend();
  restyleMap();
  renderReadout();
  renderTable();
  syncPrecinctJump();
}

function publish() {
  writeParams({
    metric: pg.metric === "general" ? null : pg.metric,
    ya: String(pg.yearA),
    yb: String(pg.yearB),
    precinct: pg.selected || null,
  });
}

function select(precinct) {
  const next = precinct == null ? null : String(precinct);
  if (String(pg.selected) === String(next)) return;
  pg.selected = next;
  publish();
  restyleMap();
  $("tr-chart")
    .querySelectorAll(".sc-mark.is-selected")
    .forEach((el) => el.classList.remove("is-selected"));
  for (const el of $("tr-chart").querySelectorAll(".sc-mark")) {
    if (el.dataset.precinct === pg.selected) {
      el.classList.add("is-selected");
      break;
    }
  }
  renderReadout();
  renderTable();
  syncPrecinctJump();
}

function setMetric(metric) {
  if (!METRICS[metric] || pg.metric === metric) return;
  pg.metric = metric;
  normalizeYears();
  publish();
  renderAll();
}

function clearFilters() {
  pg.filters = { ...EMPTY_FILTERS };
  renderAll();
}

// Parse the precinct box: "12, 15 40" -> Set{"12","15","40"}; empty -> null.
function parsePrecincts(text) {
  const codes = String(text || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return codes.length ? new Set(codes) : null;
}

const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));

function readFilterInputs() {
  pg.filters = {
    ...pg.filters,
    direction: $("tr-direction").value,
    flippedOnly: $("tr-flipped").checked,
    includeTiny: $("tr-include-tiny").checked,
    swingMin: numOrNull($("tr-swing-min").value),
    swingMax: numOrNull($("tr-swing-max").value),
    maxAbsMarginB: numOrNull($("tr-close").value),
    minVotes: numOrNull($("tr-min-votes").value),
    minNetVotes: numOrNull($("tr-min-net").value),
    base: $("tr-base").value,
    precincts: parsePrecincts($("tr-precincts").value),
  };
  renderAll();
}

// ---- boot ------------------------------------------------------------------

function wireControls() {
  $("tr-metric").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-metric]");
    if (btn) setMetric(btn.dataset.metric);
  });
  $("tr-year-a").addEventListener("change", (e) => {
    pg.yearA = Number(e.target.value);
    if (pg.yearB <= pg.yearA) {
      const later = yearsFor(pg.metric).filter((y) => y > pg.yearA);
      pg.yearB = later[0] ?? pg.yearB;
    }
    publish();
    renderAll();
  });
  $("tr-year-b").addEventListener("change", (e) => {
    pg.yearB = Number(e.target.value);
    publish();
    renderAll();
  });

  const debounced = debounce(readFilterInputs, 200);
  for (const id of ["tr-swing-min", "tr-swing-max", "tr-close", "tr-min-votes", "tr-min-net", "tr-precincts"]) {
    $(id).addEventListener("input", debounced);
  }
  for (const id of ["tr-direction", "tr-flipped", "tr-include-tiny", "tr-base"]) {
    $(id).addEventListener("change", readFilterInputs);
  }
  $("tr-arrow-size").addEventListener("change", (e) => {
    pg.arrowSizeBy = e.target.value;
    renderArrows();
    renderLegend();
  });

  // Picking from the datalist fires `input`, so a mouse pick and a fully typed
  // number take the same path. Anything that is not yet a real precinct is left
  // alone — mid-typing "2" on the way to "212" must not jump to precinct 2.
  const jump = $("tr-precinct-jump");
  const jumpTo = (raw) => {
    const code = String(raw || "").trim();
    if (!code) return select(null);
    const hit = pg.series.find((r) => String(r.precinct) === code);
    if (hit) select(hit.precinct);
  };
  jump.addEventListener("input", (e) => jumpTo(e.target.value));
  jump.addEventListener("change", (e) => jumpTo(e.target.value));
  jump.addEventListener("blur", () => syncPrecinctJump());
}

async function init() {
  try {
    await load();
  } catch (err) {
    console.error("[trends] failed to load", err);
    $("tr-chart").innerHTML = `<p class="empty-note">Could not load election results. Reload the page to try again.</p>`;
    $("tr-body").innerHTML = `<tr><td class="empty-note" colspan="6">No data.</td></tr>`;
    return;
  }

  const params = readParams();
  if (params.metric && METRICS[params.metric]) pg.metric = params.metric;
  if (params.ya) pg.yearA = Number(params.ya);
  if (params.yb) pg.yearB = Number(params.yb);
  if (params.precinct) pg.selected = String(params.precinct);
  normalizeYears();

  wireControls();
  derive();
  initMap();
  renderAll();

  // Hash-only navigation (a shared link, the back button) never reloads the
  // document, so EVERY param the page writes has to be re-applied here, not
  // just the selection. Tracking only `precinct` meant a pasted link that
  // changed the metric or the years silently kept the old view.
  onChange((next) => {
    const metric = next.metric && METRICS[next.metric] ? next.metric : "general";
    const yearA = next.ya ? Number(next.ya) : pg.yearA;
    const yearB = next.yb ? Number(next.yb) : pg.yearB;
    const viewChanged = metric !== pg.metric || yearA !== pg.yearA || yearB !== pg.yearB;
    if (viewChanged) {
      pg.metric = metric;
      pg.yearA = yearA;
      pg.yearB = yearB;
      pg.selected = next.precinct ? String(next.precinct) : null;
      renderAll();
      return;
    }
    select(next.precinct ? String(next.precinct) : null);
  });
}

init();
