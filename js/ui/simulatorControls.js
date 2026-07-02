// ui/simulatorControls.js
// =======================
// UI layer for the turnout simulator: HTML-string generators for the slider
// controls and the results summary. Imports js/lib/ only; all engine values
// (summaries, flipped-precinct lists, slider state) are passed in as
// arguments. Never fetches, never touches module-level state.
//
// Moved out of js/turnoutSimulator.js (REDESIGN Phase 2) so the engine there
// stays a pure domain module (Phase-3 home: js/domain/simulator.js).

import { formatPctWhole, formatNumber } from "../lib/format.js";

/**
 * Generate HTML for turnout simulator controls.
 * Supports extended range (50-150%) for "more turnout" and voter flip controls.
 *
 * @param {Object} currentValues - Current slider values { Rep: 1.0, Dem: 1.0, Mod: 1.0 }
 * @param {Object} flipRates - Current voter flip rates (optional)
 * @param {Object} options - { showVoterFlip: true, minPct: 50, maxPct: 150 }
 * @returns {string} HTML string for the simulator controls
 */
export function generateSimulatorControlsHTML(currentValues = { Rep: 1.0, Dem: 1.0, Mod: 1.0 }, flipRates = {}, options = {}) {
  let { showVoterFlip = true, minPct = 50, maxPct = 150 } = options;

  const formatPct = formatPctWhole;
  const formatFlipPct = formatPctWhole;

  // Generate turnout slider HTML
  let turnoutSlidersHTML = `
    <div class="simulator-section">
      <h4 class="section-title">Party Turnout</h4>
      <p class="section-hint">Below 100%: fewer voters. Above 100%: mobilize non-voters.</p>

      <div class="slider-group">
        <label for="rep-turnout">
          <span class="party-label rep">Republican</span>
          <span class="slider-value" id="rep-value">${formatPct(currentValues.Rep)}</span>
        </label>
        <input type="range" id="rep-turnout" name="rep-turnout"
               min="${minPct}" max="${maxPct}" value="${Math.round(currentValues.Rep * 100)}"
               class="turnout-slider rep-slider" data-party="Rep">
        <div class="slider-markers">
          <span>50%</span>
          <span class="baseline-marker">100%</span>
          <span>150%</span>
        </div>
      </div>

      <div class="slider-group">
        <label for="dem-turnout">
          <span class="party-label dem">Democrat</span>
          <span class="slider-value" id="dem-value">${formatPct(currentValues.Dem)}</span>
        </label>
        <input type="range" id="dem-turnout" name="dem-turnout"
               min="${minPct}" max="${maxPct}" value="${Math.round(currentValues.Dem * 100)}"
               class="turnout-slider dem-slider" data-party="Dem">
        <div class="slider-markers">
          <span>50%</span>
          <span class="baseline-marker">100%</span>
          <span>150%</span>
        </div>
      </div>

      <div class="slider-group">
        <label for="mod-turnout">
          <span class="party-label mod">Moderate/Other</span>
          <span class="slider-value" id="mod-value">${formatPct(currentValues.Mod)}</span>
        </label>
        <input type="range" id="mod-turnout" name="mod-turnout"
               min="${minPct}" max="${maxPct}" value="${Math.round(currentValues.Mod * 100)}"
               class="turnout-slider mod-slider" data-party="Mod">
        <div class="slider-markers">
          <span>50%</span>
          <span class="baseline-marker">100%</span>
          <span>150%</span>
        </div>
      </div>
    </div>
  `;

  // Generate voter flip controls HTML
  const voterFlipHTML = showVoterFlip ? `
    <div class="simulator-section voter-flip-section">
      <div class="section-header collapsible" id="voter-flip-toggle">
        <h4 class="section-title">
          <svg width="12" height="12" viewBox="0 0 12 12" class="collapse-icon">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
          </svg>
          Voter Persuasion (Flip)
        </h4>
        <span class="section-badge" id="flip-active-badge" style="display: none;">Active</span>
      </div>
      <div class="section-content" id="voter-flip-content">
        <p class="section-hint">Model persuasion: what if X% of one party's voters switched to another?</p>

        <div class="flip-controls-grid">
          <div class="flip-control">
            <label for="flip-rep-dem">
              <span class="flip-label">Rep → Dem</span>
              <span class="flip-value" id="flip-rep-dem-value">${formatFlipPct(flipRates['Rep→Dem'] || 0)}</span>
            </label>
            <input type="range" id="flip-rep-dem" name="flip-rep-dem"
                   min="0" max="25" value="${Math.round((flipRates['Rep→Dem'] || 0) * 100)}"
                   class="flip-slider" data-flip="Rep→Dem">
          </div>

          <div class="flip-control">
            <label for="flip-dem-rep">
              <span class="flip-label">Dem → Rep</span>
              <span class="flip-value" id="flip-dem-rep-value">${formatFlipPct(flipRates['Dem→Rep'] || 0)}</span>
            </label>
            <input type="range" id="flip-dem-rep" name="flip-dem-rep"
                   min="0" max="25" value="${Math.round((flipRates['Dem→Rep'] || 0) * 100)}"
                   class="flip-slider" data-flip="Dem→Rep">
          </div>

          <div class="flip-control">
            <label for="flip-mod-dem">
              <span class="flip-label">Mod → Dem</span>
              <span class="flip-value" id="flip-mod-dem-value">${formatFlipPct(flipRates['Mod→Dem'] || 0)}</span>
            </label>
            <input type="range" id="flip-mod-dem" name="flip-mod-dem"
                   min="0" max="25" value="${Math.round((flipRates['Mod→Dem'] || 0) * 100)}"
                   class="flip-slider" data-flip="Mod→Dem">
          </div>

          <div class="flip-control">
            <label for="flip-mod-rep">
              <span class="flip-label">Mod → Rep</span>
              <span class="flip-value" id="flip-mod-rep-value">${formatFlipPct(flipRates['Mod→Rep'] || 0)}</span>
            </label>
            <input type="range" id="flip-mod-rep" name="flip-mod-rep"
                   min="0" max="25" value="${Math.round((flipRates['Mod→Rep'] || 0) * 100)}"
                   class="flip-slider" data-flip="Mod→Rep">
          </div>
        </div>
      </div>
    </div>
  ` : '';

  // Assumptions note
  const assumptionsHTML = `
    <div class="simulator-assumptions" id="simulator-assumptions">
      <details>
        <summary>Assumptions</summary>
        <ul>
          <li><strong>Non-voter party mix:</strong> People who didn't vote are split between the parties in the same proportions as each precinct's registered voters.</li>
          <li><strong>Same-race:</strong> "More turnout" adds votes only in this race.</li>
          <li><strong>Persuasion:</strong> Flip % applied uniformly across precincts.</li>
          <li><strong>Order:</strong> Turnout adjustment first, then persuasion.</li>
        </ul>
      </details>
    </div>
  `;

  return `
    <div class="turnout-simulator" id="turnout-simulator">
      <h3>Turnout Simulator</h3>
      <p class="simulator-description">Model how turnout changes and voter persuasion affect election outcomes.</p>

      ${turnoutSlidersHTML}

      ${voterFlipHTML}

      <div class="simulator-actions">
        <button id="reset-turnout" class="reset-btn" aria-label="Reset all to baseline">
          Reset All
        </button>
      </div>

      ${assumptionsHTML}

      <div id="simulation-summary" class="simulation-summary"></div>
    </div>
  `;
}

