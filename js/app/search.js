// search.js
// --------------------------------------------------------------------------------
// Precinct search widget on the map (input + dropdown + keyboard navigation).

import { state } from "./state.js";
import { handlePrecinctClick } from "./precinctPanel.js";

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
      label: `Precinct ${p.PRECINCT}`,
      meta: party ? `${party}${strength}` : '',
      properties: p
    };
  }).sort((a, b) => Number(a.code) - Number(b.code));
}

function filterPrecincts(query) {
  const list = getPrecinctList();
  if (!query) return list.slice(0, 8);
  const q = query.trim().replace(/^#/, '');
  return list.filter(item =>
    item.code.startsWith(q) || item.code.includes(q)
  ).slice(0, 8);
}

function renderPrecinctSearchResults(results) {
  if (results.length === 0) {
    precinctSearchResults.innerHTML = '<div class="precinct-search-result" style="opacity:0.5;cursor:default;">No precincts found</div>';
    precinctSearchResults.classList.add('active');
    return;
  }
  precinctSearchResults.innerHTML = results.map((item, i) => `
    <div class="precinct-search-result ${i === precinctSearchIndex ? 'selected' : ''}" data-code="${item.code}">
      <span>${item.label}</span>
      <span class="precinct-search-result-meta">${item.meta}</span>
    </div>
  `).join('');
  precinctSearchResults.classList.add('active');

  // Click handlers on results
  precinctSearchResults.querySelectorAll('.precinct-search-result[data-code]').forEach(el => {
    el.addEventListener('click', () => selectPrecinctByCode(el.dataset.code));
  });
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

export function initPrecinctSearch() {
  precinctSearchInput.addEventListener('input', () => {
    const query = precinctSearchInput.value;
    precinctSearchIndex = -1;
    if (query.length === 0) {
      precinctSearchResults.classList.remove('active');
      return;
    }
    const results = filterPrecincts(query);
    renderPrecinctSearchResults(results);
  });

  precinctSearchInput.addEventListener('focus', () => {
    const query = precinctSearchInput.value;
    if (query.length > 0) {
      const results = filterPrecincts(query);
      renderPrecinctSearchResults(results);
    }
  });

  precinctSearchInput.addEventListener('keydown', (e) => {
    const resultEls = precinctSearchResults.querySelectorAll('.precinct-search-result[data-code]');
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
        selectPrecinctByCode(resultEls[precinctSearchIndex].dataset.code);
      } else if (resultEls.length === 1) {
        selectPrecinctByCode(resultEls[0].dataset.code);
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
