// forecastPage.js
// --------------------------------------------------------------------------------
// Orchestrator for forecast.html — the dedicated scenario-builder page.
// Guided flow: pick race → pick scenario (presets or sliders) → side-by-side
// actual vs simulated outcome. Reuses the root turnout-simulation engine; this
// page must not import js/app/* modules (those are coupled to index.html DOM).

import { boundary } from "./data/dataService.js";
import { getCandidateColumns } from "./electionSchema.js";
import { runFullSimulation } from "./turnoutSimulator.js";
import { PARTY_COLORS } from "./lib/constants.js";
import { escapeHtml } from "./lib/dom.js";
import { formatPrecinctLabel } from "./lib/format.js";
import { readParams, writeParams } from "./lib/urlState.js";
import { createRacePicker } from "./ui/racePicker.js";

// ---------------------------------------------------------------------------
// Page state
// ---------------------------------------------------------------------------
const pg = {
  elections: [],
  entry: null,            // selected manifest entry
  electionData: null,
  candidates: [],
  dncByPrecinct: {},
  multipliers: { Rep: 1.0, Mod: 1.0, Dem: 1.0 },
  preset: 'baseline',
};

const PRESETS = [
  { id: 'baseline',  name: 'What actually happened', desc: 'Turnout exactly as recorded', m: { Rep: 1.0, Mod: 1.0, Dem: 1.0 } },
  { id: 'dem-surge', name: 'Democratic surge',       desc: 'Dem voters turn out 25% stronger', m: { Rep: 1.0, Mod: 1.0, Dem: 1.25 } },
  { id: 'rep-surge', name: 'Republican surge',       desc: 'Rep voters turn out 25% stronger', m: { Rep: 1.25, Mod: 1.0, Dem: 1.0 } },
  { id: 'high',      name: 'Everyone shows up',      desc: 'All groups +25% turnout', m: { Rep: 1.25, Mod: 1.25, Dem: 1.25 } },
  { id: 'low',       name: 'Rainy Tuesday',          desc: 'All groups −25% turnout', m: { Rep: 0.75, Mod: 0.75, Dem: 0.75 } },
  { id: 'custom',    name: 'Custom',                 desc: 'Set each slider yourself', m: null },
];

const SLIDER_GROUPS = [
  { key: 'Rep', label: 'Republican-leaning voters', color: 'var(--color-rep-text)' },
  { key: 'Mod', label: 'Moderate / swing voters',   color: 'var(--color-mod)' },
  { key: 'Dem', label: 'Democratic-leaning voters', color: 'var(--color-dem-text)' },
];

const $ = id => document.getElementById(id);

// The one boundary handle this page uses — the app is pinned to the 2026 set.
const svc = boundary();

// Major statewide/federal contests make the most sense to forecast; list them
// first, the rest after a divider.
function orderRaces(elections) {
  const major = [], rest = [];
  for (const e of elections) {
    ((e.category === 'Federal' || e.category === 'State') ? major : rest).push(e);
  }
  // Federal contests first (President/Senate/House are the natural default),
  // then state; within each, newest year first
  const rank = e => (e.category === 'Federal' ? 0 : 1);
  major.sort((a, b) => rank(a) - rank(b) || (b.year || 0) - (a.year || 0));
  rest.sort((a, b) => (b.year || 0) - (a.year || 0));
  return { major, rest };
}

async function loadRaceCatalog() {
  const status = $('fc-load-status');
  status.textContent = 'Loading races…';
  try {
    const [, elections] = await Promise.all([svc.loadAll(), svc.listRaces()]);
    pg.elections = elections;

    const { major } = orderRaces(elections);
    pg.picker.refresh();

    status.textContent = elections.length ? '' : 'No election data on file yet.';
    if (elections.length) {
      const requested = pg.entry?.filename;
      const first = elections.find(e => e.filename === requested || e.raceKey === requested)
        || major[0] || elections[0];
      await selectRace(first.filename);
    } else {
      pg.electionData = null;
      renderOutcome();
    }
  } catch (err) {
    status.innerHTML = 'We couldn’t load the election data. Check your internet connection, then <button type="button" class="retry-link" onclick="location.reload()">try again</button>.';
    console.error(err);
  }
}

