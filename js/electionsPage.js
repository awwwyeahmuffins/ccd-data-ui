// electionsPage.js
// --------------------------------------------------------------------------------
// Orchestrator for elections.html — the full-page race catalog. Browse/search
// every race for a county or district; each race links to the map view and to
// the forecast page. Must not import js/app/* modules (index.html-coupled).

import { loadCountyRegistry, setActiveCounty, setActiveBoundary, getBoundaryConfigs, getActiveBoundary, listElectionCSVs } from "./dataLoader.js";
import { CATEGORY_ORDER, searchElections, filterByCategory } from "./electionFilters.js";
import { escapeHtml } from "./utils.js";

const pg = {
  county: 'collin',
  boundary: 'original',
  elections: [],
  search: '',
  category: 'All',
};

const $ = id => document.getElementById(id);

async function initCountySelect() {
  const registry = await loadCountyRegistry();
  const sel = $('el-county');
  const counties = registry.filter(c => c.kind !== 'district' && c.status === 'live');
  const districts = registry.filter(c => c.kind === 'district' && c.status === 'live');

  let html = counties.map(c =>
    `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</option>`).join('');
  const groups = {};
  for (const d of districts) (groups[d.group || 'Districts'] ||= []).push(d);
  for (const [label, items] of Object.entries(groups)) {
    html += `<optgroup label="${escapeHtml(label)}">` + items.map(d =>
      `<option value="${escapeHtml(d.slug)}">${escapeHtml(d.name)}</option>`).join('') + '</optgroup>';
  }
  sel.innerHTML = html;
  sel.value = pg.county;
  if (sel.value !== pg.county) pg.county = sel.value;
  sel.addEventListener('change', () => {
    pg.county = sel.value;
    updateURL();
    loadCounty();
  });
  const bsel = $('el-boundary');
  if (bsel) bsel.addEventListener('change', () => { pg.boundary = bsel.value; updateURL(); loadCounty(); });
}

// Show the 2024⇄2026 boundary toggle only when the county offers >1 set —
// this is how the real March-2026 primary races become browsable.
function renderBoundaryToggle() {
  const configs = getBoundaryConfigs();
  const ids = Object.keys(configs);
  const wrap = $('el-boundary-wrap');
  const sel = $('el-boundary');
  if (!wrap || !sel) return;
  if (ids.length < 2) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  sel.innerHTML = ids.map(id => `<option value="${id}">${escapeHtml(configs[id].label || id)}</option>`).join('');
  sel.value = pg.boundary;
}

async function loadCounty() {
  $('el-list').innerHTML = '<div class="empty-note">Loading…</div>';
  try {
    await setActiveCounty(pg.county);
    const ids = Object.keys(getBoundaryConfigs());
    if (!ids.includes(pg.boundary)) pg.boundary = getActiveBoundary();
    setActiveBoundary(pg.boundary);
    renderBoundaryToggle();
    const note = $('el-boundary-note');
    if (note) note.style.display = pg.boundary === '2026' ? '' : 'none';
    pg.elections = await listElectionCSVs();
    renderChips();
    renderList();
  } catch (err) {
    $('el-list').innerHTML = '<div class="empty-note">Could not load this county’s races.</div>';
    console.error(err);
  }
}

function renderChips() {
  const present = new Set(pg.elections.map(e => e.category).filter(Boolean));
  const cats = ['All', ...CATEGORY_ORDER.filter(c => present.has(c))];
  $('el-chips').innerHTML = cats.map(c =>
    `<button type="button" class="chip${pg.category === c ? ' active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
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
  // Searching or filtering means the user is hunting — expand everything.
  const expandAll = Boolean(pg.search) || pg.category !== 'All';

  $('el-list').innerHTML = catOrder.map((cat, i) => {
    const byYear = byCategory.get(cat);
    const years = [...byYear.keys()].sort((a, b) => (b === 'Undated' ? -1 : b) - (a === 'Undated' ? -1 : a));
    const total = [...byYear.values()].reduce((s, v) => s + v.length, 0);
    const open = expandAll || i === 0;
    const body = years.map(y => `
      <div class="year-heading">${escapeHtml(String(y))}</div>
      ${byYear.get(y)
        .slice()
        .sort((a, b) => (a.displayName || a.filename).localeCompare(b.displayName || b.filename))
        .map(raceRow).join('')}`).join('');
    return `
      <div class="family-group">
        <button type="button" class="family-header" aria-expanded="${open}">
          <span>${escapeHtml(cat)}</span>
          <span class="family-count">${total} race${total === 1 ? '' : 's'}</span>
        </button>
        <div class="family-body" ${open ? '' : 'hidden'}>${body}</div>
      </div>`;
  }).join('');

  $('el-list').querySelectorAll('.family-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = btn.nextElementSibling;
      const open = !body.hidden;
      body.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
    });
  });
}

function raceRow(e) {
  const raceParam = encodeURIComponent(e.raceKey || e.filename);
  const county = encodeURIComponent(pg.county);
  // The year already heads the section — drop a duplicated "(2022)" suffix
  const name = (e.displayName || e.filename).replace(/\s*\(\d{4}\)\s*$/, '');
  return `
    <div class="race-row">
      <span class="race-name">${escapeHtml(name)}</span>
      <span class="race-actions">
        <a class="act-map" href="index.html#county=${county}&race=${raceParam}">View on map</a>
        <a class="act-forecast" href="forecast.html#county=${county}&race=${raceParam}">Forecast</a>
      </span>
    </div>`;
}

// URL state: #county=X (race links carry their own state)
function parseURL() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (params.get('county')) pg.county = params.get('county');
  if (params.get('boundary')) pg.boundary = params.get('boundary');
}

function updateURL() {
  const params = new URLSearchParams();
  if (pg.county !== 'collin') params.set('county', pg.county);
  if (pg.boundary !== 'original') params.set('boundary', pg.boundary);
  const hash = params.toString();
  history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname);
}

let searchTimer = null;
async function init() {
  parseURL();
  await initCountySelect();
  $('el-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      pg.search = e.target.value.trim();
      renderList();
    }, 150);
  });
  await loadCounty();
}

init();
