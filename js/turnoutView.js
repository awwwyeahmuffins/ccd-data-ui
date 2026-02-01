// turnoutView.js
// ===================
// Turnout Analysis View (Workstream 6)
// Shows precinct turnout heatmap and top/bottom precincts leaderboard

import { clearLayers, formatNumber } from "./utils.js";
import { loadAllData, listElectionCSVs, loadElectionData } from "./dataLoader.js";
import { TURNOUT_CONFIG, ELECTION_META_KEYS } from "./constants.js";
import { getCandidateColumns } from "./electionSchema.js";
// Import skeleton loading utilities (Workstream 4)
import {
  createSkeletonStatGrid,
  createSkeletonList,
  createLoadingSpinner,
  fadeInContent,
  createErrorState
} from "./skeletonLoader.js";

// Track selected layer and current state
let selectedLayer = null;
let currentTurnoutData = [];
let currentElectionFilename = null;
let leaderboardMode = 'highest'; // 'highest' or 'lowest'

// ============================================================================
// CORE CALCULATION FUNCTIONS (tested in turnoutView.test.js)
// ============================================================================

/**
 * Calculate turnout percentage for a precinct
 * @param {number} ballotsCast - Number of ballots cast
 * @param {number} registeredVoters - Number of registered voters
 * @returns {number} Turnout percentage (0-100), or 0 if invalid
 */
export function calculateTurnout(ballotsCast, registeredVoters) {
  const ballots = Number(ballotsCast);
  const registered = Number(registeredVoters);
  
  if (isNaN(ballots) || isNaN(registered) || registered <= 0) {
    return 0;
  }
  
  // Cap at 100% to handle edge cases
  return Math.min(100, (ballots / registered) * 100);
}

/**
 * Get turnout color based on percentage
 * Red (low) to Green (high) gradient
 * @param {number} turnoutPct - Turnout percentage (0-100)
 * @returns {string} RGB color string
 */
