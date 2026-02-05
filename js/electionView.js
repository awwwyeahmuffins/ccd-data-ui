// js/electionView.js
// ===================
// Election Forecast view with filtering, categorization, turnout simulation, and export

import { clearLayers, debounce } from "./utils.js";
import { loadAllData, listElectionCSVs, loadElectionData } from "./dataLoader.js";
import { PARTY_COLORS, ELECTION_META_KEYS, PRECINCT_STYLE, PARTY_LABELS } from "./constants.js";
import { getCandidateColumns } from "./electionSchema.js";
// Import election filter functions
import {
  ELECTION_CATEGORIES,
  CATEGORY_ORDER,
  ElectionFilterManager,
  formatElectionName
} from "./electionFilters.js";
// Import turnout simulator functions
import {
  createSliderState,
  createVoterFlipState,
  runFullSimulation,
  generateSimulatorControlsHTML,
  generateSimulationResultsHTML
} from "./turnoutSimulator.js";
// Import export and URL state functions
import { 
  exportRaceResults, 
  createExportDropdown,
  computeRaceSummary
} from "./exportManager.js";
import { setCurrentRace, setCurrentPrecinct } from "./app.js";
// Import precinct history functions (Workstream 4)
import { 
  getPrecinctVotingHistory, 
  generateVotingHistoryHTML,
  compareDemographics,
  comparePrecincts,
  generateComparisonHTML,
  startComparison,
  clearComparison,
  getComparisonState,
  loadAllElectionDataForHistory
} from "./precinctHistory.js";
// Import skeleton loading utilities (Workstream 4)
import {
  createLoadingSpinner,
  createPrecinctDetailsSkeleton,
  fadeInContent,
  createErrorState
} from "./skeletonLoader.js";
// Import election trends utilities for comparison feature
import {
  TREND_COLORS,
  getRaceKey,
  getTrendColor,
  computePrecinctDeltas,
  computeTrendSummary
} from "./electionTrends.js";

// Track selected layer for visual feedback
let selectedLayer = null;
// Track current precinct properties for comparison
let currentPrecinctProps = null;

// Track filter manager instance
let filterManager = null;

// Track turnout simulator state
let sliderState = null;
let voterFlipState = null;
let currentElectionData = null;
let currentDncData = null;
let currentCandidates = null;
let currentElectionFilename = null;
let currentSimulationResult = null;
let currentGeoJSON = null;
let currentElectionByPrecinct = null;
let currentCandidateColors = null;
let currentMap = null;

// TRENDS: Track trend comparison state
let trendMode = false;
let secondElectionFilename = null;
let secondElectionData = null;
let secondElectionByPrecinct = null;
let secondCandidates = null;
let secondCandidateColors = null;
let trendDeltas = null;
let trendSummary = null;

// Debounced simulation update
const debouncedUpdateSimulation = debounce(() => {
  if (currentElectionData && currentDncData && currentCandidates) {
    updateSimulation();
  }
}, 100);

/**
 * Render the election view
 * @param {Object} map - Leaflet map instance
 * @param {Object} options - Optional { initialRace } to restore state from URL
 */
