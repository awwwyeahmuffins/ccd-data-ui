// mapRendering.js
// --------------------------------------------------------------------------------
// The five map render paths (neutral, demographics, turnout, election winner,
// election margin) and the Leaflet legend control. Leaflet's `L` is a global.

import { state } from "./state.js";
import { handlePrecinctClick } from "./precinctPanel.js";
import { PARTY_COLORS, PRECINCT_STYLE, PARTY_STRENGTH_COLORS } from "../constants.js";
import { getRowPrecinctCode } from "../utils.js";
import { getHeatmapStyle, getHeatmapLegendHTML } from "../demographicHeatmap.js";
import { getMarginStyle, getMarginLegendHTML } from "../marginView.js";

// Render neutral map (gray outlines, no coloring) — used when election view has no data
export function renderNeutralMap() {
  if (state.geojsonLayer) {
    state.map.removeLayer(state.geojsonLayer);
  }
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const neutralFill = isDark ? '#888' : '#d0d0d0';
  const neutralOpacity = isDark ? 0.45 : 0.3;
  const neutralBorder = isDark ? '#aaa' : '#999';
  state.geojsonLayer = L.geoJSON(state.geojsonData, {
    style: () => ({
      ...PRECINCT_STYLE.default,
      fillColor: neutralFill,
      fillOpacity: neutralOpacity,
      weight: 1,
      color: neutralBorder
    }),
    onEachFeature: (feature, layer) => {
      layer.on('mouseover', () => {
        layer.setStyle({ weight: 2, fillOpacity: neutralOpacity + 0.2 });
        layer.bringToFront();
      });
      layer.on('mouseout', () => {
        if (state.selectedLayer !== layer) {
          layer.setStyle({ weight: 1, fillOpacity: neutralOpacity });
        }
      });
      layer.on('click', () => handlePrecinctClick(feature, layer));
    }
  }).addTo(state.map);
  updateMapLegend();
}

// Render demographics map (party lean coloring)
export function renderDemographicsMap() {
  if (state.geojsonLayer) {
    state.map.removeLayer(state.geojsonLayer);
  }

  const useHeatmap = state.heatmapMetric && state.censusProfiles;
  const allFeatures = state.geojsonData?.features || [];

  state.geojsonLayer = L.geoJSON(state.geojsonData, {
    style: (feature) => useHeatmap
      ? getHeatmapStyle(feature, state.heatmapMetric, state.censusProfiles, allFeatures)
      : getPartyLeanStyle(feature),
    onEachFeature: (feature, layer) => {
      layer.on('mouseover', () => {
        layer.setStyle({ weight: PRECINCT_STYLE.default.weight + 1 });
        layer.bringToFront();
      });
      layer.on('mouseout', () => {
        if (state.selectedLayer !== layer) {
          layer.setStyle({ weight: PRECINCT_STYLE.default.weight });
        }
      });
      layer.on('click', () => handlePrecinctClick(feature, layer));
    }
  }).addTo(state.map);

  // Update legend
  updateMapLegend();
}

// Get style based on party lean (DNC data)
function getPartyLeanStyle(feature) {
  const props = feature.properties;
  const party = props.winningParty;
  const strength = props.partyStrength || 1;

  if (!party || !PARTY_STRENGTH_COLORS[party]) {
    return {
      ...PRECINCT_STYLE.default,
      fillColor: '#cccccc'
    };
  }

  const strengthColors = PARTY_STRENGTH_COLORS[party];
  const fillColor = strengthColors[strength] || strengthColors.default;

  return {
    ...PRECINCT_STYLE.default,
    fillColor
  };
}

