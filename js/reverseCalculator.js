// reverseCalculator.js
// ====================
// Reverse calculator: finds the minimum turnout multiplier for a target party to win county-wide.

import { runFullSimulation } from "./turnoutSimulator.js";

/**
 * Binary search for the minimum turnout multiplier that lets targetParty win county-wide.
 *
 * @param {Array} electionData - Array of election records by precinct
 * @param {Object} dncData - Map of precinct code to DNC data
 * @param {Array} candidates - List of candidate names
 * @param {string} targetParty - 'Dem' or 'Rep'
 * @param {Object} options - Optional overrides (unused, reserved)
 * @returns {Object} { achievable, requiredMultiplier, projectedMargin, flippedPrecincts, scenario }
 */
export function computeWinScenario(electionData, dncData, candidates, targetParty, options = {}) {
  if (!electionData || !dncData || !candidates || !targetParty) {
    return {
      achievable: false,
      requiredMultiplier: 1.5,
      projectedMargin: 0,
      flippedPrecincts: [],
      scenario: { Rep: 1.0, Dem: 1.0, Mod: 1.0 }
    };
  }

  // Helper: check if targetParty wins at a given multiplier
  function checkWin(multiplier) {
    let scenario = { Rep: 1.0, Dem: 1.0, Mod: 1.0 };
    scenario[targetParty] = multiplier;

    let result = runFullSimulation(electionData, dncData, candidates, scenario);
    let summary = result.simulatedSummary;
    if (!summary || !summary.winner) {
      return { wins: false, margin: 0, flipped: [], scenario };
    }

    // Determine if target party's candidate won
    let winnerParty = summary.winner.party;
    // Normalize winner party
    let normalizedWinner = winnerParty;
    let PARTY_NORMALIZE = { 'REP': 'Rep', 'DEM': 'Dem', 'MOD': 'Mod' };
    if (PARTY_NORMALIZE[winnerParty]) {
      normalizedWinner = PARTY_NORMALIZE[winnerParty];
    }

    let wins = normalizedWinner === targetParty;

    // Calculate margin (winner votes - runner-up votes)
    let totals = summary.candidateTotals;
    let sortedVotes = Object.values(totals).sort(function descSort(a, b) { return b - a; });
    let margin = sortedVotes.length >= 2 ? sortedVotes[0] - sortedVotes[1] : sortedVotes[0] || 0;

    return {
      wins,
      margin: wins ? margin : -margin,
      flipped: result.flippedPrecincts,
      scenario
    };
  }

  // Check baseline first (multiplier = 1.0)
  let baselineCheck = checkWin(1.0);
  if (baselineCheck.wins) {
    return {
      achievable: true,
      requiredMultiplier: 1.0,
      projectedMargin: baselineCheck.margin,
      flippedPrecincts: baselineCheck.flipped,
      scenario: baselineCheck.scenario
    };
  }

  // Linear search from 1.01 to 1.50 in 0.01 increments
  for (let mult = 1.01; mult <= 1.5; mult = Math.round((mult + 0.01) * 100) / 100) {
    let check = checkWin(mult);
    if (check.wins) {
      return {
        achievable: true,
        requiredMultiplier: mult,
        projectedMargin: check.margin,
        flippedPrecincts: check.flipped,
        scenario: check.scenario
      };
    }
  }

  // Not achievable within 150%
  let maxCheck = checkWin(1.5);
  return {
    achievable: false,
    requiredMultiplier: 1.5,
    projectedMargin: maxCheck.margin,
    flippedPrecincts: maxCheck.flipped,
    scenario: maxCheck.scenario
  };
}

/**
 * Generate HTML for the reverse calculator UI.
 *
 * @param {Array} candidates - List of candidate names (used to determine available parties)
 * @param {Object|null} result - Result from computeWinScenario, or null for initial state
 * @returns {string} HTML string
 */
export function generateReverseCalculatorHTML(candidates, result = null) {
  let resultHTML = '';

  if (result) {
    if (result.achievable) {
      let pct = Math.round(result.requiredMultiplier * 100);
      let partyLabel = result.scenario.Dem > 1.0 ? 'Democrats' : 'Republicans';
      resultHTML = `
        <div class="reverse-result achievable">
          <div class="result-number">${pct}%</div>
          <div class="result-text">${partyLabel} need ${pct}% turnout to win county-wide</div>
          <div class="result-details">
            <span>Projected margin: ${result.projectedMargin.toLocaleString()} votes</span>
            <span>Flipped precincts: ${result.flippedPrecincts.length}</span>
          </div>
        </div>
      `;
    } else {
      resultHTML = `
        <div class="reverse-result not-achievable">
          <div class="result-number">N/A</div>
          <div class="result-text">Not achievable within 150% turnout range</div>
          <div class="result-details">
            <span>Projected margin: ${Math.abs(result.projectedMargin).toLocaleString()} votes behind</span>
            <span>Flipped precincts: ${result.flippedPrecincts.length}</span>
          </div>
        </div>
      `;
    }
  }

  return `
    <div class="reverse-calculator">
      <h4>Reverse Calculator</h4>
      <p class="section-hint">Find the minimum turnout needed for a party to win county-wide.</p>
      <div class="reverse-calc-row">
        <select class="reverse-party-select" id="reverse-party-select">
          <option value="Dem">Democrat</option>
          <option value="Rep">Republican</option>
        </select>
        <button class="reverse-calculate-btn">What do I need to win?</button>
      </div>
      <div id="reverse-result-container">${resultHTML}</div>
    </div>
  `;
}