export function renderElectionView(map, options = {}) {
  const sidebarDiv = document.getElementById("sidebar-content");

  sidebarDiv.innerHTML = `
    <div class="fade-in">
      <h2>Election Forecast</h2>
      
      <div class="election-filters" role="search" aria-label="Filter elections">
        <div class="search-container">
          <input 
            type="text" 
            id="election-search" 
            class="election-search-input transition-fast"
            placeholder="Search elections..." 
            aria-label="Search elections"
            autocomplete="off"
          >
          <button 
            id="clear-search" 
            class="clear-search-btn hidden press-effect"
            aria-label="Clear search"
            type="button"
          >×</button>
        </div>
        <div id="category-tabs" class="category-tabs" role="tablist" aria-label="Election categories">
          <!-- Tabs will be populated dynamically -->
        </div>
      </div>
      
      <div id="filter-results-count" class="filter-results-count" aria-live="polite"></div>
      
      <div class="election-select-row">
        <label for="election-select">Choose election:</label>
        <div class="election-select-controls">
          <select id="election-select" class="transition-fast" aria-label="Select election to display">
            <option>Loading...</option>
          </select>
          <div id="export-dropdown-container"></div>
        </div>
      </div>
      
      <!-- TRENDS: Compare block -->
      <div class="trend-compare-block">
        <div class="trend-compare-header">
          <h3>Compare Elections</h3>
          <label class="trend-toggle-label">
            <input type="checkbox" id="trend-toggle" class="trend-toggle-checkbox">
            <span class="trend-toggle-slider"></span>
            <span class="trend-toggle-text">Show trend</span>
          </label>
        </div>
        <div class="trend-compare-controls">
          <label for="trend-second-select">Compare to:</label>
          <select id="trend-second-select" class="trend-second-select transition-fast" aria-label="Select second election for comparison">
            <option value="">-- Select election --</option>
          </select>
        </div>
        <div id="trend-legend" class="trend-legend hidden">
          <div class="trend-legend-title">Trend Legend</div>
          <div class="trend-legend-items">
            <div class="trend-legend-item">
              <span class="trend-legend-color" style="background-color: ${TREND_COLORS.swingDem.default}"></span>
              <span>Swing to Dem</span>
            </div>
            <div class="trend-legend-item">
              <span class="trend-legend-color" style="background-color: ${TREND_COLORS.swingRep.default}"></span>
              <span>Swing to Rep</span>
            </div>
            <div class="trend-legend-item">
              <span class="trend-legend-color" style="background-color: ${TREND_COLORS.neutral}"></span>
              <span>No change</span>
            </div>
            <div class="trend-legend-item">
              <span class="trend-legend-color trend-legend-flipped"></span>
              <span>Flipped</span>
            </div>
          </div>
        </div>
        <div id="trend-error" class="trend-error hidden"></div>
      </div>
      
      <p>
        Click on a precinct on the map to view that precinct's vote breakdown.
      </p>

      <div id="turnout-simulator-container"></div>

      <div id="precinct-details"></div>
    </div>
  `;
  
  // YEAR FILTER: Store initial race and year from URL for later use
  const initialRaceFromURL = options.initialRace;
  // YEAR FILTER: Parse year from URL hash
  const urlParams = new URLSearchParams(window.location.hash.slice(1));
  const initialYearFromURL = urlParams.get('year');
  const initialYear = initialYearFromURL ? parseInt(initialYearFromURL, 10) : null;

  // Initialize turnout slider state with extended range (50-150%)
  sliderState = createSliderState({ Rep: 1.0, Dem: 1.0, Mod: 1.0 }, { minValue: 0.5, maxValue: 1.5 });
  
  // Initialize voter flip state
  voterFlipState = createVoterFlipState();
  
  // Set up slider change handler
  sliderState.onChange((party, value) => {
    // Update displayed value
    if (party !== 'all') {
      const valueEl = document.getElementById(`${party.toLowerCase()}-value`);
      if (valueEl) {
        valueEl.textContent = Math.round(value * 100) + '%';
      }
    }
    
    // Re-run simulation with debounce
    debouncedUpdateSimulation();
  });
  
  // Set up voter flip change handler
  voterFlipState.onChange((flipKey, value) => {
    // Update displayed value
    if (flipKey !== 'all') {
      const flipId = flipKey.toLowerCase().replace('→', '-');
      const valueEl = document.getElementById(`flip-${flipId}-value`);
      if (valueEl) {
        valueEl.textContent = Math.round(value * 100) + '%';
      }
    }
    
    // Update active badge visibility
    updateFlipActiveBadge();
    
    // Re-run simulation with debounce
    debouncedUpdateSimulation();
  });

  const selectEl = document.getElementById("election-select");
  const searchInput = document.getElementById("election-search");
  const clearSearchBtn = document.getElementById("clear-search");
  const tabsContainer = document.getElementById("category-tabs");
  const resultsCountEl = document.getElementById("filter-results-count");
  const exportDropdownContainer = document.getElementById("export-dropdown-container");
  // YEAR FILTER: Get year dropdown element
  const yearFilterEl = document.getElementById("year-filter");

  // Initialize filter manager
  filterManager = new ElectionFilterManager();
  
  // Initialize export dropdown
  let exportDropdown = null;
  if (exportDropdownContainer) {
    exportDropdown = createExportDropdown(exportDropdownContainer, {
      onExportRace: () => {
        if (currentElectionData && currentElectionFilename) {
          exportRaceResults(currentElectionData, currentElectionFilename);
        }
      },
      onExportPrecinct: () => {
        // This would require loading all elections for the precinct - future enhancement
        console.log('Precinct history export not yet implemented');
      },
      onExportFiltered: () => {
        // Export filtered results - future enhancement
        console.log('Filtered export not yet implemented');
      }
    });
  }

  // Load elections and initialize UI
  listElectionCSVs()
    .then((files) => {
      // Set elections in filter manager
      filterManager.setElections(files);
      
      // YEAR FILTER: Set initial year from URL if present
      if (initialYear !== null) {
        filterManager.setYear(initialYear);
      }
      
      // YEAR FILTER: Populate year dropdown with available years
      const availableYears = filterManager.getAvailableYears();
      populateYearDropdown(yearFilterEl, availableYears, initialYear);
      
      // Render initial tabs
      renderCategoryTabs(tabsContainer, filterManager.getCategoryCounts(), ELECTION_CATEGORIES.ALL);
      
      // YEAR FILTER: Get filtered elections (includes year filter)
      const filteredElections = filterManager.getFilteredElections();
      
      // Populate dropdown with filtered elections
      populateDropdown(selectEl, filteredElections, '');
      updateResultsCount(resultsCountEl, filteredElections.length, files.length);
      
      // YEAR FILTER: Check if we have an initial race from URL (must match filtered list)
      let initialRace = null;
      if (filteredElections.length > 0) {
        if (initialRaceFromURL) {
          // Find entry matching the filename
          const matchingEntry = filteredElections.find(e => 
            (typeof e === 'string' ? e : e.filename) === initialRaceFromURL
          );
          if (matchingEntry) {
            initialRace = typeof matchingEntry === 'string' ? matchingEntry : matchingEntry.filename;
          }
        }
        // Fallback to first filtered election
        if (!initialRace) {
          initialRace = typeof filteredElections[0] === 'string' 
            ? filteredElections[0] 
            : filteredElections[0].filename;
        }
      }
      
      // Load initial election
      if (initialRace) {
        selectEl.value = initialRace;
        loadAndRenderElection(map, initialRace);
        // Update URL state with selected race
        setCurrentRace(initialRace);
      }
      
      // Setup filter change handler
      filterManager.onChange((state) => {
        const filtered = state.filteredElections;
        // YEAR FILTER: Extract filenames from filtered entries for dropdown
        const filteredFilenames = filtered.map(e => typeof e === 'string' ? e : e.filename);
        populateDropdown(selectEl, filtered, state.searchQuery);
        updateResultsCount(resultsCountEl, filtered.length, state.counts[ELECTION_CATEGORIES.ALL]);
        
        // Update tabs with filtered counts when searching
        if (state.searchQuery) {
          renderCategoryTabs(tabsContainer, state.filteredCounts, state.category);
        } else {
          renderCategoryTabs(tabsContainer, state.counts, state.category);
        }
        
        // YEAR FILTER: Auto-select first result if current selection is not in filtered list
        const currentValue = selectEl.value;
        const currentInFiltered = filteredFilenames.includes(currentValue);
        if (filtered.length > 0 && !currentInFiltered) {
          const firstFilename = typeof filtered[0] === 'string' ? filtered[0] : filtered[0].filename;
          selectEl.value = firstFilename;
          loadAndRenderElection(map, firstFilename);
        } else if (filtered.length === 0) {
          // Show no results state
          clearLayers(map);
          const detailsDiv = document.getElementById("precinct-details");
          if (detailsDiv) {
            detailsDiv.innerHTML = `
              <div class="no-results-message">
                <h4>No elections found</h4>
                <p>Try adjusting your search, category, or year filter.</p>
              </div>
            `;
          }
        }
      });
    })
    .catch((err) => {
      console.error("Failed to list election CSVs:", err);
      selectEl.innerHTML = "<option>Error loading elections</option>";
      const detailsDiv = document.getElementById("precinct-details");
      if (detailsDiv) {
        fadeInContent(detailsDiv, createErrorState(
          'Unable to load elections',
          'Please check your connection and try again.'
        ));
      }
    });

  // Search input handler (debounced)
  const handleSearch = debounce((query) => {
    filterManager.setSearchQuery(query);
    clearSearchBtn.classList.toggle('hidden', !query);
  }, 150);

  searchInput.addEventListener("input", (e) => {
    handleSearch(e.target.value);
  });

  // Clear search button
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = '';
    filterManager.setSearchQuery('');
    clearSearchBtn.classList.add('hidden');
    searchInput.focus();
  });

  // YEAR FILTER: Year dropdown change handler
  if (yearFilterEl) {
    yearFilterEl.addEventListener("change", (e) => {
      const yearValue = e.target.value;
      const year = yearValue === '' ? null : parseInt(yearValue, 10);
      filterManager.setYear(year);
      
      // YEAR FILTER: Update URL with year parameter
      const urlParams = new URLSearchParams(window.location.hash.slice(1));
      if (year !== null) {
        urlParams.set('year', year.toString());
      } else {
        urlParams.delete('year');
      }
      const newHash = urlParams.toString();
      history.replaceState(null, '', `#${newHash}`);
    });
  }

  // Category tab click handler (delegated)
  tabsContainer.addEventListener("click", (e) => {
    const tab = e.target.closest('.category-tab');
    if (tab) {
      const category = tab.dataset.category;
      filterManager.setCategory(category);
    }
  });

  // Keyboard navigation for tabs
  tabsContainer.addEventListener("keydown", (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const tabs = Array.from(tabsContainer.querySelectorAll('.category-tab'));
      const currentIndex = tabs.findIndex(t => t === document.activeElement);
      if (currentIndex === -1) return;
      
      let nextIndex;
      if (e.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % tabs.length;
      } else {
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      }
      
      tabs[nextIndex].focus();
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      const tab = e.target.closest('.category-tab');
      if (tab) {
        tab.click();
        e.preventDefault();
      }
    }
  });

  // Dropdown change handler
  selectEl.addEventListener("change", () => {
    const chosen = selectEl.value;
    if (!chosen) return;
    const detailsDiv = document.getElementById("precinct-details");
    if (detailsDiv) {
      detailsDiv.innerHTML = createPrecinctDetailsSkeleton();
    }
    loadAndRenderElection(map, chosen);
    // Update URL state with selected race
    setCurrentRace(chosen);
    // TRENDS: Reset trend mode when primary election changes
    resetTrendMode();
  });

  // TRENDS: Setup trend controls
  const trendToggle = document.getElementById("trend-toggle");
  const trendSecondSelect = document.getElementById("trend-second-select");
  const trendLegend = document.getElementById("trend-legend");
  const trendError = document.getElementById("trend-error");
  
  // Populate second election dropdown when elections load
  listElectionCSVs().then(files => {
    populateTrendSecondDropdown(trendSecondSelect, files);
  });
  
  // Trend toggle handler
  if (trendToggle) {
    trendToggle.addEventListener("change", () => {
      trendMode = trendToggle.checked;
      updateTrendMode();
    });
  }
  
  // Second election select handler
  if (trendSecondSelect) {
    trendSecondSelect.addEventListener("change", () => {
      const chosen = trendSecondSelect.value;
      if (chosen && currentElectionFilename) {
        loadSecondElection(chosen);
      } else {
        resetTrendMode();
      }
    });
  }

  // Keyboard shortcut: Focus search on '/' key (when not in an input)
  document.addEventListener("keydown", (e) => {
    if (e.key === '/' && 
        document.activeElement !== searchInput &&
        document.activeElement.tagName !== 'INPUT' &&
        document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      searchInput.focus();
    }
  });
}

