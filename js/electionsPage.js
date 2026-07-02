// electionsPage.js
// --------------------------------------------------------------------------------
// Orchestrator for elections.html — the full-page race catalog. Browse/search
// every race on file; each race links to the map view and to the forecast
// page. Must not import js/app/* modules (index.html-coupled).

import { boundary } from "./data/dataService.js";
import { CATEGORY_ORDER, searchElections, filterByCategory } from "./electionFilters.js";
import { escapeHtml } from "./lib/dom.js";
import { readParams } from "./lib/urlState.js";

const pg = {
  elections: [],
  search: '',
  category: 'All',
};

const $ = id => document.getElementById(id);

async function loadRaces() {
  $('el-list').innerHTML = '<div class="empty-note">Loading…</div>';
  try {
    // The app is pinned to the 2026 boundary set; the estimates note always applies.
    const note = $('el-boundary-note');
    if (note) note.style.display = '';
    pg.elections = await boundary().listRaces();
    renderChips();
    renderList();
  } catch (err) {
    $('el-list').innerHTML = '<div class="empty-note">Could not load the race catalog.</div>';
    console.error(err);
  }
}

// Plain-language names for the two abbreviation categories.
const CATEGORY_LABELS = { ISD: 'School (ISD)', MUD: 'Utility (MUD)' };
const catLabel = c => CATEGORY_LABELS[c] || c;
// The marquee contests; the hyper-local categories start collapsed under "All".
const MAJOR_CATS = new Set(['Federal', 'State', 'County']);

function renderChips() {
  const present = new Set(pg.elections.map(e => e.category).filter(Boolean));
  const cats = ['All', ...CATEGORY_ORDER.filter(c => present.has(c))];
  $('el-chips').innerHTML = cats.map(c =>
    `<button type="button" class="chip${pg.category === c ? ' active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(catLabel(c))}</button>`
  ).join('');
  $('el-chips').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      pg.category = chip.dataset.cat;
      renderChips();
      renderList();
    });
  });
}

function visibleElections() {
  let list = pg.elections;
  if (pg.category !== 'All') list = filterByCategory(list, pg.category);
  if (pg.search) list = searchElections(list, pg.search);
  return list;
}

function renderList() {
  const list = visibleElections();
  $('el-count').textContent =
    `${list.length} race${list.length === 1 ? '' : 's'}` +
    (list.length !== pg.elections.length ? ` (of ${pg.elections.length})` : '');

  if (!list.length) {
    $('el-list').innerHTML = '<div class="empty-note">No races match. Try clearing the search or filters.</div>';
    return;
  }

  // Group by category, then year (newest first). Race-family grouping is
  // useless here: county manifests carry hundreds of one-off local races, so
  // nearly every "family" has a single entry.
  const byCategory = new Map();
  for (const e of list) {
    const cat = e.category || 'Other';
    if (!byCategory.has(cat)) byCategory.set(cat, new Map());
    const byYear = byCategory.get(cat);
    const y = e.year || 'Undated';
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(e);
  }
  const catOrder = [...CATEGORY_ORDER, 'Other'].filter(c => byCategory.has(c));

  // Federal / State / County render open — those are the races a precinct
  // chair actually comes for. The hundreds of City/ISD/MUD one-offs collapse
  // behind a tap when browsing "All"; picking their chip or searching opens them.
  $('el-list').innerHTML = catOrder.map(cat => {
    const byYear = byCategory.get(cat);
    const years = [...byYear.keys()].sort((a, b) => (b === 'Undated' ? -1 : b) - (a === 'Undated' ? -1 : a));
    const total = [...byYear.values()].reduce((s, v) => s + v.length, 0);
    const body = years.map(y => `
      <div class="year-heading">${escapeHtml(String(y))}</div>
      ${byYear.get(y)
        .slice()
        .sort((a, b) => (a.displayName || a.filename).localeCompare(b.displayName || b.filename))
        .map(raceRow).join('')}`).join('');
    const collapsible = !MAJOR_CATS.has(cat) && pg.category === 'All' && !pg.search;
    if (collapsible) {
      return `
      <details class="family-group">
        <summary class="family-header">
          <span>${escapeHtml(catLabel(cat))}</span>
          <span class="family-count">${total} race${total === 1 ? '' : 's'} — tap to show</span>
        </summary>
        <div class="family-body">${body}</div>
      </details>`;
    }
    return `
      <section class="family-group">
        <h2 class="family-header">
          <span>${escapeHtml(catLabel(cat))}</span>
          <span class="family-count">${total} race${total === 1 ? '' : 's'}</span>
        </h2>
        <div class="family-body">${body}</div>
      </section>`;
  }).join('');
}

function raceRow(e) {
  const raceParam = encodeURIComponent(e.raceKey || e.filename);
  // The year already heads the section — drop a duplicated "(2022)" suffix
  const name = (e.displayName || e.filename).replace(/\s*\(\d{4}\)\s*$/, '');
  return `
    <div class="race-row">
      <span class="race-name">${escapeHtml(name)}</span>
      <span class="race-actions">
        <a class="act-map" href="index.html#race=${raceParam}">View on map</a>
        <a class="act-forecast" href="forecast.html#race=${raceParam}">Forecast</a>
      </span>
    </div>`;
}

// URL state: this page has none of its own (race links carry their state).
// Legacy #county= links are read-tolerated by simply ignoring the hash.
function parseURL() {
  readParams(); // tolerate any legacy hash without crashing; nothing to consume
}

let searchTimer = null;
async function init() {
  parseURL();
  $('el-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      pg.search = e.target.value.trim();
      renderList();
    }, 150);
  });
  await loadRaces();
}

init();
