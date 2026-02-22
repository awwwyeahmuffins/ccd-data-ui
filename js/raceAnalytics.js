// raceAnalytics.js
// ================================================================================
// Race Analytics module for Workstream 3
// Provides county-wide race summary and margin heatmap functionality
// ================================================================================

import { PARTY_COLORS } from "./constants.js";

// ================================================================================
// Margin Heatmap Color Scales
// Light = close race, Dark = decisive win
// ================================================================================

export let MARGIN_COLOR_SCALES = {
  REP: {
    light: "#FFCCCC", // Very light red (close race)
    dark: "#8B0000"   // Dark red (decisive win)
  },
  DEM: {
    light: "#CCE5FF", // Very light blue
    dark: "#00008B"   // Dark blue
  },
  LIB: {
    light: "#FFF5CC", // Very light gold
    dark: "#B8860B"   // Dark gold
  },
  GRN: {
    light: "#CCFFCC", // Very light green
    dark: "#006400"   // Dark green
  },
  default: {
    light: "#E0E0E0", // Light gray
    dark: "#404040"   // Dark gray
  }
};

// ================================================================================
// Core Analytics Functions
// ================================================================================

/**
 * Calculate county-wide race summary statistics
 * @param {Array} electionData - Array of precinct election rows
 * @param {Array} candidates - Array of candidate column names
 * @returns {Object|null} Summary statistics or null if invalid input
 */
export function calculateRaceSummary(electionData, candidates) {
  if (!electionData || !Array.isArray(electionData) || electionData.length === 0) {
    return null;
  }
  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  let totalBallotsCast = 0;
  let totalRegisteredVoters = 0;
  let candidateVotes = {};
  for (let c of candidates) { candidateVotes[c] = 0; }

  for (let row of electionData) {
    let ballots = Number(row["BALLOTS CAST TOTAL"]) || 0;
    let registered = Number(row["REGISTERED VOTERS TOTAL"]) || 0;

    // Skip precincts not in this race
    if (registered === 0 && ballots === 0) continue;

    totalBallotsCast += ballots;
    totalRegisteredVoters += registered;

    for (let candidate of candidates) {
      candidateVotes[candidate] += Number(row[candidate]) || 0;
    }
  }

  // Find winner and runner-up
  let sortedCandidates = Object.entries(candidateVotes)
    .sort((a, b) => b[1] - a[1]);

  let winner = sortedCandidates[0] || [null, 0];
  let runnerUp = sortedCandidates[1] || [null, 0];

  let totalCandidateVotes = Object.values(candidateVotes).reduce((sum, v) => sum + v, 0);
  let margin = totalCandidateVotes > 0
    ? (winner[1] - runnerUp[1]) / totalCandidateVotes
    : 0;

  let turnout = totalRegisteredVoters > 0
    ? totalBallotsCast / totalRegisteredVoters
    : 0;

  return {
    totalBallotsCast,
    totalRegisteredVoters,
    candidateVotes,
    winner: winner[0],
    winnerVotes: winner[1],
    runnerUp: runnerUp[0],
    runnerUpVotes: runnerUp[1],
    margin,
    turnout,
    totalCandidateVotes
  };
}

/**
 * Build vote share data array for chart display
 * @param {Object} summary - Race summary from calculateRaceSummary
 * @returns {Array} Array of {candidate, votes, percentage, party} objects sorted by votes
 */
export function buildVoteShareData(summary) {
  if (!summary || !summary.candidateVotes) {
    return [];
  }

  let total = summary.totalCandidateVotes || 0;

  return Object.entries(summary.candidateVotes)
    .map(function buildEntry([candidate, votes]) {
      return {
        candidate,
        votes,
        percentage: total > 0 ? (votes / total) * 100 : 0,
        party: candidate.split(" ")[0] // Extract party prefix (e.g., "REP" from "REP Greg Abbott")
      };
    })
    .sort((a, b) => b.votes - a.votes); // Sort by votes descending
}

/**
 * Calculate margin of victory for a single precinct
 * @param {Object} precinctData - Single precinct election data row
 * @param {Array} candidates - Array of candidate column names
 * @returns {Object|null} {margin, winner, winnerParty} or null if not in race
 */
export function calculatePrecinctMargin(precinctData, candidates) {
  if (!precinctData || !candidates || candidates.length === 0) {
    return null;
  }

  let registered = Number(precinctData["REGISTERED VOTERS TOTAL"]) || 0;
  let ballots = Number(precinctData["BALLOTS CAST TOTAL"]) || 0;

  // Not in race
  if (registered === 0 && ballots === 0) {
    return null;
  }

  let totalVotes = 0;
  let topVotes = 0;
  let secondVotes = 0;
  let winner = null;
  let winnerParty = null;

  for (let candidate of candidates) {
    let votes = Number(precinctData[candidate]) || 0;
    totalVotes += votes;

    if (votes > topVotes) {
      secondVotes = topVotes;
      topVotes = votes;
      winner = candidate;
      winnerParty = candidate.split(" ")[0];
    } else if (votes > secondVotes) {
      secondVotes = votes;
    }
  }

  if (totalVotes === 0) {
    return null;
  }

  let margin = (topVotes - secondVotes) / totalVotes;

  return {
    margin,
    winner,
    winnerParty
  };
}

// ================================================================================
// Color Functions
// ================================================================================

/**
 * Convert hex color to RGB object
 * @param {string} hex - Hex color string (with or without #)
 * @returns {Object} {r, g, b} values
 */