/**
 * Renders category tabs with counts
 * @param {HTMLElement} container - The tabs container element
 * @param {Object} counts - Category counts
 * @param {string} activeCategory - Currently active category
 */
function renderCategoryTabs(container, counts, activeCategory) {
  container.innerHTML = CATEGORY_ORDER.map((category, index) => {
    const isActive = category === activeCategory;
    const count = counts[category] || 0;
    return `
      <button 
        class="category-tab press-effect stagger-item ${isActive ? 'active' : ''}" 
        data-category="${category}"
        aria-pressed="${isActive}"
        aria-label="${category} elections: ${count} races"
        tabindex="${isActive ? '0' : '-1'}"
        role="tab"
        style="animation-delay: ${(index + 1) * 0.03}s;"
      >
        ${category}
        <span class="tab-count">${count}</span>
      </button>
    `;
  }).join('');
}

/**
 * Populates the election dropdown with filtered results
 * @param {HTMLSelectElement} selectEl - The select element
 * @param {Array<string|Object>} elections - Array of election filenames or objects
 * @param {string} searchQuery - Current search query for highlighting
 */
function populateDropdown(selectEl, elections, searchQuery) {
  const currentValue = selectEl.value;
  selectEl.innerHTML = '';
  
  if (elections.length === 0) {
    const opt = document.createElement("option");
    opt.value = '';
    opt.text = 'No elections match your filters';
    opt.disabled = true;
    selectEl.appendChild(opt);
    return;
  }
  
  elections.forEach((entry) => {
    const filename = typeof entry === 'string' ? entry : entry.filename;
    const displayName = (typeof entry === 'object' && entry.displayName) 
      ? entry.displayName 
      : formatElectionName(filename);
    
    const opt = document.createElement("option");
    opt.value = filename;
    opt.text = displayName;
    selectEl.appendChild(opt);
  });
  
  // Restore selection if it's still in the filtered list
  const filenames = elections.map(e => typeof e === 'string' ? e : e.filename);
  if (filenames.includes(currentValue)) {
    selectEl.value = currentValue;
  }
}

/**
 * YEAR FILTER: Populates the year dropdown with available years
 * @param {HTMLSelectElement} selectEl - The year select element
 * @param {Array<number>} years - Array of available years (sorted descending)
 * @param {number|null} selectedYear - Currently selected year (null for "All years")
 */
function populateYearDropdown(selectEl, years, selectedYear) {
  if (!selectEl) return;
  
  // Keep "All years" option
  selectEl.innerHTML = '<option value="">All years</option>';
  
  // Add year options
  years.forEach(year => {
    const opt = document.createElement("option");
    opt.value = year.toString();
    opt.text = year.toString();
    if (year === selectedYear) {
      opt.selected = true;
    }
    selectEl.appendChild(opt);
  });
}

/**
 * Updates the results count display
 * @param {HTMLElement} el - The results count element
 * @param {number} showing - Number of elections currently showing
 * @param {number} total - Total number of elections
 */
function updateResultsCount(el, showing, total) {
  if (showing === total) {
    el.innerHTML = `Showing all <strong>${total}</strong> elections`;
  } else {
    el.innerHTML = `Showing <strong>${showing}</strong> of <strong>${total}</strong> elections`;
  }
}

// TRENDS: Populate second election dropdown with elections that have the same race key
async function populateTrendSecondDropdown(selectEl, allElections) {
  if (!selectEl || !currentElectionFilename) return;
  
  // Get race key of current election
  const currentEntry = allElections.find(e => {
    const filename = typeof e === 'string' ? e : e.filename;
    return filename === currentElectionFilename;
  });
  
  if (!currentEntry) return;
  
  const currentRaceKey = getRaceKey(currentEntry);
  
  // Filter elections with same race key but different filename
  const sameRaceElections = allElections.filter(e => {
    const filename = typeof e === 'string' ? e : e.filename;
    if (filename === currentElectionFilename) return false;
    const raceKey = getRaceKey(e);
    return raceKey === currentRaceKey;
  });
  
  // Clear and populate dropdown
  selectEl.innerHTML = '<option value="">-- Select election --</option>';
  sameRaceElections.forEach(entry => {
    const filename = typeof entry === 'string' ? entry : entry.filename;
    const displayName = typeof entry === 'object' && entry.displayName 
      ? entry.displayName 
      : formatElectionName(filename);
    const year = typeof entry === 'object' ? entry.year : null;
    const label = year ? `${displayName} (${year})` : displayName;
    
    const opt = document.createElement("option");
    opt.value = filename;
    opt.textContent = label;
    selectEl.appendChild(opt);
  });
  
  // Restore selection if it still exists
  if (secondElectionFilename && sameRaceElections.some(e => {
    const filename = typeof e === 'string' ? e : e.filename;
    return filename === secondElectionFilename;
  })) {
    selectEl.value = secondElectionFilename;
  }
}