// Render turnout map (voter turnout by precinct)
export function renderTurnoutMap() {
  if (!state.geojsonLayer) return;

  // If we have election data, use its turnout; otherwise use DNC data
  const electionData = state.currentElectionData;
  const electionByPrecinct = {};

  if (electionData) {
    electionData.forEach(row => {
      const precinctCode = getRowPrecinctCode(row);
      if (precinctCode) {
        electionByPrecinct[precinctCode] = row;
      }
    });
  }

  state.geojsonLayer.eachLayer(layer => {
    const props = layer.feature.properties;
    const precinctCode = String(props.PRECINCT);
    const electionRow = electionByPrecinct[precinctCode];

    // Calculate turnout percentage
    let turnout = 0;
    const ballotsCast = electionRow?.['BALLOTS CAST TOTAL'] || electionRow?.['Total Votes'];
    const registeredVoters = electionRow?.['REGISTERED VOTERS TOTAL'] || electionRow?.['Registered Voters'];
    if (electionRow && ballotsCast && registeredVoters) {
      turnout = (parseInt(ballotsCast) / parseInt(registeredVoters)) * 100;
    } else if (props.registeredVoters && props.registeredVoters > 0) {
      // Fallback to DNC data
      turnout = (props.totalVotes || 0) / props.registeredVoters * 100;
    }

    // Color by turnout level
    let fillColor = '#cccccc';
    if (turnout > 0) {
      if (turnout >= 70) fillColor = '#1a5f2a';
      else if (turnout >= 60) fillColor = '#2e8b3e';
      else if (turnout >= 50) fillColor = '#4caf50';
      else if (turnout >= 40) fillColor = '#81c784';
      else if (turnout >= 30) fillColor = '#c8e6c9';
      else fillColor = '#e8f5e9';
    }

    layer.setStyle({
      fillColor,
      fillOpacity: 0.7,
      weight: 1,
      color: '#444'
    });
  });
}

// Check if a precinct has actual candidate votes in the current election.
// Election CSVs contain ALL precincts; non-participating ones still show
// county-wide ballots cast, so candidate votes are the real signal.
export function precinctHasCandidateVotes(record) {
  if (!record || !state.simulationCandidates) return false;
  for (const name of state.simulationCandidates) {
    if ((Number(record[name]) || 0) > 0) return true;
  }
  return false;
}

export function renderElectionMap(electionData) {
  if (!state.geojsonLayer) return;

  // If margin mode, use margin coloring
  if (state.electionColorMode === 'margin' && state.simulationCandidates) {
    state.geojsonLayer.eachLayer(layer => {
      const style = getMarginStyle(layer.feature, electionData, state.simulationCandidates);
      layer.setStyle(style);
    });
    updateMapLegend();
    return;
  }

  // Default: party winner coloring
  const electionByPrecinct = {};
  electionData.forEach(row => {
    const precinctCode = getRowPrecinctCode(row);
    if (precinctCode) {
      electionByPrecinct[precinctCode] = row;
    }
  });

  state.geojsonLayer.eachLayer(layer => {
    const props = layer.feature.properties;
    const precinctCode = String(props.PRECINCT);
    const electionRow = electionByPrecinct[precinctCode];

    if (electionRow && precinctHasCandidateVotes(electionRow)) {
      const winningParty = electionRow['Winning Party'] || electionRow.winningParty;
      const color = PARTY_COLORS[winningParty] || PARTY_COLORS.default;

      layer.setStyle({
        fillColor: color,
        fillOpacity: 0.7,
        weight: 1,
        color: '#444'
      });
    } else {
      layer.setStyle(PRECINCT_STYLE.notInRace);
    }
  });
  updateMapLegend();
}