async function selectRace(filename) {
  const status = $('fc-load-status');
  const entry = pg.elections.find(e => e.filename === filename);
  if (!entry) return;
  pg.entry = entry;
  pg.picker.setLabel(entry.displayName || entry.filename);
  pg.picker.ensureGroupOpen(entry.category);
  pg.picker.refresh();
  status.textContent = 'Loading results…';
  try {
    const data = await svc.loadRace(entry);
    pg.electionData = data;
    const headers = data[0] ? Object.keys(data[0]) : [];
    pg.candidates = getCandidateColumns(headers).filter(col => {
      const v = data[0][col];
      return v !== '' && !isNaN(Number(v));
    });

    // Reshape DNC lookup into the precinct-keyed form the simulator consumes
    const { dncLookup } = await svc.loadAll();
    pg.dncByPrecinct = {};
    Object.entries(dncLookup || {}).forEach(([code, row]) => {
      pg.dncByPrecinct[code] = {
        Precinct: row.precinct, Rep: row.rep, Mod: row.mod, Dem: row.dem,
        Total: (row.rep ?? 0) + (row.mod ?? 0) + (row.dem ?? 0)
      };
    });
    status.textContent = '';
    updateURL();
    renderOutcome();
  } catch (err) {
    status.textContent = 'Could not load results for this race.';
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// Step 2: presets + sliders
// ---------------------------------------------------------------------------
function renderPresets() {
  $('fc-presets').innerHTML = PRESETS.map(p => `
    <button type="button" class="preset-btn${pg.preset === p.id ? ' active' : ''}" data-preset="${p.id}">
      <span class="preset-name">${escapeHtml(p.name)}</span>
      <span class="preset-desc">${escapeHtml(p.desc)}</span>
    </button>`).join('');
  $('fc-presets').querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pg.preset = btn.dataset.preset;
      const preset = PRESETS.find(p => p.id === pg.preset);
      if (preset?.m) pg.multipliers = { ...preset.m };
      renderPresets();
      renderSliders();
      renderOutcome();
    });
  });
}

function renderSliders() {
  $('fc-sliders').innerHTML = SLIDER_GROUPS.map(g => {
    const pct = Math.round(pg.multipliers[g.key] * 100);
    return `
      <div class="slider-block">
        <div class="slider-label">
          <span class="who" style="color:${g.color}">${g.label}</span>
          <span class="meaning" id="fc-meaning-${g.key}">${meaning(pct)}</span>
        </div>
        <input type="range" min="50" max="150" step="5" value="${pct}"
               data-party="${g.key}" aria-label="${g.label} turnout percent" />
      </div>`;
  }).join('');
  $('fc-sliders').querySelectorAll('input[type=range]').forEach(input => {
    input.addEventListener('input', () => {
      const pct = Number(input.value);
      pg.multipliers[input.dataset.party] = pct / 100;
      $(`fc-meaning-${input.dataset.party}`).textContent = meaning(pct);
      // moving any slider means we're in custom territory
      if (pg.preset !== 'custom') { pg.preset = 'custom'; renderPresets(); }
      scheduleSim();
    });
  });
}

function meaning(pct) {
  if (pct === 100) return 'turnout as it happened (100%)';
  if (pct > 100) return `${pct}% — turns out ${pct - 100}% stronger`;
  return `${pct}% — ${100 - pct}% of them stay home`;
}

let simTimer = null;
function scheduleSim() {
  clearTimeout(simTimer);
  simTimer = setTimeout(renderOutcome, 120);
}

// ---------------------------------------------------------------------------
// Step 3: outcome
// ---------------------------------------------------------------------------
function partyColorFor(candidateCol) {
  const party = (candidateCol || '').split(/\s+/)[0];
  return PARTY_COLORS[party] || PARTY_COLORS.default || '#888';
}