// TRENDS: Load second election and compute deltas
async function loadSecondElection(filename) {
  if (!filename || !currentElectionData || !currentCandidates) {
    return;
  }
  
  const trendError = document.getElementById("trend-error");
  const trendLegend = document.getElementById("trend-legend");
  
  try {
    // Load second election data
    const secondData = await loadElectionData(filename);
    
    // Extract candidates from second election using schema utility
    const secondCandidateSet = new Set();
    if (secondData.length > 0) {
      const headers = Object.keys(secondData[0]);
      const candidateCols = getCandidateColumns(headers);
      candidateCols.forEach(col => {
        // Verify it's a numeric column (vote count)
        const sampleValue = secondData[0][col];
        if (sampleValue !== "" && !isNaN(Number(sampleValue))) {
          secondCandidateSet.add(col);
        }
      });
    }
    
    const secondCands = Array.from(secondCandidateSet);
    
    // Build candidate colors
    const secondColors = {};
    secondCands.forEach((name) => {
      const party = name.split(" ")[0];
      secondColors[name] = (PARTY_COLORS && PARTY_COLORS[party]) || getPartyColor(party);
    });
    
    // Build lookup by precinct
    const secondByPrecinct = {};
    secondData.forEach((row) => {
      secondByPrecinct[row["PRECINCT CODE"]] = row;
    });
    
    // Check if same race key
    const currentEntry = { filename: currentElectionFilename };
    const secondEntry = { filename };
    const currentRaceKey = getRaceKey(currentEntry);
    const secondRaceKey = getRaceKey(secondEntry);
    
    if (currentRaceKey !== secondRaceKey) {
      // Different race - show error
      if (trendError) {
        trendError.textContent = "Select same race for trends (e.g., both Governor races)";
        trendError.classList.remove("hidden");
      }
      if (trendLegend) {
        trendLegend.classList.add("hidden");
      }
      resetTrendMode();
      return;
    }
    
    // Compute deltas
    const deltas = computePrecinctDeltas(
      currentElectionData,
      secondData,
      currentCandidates,
      secondCands,
      'Dem' // Measure Dem side margin
    );
    
    const summary = computeTrendSummary(deltas);
    
    // Store state
    secondElectionFilename = filename;
    secondElectionData = secondData;
    secondElectionByPrecinct = secondByPrecinct;
    secondCandidates = secondCands;
    secondCandidateColors = secondColors;
    trendDeltas = deltas;
    trendSummary = summary;
    
    // Hide error, show legend
    if (trendError) {
      trendError.classList.add("hidden");
    }
    if (trendLegend) {
      trendLegend.classList.remove("hidden");
    }
    
    // Update map if trend mode is enabled
    if (trendMode && currentMap && currentMap.currentLayer) {
      updateMapWithTrends();
    }
    
  } catch (err) {
    console.error("Error loading second election:", err);
    if (trendError) {
      trendError.textContent = "Failed to load second election";
      trendError.classList.remove("hidden");
    }
    resetTrendMode();
  }
}

// TRENDS: Reset trend mode state
function resetTrendMode() {
  trendMode = false;
  secondElectionFilename = null;
  secondElectionData = null;
  secondElectionByPrecinct = null;
  secondCandidates = null;
  secondCandidateColors = null;
  trendDeltas = null;
  trendSummary = null;
  
  const trendToggle = document.getElementById("trend-toggle");
  const trendSecondSelect = document.getElementById("trend-second-select");
  const trendLegend = document.getElementById("trend-legend");
  const trendError = document.getElementById("trend-error");
  
  if (trendToggle) {
    trendToggle.checked = false;
  }
  if (trendSecondSelect) {
    trendSecondSelect.value = "";
  }
  if (trendLegend) {
    trendLegend.classList.add("hidden");
  }
  if (trendError) {
    trendError.classList.add("hidden");
  }
  
  // Refresh map to show normal colors
  if (currentMap && currentMap.currentLayer) {
    updateMapWithSimulation(); // This will use normal colors when trendMode is false
  }
}

// TRENDS: Update trend mode UI and map
function updateTrendMode() {
  const trendLegend = document.getElementById("trend-legend");
  const trendSecondSelect = document.getElementById("trend-second-select");
  
  if (trendMode && secondElectionFilename && trendDeltas) {
    // Show legend
    if (trendLegend) {
      trendLegend.classList.remove("hidden");
    }
    // Update map
    if (currentMap && currentMap.currentLayer) {
      updateMapWithTrends();
    }
  } else {
    // Hide legend
    if (trendLegend) {
      trendLegend.classList.add("hidden");
    }
    // Reset map to normal colors
    if (currentMap && currentMap.currentLayer) {
      updateMapWithSimulation();
    }
  }
}

/**
 * Loads and renders election data on the map
 * @param {L.Map} map - Leaflet map instance
 * @param {string} electionFilename - Election CSV filename
 */
