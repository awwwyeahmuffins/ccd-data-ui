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
let debouncedUpdateSimulation = debounce(function runDebouncedSimulation() {
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
  let sidebarDiv = document.getElementById("sidebar-content");

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
  let initialRaceFromURL = options.initialRace;
  // YEAR FILTER: Parse year from URL hash
  let urlParams = new URLSearchParams(window.location.hash.slice(1));
  let initialYearFromURL = urlParams.get('year');
  const initialYear = initialYearFromURL ? parseInt(initialYearFromURL, 10) : null;

  // Initialize turnout slider state with extended range (50-150%)
  sliderState = createSliderState({ Rep: 1.0, Dem: 1.0, Mod: 1.0 }, { minValue: 0.5, maxValue: 1.5 });
  
  // Initialize voter flip state
  voterFlipState = createVoterFlipState();
  
  // Set up slider change handler
  sliderState.onChange(function handleSliderChange(party, value) {
    // Update displayed value
    if (party !== 'all') {
      let valueEl = document.getElementById(`${party.toLowerCase()}-value`);
      if (valueEl) {
        valueEl.textContent = Math.round(value * 100) + '%';
      }
    }

    // Re-run simulation with debounce
    debouncedUpdateSimulation();
  });
  
  // Set up voter flip change handler
  voterFlipState.onChange(function handleFlipChange(flipKey, value) {
    // Update displayed value
    if (flipKey !== 'all') {
      let flipId = flipKey.toLowerCase().replace('→', '-');
      let valueEl = document.getElementById(`flip-${flipId}-value`);
      if (valueEl) {
        valueEl.textContent = Math.round(value * 100) + '%';
      }
    }

    // Update active badge visibility
    updateFlipActiveBadge();

    // Re-run simulation with debounce
    debouncedUpdateSimulation();
  });

  let selectEl = document.getElementById("election-select");
  let searchInput = document.getElementById("election-search");
  let clearSearchBtn = document.getElementById("clear-search");
  let tabsContainer = document.getElementById("category-tabs");
  let resultsCountEl = document.getElementById("filter-results-count");
  let exportDropdownContainer = document.getElementById("export-dropdown-container");
  // YEAR FILTER: Get year dropdown element
  let yearFilterEl = document.getElementById("year-filter");

  // Initialize filter manager
  filterManager = new ElectionFilterManager();
  
  // Initialize export dropdown
  let exportDropdown = null;
  if (exportDropdownContainer) {
    exportDropdown = createExportDropdown(exportDropdownContainer, {
      onExportRace: function handleExportRace() {
        if (currentElectionData && currentElectionFilename) {
          exportRaceResults(currentElectionData, currentElectionFilename);
        }
      },
      onExportPrecinct: function handleExportPrecinct() {
        // This would require loading all elections for the precinct - future enhancement
        console.log('Precinct history export not yet implemented');
      },
      onExportFiltered: function handleExportFiltered() {
        // Export filtered results - future enhancement
        console.log('Filtered export not yet implemented');
      }
    });
  }

  // Load elections and initialize UI
  listElectionCSVs()
    .then(function initializeElectionUI(files) {
      // Set elections in filter manager
      filterManager.setElections(files);

      // YEAR FILTER: Set initial year from URL if present
      if (initialYear !== null) {
        filterManager.setYear(initialYear);
      }

      // YEAR FILTER: Populate year dropdown with available years
      let availableYears = filterManager.getAvailableYears();
      populateYearDropdown(yearFilterEl, availableYears, initialYear);

      // Render initial tabs
      renderCategoryTabs(tabsContainer, filterManager.getCategoryCounts(), ELECTION_CATEGORIES.ALL);

      // YEAR FILTER: Get filtered elections (includes year filter)
      let filteredElections = filterManager.getFilteredElections();

      // Populate dropdown with filtered elections
      populateDropdown(selectEl, filteredElections, '');
      updateResultsCount(resultsCountEl, filteredElections.length, files.length);

      // YEAR FILTER: Check if we have an initial race from URL (must match filtered list)
      let initialRace = null;
      if (filteredElections.length > 0) {
        if (initialRaceFromURL) {
          // Find entry matching the filename
          let matchingEntry = filteredElections.find(e =>
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
      filterManager.onChange(function handleFilterChange(state) {
        let filtered = state.filteredElections;
        // YEAR FILTER: Extract filenames from filtered entries for dropdown
        let filteredFilenames = filtered.map(e => typeof e === 'string' ? e : e.filename);
        populateDropdown(selectEl, filtered, state.searchQuery);
        updateResultsCount(resultsCountEl, filtered.length, state.counts[ELECTION_CATEGORIES.ALL]);

        // Update tabs with filtered counts when searching
        if (state.searchQuery) {
          renderCategoryTabs(tabsContainer, state.filteredCounts, state.category);
        } else {
          renderCategoryTabs(tabsContainer, state.counts, state.category);
        }

        // YEAR FILTER: Auto-select first result if current selection is not in filtered list
        let currentValue = selectEl.value;
        let currentInFiltered = filteredFilenames.includes(currentValue);
        if (filtered.length > 0 && !currentInFiltered) {
          let firstFilename = typeof filtered[0] === 'string' ? filtered[0] : filtered[0].filename;
          selectEl.value = firstFilename;
          loadAndRenderElection(map, firstFilename);
        } else if (filtered.length === 0) {
          // Show no results state
          clearLayers(map);
          let detailsDiv = document.getElementById("precinct-details");
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
    .catch(function handleElectionLoadError(err) {
      console.error("Failed to list election CSVs:", err);
      selectEl.innerHTML = "<option>Error loading elections</option>";
      let detailsDiv = document.getElementById("precinct-details");
      if (detailsDiv) {
        fadeInContent(detailsDiv, createErrorState(
          'Unable to load elections',
          'Please check your connection and try again.'
        ));
      }
    });

  // Search input handler (debounced)
  let handleSearch = debounce(function applySearchFilter(query) {
    filterManager.setSearchQuery(query);
    clearSearchBtn.classList.toggle('hidden', !query);
  }, 150);

  searchInput.addEventListener("input", function handleSearchInput(e) {
    handleSearch(e.target.value);
  });

  // Clear search button
  clearSearchBtn.addEventListener("click", function handleClearSearch() {
    searchInput.value = '';
    filterManager.setSearchQuery('');
    clearSearchBtn.classList.add('hidden');
    searchInput.focus();
  });

  // YEAR FILTER: Year dropdown change handler
  if (yearFilterEl) {
    yearFilterEl.addEventListener("change", function handleYearChange(e) {
      let yearValue = e.target.value;
      let year = yearValue === '' ? null : parseInt(yearValue, 10);
      filterManager.setYear(year);

      // YEAR FILTER: Update URL with year parameter
      let yearUrlParams = new URLSearchParams(window.location.hash.slice(1));
      if (year !== null) {
        yearUrlParams.set('year', year.toString());
      } else {
        yearUrlParams.delete('year');
      }
      let newHash = yearUrlParams.toString();
      history.replaceState(null, '', `#${newHash}`);
    });
  }

  // Category tab click handler (delegated)
  tabsContainer.addEventListener("click", function handleTabClick(e) {
    let tab = e.target.closest('.category-tab');
    if (tab) {
      let category = tab.dataset.category;
      filterManager.setCategory(category);
    }
  });

  // Keyboard navigation for tabs
  tabsContainer.addEventListener("keydown", function handleTabKeyNav(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      let tabs = Array.from(tabsContainer.querySelectorAll('.category-tab'));
      let currentIndex = tabs.findIndex(t => t === document.activeElement);
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
      let tab = e.target.closest('.category-tab');
      if (tab) {
        tab.click();
        e.preventDefault();
      }
    }
  });

  // Dropdown change handler
  selectEl.addEventListener("change", function handleElectionSelect() {
    let chosen = selectEl.value;
    if (!chosen) return;
    let detailsDiv = document.getElementById("precinct-details");
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
  let trendToggle = document.getElementById("trend-toggle");
  let trendSecondSelect = document.getElementById("trend-second-select");
  let trendLegend = document.getElementById("trend-legend");
  let trendError = document.getElementById("trend-error");

  // Populate second election dropdown when elections load
  listElectionCSVs().then(function populateTrendDropdown(files) {
    populateTrendSecondDropdown(trendSecondSelect, files);
  });

  // Trend toggle handler
  if (trendToggle) {
    trendToggle.addEventListener("change", function handleTrendToggle() {
      trendMode = trendToggle.checked;
      updateTrendMode();
    });
  }

  // Second election select handler
  if (trendSecondSelect) {
    trendSecondSelect.addEventListener("change", function handleSecondElectionSelect() {
      let chosen = trendSecondSelect.value;
      if (chosen && currentElectionFilename) {
        loadSecondElection(chosen);
      } else {
        resetTrendMode();
      }
    });
  }

  // Keyboard shortcut: Focus search on '/' key (when not in an input)
  document.addEventListener("keydown", function handleSearchShortcut(e) {
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
  container.innerHTML = CATEGORY_ORDER.map(function renderTabButton(category, index) {
    let isActive = category === activeCategory;
    let count = counts[category] || 0;
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
  let currentValue = selectEl.value;
  selectEl.innerHTML = '';

  if (elections.length === 0) {
    let opt = document.createElement("option");
    opt.value = '';
    opt.text = 'No elections match your filters';
    opt.disabled = true;
    selectEl.appendChild(opt);
    return;
  }

  for (let entry of elections) {
    let filename = typeof entry === 'string' ? entry : entry.filename;
    let displayName = (typeof entry === 'object' && entry.displayName)
      ? entry.displayName
      : formatElectionName(filename);

    let opt = document.createElement("option");
    opt.value = filename;
    opt.text = displayName;
    selectEl.appendChild(opt);
  }

  // Restore selection if it's still in the filtered list
  let filenames = elections.map(e => typeof e === 'string' ? e : e.filename);
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
  for (let year of years) {
    let opt = document.createElement("option");
    opt.value = year.toString();
    opt.text = year.toString();
    if (year === selectedYear) {
      opt.selected = true;
    }
    selectEl.appendChild(opt);
  }
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
  let currentEntry = allElections.find(function matchCurrentElection(e) {
    let filename = typeof e === 'string' ? e : e.filename;
    return filename === currentElectionFilename;
  });

  if (!currentEntry) return;

  let currentRaceKey = getRaceKey(currentEntry);

  // Filter elections with same race key but different filename
  let sameRaceElections = allElections.filter(function filterSameRace(e) {
    let filename = typeof e === 'string' ? e : e.filename;
    if (filename === currentElectionFilename) return false;
    let raceKey = getRaceKey(e);
    return raceKey === currentRaceKey;
  });

  // Clear and populate dropdown
  selectEl.innerHTML = '<option value="">-- Select election --</option>';
  for (let entry of sameRaceElections) {
    let filename = typeof entry === 'string' ? entry : entry.filename;
    let displayName = typeof entry === 'object' && entry.displayName
      ? entry.displayName
      : formatElectionName(filename);
    let year = typeof entry === 'object' ? entry.year : null;
    let label = year ? `${displayName} (${year})` : displayName;

    let opt = document.createElement("option");
    opt.value = filename;
    opt.textContent = label;
    selectEl.appendChild(opt);
  }

  // Restore selection if it still exists
  if (secondElectionFilename && sameRaceElections.some(function matchSecondElection(e) {
    let filename = typeof e === 'string' ? e : e.filename;
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
  
  let trendErrorEl = document.getElementById("trend-error");
  let trendLegendEl = document.getElementById("trend-legend");

  try {
    // Load second election data
    let secondData = await loadElectionData(filename);

    // Extract candidates from second election using schema utility
    let secondCandidateSet = new Set();
    if (secondData.length > 0) {
      let headers = Object.keys(secondData[0]);
      let candidateCols = getCandidateColumns(headers);
      for (let col of candidateCols) {
        // Verify it's a numeric column (vote count)
        let sampleValue = secondData[0][col];
        if (sampleValue !== "" && !isNaN(Number(sampleValue))) {
          secondCandidateSet.add(col);
        }
      }
    }

    let secondCands = Array.from(secondCandidateSet);

    // Build candidate colors
    let secondColors = {};
    for (let name of secondCands) {
      let party = name.split(" ")[0];
      secondColors[name] = (PARTY_COLORS && PARTY_COLORS[party]) || getPartyColor(party);
    }

    // Build lookup by precinct
    let secondByPrecinct = {};
    for (let row of secondData) {
      secondByPrecinct[row["PRECINCT CODE"]] = row;
    }

    // Check if same race key
    let currentEntry = { filename: currentElectionFilename };
    let secondEntry = { filename };
    let currentRaceKey = getRaceKey(currentEntry);
    let secondRaceKey = getRaceKey(secondEntry);
    
    if (currentRaceKey !== secondRaceKey) {
      // Different race - show error
      if (trendErrorEl) {
        trendErrorEl.textContent = "Select same race for trends (e.g., both Governor races)";
        trendErrorEl.classList.remove("hidden");
      }
      if (trendLegendEl) {
        trendLegendEl.classList.add("hidden");
      }
      resetTrendMode();
      return;
    }

    // Compute deltas
    let deltas = computePrecinctDeltas(
      currentElectionData,
      secondData,
      currentCandidates,
      secondCands,
      'Dem' // Measure Dem side margin
    );

    let summary = computeTrendSummary(deltas);

    // Store state
    secondElectionFilename = filename;
    secondElectionData = secondData;
    secondElectionByPrecinct = secondByPrecinct;
    secondCandidates = secondCands;
    secondCandidateColors = secondColors;
    trendDeltas = deltas;
    trendSummary = summary;

    // Hide error, show legend
    if (trendErrorEl) {
      trendErrorEl.classList.add("hidden");
    }
    if (trendLegendEl) {
      trendLegendEl.classList.remove("hidden");
    }

    // Update map if trend mode is enabled
    if (trendMode && currentMap && currentMap.currentLayer) {
      updateMapWithTrends();
    }

  } catch (err) {
    console.error("Error loading second election:", err);
    if (trendErrorEl) {
      trendErrorEl.textContent = "Failed to load second election";
      trendErrorEl.classList.remove("hidden");
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
  
  let trendToggleEl = document.getElementById("trend-toggle");
  let trendSecondSelectEl = document.getElementById("trend-second-select");
  let trendLegendEl = document.getElementById("trend-legend");
  let trendErrorEl = document.getElementById("trend-error");

  if (trendToggleEl) {
    trendToggleEl.checked = false;
  }
  if (trendSecondSelectEl) {
    trendSecondSelectEl.value = "";
  }
  if (trendLegendEl) {
    trendLegendEl.classList.add("hidden");
  }
  if (trendErrorEl) {
    trendErrorEl.classList.add("hidden");
  }
  
  // Refresh map to show normal colors
  if (currentMap && currentMap.currentLayer) {
    updateMapWithSimulation(); // This will use normal colors when trendMode is false
  }
}

// TRENDS: Update trend mode UI and map
function updateTrendMode() {
  let trendLegendEl = document.getElementById("trend-legend");
  let trendSecondSelectEl = document.getElementById("trend-second-select");
  
  if (trendMode && secondElectionFilename && trendDeltas) {
    // Show legend
    if (trendLegendEl) {
      trendLegendEl.classList.remove("hidden");
    }
    // Update map
    if (currentMap && currentMap.currentLayer) {
      updateMapWithTrends();
    }
  } else {
    // Hide legend
    if (trendLegendEl) {
      trendLegendEl.classList.add("hidden");
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
  
  let detailsDiv = document.getElementById("precinct-details");
  let simulatorContainer = document.getElementById("turnout-simulator-container");
  
  // Show skeleton loading state
  if (detailsDiv) {
    detailsDiv.innerHTML = createPrecinctDetailsSkeleton();
  }

  try {
    let [geojsonResp, electionData] = await Promise.all([
      loadAllData(),
      loadElectionData(electionFilename),
    ]);

    // Collect candidate fields using schema utility
    let candidateSet = new Set();
    if (electionData.length > 0) {
      let headers = Object.keys(electionData[0]);
      let candidateCols = getCandidateColumns(headers);
      for (let col of candidateCols) {
        // Verify it's a numeric column (vote count)
        let sampleValue = electionData[0][col];
        if (sampleValue !== "" && !isNaN(Number(sampleValue))) {
          candidateSet.add(col);
        }
      }
    }

    let candidates = Array.from(candidateSet);

    // Build candidate colors based on party prefix
    let candidateColors = {};
    for (let name of candidates) {
      let party = name.split(" ")[0];
      candidateColors[name] = (PARTY_COLORS && PARTY_COLORS[party]) || getPartyColor(party);
    }

    let precinctGeoJSON = geojsonResp.geojson;

    // Build lookup object keyed by precinct code (O(1) lookup)
    let electionByPrecinct = {};
    for (let row of electionData) {
      electionByPrecinct[row["PRECINCT CODE"]] = row;
    }

    // Build DNC data lookup from geojsonResp.dncLookup
    // Convert lowercase keys to uppercase for turnout simulator compatibility
    let dncDataByPrecinct = {};
    if (geojsonResp.dncLookup) {
      for (let [precinctCode, row] of Object.entries(geojsonResp.dncLookup)) {
        dncDataByPrecinct[precinctCode] = {
          Precinct: row.precinct,
          Rep: row.rep,
          Mod: row.mod,
          Dem: row.dem,
          Total: row.rep + row.mod + row.dem
        };
      }
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
      let turnoutValues = sliderState ? sliderState.getAll() : { Rep: 1.0, Dem: 1.0, Mod: 1.0 };
      let flipRates = voterFlipState ? voterFlipState.getAll() : {};
      simulatorContainer.innerHTML = generateSimulatorControlsHTML(turnoutValues, flipRates, { showVoterFlip: true });
      setupSimulatorEventListeners();
      
      // Run initial simulation
      updateSimulation();
    }

    // Default style for precincts
    let defaultStyle = (PRECINCT_STYLE && PRECINCT_STYLE.default) || {
      color: "#444",
      weight: 1,
      fillOpacity: 0.7
    };

    let notInRaceStyle = (PRECINCT_STYLE && PRECINCT_STYLE.notInRace) || {
      color: "#888",
      weight: 1,
      fillColor: "#ccc",
      fillOpacity: 0.3
    };

    // Create a new GeoJSON layer
    let layer = L.geoJSON(precinctGeoJSON, {
      style: function stylePrecinctFeature(feature) {
        let code = feature.properties.PRECINCT;
        let codeStr = code.toString();
        
        // O(1) direct lookup
        let record = electionByPrecinct[codeStr];

        // Check if precinct is NOT part of this race
        let registeredVoters = record ? Number(record["REGISTERED VOTERS TOTAL"]) || 0 : 0;
        let ballotsCast = record ? Number(record["BALLOTS CAST TOTAL"]) || 0 : 0;
        
        if (!record || (registeredVoters === 0 && ballotsCast === 0)) {
          return notInRaceStyle;
        }

        // TRENDS: If trend mode is active and we have deltas, color by trend
        if (trendMode && trendDeltas && trendDeltas[codeStr]) {
          let delta = trendDeltas[codeStr];

          if (delta.delta == null) {
            // Missing data in one election
            return {
              ...defaultStyle,
              fillColor: TREND_COLORS.noData,
              fillOpacity: 0.3
            };
          }
          
          // Color by margin delta
          let fillColor = getTrendColor(delta.delta, 'Dem');

          // If flipped, add border highlight
          let style = {
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
        for (let name of candidates) {
          let v = Number(record[name]) || 0;
          totalCandidateVotes += v;
          if (v > topVotes) {
            topVotes = v;
            topCandidate = name;
          }
        }
        
        if (totalCandidateVotes === 0) {
          return notInRaceStyle;
        }

        let fillColor = candidateColors[topCandidate] || "#ccc";

        return {
          ...defaultStyle,
          fillColor
        };
      },
      onEachFeature: function bindPrecinctClick(feature, leafletLayer) {
        leafletLayer.on("click", function handleLayerClick() {
          handlePrecinctClick(feature, leafletLayer);
        });
      },
    }).addTo(map);

    map.currentLayer = layer;

    // TRENDS: Populate second election dropdown with same-race elections
    let trendSecondSelectEl = document.getElementById("trend-second-select");
    if (trendSecondSelectEl) {
      listElectionCSVs().then(function updateTrendDropdown(files) {
        populateTrendSecondDropdown(trendSecondSelectEl, files);
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
  let detailsDiv = document.getElementById("precinct-details");
  let code = feature.properties.PRECINCT.toString();
  let data = currentElectionByPrecinct[code] || {};
  
  // Store current precinct properties for comparison feature
  currentPrecinctProps = feature.properties;
  
  // Reset previous selection
  if (selectedLayer) {
    let defaultWeight = (PRECINCT_STYLE && PRECINCT_STYLE.default && PRECINCT_STYLE.default.weight) || 1;
    selectedLayer.setStyle({ weight: defaultWeight });
  }
  
  // Highlight current selection
  let selectedStyle = (PRECINCT_STYLE && PRECINCT_STYLE.selected) || { weight: 3 };
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
  let precinctSimulation = currentSimulationResult?.precinctResults[code];
  let isFlipped = currentSimulationResult?.flippedPrecincts.includes(code);

  // Build candidate results HTML with original and simulated values
  let candidateResultsHTML = `<h4>Detailed Results</h4><ul class="candidate-results">`;
  for (let name of currentCandidates) {
    let originalVotes = Number(data[name]) || 0;
    let simulatedVotes = precinctSimulation?.adjustedVotes[name] || originalVotes;
    let diff = simulatedVotes - originalVotes;

    if (originalVotes > 0 || simulatedVotes > 0) {
      let diffStr = diff !== 0 ? ` <span class="${diff > 0 ? 'positive' : 'negative'}">(${diff > 0 ? '+' : ''}${diff})</span>` : '';
      candidateResultsHTML += `<li>${name}: ${simulatedVotes.toLocaleString()} votes${diffStr}</li>`;
    }
  }
  candidateResultsHTML += `</ul>`;

  // Get party label
  let partyCode = data["Winning Party"];
  let partyLabel = (PARTY_LABELS && PARTY_LABELS[partyCode]) || partyCode || "N/A";

  // Simulated winner info
  let simulatedWinner = precinctSimulation?.winner?.name || data["Winning Candidate"];
  let originalWinner = data["Winning Candidate"];
  let winnerChanged = originalWinner !== simulatedWinner;

  let winnerHTML = `<p><strong>Original Winner:</strong> ${originalWinner || "N/A"}</p>`;
  if (winnerChanged) {
    winnerHTML += `<p><strong>Simulated Winner:</strong> <span class="winner-change-text">${simulatedWinner}</span></p>`;
  }

  let flippedBadge = isFlipped ? '<span class="flipped-badge">FLIPPED</span>' : '';

  // Check if we're in comparison mode
  let comparisonState = getComparisonState();
  let isComparing = comparisonState.isComparing;

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
    let delta = trendDeltas[code];
    let secondDataRow = secondElectionByPrecinct[code] || {};

    if (delta.delta != null) {
      let deltaSign = delta.delta >= 0 ? '+' : '';
      let deltaColor = delta.delta >= 0 ? 'trend-positive' : 'trend-negative';
      let trendFlippedBadge = delta.flipped ? '<span class="trend-flipped-badge">FLIPPED</span>' : '';

      // Get year info if available
      let currentYear = currentElectionFilename.match(/_(\d{4})\.csv$/)?.[1] || '';
      let secondYear = secondElectionFilename.match(/_(\d{4})\.csv$/)?.[1] || '';
      
      trendHTML = `
        <div class="trend-comparison-section">
          <h4>Trend Comparison ${trendFlippedBadge}</h4>
          <div class="trend-comparison-grid">
            <div class="trend-year-column">
              <div class="trend-year-header">${currentYear || 'Year 1'}</div>
              <p><strong>Election:</strong> ${formatElectionName(currentElectionFilename)}</p>
              <p><strong>Winner:</strong> ${delta.winner1 || 'N/A'}</p>
              <p><strong>Margin:</strong> ${delta.margin1 != null ? delta.margin1.toFixed(2) + '%' : 'N/A'}</p>
              <p><strong>Total Votes:</strong> ${(delta.votes1 || 0).toLocaleString()}</p>
            </div>
            <div class="trend-year-column">
              <div class="trend-year-header">${secondYear || 'Year 2'}</div>
              <p><strong>Election:</strong> ${formatElectionName(secondElectionFilename)}</p>
              <p><strong>Winner:</strong> ${delta.winner2 || 'N/A'}</p>
              <p><strong>Margin:</strong> ${delta.margin2 != null ? delta.margin2.toFixed(2) + '%' : 'N/A'}</p>
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
  let tabs = detailsDiv.querySelectorAll('.precinct-detail-tab');
  for (let tab of tabs) {
    tab.addEventListener('click', function handleTabSwitch() {
      let tabId = tab.dataset.tab;

      // Update tab states
      for (let t of tabs) {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      }
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      // Update content visibility
      for (let content of detailsDiv.querySelectorAll('.tab-content')) {
        content.classList.remove('active');
      }
      document.getElementById(`tab-${tabId}`).classList.add('active');

      // Load voting history on first tab switch
      if (tabId === 'history') {
        loadVotingHistoryTab(precinctCode);
      }
    });
  }
}

/**
 * Sets up compare button click handler
 * @param {Object} feature - GeoJSON feature
 * @param {L.Layer} leafletLayer - Leaflet layer
 */
function setupCompareButton(feature, leafletLayer) {
  let compareBtn = document.getElementById('compare-btn');
  if (compareBtn) {
    compareBtn.addEventListener('click', function handleCompareClick() {
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
  let cancelCompareBtn = document.getElementById('cancel-compare-btn');
  if (cancelCompareBtn) {
    cancelCompareBtn.addEventListener('click', function handleCancelCompare() {
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
  let historyTab = document.getElementById('tab-history');
  if (!historyTab) return;

  // Check if already loaded
  if (historyTab.querySelector('.voting-history')) {
    return;
  }

  try {
    let history = await getPrecinctVotingHistory(precinctCode);
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
  let detailsDiv = document.getElementById("precinct-details");

  // Generate demographics comparison
  let demographics = compareDemographics(precinct1Props, precinct2Props);
  
  // Generate election comparison for current election
  let electionComparison = null;
  let raceName = null;
  if (currentElectionByPrecinct && currentElectionFilename) {
    let electionRows = Object.values(currentElectionByPrecinct);
    electionComparison = comparePrecincts(
      electionRows,
      precinct1Props.PRECINCT,
      precinct2Props.PRECINCT
    );
    raceName = formatElectionName(currentElectionFilename);
  }
  
  // Generate comparison HTML
  let comparisonHTML = generateComparisonHTML(demographics, electionComparison, raceName);
  
  detailsDiv.innerHTML = `
    <hr>
    ${comparisonHTML}
    <button class="compare-btn" id="clear-comparison-btn" style="margin-top: 16px;">
      Clear Comparison
    </button>
  `;
  
  // Setup clear comparison button
  let clearBtn = document.getElementById('clear-comparison-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', function handleClearComparison() {
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
  let turnoutSliders = document.querySelectorAll('.turnout-slider');

  for (let slider of turnoutSliders) {
    slider.addEventListener('input', function handleTurnoutSliderInput(e) {
      let party = e.target.dataset.party;
      let value = Number(e.target.value) / 100;
      sliderState.setValue(party, value);
    });
  }

  // Voter flip slider input handlers
  let flipSliders = document.querySelectorAll('.flip-slider');

  for (let slider of flipSliders) {
    slider.addEventListener('input', function handleFlipSliderInput(e) {
      let flipKey = e.target.dataset.flip;
      let value = Number(e.target.value) / 100;
      voterFlipState.setRate(flipKey, value);
    });
  }

  // Voter flip section toggle (collapsible)
  let flipToggle = document.getElementById('voter-flip-toggle');
  let flipContent = document.getElementById('voter-flip-content');
  if (flipToggle && flipContent) {
    flipToggle.addEventListener('click', function handleFlipToggle() {
      flipContent.classList.toggle('collapsed');
      flipToggle.classList.toggle('collapsed');
    });
  }

  // Reset button handler
  let resetBtn = document.getElementById('reset-turnout');
  if (resetBtn) {
    resetBtn.addEventListener('click', function handleResetClick() {
      // Reset slider state
      sliderState.reset();
      voterFlipState.reset();

      // Reset turnout slider inputs
      for (let slider of document.querySelectorAll('.turnout-slider')) {
        slider.value = 100;
      }

      // Reset flip slider inputs
      for (let slider of document.querySelectorAll('.flip-slider')) {
        slider.value = 0;
      }

      // Update displayed turnout values
      for (let party of ['rep', 'dem', 'mod']) {
        let valueEl = document.getElementById(`${party}-value`);
        if (valueEl) valueEl.textContent = '100%';
      }

      // Update displayed flip values
      for (let flip of ['rep-dem', 'dem-rep', 'mod-dem', 'mod-rep']) {
        let valueEl = document.getElementById(`flip-${flip}-value`);
        if (valueEl) valueEl.textContent = '0%';
      }

      // Hide active badge
      updateFlipActiveBadge();
    });
  }
}

/**
 * Updates the "Active" badge visibility on voter flip section
 */
function updateFlipActiveBadge() {
  let badge = document.getElementById('flip-active-badge');
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

  let turnoutMultipliers = sliderState ? sliderState.getAll() : { Rep: 1.0, Dem: 1.0, Mod: 1.0 };
  let voterFlipRates = voterFlipState ? voterFlipState.getAll() : {};
  
  // Run simulation with extended turnout and voter flip
  currentSimulationResult = runFullSimulation(
    currentElectionData,
    currentDncData,
    currentCandidates,
    turnoutMultipliers,
    { voterFlipRates }
  );

  // Update simulation summary display
  let summaryDiv = document.getElementById('simulation-summary');
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

  let defaultStyle = (PRECINCT_STYLE && PRECINCT_STYLE.default) || {
    color: "#444",
    weight: 1,
    fillOpacity: 0.7
  };

  let notInRaceStyle = (PRECINCT_STYLE && PRECINCT_STYLE.notInRace) || {
    color: "#888",
    weight: 1,
    fillColor: "#ccc",
    fillOpacity: 0.3
  };

  // Update each layer's style based on trend deltas
  currentMap.currentLayer.eachLayer(function styleTrendLayer(layer) {
    let code = layer.feature.properties.PRECINCT.toString();
    let delta = trendDeltas[code];
    let record = currentElectionByPrecinct[code];

    // Check if precinct is NOT part of this race
    if (!record || !precinctHasCandidateVotes(record)) {
      layer.setStyle(notInRaceStyle);
      return;
    }
    
    if (!delta || delta.delta == null) {
      // Missing data in one election
      layer.setStyle({
        ...defaultStyle,
        fillColor: TREND_COLORS.noData,
        fillOpacity: 0.3
      });
      return;
    }
    
    // Color by margin delta
    let fillColor = getTrendColor(delta.delta, 'Dem');

    // If flipped, add border highlight
    let style = {
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

  let defaultStyle = (PRECINCT_STYLE && PRECINCT_STYLE.default) || {
    color: "#444",
    weight: 1,
    fillOpacity: 0.7
  };

  let notInRaceStyle = (PRECINCT_STYLE && PRECINCT_STYLE.notInRace) || {
    color: "#888",
    weight: 1,
    fillColor: "#ccc",
    fillOpacity: 0.3
  };

  let flippedPrecincts = new Set(currentSimulationResult.flippedPrecincts);

  // Update each layer's style based on simulation results
  currentMap.currentLayer.eachLayer(function styleSimulationLayer(layer) {
    let code = layer.feature.properties.PRECINCT.toString();
    let precinctResult = currentSimulationResult.precinctResults[code];
    let record = currentElectionByPrecinct[code];

    // Check if precinct is NOT part of this race
    if (!record || !precinctHasCandidateVotes(record)) {
      layer.setStyle(notInRaceStyle);
      return;
    }

    // Determine winner from simulation
    let simulatedWinner = precinctResult?.winner?.name;
    let fillColor = currentCandidateColors[simulatedWinner] || "#ccc";

    // If no simulation result, use original
    if (!simulatedWinner && currentCandidates) {
      let topCandidate = null;
      let topVotes = 0;
      for (let name of currentCandidates) {
        let v = Number(record[name]) || 0;
        if (v > topVotes) {
          topVotes = v;
          topCandidate = name;
        }
      }
      fillColor = currentCandidateColors[topCandidate] || "#ccc";
    }

    // Check if this precinct flipped
    let isFlipped = flippedPrecincts.has(code);

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
      let weight = (layer === selectedLayer) ?
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
  let colors = {
    'REP': '#E91D0E',
    'DEM': '#004aad',
    'LIB': '#FFD700',
    'GRE': '#17AA5C',
    'IND': '#888888'
  };
  return colors[party] || '#888888';
}