function candidateRows(summary, candidates) {
  const ranked = [...candidates]
    .map(c => ({ c, v: summary.candidateTotals[c] || 0, p: summary.candidatePercentages?.[c] || 0 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 4);
  const max = ranked[0]?.v || 1;
  return ranked.map(({ c, v, p }) => `
    <div class="cand-row">
      <div class="cand-name">
        <span>${escapeHtml(c)}</span>
        <span><strong>${v.toLocaleString()}</strong> · ${(p * 100).toFixed(1)}%</span>
      </div>
      <div class="cand-bar"><div style="width:${Math.round(v / max * 100)}%;background:${partyColorFor(c)}"></div></div>
    </div>`).join('');
}

function renderOutcome() {
  const el = $('fc-outcome');
  if (!pg.electionData || !pg.candidates.length) {
    el.innerHTML = '<div class="loading">Pick a race above to see results.</div>';
    return;
  }

  const sim = runFullSimulation(pg.electionData, pg.dncByPrecinct, pg.candidates, pg.multipliers);
  const { originalSummary, simulatedSummary, flippedPrecincts, countyFlipped } = sim;
  if (!originalSummary || !simulatedSummary) {
    el.innerHTML = '<div class="loading">This race has no per-precinct partisan data to simulate from.</div>';
    return;
  }

  const isBaseline = Object.values(pg.multipliers).every(m => m === 1.0);
  const simulatedCount = Object.keys(sim.precinctResults).length;
  const totalPrecincts = pg.electionData.length;

  const flipHtml = isBaseline
    ? `<div class="flip-callout no-change">This is the actual recorded outcome. Pick a scenario above to see what changes.</div>`
    : countyFlipped
      ? `<div class="flip-callout"><strong>The race flips.</strong> Under this scenario the overall winner changes from
           ${escapeHtml(originalSummary.winner?.name || '—')} to ${escapeHtml(simulatedSummary.winner?.name || '—')}.</div>`
      : `<div class="flip-callout no-change">The overall winner doesn’t change under this scenario${
           flippedPrecincts.length ? `, but ${flippedPrecincts.length} precinct${flippedPrecincts.length === 1 ? '' : 's'} flip` : ''}.</div>`;

  const chips = flippedPrecincts.slice(0, 24).map(code =>
    `<a class="flip-chip" href="precinct.html#precinct=${encodeURIComponent(code)}">${escapeHtml(formatPrecinctLabel({ PRECINCT: code }))}</a>`).join('')
    + (flippedPrecincts.length > 24 ? `<span class="flip-chip">+${flippedPrecincts.length - 24} more</span>` : '');

  const raceParam = pg.entry.raceKey || pg.entry.filename;
  el.innerHTML = `
    <div class="outcome-grid">
      <div class="outcome-col">
        <h3>Actual result</h3>
        <p class="outcome-winner">${escapeHtml(originalSummary.winner?.name || 'No votes')}</p>
        ${candidateRows(originalSummary, pg.candidates)}
      </div>
      <div class="outcome-col">
        <h3>Your scenario</h3>
        <p class="outcome-winner">${escapeHtml(simulatedSummary.winner?.name || 'No votes')}</p>
        ${candidateRows(simulatedSummary, pg.candidates)}
      </div>
    </div>
    ${flipHtml}
    ${flippedPrecincts.length && !isBaseline ? `<div class="flip-chips">${chips}</div>` : ''}
    <div class="muted-note">${simulatedCount} of ${totalPrecincts} precincts simulated
      (precincts without partisan-makeup data are left at their actual result).</div>
    <a class="map-link" href="index.html#race=${encodeURIComponent(raceParam)}">
      View this race on the map →</a>
  `;
}

// ---------------------------------------------------------------------------
// URL state (#race=Y) — shareable; legacy #county= links are read-tolerated
// ---------------------------------------------------------------------------
function parseURL() {
  const params = readParams();
  if (params.race) pg.entry = { filename: params.race };
}

function updateURL() {
  writeParams({
    race: pg.entry ? pg.entry.raceKey || pg.entry.filename : null,
  });
}

// ---------------------------------------------------------------------------
async function init() {
  parseURL();
  renderPresets();
  renderSliders();
  // The shared searchable race picker (ui/racePicker.js) — same component as
  // the Map; no Overview row here because the forecast always needs a race.
  pg.picker = createRacePicker({
    root: $('fc-race-select'),
    button: $('fc-race-btn'),
    nameEl: $('fc-race-name'),
    menuEl: $('fc-race-menu'),
    searchInput: $('fc-race-search'),
    listEl: $('fc-race-list'),
    getRaces: () => pg.elections,
    getSelectedId: () => (pg.entry ? pg.entry.raceKey || pg.entry.filename : null),
    onPick: (id) => {
      if (!id) return;
      const e = pg.elections.find((x) => (x.raceKey || x.filename) === id);
      if (e) selectRace(e.filename);
    },
    showOverview: false,
  });
  await loadRaceCatalog();
}

init();