async function loadAndRenderElection(map, electionFilename) {
  clearLayers(map);
  selectedLayer = null;
  currentMap = map;
  
  const detailsDiv = document.getElementById("precinct-details");
  const simulatorContainer = document.getElementById("turnout-simulator-container");
  
  // Show skeleton loading state
  if (detailsDiv) {
    detailsDiv.innerHTML = createPrecinctDetailsSkeleton();
  }

  try {
    const [geojsonResp, electionData] = await Promise.all([
      loadAllData(),
      loadElectionData(electionFilename),
    ]);

    // Collect candidate fields using schema utility
    const candidateSet = new Set();
    if (electionData.length > 0) {
      const headers = Object.keys(electionData[0]);
      const candidateCols = getCandidateColumns(headers);
      candidateCols.forEach(col => {
        // Verify it's a numeric column (vote count)
        const sampleValue = electionData[0][col];
        if (sampleValue !== "" && !isNaN(Number(sampleValue))) {
          candidateSet.add(col);
        }
      });
    }

    const candidates = Array.from(candidateSet);
    
    // Build candidate colors based on party prefix
    const candidateColors = {};
    candidates.forEach((name) => {
      const party = name.split(" ")[0];
      candidateColors[name] = (PARTY_COLORS && PARTY_COLORS[party]) || getPartyColor(party);
    });

    const precinctGeoJSON = geojsonResp.geojson;
    
    // Build lookup object keyed by precinct code (O(1) lookup)
    const electionByPrecinct = {};
    electionData.forEach((row) => {
      electionByPrecinct[row["PRECINCT CODE"]] = row;
    });

    // Build DNC data lookup from geojsonResp.dncLookup
    // Convert lowercase keys to uppercase for turnout simulator compatibility
    const dncDataByPrecinct = {};
    if (geojsonResp.dncLookup) {
      Object.entries(geojsonResp.dncLookup).forEach(([precinctCode, row]) => {
        dncDataByPrecinct[precinctCode] = {
          Precinct: row.precinct,
          Rep: row.rep,
          Mod: row.mod,
          Dem: row.dem,
          Total: row.rep + row.mod + row.dem
        };
      });
    }

    // Store data for turnout simulation
    currentElectionData = electionData;
    currentDncData = dncDataByPrecinct;
    currentCandidates = candidates;
    currentElectionFilename = electionFilename;
    currentGeoJSON = precinctGeoJSON;
    currentElectionByPrecinct = electionByPrecinct;
    currentCandidateColors = candidateColors;
    
    // Reset slider state for new election
    if (sliderState) {
      sliderState.reset();
    }
    if (voterFlipState) {
      voterFlipState.reset();
    }

    // Render turnout simulator controls with extended range and voter flip
    if (simulatorContainer) {
      const turnoutValues = sliderState ? sliderState.getAll() : { Rep: 1.0, Dem: 1.0, Mod: 1.0 };
      const flipRates = voterFlipState ? voterFlipState.getAll() : {};
      simulatorContainer.innerHTML = generateSimulatorControlsHTML(turnoutValues, flipRates, { showVoterFlip: true });
      setupSimulatorEventListeners();
      
      // Run initial simulation
      updateSimulation();
    }

    // Default style for precincts
    const defaultStyle = (PRECINCT_STYLE && PRECINCT_STYLE.default) || {
      color: "#444",
      weight: 1,
      fillOpacity: 0.7
    };
    
    const notInRaceStyle = (PRECINCT_STYLE && PRECINCT_STYLE.notInRace) || {
      color: "#888",
      weight: 1,
      fillColor: "#ccc",
      fillOpacity: 0.3
    };

    // Create a new GeoJSON layer
    const layer = L.geoJSON(precinctGeoJSON, {
      style: (feature) => {
        const code = feature.properties.PRECINCT;
        const codeStr = code.toString();
        
        // O(1) direct lookup
        const record = electionByPrecinct[codeStr];
        
        // Check if precinct is NOT part of this race
        const registeredVoters = record ? Number(record["REGISTERED VOTERS TOTAL"]) || 0 : 0;
        const ballotsCast = record ? Number(record["BALLOTS CAST TOTAL"]) || 0 : 0;
        
        if (!record || (registeredVoters === 0 && ballotsCast === 0)) {
          return notInRaceStyle;
        }

        // TRENDS: If trend mode is active and we have deltas, color by trend
        if (trendMode && trendDeltas && trendDeltas[codeStr]) {
          const delta = trendDeltas[codeStr];
          
          if (delta.delta === null || delta.delta === undefined) {
            // Missing data in one election
            return {
              ...defaultStyle,
              fillColor: TREND_COLORS.noData,
              fillOpacity: 0.3
            };
          }
          
          // Color by margin delta
          const fillColor = getTrendColor(delta.delta, 'Dem');
          
          // If flipped, add border highlight
          const style = {
            ...defaultStyle,
            fillColor
          };
          
          if (delta.flipped) {
            style.color = TREND_COLORS.flipped;
            style.weight = 3;
            style.dashArray = "5, 5";
          }
          
          return style;
        }

        // Normal mode: Find top candidate
        let topCandidate = null;
        let topVotes = 0;
        let totalCandidateVotes = 0;
        candidates.forEach(name => {
          const v = Number(record[name]) || 0;
          totalCandidateVotes += v;
          if (v > topVotes) {
            topVotes = v;
            topCandidate = name;
          }
        });
        
        if (totalCandidateVotes === 0) {
          return notInRaceStyle;
        }

        const fillColor = candidateColors[topCandidate] || "#ccc";
        
        return {
          ...defaultStyle,
          fillColor
        };
      },
      onEachFeature: (feature, leafletLayer) => {
        leafletLayer.on("click", () => {
          handlePrecinctClick(feature, leafletLayer);
        });
      },
    }).addTo(map);

    map.currentLayer = layer;
    
    // TRENDS: Populate second election dropdown with same-race elections
    const trendSecondSelect = document.getElementById("trend-second-select");
    if (trendSecondSelect) {
      listElectionCSVs().then(files => {
        populateTrendSecondDropdown(trendSecondSelect, files);
      });
    }
    
    // Clear loading state after successful load with fade-in
    if (detailsDiv && (detailsDiv.querySelector('.sidebar-skeleton') || detailsDiv.querySelector('.loading-spinner'))) {
      fadeInContent(detailsDiv, '<p class="instruction-text">Click a precinct to view results</p>');
    }
    
  } catch (err) {
    console.error("Error loading election data:", err);
    if (detailsDiv) {
      fadeInContent(detailsDiv, createErrorState(
        'Unable to load election data',
        'Please check your connection and try again.'
      ));
    }
  }
}

/**
 * Handles precinct click event
 * @param {Object} feature - GeoJSON feature
 * @param {L.Layer} leafletLayer - Leaflet layer
 */