export function hexToRGB(hex) {
  let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

/**
 * Convert RGB values to hex string
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {string} Hex color string with # prefix
 */
export function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(function toHexPart(x) {
    let hex = x.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("").toUpperCase();
}

/**
 * Get color for margin heatmap based on margin and winning party
 * Interpolates between light (close race) and dark (decisive win)
 * @param {number} margin - Margin of victory (0-1)
 * @param {string} party - Winning party code (REP, DEM, etc.)
 * @returns {string} Hex color code
 */
export function getMarginColor(margin, party) {
  // Clamp margin to [0, 1]
  let clampedMargin = Math.max(0, Math.min(1, margin));

  let scale = MARGIN_COLOR_SCALES[party] || MARGIN_COLOR_SCALES.default;

  // Interpolate between light and dark based on margin
  // margin 0 = light (close), margin 1 = dark (decisive)
  let lightRGB = hexToRGB(scale.light);
  let darkRGB = hexToRGB(scale.dark);

  let r = Math.round(lightRGB.r + (darkRGB.r - lightRGB.r) * clampedMargin);
  let g = Math.round(lightRGB.g + (darkRGB.g - lightRGB.g) * clampedMargin);
  let b = Math.round(lightRGB.b + (darkRGB.b - lightRGB.b) * clampedMargin);
  
  return rgbToHex(r, g, b);
}

// ================================================================================
// HTML Generation
// ================================================================================

/**
 * Generate HTML for race summary sidebar display
 * @param {Object} summary - Race summary from calculateRaceSummary
 * @param {string} raceName - Display name of the race
 * @returns {string} HTML string
 */
export function generateRaceSummaryHTML(summary, raceName) {
  if (!summary) {
    return '<div class="error-state"><p>Unable to calculate race summary.</p></div>';
  }

  let formatNumber = (n) => n.toLocaleString();
  let formatPct = (n) => (n * 100).toFixed(1) + "%";

  // Get party label
  let winnerParty = summary.winner ? summary.winner.split(" ")[0] : "N/A";
  let winnerName = summary.winner ? summary.winner.split(" ").slice(1).join(" ") : "N/A";

  return `
    <div class="race-summary">
      <h3>County-Wide Results</h3>
      <p class="race-name">${raceName}</p>
      
      <div class="summary-stats">
        <div class="stat-item">
          <span class="stat-label">Winner</span>
          <span class="stat-value winner-${winnerParty.toLowerCase()}">${winnerName} (${winnerParty})</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Margin</span>
          <span class="stat-value">${formatPct(summary.margin)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Total Votes</span>
          <span class="stat-value">${formatNumber(summary.totalCandidateVotes)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Turnout</span>
          <span class="stat-value">${formatPct(summary.turnout)}</span>
        </div>
      </div>
      
      <div class="vote-share-chart">
        <canvas id="vote-share-canvas" aria-label="Vote share breakdown chart"></canvas>
      </div>
    </div>
  `;
}

/**
 * Generate HTML for the margin heatmap toggle control
 * @param {boolean} isActive - Whether margin mode is currently active
 * @returns {string} HTML string for the toggle
 */
export function generateMarginToggleHTML(isActive = false) {
  return `
    <div class="margin-toggle-container">
      <label class="toggle-switch">
        <input type="checkbox" id="margin-heatmap-toggle" ${isActive ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <span class="toggle-label">Margin Heatmap</span>
      <span class="toggle-hint">Dark = decisive, Light = close</span>
    </div>
  `;
}

// ================================================================================
// Chart Creation
// ================================================================================

// Store chart instance for cleanup
let voteShareChartInstance = null;

/**
 * Create or update the vote share bar chart
 * @param {Array} voteShareData - Array from buildVoteShareData
 * @param {string} canvasId - ID of the canvas element
 * @returns {Object|null} Chart.js instance or null
 */
export function createVoteShareChart(voteShareData, canvasId = "vote-share-canvas") {
  if (!voteShareData || voteShareData.length === 0) {
    return null;
  }

  let canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.error(`Canvas element not found: ${canvasId}`);
    return null;
  }

  // Destroy existing chart
  if (voteShareChartInstance) {
    voteShareChartInstance.destroy();
    voteShareChartInstance = null;
  }

  let ctx = canvas.getContext("2d");

  // Prepare data
  let labels = voteShareData.map(function extractLabel(d) {
    // Show candidate name without party prefix for cleaner display
    let nameParts = d.candidate.split(" ");
    return nameParts.slice(1).join(" ") || d.candidate;
  });

  let values = voteShareData.map(d => d.votes);
  let backgroundColors = voteShareData.map(d => PARTY_COLORS[d.party] || PARTY_COLORS.default);

  voteShareChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: backgroundColors,
        borderColor: backgroundColors.map(c => c),
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: 'y', // Horizontal bar chart
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        datalabels: {
          color: "#fff",
          anchor: 'end',
          align: 'start',
          offset: 4,
          font: {
            size: 11,
            weight: "bold"
          },
          formatter: function formatLabel(value, context) {
            let idx = context.dataIndex;
            let pct = voteShareData[idx].percentage.toFixed(1);
            return `${pct}%`;
          }
        },
        tooltip: {
          callbacks: {
            label: function formatTooltip(ctx) {
              let idx = ctx.dataIndex;
              let d = voteShareData[idx];
              return `${d.votes.toLocaleString()} votes (${d.percentage.toFixed(1)}%)`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: {
            display: false
          },
          ticks: {
            callback: (value) => value.toLocaleString()
          }
        },
        y: {
          grid: {
            display: false
          }
        }
      }
    },
    plugins: [ChartDataLabels]
  });

  return voteShareChartInstance;
}

/**
 * Destroy the vote share chart instance
 */
export function destroyVoteShareChart() {
  if (voteShareChartInstance) {
    voteShareChartInstance.destroy();
    voteShareChartInstance = null;
  }
}
