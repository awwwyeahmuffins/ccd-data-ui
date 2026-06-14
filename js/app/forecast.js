// forecast.js
// --------------------------------------------------------------------------------
// Forecast tab: turnout simulator controls, simulation runs and their map
// overlay, the universe builder, and the reverse win-scenario calculator.

import { state } from "./state.js";
import { showNotification } from "./uiChrome.js";
import { PARTY_COLORS, PRECINCT_STYLE } from "../constants.js";
import { debounce } from "../utils.js";
import { runFullSimulation, generateSimulatorControlsHTML, generateSimulationResultsHTML } from "../turnoutSimulator.js";
import { FILTER_FIELDS, buildPrecinctRecord, applyFilters, generateUniverseBuilderHTML, exportUniverseCSV, highlightUniverseOnMap } from "../universeBuilder.js";
import { computeWinScenario, generateReverseCalculatorHTML } from "../reverseCalculator.js";
import { downloadCSV } from "../exportCSV.js";

// Reshape the DNC lookup into the precinct-keyed form the simulator and
// universe builder consume (precinct code -> { Precinct, Rep, Mod, Dem, Total }).
export function buildDncByPrecinct(dncLookup) {
  const byPrecinct = {};
  if (dncLookup) {
    Object.entries(dncLookup).forEach(([code, row]) => {
      byPrecinct[code] = {
        Precinct: row.precinct,
        Rep: row.rep,
        Mod: row.mod,
        Dem: row.dem,
        Total: (row.rep ?? 0) + (row.mod ?? 0) + (row.dem ?? 0)
      };
    });
  }
  return byPrecinct;
}