function handlePrecinctClick(feature, leafletLayer) {
  const detailsDiv = document.getElementById("precinct-details");
  const code = feature.properties.PRECINCT.toString();
  const data = currentElectionByPrecinct[code] || {};
  
  // Store current precinct properties for comparison feature
  currentPrecinctProps = feature.properties;
  
  // Reset previous selection
  if (selectedLayer) {
    const defaultWeight = (PRECINCT_STYLE && PRECINCT_STYLE.default && PRECINCT_STYLE.default.weight) || 1;
    selectedLayer.setStyle({ weight: defaultWeight });
  }
  
  // Highlight current selection
  const selectedStyle = (PRECINCT_STYLE && PRECINCT_STYLE.selected) || { weight: 3 };
  leafletLayer.setStyle(selectedStyle);
  selectedLayer = leafletLayer;

  // Check if precinct has no data or is not part of this race
  // City/ISD/MUD elections may have BALLOTS_CAST > 0 for non-participating precincts
  // (from other races on the ballot), so also check candidate votes
  if (!data["PRECINCT CODE"] || !precinctHasCandidateVotes(data)) {
    detailsDiv.innerHTML = `
      <div class="empty-state">
        <hr>
        <h3>Precinct ${code}</h3>
        <p>This precinct is not part of this election.</p>
      </div>
    `;
    return;
  }

  // Get simulation data for this precinct
  const precinctSimulation = currentSimulationResult?.precinctResults[code];
  const isFlipped = currentSimulationResult?.flippedPrecincts.includes(code);

  // Build candidate results HTML with original and simulated values
  let candidateResultsHTML = `<h4>Detailed Results</h4><ul class="candidate-results">`;
  currentCandidates.forEach(name => {
    const originalVotes = Number(data[name]) || 0;
    const simulatedVotes = precinctSimulation?.adjustedVotes[name] || originalVotes;
    const diff = simulatedVotes - originalVotes;
    
    if (originalVotes > 0 || simulatedVotes > 0) {
      const diffStr = diff !== 0 ? ` <span class="${diff > 0 ? 'positive' : 'negative'}">(${diff > 0 ? '+' : ''}${diff})</span>` : '';
      candidateResultsHTML += `<li>${name}: ${simulatedVotes.toLocaleString()} votes${diffStr}</li>`;
    }
  });
  candidateResultsHTML += `</ul>`;

  // Get party label
  const partyCode = data["Winning Party"];
  const partyLabel = (PARTY_LABELS && PARTY_LABELS[partyCode]) || partyCode || "N/A";
  
  // Simulated winner info
  const simulatedWinner = precinctSimulation?.winner?.name || data["Winning Candidate"];
  const originalWinner = data["Winning Candidate"];
  const winnerChanged = originalWinner !== simulatedWinner;

  let winnerHTML = `<p><strong>Original Winner:</strong> ${originalWinner || "N/A"}</p>`;
  if (winnerChanged) {
    winnerHTML += `<p><strong>Simulated Winner:</strong> <span class="winner-change-text">${simulatedWinner}</span></p>`;
  }

  const flippedBadge = isFlipped ? '<span class="flipped-badge">FLIPPED</span>' : '';

  // Check if we're in comparison mode
  const comparisonState = getComparisonState();
  const isComparing = comparisonState.isComparing;

  // Build comparison mode banner if applicable
  let comparisonBanner = '';
  if (isComparing && comparisonState.precinct1 && !comparisonState.precinct2) {
    comparisonBanner = `
      <div class="comparison-mode-banner">
        <span class="banner-text">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 3H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zM9 9H5V5h4v4zm11-6h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zm-1 6h-4V5h4v4z"/></svg>
          Select second precinct to compare (Pct ${comparisonState.precinct1.PRECINCT})
        </span>
        <button class="cancel-compare-btn" id="cancel-compare-btn">Cancel</button>
      </div>
    `;
  }

  // Build compare button (only show if not in comparison mode)
  const compareButton = !isComparing ? `
    <button class="compare-btn press-effect hover-lift-subtle" id="compare-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 3H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zM9 9H5V5h4v4zm11-6h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zm-1 6h-4V5h4v4z"/></svg>
      Compare with another precinct
    </button>
  ` : '';

  // TRENDS: Build trend comparison HTML if in trend mode
  let trendHTML = '';
  if (trendMode && trendDeltas && trendDeltas[code] && secondElectionData) {
    const delta = trendDeltas[code];
    const secondData = secondElectionByPrecinct[code] || {};
    
    if (delta.delta !== null && delta.delta !== undefined) {
      const deltaSign = delta.delta >= 0 ? '+' : '';
      const deltaColor = delta.delta >= 0 ? 'trend-positive' : 'trend-negative';
      const flippedBadge = delta.flipped ? '<span class="trend-flipped-badge">FLIPPED</span>' : '';
      
      // Get year info if available
      const currentYear = currentElectionFilename.match(/_(\d{4})\.csv$/)?.[1] || '';
      const secondYear = secondElectionFilename.match(/_(\d{4})\.csv$/)?.[1] || '';
      
      trendHTML = `
        <div class="trend-comparison-section">
          <h4>Trend Comparison ${flippedBadge}</h4>
          <div class="trend-comparison-grid">
            <div class="trend-year-column">
              <div class="trend-year-header">${currentYear || 'Year 1'}</div>
              <p><strong>Election:</strong> ${formatElectionName(currentElectionFilename)}</p>
              <p><strong>Winner:</strong> ${delta.winner1 || 'N/A'}</p>
              <p><strong>Margin:</strong> ${delta.margin1 !== null ? delta.margin1.toFixed(2) + '%' : 'N/A'}</p>
              <p><strong>Total Votes:</strong> ${(delta.votes1 || 0).toLocaleString()}</p>
            </div>
            <div class="trend-year-column">
              <div class="trend-year-header">${secondYear || 'Year 2'}</div>
              <p><strong>Election:</strong> ${formatElectionName(secondElectionFilename)}</p>
              <p><strong>Winner:</strong> ${delta.winner2 || 'N/A'}</p>
              <p><strong>Margin:</strong> ${delta.margin2 !== null ? delta.margin2.toFixed(2) + '%' : 'N/A'}</p>
              <p><strong>Total Votes:</strong> ${(delta.votes2 || 0).toLocaleString()}</p>
            </div>
          </div>
          <div class="trend-delta">
            <strong>Change:</strong> 
            <span class="${deltaColor}">${deltaSign}${delta.delta.toFixed(2)}%</span>
            ${delta.flipped ? '<span class="trend-flipped-text">(Winner changed)</span>' : ''}
          </div>
        </div>
      `;
    } else {
      trendHTML = `
        <div class="trend-comparison-section">
          <p class="trend-no-data">No comparison data available for this precinct (missing in one election)</p>
        </div>
      `;
    }
  }

  // Build tabbed interface with animations
  detailsDiv.innerHTML = `
    <div class="fade-in">
      <hr>
      <h3>Precinct ${code} ${flippedBadge}</h3>
      
      ${comparisonBanner}
      
      <div class="precinct-detail-tabs" role="tablist">
        <button class="precinct-detail-tab press-effect active" data-tab="results" role="tab" aria-selected="true">Election Results</button>
        <button class="precinct-detail-tab press-effect" data-tab="history" role="tab" aria-selected="false">Voting History</button>
      </div>
      
      <div id="tab-results" class="tab-content active fade-in">
        ${trendMode && trendHTML ? trendHTML : `
          <p><strong>Election:</strong> ${formatElectionName(currentElectionFilename)}</p>
          ${winnerHTML}
          <p><strong>Party:</strong> ${partyLabel}</p>
          <p><strong>Total Votes:</strong> ${(Number(data["BALLOTS CAST TOTAL"]) || 0).toLocaleString()}</p>
          ${candidateResultsHTML}
          ${compareButton}
        `}
      </div>
      
    <div id="tab-history" class="tab-content">
      <div class="voting-history-loading">
        ${createLoadingSpinner({ size: 'small', label: 'Loading voting history' })}
        <p>Loading voting history...</p>
      </div>
    </div>
    </div>
  `;

  // Setup tab switching
  setupPrecinctTabs(detailsDiv, code);

  // Setup compare button
  setupCompareButton(feature, leafletLayer);

  // Setup cancel compare button
  setupCancelCompareButton(feature, leafletLayer);

  // Check if this is the second precinct in comparison mode
  if (isComparing && comparisonState.precinct1 && !comparisonState.precinct2) {
    if (feature.properties.PRECINCT !== comparisonState.precinct1.PRECINCT) {
      // This is the second precinct - show comparison
      startComparison(feature.properties);
      showPrecinctComparison(comparisonState.precinct1, feature.properties);
    }
  }
}