export function getTurnoutColor(turnoutPct) {
  if (turnoutPct == null || isNaN(turnoutPct)) {
    return TURNOUT_CONFIG.invalidColor;
  }
  
  // Clamp between 0 and 100
  const pct = Math.max(0, Math.min(100, turnoutPct));
  const { low, medium, high } = TURNOUT_CONFIG.colors;
  
  if (pct < 50) {
    // Red to Yellow gradient (0-50%)
    const ratio = pct / 50;
    const r = Math.round(low.r + (medium.r - low.r) * ratio);
    const g = Math.round(low.g + (medium.g - low.g) * ratio);
    const b = Math.round(low.b + (medium.b - low.b) * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Yellow to Green gradient (50-100%)
    const ratio = (pct - 50) / 50;
    const r = Math.round(medium.r + (high.r - medium.r) * ratio);
    const g = Math.round(medium.g + (high.g - medium.g) * ratio);
    const b = Math.round(medium.b + (high.b - medium.b) * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

/**
 * Check if a precinct actually participated in this specific race
 * A precinct participated if it has any non-zero votes in race-specific columns
 * (i.e., columns that are not metadata like PRECINCT CODE, REGISTERED VOTERS, etc.)
 * @param {Object} row - A row of election data
 * @returns {boolean} True if the precinct participated in this race
 */
export function precinctParticipatedInRace(row) {
  if (!row || typeof row !== 'object') {
    return false;
  }
  
  // Get all race-specific columns (exclude metadata columns) using schema utility
  const raceColumns = getCandidateColumns(Object.keys(row));
  
  // A precinct participated if any race-specific column has a non-zero value
  return raceColumns.some(col => {
    const value = Number(row[col]);
    return !isNaN(value) && value > 0;
  });
}

/**
 * Prepare turnout data for all precincts in an election
 * @param {Array} electionData - Raw election CSV data
 * @returns {Array} Array of precinct turnout objects sorted by turnout descending
 */
export function prepareTurnoutData(electionData) {
  if (!Array.isArray(electionData) || electionData.length === 0) {
    return [];
  }
  
  const turnoutData = electionData
    .filter(row => precinctParticipatedInRace(row)) // Only include precincts that participated in this race
    .map(row => {
      const precinctCode = row['PRECINCT CODE'];
      const precinctName = row['PRECINCT NAME'] || `Precinct ${precinctCode}`;
      const registeredVoters = Number(row['REGISTERED VOTERS TOTAL']) || 0;
      const ballotsCast = Number(row['BALLOTS CAST TOTAL']) || 0;
      const turnoutPct = calculateTurnout(ballotsCast, registeredVoters);
      
      return {
        precinctCode: String(precinctCode),
        precinctName,
        registeredVoters,
        ballotsCast,
        turnoutPct,
        turnoutColor: getTurnoutColor(turnoutPct)
      };
    })
    .filter(d => d.registeredVoters > 0);
  
  // Sort by turnout percentage descending
  turnoutData.sort((a, b) => b.turnoutPct - a.turnoutPct);
  
  // Add rank
  turnoutData.forEach((d, i) => {
    d.rank = i + 1;
  });
  
  return turnoutData;
}

/**
 * Get top N precincts by turnout
 * @param {Array} turnoutData - Prepared turnout data
 * @param {number} n - Number of precincts to return
 * @returns {Array} Top N precincts
 */
export function getTopPrecincts(turnoutData, n = 10) {
  if (!Array.isArray(turnoutData)) return [];
  return turnoutData.slice(0, Math.min(n, turnoutData.length));
}

/**
 * Get bottom N precincts by turnout
 * @param {Array} turnoutData - Prepared turnout data
 * @param {number} n - Number of precincts to return
 * @returns {Array} Bottom N precincts (reversed - lowest first)
 */
export function getBottomPrecincts(turnoutData, n = 10) {
  if (!Array.isArray(turnoutData)) return [];
  return turnoutData.slice(-Math.min(n, turnoutData.length)).reverse();
}

/**
 * Calculate turnout summary statistics for precincts that participated in this race
 * @param {Array} electionData - Raw election CSV data
 * @returns {Object} Summary statistics
 */
export function calculateCountySummary(electionData) {
  if (!Array.isArray(electionData) || electionData.length === 0) {
    return {
      totalRegistered: 0,
      totalBallotsCast: 0,
      overallTurnout: 0,
      precinctCount: 0,
      participatingPrecincts: 0,
      avgTurnout: 0,
      minTurnout: 0,
      maxTurnout: 0
    };
  }
  
  // Filter to only precincts that actually participated in this race
  const participatingData = electionData.filter(row => precinctParticipatedInRace(row));
  
  let totalRegistered = 0;
  let totalBallotsCast = 0;
  let participatingPrecincts = 0;
  let turnouts = [];
  
  participatingData.forEach(row => {
    const registered = Number(row['REGISTERED VOTERS TOTAL']) || 0;
    const ballots = Number(row['BALLOTS CAST TOTAL']) || 0;
    
    if (registered > 0) {
      totalRegistered += registered;
      totalBallotsCast += ballots;
      participatingPrecincts++;
      turnouts.push(calculateTurnout(ballots, registered));
    }
  });
  
  const overallTurnout = totalRegistered > 0 
    ? (totalBallotsCast / totalRegistered) * 100 
    : 0;
  
  const avgTurnout = turnouts.length > 0
    ? turnouts.reduce((a, b) => a + b, 0) / turnouts.length
    : 0;
  
  return {
    totalRegistered,
    totalBallotsCast,
    overallTurnout: Math.round(overallTurnout * 10) / 10,
    precinctCount: participatingData.length,
    participatingPrecincts,
    avgTurnout: Math.round(avgTurnout * 10) / 10,
    minTurnout: turnouts.length > 0 ? Math.round(Math.min(...turnouts) * 10) / 10 : 0,
    maxTurnout: turnouts.length > 0 ? Math.round(Math.max(...turnouts) * 10) / 10 : 0
  };
}

/**
 * Format turnout percentage for display
 * @param {number} pct - Turnout percentage
 * @returns {string} Formatted percentage string
 */
export function formatTurnoutPct(pct) {
  if (pct == null || isNaN(pct)) {
    return 'N/A';
  }
  return pct.toFixed(1) + '%';
}

// ============================================================================
// VIEW RENDERING
// ============================================================================

/**
 * Main entry point - render the turnout analysis view
 * @param {Object} map - Leaflet map instance
 */
export function renderTurnoutView(map) {
  const sidebarDiv = document.getElementById("sidebar-content");

  sidebarDiv.innerHTML = `
    <div class="fade-in">
      <h2>Turnout Analysis</h2>
      
      <!-- Election Selection Card -->
      <div class="data-card hover-lift-subtle stagger-item" style="animation-delay: 0.05s;">
        <div class="data-card-header">
          <div class="data-card-icon green">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
          </div>
          <div>
            <h3 class="data-card-title">Select Election</h3>
            <p class="data-card-subtitle">View turnout by precinct</p>
          </div>
        </div>
        <label for="turnout-election-select" class="sr-only">Choose election:</label>
        <select id="turnout-election-select" class="transition-fast" aria-label="Select election for turnout analysis">
          <option>Loading...</option>
        </select>
      </div>

      <!-- County Summary Card -->
      <div class="data-card hover-lift-subtle stagger-item" id="turnout-summary-card" style="animation-delay: 0.1s;">
        <div class="data-card-header">
          <div class="data-card-icon blue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 20V10"></path>
              <path d="M12 20V4"></path>
              <path d="M6 20v-6"></path>
            </svg>
          </div>
          <div>
            <h3 class="data-card-title">County Summary</h3>
            <p class="data-card-subtitle">Overall turnout statistics</p>
          </div>
        </div>
        <div id="county-summary-stats" class="skeleton-loading">
          ${createSkeletonStatGrid(4)}
        </div>
      </div>

      <!-- Leaderboard Card -->
      <div class="data-card hover-lift-subtle stagger-item" id="leaderboard-card" style="animation-delay: 0.15s;">
        <div class="data-card-header">
          <div class="data-card-icon purple">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M8 21h8"></path>
              <path d="M12 17v4"></path>
              <path d="M7 4h10l-2 6h2l-5 8-5-8h2l-2-6z"></path>
            </svg>
          </div>
          <div>
            <h3 class="data-card-title">Precinct Rankings</h3>
            <p class="data-card-subtitle">Top and bottom turnout precincts</p>
          </div>
        </div>
        
        <!-- Leaderboard Toggle -->
        <div class="leaderboard-toggle" role="group" aria-label="Toggle between highest and lowest turnout">
          <button id="leaderboard-highest" class="toggle-btn press-effect active" aria-pressed="true">
            Highest Turnout
          </button>
          <button id="leaderboard-lowest" class="toggle-btn press-effect" aria-pressed="false">
            Lowest Turnout
          </button>
        </div>
        
        <div id="leaderboard-list" class="leaderboard-list skeleton-loading">
          ${createSkeletonList(5)}
        </div>
      </div>

      <!-- Precinct Details -->
      <div id="precinct-turnout-details"></div>
    </div>
  `;

  // Set up election dropdown
  const selectEl = document.getElementById("turnout-election-select");
  listElectionCSVs()
    .then((files) => {
      selectEl.innerHTML = "";
      files.forEach((entry) => {
        // Handle both string and object formats from manifest
        const filename = typeof entry === 'string' ? entry : entry.filename;
        const displayName = (typeof entry === 'object' && entry.displayName) 
          ? entry.displayName 
          : filename.replace(/\.csv$/, "").replace(/_/g, " ").replace(/ - /g, " - ");
        
        const opt = document.createElement("option");
        opt.value = filename;
        opt.text = displayName;
        selectEl.appendChild(opt);
      });
      if (files.length > 0) {
        const firstFilename = typeof files[0] === 'string' ? files[0] : files[0].filename;
        selectEl.value = firstFilename;
        loadAndRenderTurnout(map, firstFilename);
      }
    })
    .catch((err) => {
      console.error("Failed to list election CSVs:", err);
      selectEl.innerHTML = "<option>Error loading elections</option>";
      showTurnoutError("Unable to load elections list");
    });

  selectEl.addEventListener("change", () => {
    const chosen = selectEl.value;
    if (!chosen) return;
    showLoadingState();
    loadAndRenderTurnout(map, chosen);
  });

  // Set up leaderboard toggle
  setupLeaderboardToggle(map);
}

/**
 * Set up leaderboard toggle buttons
 */
function setupLeaderboardToggle(map) {
  const highestBtn = document.getElementById("leaderboard-highest");
  const lowestBtn = document.getElementById("leaderboard-lowest");

  highestBtn?.addEventListener("click", () => {
    if (leaderboardMode === 'highest') return;
    leaderboardMode = 'highest';
    highestBtn.classList.add("active");
    highestBtn.setAttribute('aria-pressed', 'true');
    lowestBtn.classList.remove("active");
    lowestBtn.setAttribute('aria-pressed', 'false');
    updateLeaderboard();
  });

  lowestBtn?.addEventListener("click", () => {
    if (leaderboardMode === 'lowest') return;
    leaderboardMode = 'lowest';
    lowestBtn.classList.add("active");
    lowestBtn.setAttribute('aria-pressed', 'true');
    highestBtn.classList.remove("active");
    highestBtn.setAttribute('aria-pressed', 'false');
    updateLeaderboard();
  });
}

/**
 * Show skeleton loading state in sidebar
 */
function showLoadingState() {
  const summaryDiv = document.getElementById("county-summary-stats");
  const leaderboardDiv = document.getElementById("leaderboard-list");
  const detailsDiv = document.getElementById("precinct-turnout-details");

  // Use skeleton loading for better UX
  if (summaryDiv) {
    summaryDiv.innerHTML = createSkeletonStatGrid(4);
    summaryDiv.classList.add('skeleton-loading');
  }
  if (leaderboardDiv) {
    leaderboardDiv.innerHTML = createSkeletonList(5);
    leaderboardDiv.classList.add('skeleton-loading');
  }
  if (detailsDiv) detailsDiv.innerHTML = '';
}

/**
 * Show error state with fade-in animation
 */
function showTurnoutError(message) {
  const detailsDiv = document.getElementById("precinct-turnout-details");
  if (detailsDiv) {
    fadeInContent(detailsDiv, createErrorState('Error', message));
  }
}

/**
 * Load election data and render turnout map
 */
async function loadAndRenderTurnout(map, electionFilename) {
  clearLayers(map);
  selectedLayer = null;
  currentElectionFilename = electionFilename;

  try {
    const [geojsonResp, electionData] = await Promise.all([
      loadAllData(),
      loadElectionData(electionFilename),
    ]);

    // Prepare turnout data
    currentTurnoutData = prepareTurnoutData(electionData);
    const summary = calculateCountySummary(electionData);
    
    // Update summary card
    renderCountySummary(summary);
    
    // Update leaderboard
    updateLeaderboard();

    // Build turnout lookup
    const turnoutByPrecinct = {};
    currentTurnoutData.forEach(d => {
      turnoutByPrecinct[d.precinctCode] = d;
    });

    const precinctGeoJSON = geojsonResp.geojson;

    // Create map layer
    const layer = L.geoJSON(precinctGeoJSON, {
      style: (feature) => {
        const code = String(feature.properties.PRECINCT);
        const turnoutInfo = turnoutByPrecinct[code];

        if (!turnoutInfo) {
          return TURNOUT_CONFIG.style.noData;
        }

        return {
          ...TURNOUT_CONFIG.style.default,
          fillColor: turnoutInfo.turnoutColor
        };
      },
      onEachFeature: (feature, leafletLayer) => {
        leafletLayer.on("click", () => {
          const code = String(feature.properties.PRECINCT);
          const turnoutInfo = turnoutByPrecinct[code];

          // Reset previous selection
          if (selectedLayer) {
            selectedLayer.setStyle({ weight: TURNOUT_CONFIG.style.default.weight });
          }

          // Highlight current selection
          leafletLayer.setStyle(TURNOUT_CONFIG.style.selected);
          selectedLayer = leafletLayer;

          // Show precinct details
          renderPrecinctDetails(code, turnoutInfo, feature.properties);
        });

        // Hover effects
        leafletLayer.on("mouseover", () => {
          if (leafletLayer !== selectedLayer) {
            leafletLayer.setStyle({ weight: 2 });
          }
        });

        leafletLayer.on("mouseout", () => {
          if (leafletLayer !== selectedLayer) {
            leafletLayer.setStyle({ weight: TURNOUT_CONFIG.style.default.weight });
          }
        });
      },
    }).addTo(map);

    map.currentLayer = layer;

  } catch (err) {
    console.error("Error loading turnout data:", err);
    showTurnoutError("Failed to load election data. Please try again.");
  }
}

/**
 * Render county summary statistics with fade-in animation
 */
function renderCountySummary(summary) {
  const summaryDiv = document.getElementById("county-summary-stats");
  if (!summaryDiv) return;

  // Remove skeleton loading class and add fade-in
  summaryDiv.classList.remove('skeleton-loading');
  summaryDiv.classList.add('fade-in');
  
  summaryDiv.innerHTML = `
    <div class="summary-stats">
      <div class="summary-stat">
        <span class="summary-value">${formatTurnoutPct(summary.overallTurnout)}</span>
        <span class="summary-label">Overall Turnout</span>
      </div>
      <div class="summary-stat">
        <span class="summary-value">${formatNumber(summary.totalBallotsCast)}</span>
        <span class="summary-label">Ballots Cast</span>
      </div>
      <div class="summary-stat">
        <span class="summary-value">${formatNumber(summary.totalRegistered)}</span>
        <span class="summary-label">Registered Voters</span>
      </div>
      <div class="summary-stat">
        <span class="summary-value">${summary.participatingPrecincts}</span>
        <span class="summary-label">Precincts</span>
      </div>
    </div>
    <div class="turnout-range">
      <span class="range-label">Turnout Range:</span>
      <span class="range-value">${formatTurnoutPct(summary.minTurnout)} - ${formatTurnoutPct(summary.maxTurnout)}</span>
    </div>
  `;
}

/**
 * Update leaderboard based on current mode
 */
function updateLeaderboard() {
  const leaderboardDiv = document.getElementById("leaderboard-list");
  if (!leaderboardDiv) return;

  // Remove skeleton loading state
  leaderboardDiv.classList.remove('skeleton-loading');

  const precincts = leaderboardMode === 'highest' 
    ? getTopPrecincts(currentTurnoutData, TURNOUT_CONFIG.leaderboard.defaultCount)
    : getBottomPrecincts(currentTurnoutData, TURNOUT_CONFIG.leaderboard.defaultCount);

  if (precincts.length === 0) {
    leaderboardDiv.innerHTML = '<p class="no-data">No data available</p>';
    return;
  }

  const listHTML = precincts.map((p, idx) => {
    const displayRank = leaderboardMode === 'highest' ? p.rank : currentTurnoutData.length - p.rank + 1;
    return `
      <div class="leaderboard-item hover-lift-subtle stagger-item" data-precinct="${p.precinctCode}" tabindex="0" role="button" 
           aria-label="${p.precinctName}: ${formatTurnoutPct(p.turnoutPct)} turnout"
           style="animation-delay: ${(idx + 1) * 0.03}s;">
        <span class="leaderboard-rank">#${displayRank}</span>
        <span class="leaderboard-name">${p.precinctName}</span>
        <span class="leaderboard-turnout" style="color: ${p.turnoutColor}">${formatTurnoutPct(p.turnoutPct)}</span>
      </div>
    `;
  }).join('');

  leaderboardDiv.innerHTML = listHTML;

  // Add click handlers to zoom to precinct
  leaderboardDiv.querySelectorAll('.leaderboard-item').forEach(item => {
    item.addEventListener('click', () => {
      const precinctCode = item.getAttribute('data-precinct');
      zoomToPrecinct(precinctCode);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const precinctCode = item.getAttribute('data-precinct');
        zoomToPrecinct(precinctCode);
      }
    });
  });
}

/**
 * Zoom to and select a specific precinct
 */
function zoomToPrecinct(precinctCode) {
  const map = window.leafletMap; // We'll need to expose this globally or pass it
  if (!map || !map.currentLayer) return;

  map.currentLayer.eachLayer(layer => {
    if (String(layer.feature?.properties?.PRECINCT) === precinctCode) {
      // Zoom to precinct
      map.fitBounds(layer.getBounds(), { padding: [50, 50] });
      
      // Trigger click to select and show details
      layer.fire('click');
    }
  });
}

/**
 * Render precinct details in sidebar
 */
function renderPrecinctDetails(precinctCode, turnoutInfo, properties) {
  const detailsDiv = document.getElementById("precinct-turnout-details");
  if (!detailsDiv) return;

  if (!turnoutInfo) {
    detailsDiv.innerHTML = `
      <div class="precinct-details-card">
        <hr>
        <h3>Precinct ${precinctCode}</h3>
        <p class="no-data">This precinct did not participate in this election.</p>
      </div>
    `;
    return;
  }

  const electionName = currentElectionFilename
    ? currentElectionFilename.replace(/\.csv$/, "").replace(/_/g, " ")
    : "Selected Election";

  detailsDiv.innerHTML = `
    <div class="precinct-details-card fade-in">
      <hr>
      <h3>${turnoutInfo.precinctName}</h3>
      <p><strong>Election:</strong> ${electionName}</p>
      
      <div class="turnout-highlight scale-in" style="background: linear-gradient(135deg, ${turnoutInfo.turnoutColor}22, ${turnoutInfo.turnoutColor}44); animation-delay: 0.1s;">
        <div class="turnout-value" style="color: ${turnoutInfo.turnoutColor}">${formatTurnoutPct(turnoutInfo.turnoutPct)}</div>
        <div class="turnout-label">Turnout Rate</div>
      </div>
      
      <div class="precinct-stats">
        <div class="precinct-stat stagger-item" style="animation-delay: 0.15s;">
          <span class="stat-value">${formatNumber(turnoutInfo.ballotsCast)}</span>
          <span class="stat-label">Ballots Cast</span>
        </div>
        <div class="precinct-stat stagger-item" style="animation-delay: 0.2s;">
          <span class="stat-value">${formatNumber(turnoutInfo.registeredVoters)}</span>
          <span class="stat-label">Registered</span>
        </div>
        <div class="precinct-stat stagger-item" style="animation-delay: 0.25s;">
          <span class="stat-value">#${turnoutInfo.rank}</span>
          <span class="stat-label">County Rank</span>
        </div>
      </div>
      
      <p class="gotv-note fade-in" style="animation-delay: 0.3s;">
        ${turnoutInfo.turnoutPct < 50 
          ? '<strong>GOTV Opportunity:</strong> This precinct has below-average turnout.'
          : turnoutInfo.turnoutPct >= 70 
            ? '<strong>High Engagement:</strong> This precinct has excellent turnout.'
            : '<strong>Moderate Turnout:</strong> Room for improvement in voter engagement.'}
      </p>
    </div>
  `;
}

// Export for global access (needed for zoomToPrecinct)
export { currentTurnoutData };
