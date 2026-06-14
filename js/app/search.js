// search.js
// --------------------------------------------------------------------------------
// Search widget on the map: find a precinct by number, OR type a street address
// or place name and we geocode it (statewide) and drop you on the precinct that
// contains it. Address matching is point-in-polygon against the loaded county,
// so the address must be in the county currently shown.

import { state } from "./state.js";
import { handlePrecinctClick } from "./precinctPanel.js";
import { formatPrecinctLabel, escapeHtml } from "../utils.js";
import { findPrecinctForAddress, TEXAS_VIEWBOX } from "../geoLookup.js";

const precinctSearchInput = document.getElementById('precinct-search-input-map');
const precinctSearchResults = document.getElementById('precinct-search-results');
let precinctSearchIndex = -1;

export function getPrecinctList() {
  if (!state.geojsonData) return [];
  return state.geojsonData.features.map(f => {
    const p = f.properties;
    const party = p.winningParty || '';
    const strength = p.partyStrength != null ? ` (${p.partyStrength}/3)` : '';
    return {
      code: String(p.PRECINCT),
      label: formatPrecinctLabel(p),
      meta: party ? `${party}${strength}` : '',
      properties: p
    };
  }).sort((a, b) =>
    // numeric codes sort numerically; district/texas codes ("collin:42",
    // county slugs) fall back to locale order
    (Number(a.code) - Number(b.code)) || a.code.localeCompare(b.code)
  );
}

function filterPrecincts(query) {
  const list = getPrecinctList();
  if (!query) return list.slice(0, 8);
  const q = query.trim().replace(/^#/, '');
  return list.filter(item =>
    item.code.startsWith(q) || item.code.includes(q)
  ).slice(0, 8);
}

// A query is "address-like" when it isn't purely a precinct code — it has a
// space, a comma, or letters. Numbers-only stays a precinct-number search so
// we never geocode "1042".
function looksLikeAddress(query) {
  const s = query.trim();
  if (!s) return false;
  return /[,\s]/.test(s) || /[a-zA-Z]/.test(s);
}

function staticResult(text) {
  precinctSearchResults.innerHTML =
    `<div class="precinct-search-result" style="opacity:0.6;cursor:default;">${escapeHtml(text)}</div>`;
  precinctSearchResults.classList.add('active');
}

function renderPrecinctSearchResults(results, addressQuery) {
  let rows = results.map((item, i) => `
    <div class="precinct-search-result ${i === precinctSearchIndex ? 'selected' : ''}" data-code="${escapeHtml(item.code)}">
      <span>${escapeHtml(item.label)}</span>
      <span class="precinct-search-result-meta">${escapeHtml(item.meta)}</span>
    </div>
  `);

  if (addressQuery) {
    rows.push(`
      <div class="precinct-search-result precinct-search-result-address" data-address="${escapeHtml(addressQuery)}">
        <span>📍 Find address: “${escapeHtml(addressQuery)}”</span>
        <span class="precinct-search-result-meta">in this county</span>
      </div>
    `);
  }

  if (rows.length === 0) {
    staticResult('No precincts found');
    return;
  }

  precinctSearchResults.innerHTML = rows.join('');
  precinctSearchResults.classList.add('active');

  precinctSearchResults.querySelectorAll('.precinct-search-result[data-code]').forEach(el => {
    el.addEventListener('click', () => selectPrecinctByCode(el.dataset.code));
  });
  precinctSearchResults.querySelectorAll('.precinct-search-result[data-address]').forEach(el => {
    el.addEventListener('click', () => runAddressSearch(el.dataset.address));
  });
}

async function runAddressSearch(query) {
  const features = state.geojsonData?.features || [];
  staticResult('Finding address…');
  let result;
  try {
    result = await findPrecinctForAddress(query, features, fetch, TEXAS_VIEWBOX);
  } catch (err) {
    console.error('[Search] address lookup failed:', err);
    staticResult('Address lookup unavailable — try again');
    return;
  }
  if (!result) {
    staticResult('No match for that address');
    return;
  }
  if (!result.code) {
    staticResult('That address is outside the county shown. Switch counties from the menu above.');
    return;
  }
  selectPrecinctByCode(result.code);
}

export function selectPrecinctByCode(code) {
  if (!state.geojsonLayer) return;

  // Find the matching layer
  let targetLayer = null;
  let targetFeature = null;
  state.geojsonLayer.eachLayer(layer => {
    if (String(layer.feature.properties.PRECINCT) === String(code)) {
      targetLayer = layer;
      targetFeature = layer.feature;
    }
  });

  if (!targetLayer || !targetFeature) return;

  // Fly to precinct bounds
  state.map.flyToBounds(targetLayer.getBounds(), { maxZoom: 14, padding: [40, 40] });

  // Trigger click behavior
  handlePrecinctClick(targetFeature, targetLayer);

  // Clear search
  precinctSearchInput.value = '';
  precinctSearchResults.classList.remove('active');
  precinctSearchIndex = -1;
}

function handleQuery(query) {
  precinctSearchIndex = -1;
  if (query.length === 0) {
    precinctSearchResults.classList.remove('active');
    return;
  }
  const matches = filterPrecincts(query);
  renderPrecinctSearchResults(matches, looksLikeAddress(query) ? query.trim() : null);
}

function activateResult(el) {
  if (!el) return;
  if (el.dataset.code) selectPrecinctByCode(el.dataset.code);
  else if (el.dataset.address) runAddressSearch(el.dataset.address);
}

export function initPrecinctSearch() {
  precinctSearchInput.addEventListener('input', () => {
    handleQuery(precinctSearchInput.value);
  });

  precinctSearchInput.addEventListener('focus', () => {
    if (precinctSearchInput.value.length > 0) handleQuery(precinctSearchInput.value);
  });

  precinctSearchInput.addEventListener('keydown', (e) => {
    const resultEls = precinctSearchResults.querySelectorAll('.precinct-search-result[data-code], .precinct-search-result[data-address]');
    if (resultEls.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      precinctSearchIndex = Math.min(precinctSearchIndex + 1, resultEls.length - 1);
      resultEls.forEach((el, i) => el.classList.toggle('selected', i === precinctSearchIndex));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      precinctSearchIndex = Math.max(precinctSearchIndex - 1, 0);
      resultEls.forEach((el, i) => el.classList.toggle('selected', i === precinctSearchIndex));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (precinctSearchIndex >= 0 && precinctSearchIndex < resultEls.length) {
        activateResult(resultEls[precinctSearchIndex]);
      } else {
        // No explicit selection: prefer a single precinct match, else the
        // address action if the query looks like an address.
        const codeEls = [...resultEls].filter(el => el.dataset.code);
        const addrEl = [...resultEls].find(el => el.dataset.address);
        if (codeEls.length === 1 && !addrEl) activateResult(codeEls[0]);
        else if (addrEl) activateResult(addrEl);
        else if (codeEls.length >= 1) activateResult(codeEls[0]);
      }
    } else if (e.key === 'Escape') {
      precinctSearchResults.classList.remove('active');
      precinctSearchInput.blur();
    }
  });

  // Close results when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#precinct-search-widget')) {
      precinctSearchResults.classList.remove('active');
    }
  });
}