/**
 * Sets up precinct detail tabs
 * @param {HTMLElement} detailsDiv - Details container
 * @param {string} precinctCode - Precinct code
 */
function setupPrecinctTabs(detailsDiv, precinctCode) {
  const tabs = detailsDiv.querySelectorAll('.precinct-detail-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      
      // Update tab states
      tabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      
      // Update content visibility
      detailsDiv.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(`tab-${tabId}`).classList.add('active');
      
      // Load voting history on first tab switch
      if (tabId === 'history') {
        loadVotingHistoryTab(precinctCode);
      }
    });
  });
}

/**
 * Sets up compare button click handler
 * @param {Object} feature - GeoJSON feature
 * @param {L.Layer} leafletLayer - Leaflet layer
 */
function setupCompareButton(feature, leafletLayer) {
  const compareBtn = document.getElementById('compare-btn');
  if (compareBtn) {
    compareBtn.addEventListener('click', () => {
      startComparison(feature.properties);
      // Refresh the display to show comparison mode
      handlePrecinctClick(feature, leafletLayer);
    });
  }
}

/**
 * Sets up cancel compare button click handler
 * @param {Object} feature - GeoJSON feature
 * @param {L.Layer} leafletLayer - Leaflet layer
 */
function setupCancelCompareButton(feature, leafletLayer) {
  const cancelCompareBtn = document.getElementById('cancel-compare-btn');
  if (cancelCompareBtn) {
    cancelCompareBtn.addEventListener('click', () => {
      clearComparison();
      // Refresh the display
      handlePrecinctClick(feature, leafletLayer);
    });
  }
}

/**
 * Loads and displays voting history for a precinct
 * @param {string} precinctCode - Precinct code
 */
async function loadVotingHistoryTab(precinctCode) {
  const historyTab = document.getElementById('tab-history');
  if (!historyTab) return;
  
  // Check if already loaded
  if (historyTab.querySelector('.voting-history')) {
    return;
  }
  
  try {
    const history = await getPrecinctVotingHistory(precinctCode);
    historyTab.innerHTML = generateVotingHistoryHTML(history);
  } catch (err) {
    console.error('Error loading voting history:', err);
    historyTab.innerHTML = `
      <div class="error-state">
        <p>Unable to load voting history.</p>
        <button onclick="loadVotingHistoryTab('${precinctCode}')" class="retry-btn">Retry</button>
      </div>
    `;
  }
}

/**
 * Shows comparison between two precincts
 * @param {Object} precinct1Props - First precinct properties
 * @param {Object} precinct2Props - Second precinct properties
 */
async function showPrecinctComparison(precinct1Props, precinct2Props) {
  const detailsDiv = document.getElementById("precinct-details");
  
  // Generate demographics comparison
  const demographics = compareDemographics(precinct1Props, precinct2Props);
  
  // Generate election comparison for current election
  let electionComparison = null;
  let raceName = null;
  if (currentElectionByPrecinct && currentElectionFilename) {
    const electionData = Object.values(currentElectionByPrecinct);
    electionComparison = comparePrecincts(
      electionData, 
      precinct1Props.PRECINCT, 
      precinct2Props.PRECINCT
    );
    raceName = formatElectionName(currentElectionFilename);
  }
  
  // Generate comparison HTML
  const comparisonHTML = generateComparisonHTML(demographics, electionComparison, raceName);
  
  detailsDiv.innerHTML = `
    <hr>
    ${comparisonHTML}
    <button class="compare-btn" id="clear-comparison-btn" style="margin-top: 16px;">
      Clear Comparison
    </button>
  `;
  
  // Setup clear comparison button
  const clearBtn = document.getElementById('clear-comparison-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearComparison();
      detailsDiv.innerHTML = '<p class="instruction-text">Click a precinct to view results</p>';
    });
  }
}

/**
 * Sets up event listeners for turnout simulator controls
 */
function setupSimulatorEventListeners() {
  // Turnout slider input handlers
  const turnoutSliders = document.querySelectorAll('.turnout-slider');
  
  turnoutSliders.forEach(slider => {
    slider.addEventListener('input', (e) => {
      const party = e.target.dataset.party;
      const value = Number(e.target.value) / 100;
      sliderState.setValue(party, value);
    });
  });

  // Voter flip slider input handlers
  const flipSliders = document.querySelectorAll('.flip-slider');
  
  flipSliders.forEach(slider => {
    slider.addEventListener('input', (e) => {
      const flipKey = e.target.dataset.flip;
      const value = Number(e.target.value) / 100;
      voterFlipState.setRate(flipKey, value);
    });
  });

  // Voter flip section toggle (collapsible)
  const flipToggle = document.getElementById('voter-flip-toggle');
  const flipContent = document.getElementById('voter-flip-content');
  if (flipToggle && flipContent) {
    flipToggle.addEventListener('click', () => {
      flipContent.classList.toggle('collapsed');
      flipToggle.classList.toggle('collapsed');
    });
  }

  // Reset button handler
  const resetBtn = document.getElementById('reset-turnout');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      // Reset slider state
      sliderState.reset();
      voterFlipState.reset();
      
      // Reset turnout slider inputs
      document.querySelectorAll('.turnout-slider').forEach(slider => {
        slider.value = 100;
      });
      
      // Reset flip slider inputs
      document.querySelectorAll('.flip-slider').forEach(slider => {
        slider.value = 0;
      });
      
      // Update displayed turnout values
      ['rep', 'dem', 'mod'].forEach(party => {
        const valueEl = document.getElementById(`${party}-value`);
        if (valueEl) valueEl.textContent = '100%';
      });
      
      // Update displayed flip values
      ['rep-dem', 'dem-rep', 'mod-dem', 'mod-rep'].forEach(flip => {
        const valueEl = document.getElementById(`flip-${flip}-value`);
        if (valueEl) valueEl.textContent = '0%';
      });
      
      // Hide active badge
      updateFlipActiveBadge();
    });
  }
}

/**
 * Updates the "Active" badge visibility on voter flip section
 */
function updateFlipActiveBadge() {
  const badge = document.getElementById('flip-active-badge');
  if (badge && voterFlipState) {
    badge.style.display = voterFlipState.hasAnyFlips() ? 'inline' : 'none';
  }
}