/**
 * Generate detailed HTML for all flipped precincts.
 * Shows first 5 by default with a "Show all N" toggle.
 *
 * @param {Array} flippedPrecincts - List of precinct codes that flipped
 * @param {Object} originalSummary - Original county-wide results (for context)
 * @param {Object} simulatedSummary - Simulated county-wide results (for context)
 * @returns {string} HTML string for the flipped precincts detail list
 */
function generateFlippedPrecinctsDetailHTML(flippedPrecincts, originalSummary, simulatedSummary) {
  if (!flippedPrecincts || flippedPrecincts.length === 0) {
    return '<p class="no-flips">No precincts flipped with current settings.</p>';
  }

  let total = flippedPrecincts.length;
  let initialShow = 5;
  let items = '';

  for (let i = 0; i < total; i++) {
    let code = flippedPrecincts[i];
    let hiddenClass = i >= initialShow ? ' hidden' : '';
    items += `<div class="flipped-list-item${hiddenClass}" data-flip-index="${i}">
        <span class="flipped-precinct-code">${code}</span>
      </div>`;
  }

  let toggleHTML = total > initialShow
    ? `<button class="flipped-list-toggle" data-expanded="false">Show all ${total} precincts</button>`
    : '';

  return `<div class="flipped-list">${items}${toggleHTML}</div>`;
}

/**
 * Generate HTML for simulation results summary.
 *
 * @param {Object} originalSummary - Original county-wide results
 * @param {Object} simulatedSummary - Simulated county-wide results
 * @param {Array} flippedPrecincts - List of precincts that flipped
 * @param {boolean} countyFlipped - Whether the county-wide winner changed
 * @returns {string} HTML string for the results summary
 */
export function generateSimulationResultsHTML(originalSummary, simulatedSummary, flippedPrecincts, countyFlipped) {
  if (!originalSummary || !simulatedSummary) {
    return '<p class="no-data">Select an election to begin simulation.</p>';
  }

  const formatNum = formatNumber;

  // Build candidate comparison rows
  let candidateRows = '';
  let candidates = Object.keys(originalSummary.candidateTotals);
  for (let candidate of candidates) {
    let origVotes = originalSummary.candidateTotals[candidate];
    let simVotes = simulatedSummary.candidateTotals[candidate];
    let diff = simVotes - origVotes;
    let diffClass = diff > 0 ? 'positive' : diff < 0 ? 'negative' : '';
    let diffSign = diff > 0 ? '+' : '';

    candidateRows += `
      <tr>
        <td>${candidate}</td>
        <td>${formatNum(origVotes)}</td>
        <td>${formatNum(simVotes)}</td>
        <td class="${diffClass}">${diffSign}${formatNum(diff)}</td>
      </tr>
    `;
  }

  const flippedCount = flippedPrecincts.length;
  const flippedClass = countyFlipped ? 'county-flipped' : '';
  const winnerChangeHTML = countyFlipped
    ? `<div class="winner-change alert">
         <strong>County Winner Changed!</strong>
         <p>${originalSummary.winner?.name} → ${simulatedSummary.winner?.name}</p>
       </div>`
    : '';

  return `
    <div class="simulation-results ${flippedClass}">
      ${winnerChangeHTML}

      <h4>Vote Comparison</h4>
      <table class="comparison-table">
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Original</th>
            <th>Simulated</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          ${candidateRows}
        </tbody>
      </table>

      <div class="flipped-precincts">
        <h4>Flipped Precincts: <span class="flip-count">${flippedCount}</span></h4>
        ${generateFlippedPrecinctsDetailHTML(flippedPrecincts, originalSummary, simulatedSummary)}
      </div>
    </div>
  `;
}