// ==========================================================================
// MAP LEGEND
// ==========================================================================
export function addMapLegend() {
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function() {
    const div = L.DomUtil.create('div', 'map-legend-leaflet');
    L.DomEvent.disableClickPropagation(div);
    div.innerHTML = `
      <div class="legend-container">
        <button class="legend-toggle" aria-label="Toggle legend" title="Toggle legend">
          <span class="legend-toggle-icon">Legend</span>
        </button>
        <div class="legend-body">
          <div style="font-weight: 600; margin-bottom: 8px; font-size: 15px;">Party Lean</div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="width: 16px; height: 16px; border-radius: 4px; background: ${PARTY_COLORS.Rep};"></span>
              <span style="font-size: 14px;">Republican</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="width: 16px; height: 16px; border-radius: 4px; background: ${PARTY_COLORS.Dem};"></span>
              <span style="font-size: 14px;">Democrat</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="width: 16px; height: 16px; border-radius: 4px; background: ${PARTY_COLORS.Mod};"></span>
              <span style="font-size: 14px;">Moderate</span>
            </div>
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">Color intensity = strength</div>
        </div>
      </div>
    `;
    // Auto-collapse legend on mobile
    if (window.innerWidth <= 768) {
      div.querySelector('.legend-body').classList.add('collapsed');
      div.querySelector('.legend-toggle-icon').textContent = 'Legend +';
    }
    // Toggle legend body on click
    div.querySelector('.legend-toggle').addEventListener('click', () => {
      div.querySelector('.legend-body').classList.toggle('collapsed');
      div.querySelector('.legend-toggle-icon').textContent =
        div.querySelector('.legend-body').classList.contains('collapsed') ? 'Legend +' : 'Legend';
    });
    return div;
  };
  legend.addTo(state.map);
}

export function updateMapLegend() {
  const legendEl = document.querySelector('.map-legend-leaflet');
  if (!legendEl) return;

  let content;
  if (state.viewMode === 'demographics' && state.heatmapMetric && state.censusProfiles) {
    const allFeatures = state.geojsonData?.features || [];
    content = getHeatmapLegendHTML(state.heatmapMetric, state.censusProfiles, allFeatures);
  } else if (state.viewMode === 'election' && state.electionColorMode === 'margin') {
    content = getMarginLegendHTML();
  } else if (state.viewMode === 'turnout') {
    content = `
      <div style="font-weight: 600; margin-bottom: 8px; font-size: 15px;">Voter Turnout</div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 16px; height: 16px; border-radius: 4px; background: #1a5f2a;"></span>
          <span style="font-size: 14px;">70%+</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 16px; height: 16px; border-radius: 4px; background: #4caf50;"></span>
          <span style="font-size: 14px;">50–70%</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 16px; height: 16px; border-radius: 4px; background: #81c784;"></span>
          <span style="font-size: 14px;">40–50%</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 16px; height: 16px; border-radius: 4px; background: #c8e6c9;"></span>
          <span style="font-size: 14px;">30–40%</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 16px; height: 16px; border-radius: 4px; background: #ccc;"></span>
          <span style="font-size: 14px;">No data</span>
        </div>
      </div>
    `;
  } else if (state.viewMode === 'election' && !state.currentElectionData) {
    // Neutral map — no legend needed, show hint
    content = `<div style="font-size: 14px; color: var(--text-secondary);">Select an election to see results</div>`;
  } else {
    // Default party lean legend
    content = `
      <div style="font-weight: 600; margin-bottom: 8px; font-size: 15px;">Party Lean</div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 16px; height: 16px; border-radius: 4px; background: ${PARTY_COLORS.Rep};"></span>
          <span style="font-size: 14px;">Republican</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 16px; height: 16px; border-radius: 4px; background: ${PARTY_COLORS.Dem};"></span>
          <span style="font-size: 14px;">Democrat</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 16px; height: 16px; border-radius: 4px; background: ${PARTY_COLORS.Mod};"></span>
          <span style="font-size: 14px;">Moderate / Independent</span>
        </div>
      </div>
      <div style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">Color intensity = strength</div>
    `;
  }
  const body = legendEl.querySelector('.legend-body');
  if (body) {
    body.innerHTML = content;
  } else {
    legendEl.innerHTML = `<div class="legend-container"><div class="legend-body">${content}</div></div>`;
  }
}