/**
 * Updates the simulation and re-renders results
 */
function updateSimulation() {
  if (!currentElectionData || !currentDncData || !currentCandidates) {
    return;
  }

  const turnoutMultipliers = sliderState ? sliderState.getAll() : { Rep: 1.0, Dem: 1.0, Mod: 1.0 };
  const voterFlipRates = voterFlipState ? voterFlipState.getAll() : {};
  
  // Run simulation with extended turnout and voter flip
  currentSimulationResult = runFullSimulation(
    currentElectionData,
    currentDncData,
    currentCandidates,
    turnoutMultipliers,
    { voterFlipRates }
  );

  // Update simulation summary display
  const summaryDiv = document.getElementById('simulation-summary');
  if (summaryDiv) {
    summaryDiv.innerHTML = generateSimulationResultsHTML(
      currentSimulationResult.originalSummary,
      currentSimulationResult.simulatedSummary,
      currentSimulationResult.flippedPrecincts,
      currentSimulationResult.countyFlipped
    );
  }

  // Update map to highlight flipped precincts
  if (currentMap && currentMap.currentLayer) {
    updateMapWithSimulation();
  }
}

// TRENDS: Update map layer to show trend colors
function updateMapWithTrends() {
  if (!currentMap || !currentMap.currentLayer || !trendDeltas) {
    return;
  }

  const defaultStyle = (PRECINCT_STYLE && PRECINCT_STYLE.default) || {
    color: "#444",
    weight: 1,
    fillOpacity: 0.7
  };
  
  const notInRaceStyle = (PRECINCT_STYLE && PRECINCT_STYLE.notInRace) || {
    color: "#888",
    weight: 1,
    fillColor: "#ccc",
    fillOpacity: 0.3
  };

  // Update each layer's style based on trend deltas
  currentMap.currentLayer.eachLayer((layer) => {
    const code = layer.feature.properties.PRECINCT.toString();
    const delta = trendDeltas[code];
    const record = currentElectionByPrecinct[code];

    // Check if precinct is NOT part of this race
    if (!record || !precinctHasCandidateVotes(record)) {
      layer.setStyle(notInRaceStyle);
      return;
    }
    
    if (!delta || delta.delta === null || delta.delta === undefined) {
      // Missing data in one election
      layer.setStyle({
        ...defaultStyle,
        fillColor: TREND_COLORS.noData,
        fillOpacity: 0.3
      });
      return;
    }
    
    // Color by margin delta
    const fillColor = getTrendColor(delta.delta, 'Dem');
    
    // If flipped, add border highlight
    const style = {
      ...defaultStyle,
      fillColor
    };
    
    if (delta.flipped) {
      style.color = TREND_COLORS.flipped;
      style.weight = 3;
      style.dashArray = "5, 5";
    }
    
    // Keep selected layer's weight if it's selected
    if (layer === selectedLayer) {
      style.weight = (PRECINCT_STYLE && PRECINCT_STYLE.selected && PRECINCT_STYLE.selected.weight) || 3;
    }
    
    layer.setStyle(style);
  });
}

/**
 * Updates the map layer to show simulated results and highlight flipped precincts
 */
function updateMapWithSimulation() {
  // TRENDS: If trend mode is active, use trend colors instead
  if (trendMode && trendDeltas) {
    updateMapWithTrends();
    return;
  }
  if (!currentMap || !currentMap.currentLayer || !currentSimulationResult) {
    return;
  }

  const defaultStyle = (PRECINCT_STYLE && PRECINCT_STYLE.default) || {
    color: "#444",
    weight: 1,
    fillOpacity: 0.7
  };
  
  const notInRaceStyle = (PRECINCT_STYLE && PRECINCT_STYLE.notInRace) || {
    color: "#888",
    weight: 1,
    fillColor: "#ccc",
    fillOpacity: 0.3
  };

  const flippedPrecincts = new Set(currentSimulationResult.flippedPrecincts);

  // Update each layer's style based on simulation results
  currentMap.currentLayer.eachLayer((layer) => {
    const code = layer.feature.properties.PRECINCT.toString();
    const precinctResult = currentSimulationResult.precinctResults[code];
    const record = currentElectionByPrecinct[code];

    // Check if precinct is NOT part of this race
    if (!record || !precinctHasCandidateVotes(record)) {
      layer.setStyle(notInRaceStyle);
      return;
    }

    // Determine winner from simulation
    const simulatedWinner = precinctResult?.winner?.name;
    let fillColor = currentCandidateColors[simulatedWinner] || "#ccc";
    
    // If no simulation result, use original
    if (!simulatedWinner && currentCandidates) {
      let topCandidate = null;
      let topVotes = 0;
      currentCandidates.forEach(name => {
        const v = Number(record[name]) || 0;
        if (v > topVotes) {
          topVotes = v;
          topCandidate = name;
        }
      });
      fillColor = currentCandidateColors[topCandidate] || "#ccc";
    }

    // Check if this precinct flipped
    const isFlipped = flippedPrecincts.has(code);
    
    // Set style with flipped highlighting
    if (isFlipped) {
      layer.setStyle({
        ...defaultStyle,
        fillColor,
        color: "#FFD700", // Gold border for flipped precincts
        weight: 3,
        dashArray: "5, 5" // Dashed border
      });
    } else {
      // Keep selected layer's weight if it's selected
      const weight = (layer === selectedLayer) ? 
        ((PRECINCT_STYLE && PRECINCT_STYLE.selected && PRECINCT_STYLE.selected.weight) || 3) :
        defaultStyle.weight;
      
      layer.setStyle({
        ...defaultStyle,
        fillColor,
        weight,
        dashArray: null
      });
    }
  });
}

/**
 * Checks if a precinct participates in the current race by summing candidate votes.
 * Non-participating precincts in City/ISD/MUD elections have BALLOTS_CAST > 0
 * (from other races on the ballot) but 0 votes for the current race's candidates.
 * @param {Object} record - Election data row for the precinct
 * @returns {boolean} True if the precinct has candidate votes in this race
 */
function precinctHasCandidateVotes(record) {
  if (!record || !currentCandidates) return false;
  let total = 0;
  for (const name of currentCandidates) {
    total += Number(record[name]) || 0;
    if (total > 0) return true; // short-circuit
  }
  return false;
}

/**
 * Gets a color for a party prefix (fallback if PARTY_COLORS not available)
 * @param {string} party - Party prefix (REP, DEM, etc.)
 * @returns {string} Hex color code
 */
function getPartyColor(party) {
  const colors = {
    'REP': '#E91D0E',
    'DEM': '#004aad',
    'LIB': '#FFD700',
    'GRE': '#17AA5C',
    'IND': '#888888'
  };
  return colors[party] || '#888888';
}