export function renderForecastSection() {
  const container = document.getElementById('turnout-simulator-container');
  const summaryDiv = document.getElementById('simulation-summary');
  if (!container || !state.currentElectionData || !state.dncDataByPrecinct || !state.simulationCandidates?.length) return;

  const turnoutValues = state.sliderState ? state.sliderState.getAll() : { Rep: 1.0, Dem: 1.0, Mod: 1.0 };
  const flipRates = state.voterFlipState ? state.voterFlipState.getAll() : {};
  container.innerHTML = generateSimulatorControlsHTML(turnoutValues, flipRates, { showVoterFlip: true });

  // Attach slider listeners
  document.querySelectorAll('.turnout-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
      const party = e.target.dataset.party;
      const rawValue = Number(e.target.value);
      const value = rawValue / 100;
      state.sliderState.setValue(party, value);
      // Update the displayed value label
      const labelEl = document.getElementById(`${party.toLowerCase()}-value`);
      if (labelEl) labelEl.textContent = rawValue + '%';
      debouncedRunSimulation();
    });
  });
  document.querySelectorAll('.flip-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
      const flipKey = e.target.dataset.flip;
      const rawValue = Number(e.target.value);
      const value = rawValue / 100;
      state.voterFlipState.setRate(flipKey, value);
      // Update the displayed flip value label
      const labelId = 'flip-' + flipKey.toLowerCase().replace('→', '-') + '-value';
      const labelEl = document.getElementById(labelId);
      if (labelEl) labelEl.textContent = rawValue + '%';
      debouncedRunSimulation();
    });
  });
  const resetBtn = document.getElementById('reset-turnout');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.sliderState.reset();
      state.voterFlipState.reset();
      document.querySelectorAll('.turnout-slider').forEach(s => { s.value = 100; });
      document.querySelectorAll('.flip-slider').forEach(s => { s.value = 0; });
      ['rep', 'dem', 'mod'].forEach(party => {
        const el = document.getElementById(`${party}-value`);
        if (el) el.textContent = '100%';
      });
      renderForecastSection();
    });
  }

  // H13: Add simulator presets. Keep the partisan presets symmetric (a "Dem
  // surge" must have a matching "Rep surge") so the tool never looks like it
  // favours one side.
  const presetsHtml = `
    <div class="simulator-presets">
      <button class="preset-btn" data-preset="baseline" title="All groups at the turnout that actually happened">What happened</button>
      <button class="preset-btn" data-preset="dem-surge" title="Dem-leaning voters turn out 30% stronger">Democratic surge</button>
      <button class="preset-btn" data-preset="rep-surge" title="Rep-leaning voters turn out 30% stronger">Republican surge</button>
      <button class="preset-btn" data-preset="low-turnout" title="Every group turns out lower">Low turnout</button>
    </div>
  `;
  container.insertAdjacentHTML('afterend', presetsHtml);

  // Wire up preset buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      const presets = {
        'low-turnout': { Rep: 0.8, Dem: 0.7, Mod: 0.7 },
        'dem-surge': { Rep: 1.0, Dem: 1.3, Mod: 1.0 },
        'rep-surge': { Rep: 1.3, Dem: 1.0, Mod: 1.0 },
        'baseline': { Rep: 1.0, Dem: 1.0, Mod: 1.0 }
      };
      const values = presets[preset];
      if (!values || !state.sliderState) return;
      Object.entries(values).forEach(([party, val]) => {
        state.sliderState.setValue(party, val);
      });
      // Update slider UI
      document.querySelectorAll('.turnout-slider').forEach(s => {
        const party = s.dataset.party;
        if (values[party] !== undefined) {
          s.value = values[party] * 100;
        }
      });
      ['Rep', 'Dem', 'Mod'].forEach(party => {
        const el = document.getElementById(`${party.toLowerCase()}-value`);
        if (el && values[party] !== undefined) el.textContent = (values[party] * 100) + '%';
      });
      runSimulation();
    });
  });

  // H11: Add export simulation button after summary
  if (summaryDiv) {
    const exportSimBtn = document.createElement('button');
    exportSimBtn.className = 'export-sim-btn';
    exportSimBtn.style.marginTop = '8px';
    exportSimBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export Simulation`;
    exportSimBtn.addEventListener('click', () => exportSimulationResults());
    summaryDiv.parentNode.insertBefore(exportSimBtn, summaryDiv.nextSibling);
  }

  // Universe Builder
  renderUniverseBuilder();

  runSimulation();
}

// ==========================================================================
// UNIVERSE BUILDER INTEGRATION
// ==========================================================================

// Universe builder state (persists across re-renders)
if (!window._universeState) {
  window._universeState = { criteria: [], records: [], matchingCodes: [] };
}

export function renderUniverseBuilder() {
  const ubContainer = document.getElementById('universe-builder-container');
  if (!ubContainer || !state.currentElectionData || !state.simulationCandidates?.length) return;

  const us = window._universeState;
  // Build set of valid precinct codes from GeoJSON boundaries
  const validCodes = new Set();
  if (state.geojsonData?.features) {
    for (const f of state.geojsonData.features) {
      validCodes.add(String(f.properties.PRECINCT));
    }
  }
  // Build precinct records from current election + census + DNC data
  us.records = [];
  for (const row of state.currentElectionData) {
    const code = String(row['PRECINCT CODE'] || row['PRECINCT_CODE'] || '');
    if (!code) continue;
    if (validCodes.size > 0 && !validCodes.has(code)) continue;
    const dncRow = state.dncDataByPrecinct ? state.dncDataByPrecinct[code] : null;
    const censusProfile = state.censusProfiles ? state.censusProfiles[code] : null;
    us.records.push(buildPrecinctRecord(code, row, dncRow, censusProfile, state.simulationCandidates));
  }

  // Apply current filters
  const filtered = applyFilters(us.records, us.criteria);
  us.matchingCodes = filtered.map(r => r.code);

  ubContainer.innerHTML = generateUniverseBuilderHTML(us.criteria, filtered.length, us.records.length);
  wireUniverseBuilderEvents(ubContainer, filtered);
}

function wireUniverseBuilderEvents(ubContainer, filteredRecords) {
  const us = window._universeState;

  // Toggle collapse
  const toggleHeader = document.getElementById('universe-builder-toggle');
  const body = document.getElementById('universe-builder-body');
  if (toggleHeader && body) {
    toggleHeader.addEventListener('click', () => {
      body.classList.toggle('collapsed');
    });
  }

  // Add filter
  const addBtn = document.getElementById('universe-add-filter');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const fieldId = document.getElementById('universe-field-select')?.value;
      const operator = document.getElementById('universe-operator-select')?.value;
      const valueRaw = document.getElementById('universe-value-input')?.value?.trim();
      if (!fieldId || !operator || !valueRaw) return;

      const field = FILTER_FIELDS.find(f => f.id === fieldId);
      let value;
      if (field?.type === 'enum') {
        value = valueRaw;
      } else {
        value = Number(valueRaw);
        if (isNaN(value)) return;
      }

      us.criteria.push({ field: fieldId, operator, value });
      renderUniverseBuilder();
    });
  }

  // Remove filter pills
  ubContainer.querySelectorAll('.filter-pill-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.filterIndex);
      us.criteria.splice(idx, 1);
      renderUniverseBuilder();
    });
  });

  // Highlight on map toggle
  const highlightToggle = document.getElementById('universe-highlight-toggle');
  if (highlightToggle) {
    highlightToggle.addEventListener('change', () => {
      if (highlightToggle.checked && state.geojsonLayer) {
        highlightUniverseOnMap(state.geojsonLayer, us.matchingCodes);
      } else if (state.geojsonLayer) {
        // Reset to normal styling
        state.geojsonLayer.eachLayer(layer => {
          layer.setStyle({ fillOpacity: 0.5, opacity: 1 });
        });
      }
    });
  }

  // Export button
  const exportBtn = document.getElementById('universe-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportUniverseCSV(filteredRecords);
    });
  }
}

// H11: Export simulation results
function exportSimulationResults() {
  if (!state.simulationResult || !state.simulationResult.precinctResults) {
    showNotification('Run a simulation first');
    return;
  }
  const results = state.simulationResult.precinctResults;
  const flippedSet = new Set(state.simulationResult.flippedPrecincts || []);
  const rows = [];
  for (const [precinctCode, result] of Object.entries(results)) {
    if (!result || !result.winner) continue;
    const row = {
      'Precinct': precinctCode,
      'Simulated Winner': result.winner.name || '',
      'Simulated Winner Party': result.winner.party || '',
      'Flipped': flippedSet.has(precinctCode) ? 'Y' : 'N'
    };
    // Add candidate vote columns from simulation
    if (result.candidates) {
      result.candidates.forEach(c => {
        row[`Simulated: ${c.name}`] = c.simulatedVotes || c.votes || 0;
      });
    }
    rows.push(row);
  }
  if (rows.length === 0) {
    showNotification('No simulation data to export');
    return;
  }
  downloadCSV(rows, `simulation_results_${new Date().toISOString().split('T')[0]}.csv`);
  showNotification('Simulation results exported');
}

export const debouncedRunSimulation = debounce(() => runSimulation(), 100);

export function runSimulation() {
  if (!state.currentElectionData || !state.dncDataByPrecinct || !state.simulationCandidates?.length) return;
  const turnoutMultipliers = state.sliderState ? state.sliderState.getAll() : { Rep: 1.0, Dem: 1.0, Mod: 1.0 };
  const voterFlipRates = state.voterFlipState ? state.voterFlipState.getAll() : {};
  state.simulationResult = runFullSimulation(
    state.currentElectionData,
    state.dncDataByPrecinct,
    state.simulationCandidates,
    turnoutMultipliers,
    { voterFlipRates }
  );

  const summaryDiv = document.getElementById('simulation-summary');
  if (summaryDiv && state.simulationResult) {
    summaryDiv.innerHTML = generateSimulationResultsHTML(
      state.simulationResult.originalSummary,
      state.simulationResult.simulatedSummary,
      state.simulationResult.flippedPrecincts,
      state.simulationResult.countyFlipped
    );
    // Wire up "Show all N precincts" toggle
    const toggle = summaryDiv.querySelector('.flipped-list-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const expanded = toggle.dataset.expanded === 'true';
        const items = summaryDiv.querySelectorAll('.flipped-list-item');
        if (expanded) {
          for (let i = 5; i < items.length; i++) items[i].classList.add('hidden');
          toggle.textContent = 'Show all ' + items.length + ' precincts';
          toggle.dataset.expanded = 'false';
        } else {
          for (const item of items) item.classList.remove('hidden');
          toggle.textContent = 'Show fewer';
          toggle.dataset.expanded = 'true';
        }
      });
    }
  }

  if (state.simulationResult && Object.keys(state.simulationResult.precinctResults || {}).length > 0) {
    updateMapForSimulation();
  }

  // Render Reverse Calculator after simulation results
  renderReverseCalculator();
}

function renderReverseCalculator() {
  const rcContainer = document.getElementById('reverse-calculator-container');
  if (!rcContainer || !state.simulationCandidates?.length) return;

  rcContainer.innerHTML = generateReverseCalculatorHTML(state.simulationCandidates);

  // Wire up the calculate button
  const calcBtn = rcContainer.querySelector('.reverse-calculate-btn');
  if (calcBtn) {
    calcBtn.addEventListener('click', () => {
      const partySelect = document.getElementById('reverse-party-select');
      if (!partySelect) return;
      const targetParty = partySelect.value;

      calcBtn.disabled = true;
      calcBtn.textContent = 'Calculating...';

      // Use requestAnimationFrame to allow UI to update before heavy computation
      requestAnimationFrame(() => {
        const result = computeWinScenario(
          state.currentElectionData,
          state.dncDataByPrecinct,
          state.simulationCandidates,
          targetParty
        );

        // Re-render with result
        rcContainer.innerHTML = generateReverseCalculatorHTML(state.simulationCandidates, result);

        // Re-wire the button for subsequent clicks
        const newCalcBtn = rcContainer.querySelector('.reverse-calculate-btn');
        if (newCalcBtn) {
          newCalcBtn.addEventListener('click', () => renderReverseCalculator());
        }

        // Pre-select the party that was chosen
        const newSelect = document.getElementById('reverse-party-select');
        if (newSelect) newSelect.value = targetParty;
      });
    });
  }
}

export function updateMapForSimulation() {
  if (!state.geojsonLayer || !state.simulationResult) return;
  const flippedSet = new Set(state.simulationResult.flippedPrecincts || []);
  const results = state.simulationResult.precinctResults || {};

  state.geojsonLayer.eachLayer(layer => {
    const code = String(layer.feature.properties.PRECINCT);
    const result = results[code];
    let style;
    if (!result || !result.winner) {
      style = PRECINCT_STYLE.notInRace;
    } else {
      const rawParty = result.winner.party || (result.winner.name && result.winner.name.split(' ')[0]);
      const partyKey = rawParty ? (rawParty.charAt(0).toUpperCase() + rawParty.slice(1).toLowerCase()) : null;
      const color = (partyKey && PARTY_COLORS[partyKey]) || PARTY_COLORS.default;
      const isFlipped = flippedSet.has(code);
      style = {
        fillColor: color,
        fillOpacity: 0.7,
        weight: isFlipped ? 3 : 1,
        color: isFlipped ? '#000' : '#444',
        dashArray: isFlipped ? '8 4' : null
      };
    }
    // Record as base style so the shared hover-out handler restores the
    // simulation color, not the pre-simulation view
    layer._baseStyle = style;
    layer.setStyle(style);
  });
}
