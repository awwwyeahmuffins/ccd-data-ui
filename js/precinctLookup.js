// precinctLookup.js
// --------------------------------------------------------------------------------
// Precinct Lookup page orchestration — search, report rendering, mini map,
// Chart.js charts, county comparisons, section navigation.

import {
  loadAllData,
  setActiveBoundary,
  getActiveBoundary,
  getBoundaryConfigs,
  listElectionCSVs,
  getActiveCounty,
  setActiveCounty,
  loadCountyRegistry,
} from "./dataLoader.js";
import { findPrecinctForAddress, findPrecinctForPoint } from "./geoLookup.js";
import {
  loadCensusProfiles,
  generateProfileHTML,
  renderPartyRegistration,
  renderRacialDemographics,
  renderOfficials,
  generateTakeaways,
  renderTrendArrow,
  escapeHtml,
  formatNum,
  formatCurrency,
  formatPct,
} from "./precinctProfile.js";
import {
  getPrecinctVotingHistory,
  clearElectionDataCache,
  computePrecinctTrend,
  CATEGORY_ORDER,
  formatRaceName,
  calculateTurnout,
  getPrecinctCandidateData,
  getPrecinctRaceDetail,
  computeCountyDemShare,
  loadAllElectionDataForHistory,
  categorizeRace,
} from "./precinctHistory.js";
import {
  initTheme,
  toggleTheme,
  getCurrentTheme,
  LIGHT_TILE_URL,
  DARK_TILE_URL,
} from "./themeManager.js";
import { exportAsPDF, exportAsMarkdown } from "./precinctExport.js";
import {
  loadOnePagerData,
  generateFieldOnePagerHTML,
  generateFieldOnePagerText,
  printOnePager,
  copyOnePagerToClipboard,
} from "./fieldOnePager.js";
import {
  AUDIENCES,
  isAudience,
  derivePrecinctSignature,
  recommendAudience,
  buildTargetedTalkingPoints,
  buildCanvassScript,
} from "./talkingPointsBuilder.js";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let geojsonData = null;
let dncLookup = null;
let racialLookup = null;
let censusProfiles = null;
let strategicIntel = null;
let precinctList = []; // [{code, feature, party}]
let miniMap = null;
let miniMapLayer = null;
let contextLayer = null;
let tileLayer = null;
let currentReportData = null;
let currentPrecinctCode = null;
let isSwitching = false;

// Chart lifecycle
let chartInstances = {};

// County averages & precinct rankings
let countyAverages = null;
let precinctRankings = null;

// Section nav observer
let sectionObserver = null;

// PVI cache: precinctCode -> { pvi, label }
let pviCache = {};

// Comparison state
let compareMode = false;
let comparePrecinct = null;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Brand the header + tab title to the active county instead of hardcoding
// "Collin County". Resolves the slug → display name via the registry; falls
// back to a clean "Texas" until that resolves (or if it can't).
async function applyCountyBranding() {
  const slug = getActiveCounty();
  const label = document.getElementById("header-county-name");
  const setName = (name) => {
    if (label) label.textContent = `${name} County`;
    document.title = `${name} County Precinct Lookup`;
  };
  // Slug like "collin" → "Collin" as an immediate, sensible default.
  setName(slug.charAt(0).toUpperCase() + slug.slice(1));
  try {
    const registry = await loadCountyRegistry();
    const entry = registry.find((c) => c.slug === slug);
    if (entry && entry.name) setName(entry.name);
  } catch (_) { /* keep the slug-derived name */ }
}

export async function initPrecinctLookup() {
  initTheme();
  applyCountyBranding();

  // Theme toggle
  let themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) {
    updateThemeIcon(themeBtn);
    themeBtn.addEventListener("click", function onThemeToggle() {
      toggleTheme();
      updateThemeIcon(themeBtn);
      updateMiniMapTiles();
    });
  }

  // Boundary toggle pills
  let boundaryBtns = document.querySelectorAll(".boundary-pill");
  boundaryBtns.forEach(function attachBoundary(btn) {
    btn.addEventListener("click", async function onBoundary() {
      let id = btn.dataset.boundary;
      if (id === getActiveBoundary() || isSwitching) return;
      boundaryBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      await handleBoundarySwitch(id);
    });
  });

  // Search input
  let searchInput = document.getElementById("precinct-search");
  let dropdown = document.getElementById("search-dropdown");
  if (searchInput && dropdown) {
    searchInput.addEventListener("input", function onInput() {
      handleSearchInput(searchInput.value.trim(), dropdown);
    });
    searchInput.addEventListener("keydown", function onKey(e) {
      handleSearchKeydown(e, dropdown);
    });
    document.addEventListener("click", function onDocClick(e) {
      if (!e.target.closest(".search-wrapper")) {
        dropdown.classList.remove("open");
      }
    });
  }

  // "Use my location" button
  bindLocationButton();

  // Export buttons
  let pdfBtn = document.getElementById("export-pdf");
  let mdBtn = document.getElementById("export-md");
  if (pdfBtn) pdfBtn.addEventListener("click", exportAsPDF);
  if (mdBtn) {
    mdBtn.addEventListener("click", function onMdExport() {
      if (currentReportData) exportAsMarkdown(currentReportData);
    });
  }
  bindOnePagerButton();

  // A #county= deep link (e.g. from the Targets view) must be applied BEFORE we
  // load any data — loadAllData() otherwise defaults to Collin.
  const preHash = parseHash();
  if (preHash.county && preHash.county !== getActiveCounty()) {
    try {
      await setActiveCounty(preHash.county);
      applyCountyBranding();
    } catch (_) { /* unknown slug — fall back to the default county */ }
  }

  // Load data
  await loadBaseData();

  // Check URL hash for deep link
  let hash = parseHash();
  if (hash.precinct) {
    if (hash.boundary && hash.boundary !== getActiveBoundary()) {
      boundaryBtns.forEach((b) => {
        b.classList.toggle("active", b.dataset.boundary === hash.boundary);
      });
      await handleBoundarySwitch(hash.boundary);
    }
    await selectPrecinct(hash.precinct);
    if (searchInput) searchInput.value = hash.precinct;
  }
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadBaseData() {
  let result = await loadAllData();
  geojsonData = result.geojson;
  dncLookup = result.dncLookup;
  racialLookup = result.racialLookup;

  try {
    censusProfiles = await loadCensusProfiles();
  } catch {
    censusProfiles = null;
  }

  try {
    let boundary = getActiveBoundary();
    let config = getBoundaryConfigs()[boundary];
    let resp = await fetch(`${config.profileDir}/strategic_intelligence.json`);
    if (resp.ok) strategicIntel = await resp.json();
  } catch {
    strategicIntel = null;
  }

  // Build precinct list from GeoJSON features
  precinctList = geojsonData.features.map(function extractPrecinct(f) {
    let code = String(f.properties.PRECINCT);
    let party = f.properties.winningParty || "";
    return { code, feature: f, party };
  });
  precinctList.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  // Compute county averages and rankings
  computeCountyAverages();
}

async function handleBoundarySwitch(boundaryId) {
  isSwitching = true;

  let searchInput = document.getElementById("precinct-search");
  if (searchInput) {
    searchInput.disabled = true;
    searchInput.placeholder = "Loading boundary data...";
  }

  try {
    setActiveBoundary(boundaryId);
    clearElectionDataCache();
    await loadBaseData();

    if (currentPrecinctCode) {
      let exists = precinctList.find((p) => p.code === currentPrecinctCode);
      if (exists) {
        await selectPrecinct(currentPrecinctCode);
      } else {
        resetReport();
        let configs = getBoundaryConfigs();
        let label = configs[boundaryId].label;
        showNotice(`Precinct ${currentPrecinctCode} does not exist in ${label}. Please search for a different precinct.`);
        currentPrecinctCode = null;
        window.location.hash = "";
        if (searchInput) searchInput.value = "";
      }
    }
  } catch (err) {
    console.error("Boundary switch failed:", err);
    showError("Failed to load boundary data. Please try again.");
  } finally {
    isSwitching = false;
    if (searchInput) {
      searchInput.disabled = false;
      searchInput.placeholder = "Enter precinct number (e.g. 100)";
    }
  }
}

// ---------------------------------------------------------------------------
// County averages & rankings
// ---------------------------------------------------------------------------

function computeCountyAverages() {
  if (!censusProfiles) {
    countyAverages = null;
    precinctRankings = null;
    return;
  }

  let codes = Object.keys(censusProfiles);
  let total = codes.length;
  if (total === 0) {
    countyAverages = null;
    precinctRankings = null;
    return;
  }

  let incomes = [], homeValues = [], ages = [], collegePcts = [], populations = [];
  let homeownerPcts = [], povertyRates = [];

  for (let code of codes) {
    let p = censusProfiles[code];
    if (p.income?.medianHousehold != null) incomes.push({ code, value: p.income.medianHousehold });
    if (p.housing?.medianHomeValue != null) homeValues.push({ code, value: p.housing.medianHomeValue });
    if (p.age?.medianAge != null) ages.push({ code, value: p.age.medianAge });
    let bach = p.education?.bachelors || 0;
    let grad = p.education?.graduateProfessional || 0;
    collegePcts.push({ code, value: bach + grad });
    if (p.population != null) populations.push({ code, value: p.population });
    if (p.housing?.ownerOccupied != null) homeownerPcts.push({ code, value: p.housing.ownerOccupied });
    if (p.income?.povertyRate != null) povertyRates.push({ code, value: p.income.povertyRate });
  }

  function median(arr) {
    if (arr.length === 0) return null;
    let sorted = arr.map((a) => a.value).sort((a, b) => a - b);
    let mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function avg(arr) {
    if (arr.length === 0) return null;
    return arr.reduce((s, a) => s + a.value, 0) / arr.length;
  }

  countyAverages = {
    income: median(incomes),
    homeValue: median(homeValues),
    age: median(ages),
    college: avg(collegePcts),
    population: avg(populations),
    homeowner: avg(homeownerPcts),
    poverty: avg(povertyRates),
  };

  function buildRanking(arr) {
    let sorted = [...arr].sort((a, b) => b.value - a.value);
    let lookup = {};
    sorted.forEach((item, i) => {
      lookup[item.code] = { rank: i + 1, total: sorted.length };
    });
    return lookup;
  }

  precinctRankings = {
    income: buildRanking(incomes),
    homeValue: buildRanking(homeValues),
    college: buildRanking(collegePcts),
    population: buildRanking(populations),
    age: buildRanking(ages),
  };
}

// ---------------------------------------------------------------------------
// Search / autocomplete
// ---------------------------------------------------------------------------

// A query with letters (or longer than any precinct code) is an address
function looksLikeAddress(query) {
  return /[a-zA-Z]/.test(query) || query.trim().length > 4;
}

function handleSearchInput(query, dropdown) {
  if (!query) {
    dropdown.classList.remove("open");
    dropdown.innerHTML = "";
    return;
  }

  let matches = precinctList.filter(function matchPrecinct(p) {
    return p.code.startsWith(query);
  }).slice(0, 20);

  if (matches.length === 0) {
    if (looksLikeAddress(query)) {
      dropdown.innerHTML = `<div class="dropdown-item address-action selected" data-action="address">
        📍 Find the precinct for “${escapeHtml(query)}”
      </div>`;
      dropdown.classList.add("open");
      dropdown.querySelector('[data-action="address"]').addEventListener("click", function onAddr() {
        searchByAddress(query, dropdown);
      });
      return;
    }
    dropdown.classList.remove("open");
    dropdown.innerHTML = "";
    return;
  }

  dropdown.innerHTML = matches
    .map(function renderMatch(p, i) {
      let partyBadge = p.party
        ? `<span class="dropdown-party ${p.party.toLowerCase()}">${escapeHtml(p.party)}</span>`
        : "";
      return `<div class="dropdown-item${i === 0 ? " selected" : ""}" data-code="${escapeHtml(p.code)}">
        <span class="dropdown-code">Precinct ${escapeHtml(p.code)}</span>${partyBadge}
      </div>`;
    })
    .join("");

  dropdown.classList.add("open");

  dropdown.querySelectorAll(".dropdown-item").forEach(function attachClick(item) {
    item.addEventListener("click", function onSelect() {
      let code = item.dataset.code;
      document.getElementById("precinct-search").value = code;
      dropdown.classList.remove("open");
      selectPrecinct(code);
    });
  });
}

function handleSearchKeydown(e, dropdown) {
  let items = dropdown.querySelectorAll(".dropdown-item");
  if (items.length === 0) return;

  let selected = dropdown.querySelector(".dropdown-item.selected");
  let idx = Array.from(items).indexOf(selected);

  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (selected) selected.classList.remove("selected");
    idx = Math.min(idx + 1, items.length - 1);
    items[idx].classList.add("selected");
    items[idx].scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (selected) selected.classList.remove("selected");
    idx = Math.max(idx - 1, 0);
    items[idx].classList.add("selected");
    items[idx].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (selected) {
      if (selected.dataset.action === "address") {
        searchByAddress(document.getElementById("precinct-search").value.trim(), dropdown);
        return;
      }
      let code = selected.dataset.code;
      document.getElementById("precinct-search").value = code;
      dropdown.classList.remove("open");
      selectPrecinct(code);
    }
  } else if (e.key === "Escape") {
    dropdown.classList.remove("open");
  }
}

// ---------------------------------------------------------------------------
// Address & geolocation search
// ---------------------------------------------------------------------------

async function searchByAddress(query, dropdown) {
  dropdown.innerHTML = '<div class="dropdown-item address-action">Searching for that address…</div>';
  dropdown.classList.add("open");

  let result;
  try {
    let features = precinctList.map((p) => p.feature);
    result = await findPrecinctForAddress(query, features);
  } catch {
    dropdown.classList.remove("open");
    showNotice("The address search service is unavailable right now. Please try again in a moment.");
    return;
  }

  dropdown.classList.remove("open");
  dropdown.innerHTML = "";

  if (!result) {
    showNotice(`Couldn't find “${query}”. Try adding the city, e.g. “123 Main St, McKinney”.`);
    return;
  }
  if (!result.code) {
    showNotice("That address appears to be outside Collin County's precincts.");
    return;
  }

  document.getElementById("precinct-search").value = result.code;
  await selectPrecinct(result.code);
}

function bindLocationButton() {
  let btn = document.getElementById("use-location-btn");
  if (!btn) return;
  btn.addEventListener("click", function onLocate() {
    if (!navigator.geolocation) {
      showNotice("Your browser doesn't support location lookup. Type your address instead.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "📍 Finding your precinct…";
    let restore = () => {
      btn.disabled = false;
      btn.textContent = "📍 Use my location";
    };
    navigator.geolocation.getCurrentPosition(
      function onPosition(pos) {
        restore();
        let features = precinctList.map((p) => p.feature);
        let feature = findPrecinctForPoint(pos.coords.latitude, pos.coords.longitude, features);
        if (!feature) {
          showNotice("Your current location appears to be outside Collin County's precincts.");
          return;
        }
        let code = String(feature.properties.PRECINCT);
        document.getElementById("precinct-search").value = code;
        selectPrecinct(code);
      },
      function onError() {
        restore();
        showNotice("Couldn't get your location. You can type your street address in the search box instead.");
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  });
}

// ---------------------------------------------------------------------------
// Select precinct & render report
// ---------------------------------------------------------------------------

async function selectPrecinct(code) {
  let entry = precinctList.find((p) => p.code === String(code));
  if (!entry) {
    let configs = getBoundaryConfigs();
    let label = configs[getActiveBoundary()].label;
    resetReport();
    showNotice(`Precinct ${code} not found in ${label}. Please search for a different precinct.`);
    return;
  }

  // Destroy any existing charts before re-rendering
  destroyAllCharts();

  currentPrecinctCode = String(code);
  let feature = entry.feature;
  let props = feature.properties;

  let partyData = dncLookup[String(code)] || null;
  let racialData = racialLookup[String(code)] || null;
  let officials = extractOfficials(props);
  let census = censusProfiles ? censusProfiles[String(code)] : null;

  // Show report, hide intro, show section nav
  document.getElementById("intro-message")?.classList.add("hidden");
  let reportEl = document.getElementById("report-container");
  reportEl.classList.remove("hidden");
  showSectionNav();

  ensureReportStructure(reportEl);

  // Show loading state for election history
  let historyEl = document.getElementById("section-election-history");
  historyEl.innerHTML = '<div class="loading-spinner">Loading election history...</div>';

  // Render immediate sections
  renderHeroSection(code, census, partyData, racialData, props._meta || null);
  bindCompareButton(code);
  renderMiniMap(feature, partyData);
  renderPartySection(partyData);
  renderRacialSection(racialData);
  renderOfficialsSection(officials);
  renderCensusSection(census, code, props._meta || null);

  // Update URL hash
  let boundary = getActiveBoundary();
  window.location.hash = `precinct=${code}&boundary=${boundary}`;

  // Setup section nav observer
  setupSectionNav();

  // Bind collapsible census toggles
  bindCollapsibleToggles();

  // Load election history async
  let votingHistory;
  let allElectionData;
  try {
    allElectionData = await loadAllElectionDataForHistory();
    votingHistory = await getPrecinctVotingHistory(code);
  } catch {
    votingHistory = { races: [], byCategory: {}, partyRecord: { Rep: 0, Dem: 0, Other: 0 } };
    allElectionData = {};
  }
  renderElectionHistory(votingHistory, code, allElectionData);

  // Compute PVI, strategy, margin trend, turnout gap, talking points, similar precincts async
  let manifest = [];
  try { manifest = await listElectionCSVs(); } catch { /* optional */ }

  // True registered-voter count comes from election results, not the DNC file
  updateHeroRegisteredVoters(votingHistory, manifest);

  let pviResult = computePVI(code, allElectionData, manifest);
  renderPVIBadge(pviResult);
  pviCache[code] = pviResult;

  let strategyResult = classifyStrategy(code, partyData, votingHistory, pviResult);
  renderStrategyBadge(strategyResult);
  renderStrategyDetail(strategyResult);

  renderMarginTrend(code, allElectionData, manifest);
  renderTurnoutGap(code, votingHistory, partyData, allElectionData, manifest);
  renderTalkingPoints(code, census, partyData, racialData, votingHistory, pviResult, strategyResult);
  renderStrategicIntelligence(code);
  renderSimilarPrecincts(code, census, partyData, racialData, allElectionData, manifest);

  // Compute and inject trend arrow
  computePrecinctTrend(code).then(function onTrend(trendData) {
    let arrow = renderTrendArrow(trendData);
    if (arrow) {
      let heroEl = document.getElementById("hero-section");
      if (heroEl) {
        let trendEl = heroEl.querySelector('.trend-arrow-container');
        if (trendEl) {
          trendEl.innerHTML = arrow;
        }
      }
    }
  }).catch(function onErr() { /* trend is optional */ });

  // Store for export
  let configs = getBoundaryConfigs();
  currentReportData = {
    code,
    boundaryLabel: configs[boundary].label,
    partyData,
    racialData,
    officials,
    census,
    votingHistory,
    countyAverages,
    rankings: precinctRankings,
    pvi: pviResult,
    strategy: strategyResult,
    strategicIntel: strategicIntel?.[String(code)] || null,
  };

  document.getElementById("export-bar")?.classList.remove("hidden");
}

function extractOfficials(props) {
  let keys = ["CONG", "CONG_N", "SEN", "SEN_N", "SHR", "SHR_N", "SED", "SED_N", "COMMISH", "COMMISH_N", "JP_N", "CONST_N"];
  let officials = {};
  for (let k of keys) {
    if (props[k] != null) officials[k] = props[k];
  }
  return Object.keys(officials).length > 0 ? officials : null;
}

// ---------------------------------------------------------------------------
// Chart lifecycle
// ---------------------------------------------------------------------------

function destroyAllCharts() {
  for (let key in chartInstances) {
    if (chartInstances[key]) {
      chartInstances[key].destroy();
    }
  }
  chartInstances = {};
}

// ---------------------------------------------------------------------------
// Hero dashboard section
// ---------------------------------------------------------------------------

function renderHeroSection(code, census, partyData, racialData, meta) {
  let el = document.getElementById("hero-section");
  let configs = getBoundaryConfigs();
  let boundaryLabel = configs[getActiveBoundary()].label;

  // Row 1: precinct code + badges
  let badges = '';
  badges += `<span class="boundary-label">${escapeHtml(boundaryLabel)}</span>`;
  if (partyData?.winningParty) {
    let cls = partyData.winningParty.toLowerCase();
    let strength = partyData.partyStrength != null ? ` (${partyData.partyStrength}/3)` : "";
    badges += `<span class="party-lean-badge ${cls}">${escapeHtml(partyData.winningParty)}${escapeHtml(strength)}</span>`;
  }

  let html = '<div class="hero-section">';
  html += '<div class="hero-row-top">';
  html += `<span class="hero-precinct-code">Precinct ${escapeHtml(code)}</span>`;
  html += `<div class="hero-badges">${badges}<span class="pvi-badge-container"></span><span class="strategy-badge-container"></span><span class="trend-arrow-container"></span><button class="compare-btn" id="compare-btn">Compare</button></div>`;
  html += '</div>';

  // Row 2: stat cards
  let stats = [];

  if (census?.population != null) {
    stats.push(heroStatCard(formatNum(census.population), "Population", census.population, "population", countyAverages?.population, true, code));
  }

  if (partyData) {
    let total = (partyData.rep || 0) + (partyData.mod || 0) + (partyData.dem || 0);
    // DNC-scored voter universe — NOT the county's registered-voter count
    // (the real count is injected later from election results; see
    // updateHeroRegisteredVoters)
    stats.push(heroStatCard(formatNum(total), "Scored Voters", null, null, null, false, code));
  }

  if (census?.income?.medianHousehold != null) {
    stats.push(heroStatCard(formatCurrency(census.income.medianHousehold), "Median Income", census.income.medianHousehold, "income", countyAverages?.income, true, code));
  }

  if (census?.housing?.medianHomeValue != null) {
    stats.push(heroStatCard(formatCurrency(census.housing.medianHomeValue), "Home Value", census.housing.medianHomeValue, "homeValue", countyAverages?.homeValue, true, code));
  }

  if (census?.age?.medianAge != null) {
    stats.push(heroStatCard(String(census.age.medianAge), "Median Age", census.age.medianAge, "age", countyAverages?.age, false, code));
  }

  if (census?.education) {
    let collegePct = (census.education.bachelors || 0) + (census.education.graduateProfessional || 0);
    stats.push(heroStatCard(formatPct(collegePct), "College %", collegePct, "college", countyAverages?.college, true, code));
  }

  // Fallback if no census data
  if (stats.length === 0 && partyData) {
    let total = (partyData.rep || 0) + (partyData.mod || 0) + (partyData.dem || 0);
    stats.push(heroStatCard(formatNum(total), "Scored Voters", null, null, null, false, code));
    if (partyData.winningParty) {
      stats.push(heroStatCard(partyData.winningParty, "Party Lean", null, null, null, false, code));
    }
  }

  html += '<div class="hero-stats-grid">';
  html += stats.join('');
  html += '</div>';

  // Flag brand-new or low-confidence precincts so sparse stats aren't
  // mistaken for real zeros (2026 redistricting created several)
  let scoredTotal = partyData ? (partyData.rep || 0) + (partyData.mod || 0) + (partyData.dem || 0) : null;
  let isNewOrLowConfidence = meta &&
    (meta.dataQuality === 'low_confidence' || meta.interpolationType === 'new_boundary' || meta.interpolationType === 'sliver');
  if (isNewOrLowConfidence) {
    html += '<div class="new-precinct-notice">⚠️ This precinct was newly created in the 2026 redistricting and has little or no voting history yet. Numbers below are estimates or may be blank.</div>';
  } else if (scoredTotal != null && scoredTotal < 10) {
    html += '<div class="new-precinct-notice">⚠️ Very few scored voters in this precinct — percentage figures below may be misleading.</div>';
  }

  html += '</div>';

  el.innerHTML = html;
}

// Inject the county's actual registered-voter count into the hero grid once
// election history is available. Sourced from the most recent race that
// reports REGISTERED VOTERS TOTAL for this precinct (county-wide races carry
// the full count; the DNC "Scored Voters" card is a modeled subset).
function updateHeroRegisteredVoters(votingHistory, manifest) {
  let races = votingHistory?.races || [];
  if (races.length === 0) return;

  let manifestByFile = {};
  for (let entry of manifest || []) {
    let fn = typeof entry === 'string' ? entry : entry.filename;
    manifestByFile[fn] = entry;
  }

  let best = null;
  for (let race of races) {
    if (!(race.registeredVoters > 0)) continue;
    let year = manifestByFile[race.filename]?.year || extractYear(race.raceName) || 0;
    if (!best || year > best.year ||
        (year === best.year && race.registeredVoters > best.count)) {
      best = { year, count: race.registeredVoters };
    }
  }
  if (!best) return;

  let grid = document.querySelector('#hero-section .hero-stats-grid');
  if (!grid || grid.querySelector('[data-stat="registered-voters"]')) return;

  let card = document.createElement('div');
  card.className = 'hero-stat-card';
  card.setAttribute('data-stat', 'registered-voters');
  let label = best.year ? `Registered Voters (${best.year})` : 'Registered Voters';
  card.innerHTML =
    `<div class="hero-stat-value">${escapeHtml(formatNum(best.count))}</div>` +
    `<div class="hero-stat-label">${escapeHtml(label)}</div>`;

  // Place right after Population (first card) so the two official counts lead
  let first = grid.firstElementChild;
  if (first && first.nextSibling) {
    grid.insertBefore(card, first.nextSibling);
  } else {
    grid.appendChild(card);
  }
}

function heroStatCard(displayValue, label, rawValue, rankMetric, countyValue, higherIsBetter, code) {
  let html = '<div class="hero-stat-card">';
  html += `<div class="hero-stat-value">${escapeHtml(displayValue)}</div>`;
  html += `<div class="hero-stat-label">${escapeHtml(label)}</div>`;

  if (rawValue != null && countyValue != null) {
    html += comparisonBadge(rawValue, countyValue, higherIsBetter);
  }

  if (rankMetric && code && precinctRankings?.[rankMetric]) {
    let r = precinctRankings[rankMetric][String(code)];
    if (r) {
      html += `<div class="hero-stat-rank">#${r.rank} of ${r.total}</div>`;
    }
  }

  html += '</div>';
  return html;
}

function comparisonBadge(value, countyValue, higherIsBetter) {
  if (countyValue == null || countyValue === 0) return '';
  let pctDiff = ((value - countyValue) / Math.abs(countyValue)) * 100;
  let absPct = Math.abs(pctDiff).toFixed(0);

  if (Math.abs(pctDiff) < 5) {
    return '<div class="hero-stat-comparison near">near avg</div>';
  }

  let isGood = higherIsBetter ? pctDiff > 0 : pctDiff < 0;
  let cls = isGood ? 'above' : 'below';
  let sign = pctDiff > 0 ? '+' : '';
  return `<div class="hero-stat-comparison ${cls}">${sign}${absPct}% vs county</div>`;
}

// ---------------------------------------------------------------------------
// Section navigation
// ---------------------------------------------------------------------------

function showSectionNav() {
  let nav = document.getElementById("section-nav");
  if (nav) nav.classList.remove("hidden");
}

function hideSectionNav() {
  let nav = document.getElementById("section-nav");
  if (nav) nav.classList.add("hidden");
}

function setupSectionNav() {
  // Clean up previous observer
  if (sectionObserver) {
    sectionObserver.disconnect();
    sectionObserver = null;
  }

  let nav = document.getElementById("section-nav");
  if (!nav) return;

  let pills = nav.querySelectorAll(".section-nav-pill");

  // Click handlers
  pills.forEach(function attachNavClick(pill) {
    pill.onclick = function onNavClick(e) {
      e.preventDefault();
      let targetId = pill.dataset.target;
      let targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
  });

  // IntersectionObserver to track active section
  let sections = document.querySelectorAll("[data-section]");
  if (sections.length === 0) return;

  sectionObserver = new IntersectionObserver(
    function onIntersect(entries) {
      for (let entry of entries) {
        if (entry.isIntersecting) {
          let sectionId = entry.target.dataset.section;
          pills.forEach(function updatePill(p) {
            p.classList.toggle("active", p.dataset.target === sectionId);
          });
        }
      }
    },
    { rootMargin: "-100px 0px -60% 0px", threshold: 0.1 }
  );

  sections.forEach(function observeSection(sec) {
    sectionObserver.observe(sec);
  });
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderPartySection(partyData) {
  let el = document.getElementById("section-party");
  el.innerHTML = renderPartyRegistration(partyData);
}

function renderRacialSection(racialData) {
  let el = document.getElementById("section-racial");
  el.innerHTML = renderRacialDemographics(racialData);
}

function renderOfficialsSection(officials) {
  let el = document.getElementById("section-officials");
  el.innerHTML = renderOfficials(officials);
}

function renderCensusSection(census, code, boundaryMeta) {
  let el = document.getElementById("section-census");
  if (!census) {
    el.innerHTML = `<div class="census-unavailable">No census profile is available for precinct ${escapeHtml(code)}. Party, racial, officials, and election data are still shown above.</div>`;
    return;
  }
  let extraData = {};
  if (boundaryMeta) {
    extraData.boundaryMeta = boundaryMeta;
  }
  el.innerHTML = generateProfileHTML(census, code, extraData);
}

// ---------------------------------------------------------------------------
// Collapsible census toggle bindings
// ---------------------------------------------------------------------------

function bindCollapsibleToggles() {
  let toggles = document.querySelectorAll(".census-toggle-btn");
  toggles.forEach(function attachToggle(btn) {
    btn.addEventListener("click", function onToggle() {
      let expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      let body = btn.nextElementSibling;
      if (body && body.classList.contains("census-collapsible")) {
        body.classList.toggle("collapsed", expanded);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Election history with tabs
// ---------------------------------------------------------------------------

// Tab category mapping
let TAB_CATEGORIES = {
  All: null,
  Federal: ["Federal"],
  State: ["State"],
  County: ["County"],
  Local: ["City", "ISD", "MUD", "Propositions", "Other"],
};

// Old renderElectionHistory/renderElectionTable replaced by renderElectionHistory with drilldown below

// ---------------------------------------------------------------------------
// Win streak computation
// ---------------------------------------------------------------------------

function computeWinStreak(votingHistory) {
  let federal = votingHistory.byCategory?.Federal;
  if (!federal || federal.length === 0) return null;

  // Sort by year descending (raceName contains year info)
  let sorted = [...federal].sort((a, b) => {
    let yearA = extractYear(a.raceName);
    let yearB = extractYear(b.raceName);
    return yearB - yearA;
  });

  let streakParty = sorted[0]?.winningParty;
  if (!streakParty || streakParty === "Other") return null;

  let count = 0;
  for (let race of sorted) {
    if (race.winningParty === streakParty) {
      count++;
    } else {
      break;
    }
  }

  if (count < 2) return null;
  return `Voted ${streakParty} in last ${count} Federal races`;
}

function extractYear(raceName) {
  let match = raceName.match(/\b(20\d{2})\b/);
  return match ? parseInt(match[1], 10) : 0;
}

// ---------------------------------------------------------------------------
// Chart.js rendering
// ---------------------------------------------------------------------------

function getChartColors() {
  let style = getComputedStyle(document.documentElement);
  return {
    text: style.getPropertyValue('--text-secondary').trim() || '#717171',
    grid: style.getPropertyValue('--border').trim() || '#DDDDDD',
  };
}

function renderPartyChart(partyData) {
  if (!partyData) return;
  let canvas = document.getElementById('precinct-party-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (chartInstances.party) chartInstances.party.destroy();

  chartInstances.party = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Republican', 'Moderate', 'Democrat'],
      datasets: [{
        data: [partyData.rep || 0, partyData.mod || 0, partyData.dem || 0],
        backgroundColor: ['#E81B23', '#800080', '#00AEF3'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
      },
      cutout: '60%',
    },
  });
}

function renderRacialChart(racialData) {
  if (!racialData) return;
  let canvas = document.getElementById('precinct-racial-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (chartInstances.racial) chartInstances.racial.destroy();

  chartInstances.racial = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['White', 'Asian', 'Hispanic', 'Black', 'Others'],
      datasets: [{
        data: [
          racialData.pct_white || 0,
          racialData.pct_asian || 0,
          racialData.pct_hispanic || 0,
          racialData.pct_black || 0,
          racialData.pct_others || 0,
        ],
        backgroundColor: ['#9467bd', '#1f77b4', '#2ca02c', '#ff7f0e', '#d62728'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
      },
      cutout: '60%',
    },
  });
}

function renderIncomeChart(census) {
  if (!census?.income?.brackets) return;
  let canvas = document.getElementById('precinct-income-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (chartInstances.income) chartInstances.income.destroy();

  let colors = getChartColors();
  let brackets = census.income.brackets;

  chartInstances.income = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['<$50K', '$50-100K', '$100-150K', '$150-200K', '$200K+'],
      datasets: [{
        data: [
          ((brackets.under50k || 0) * 100),
          ((brackets['50kTo100k'] || 0) * 100),
          ((brackets['100kTo150k'] || 0) * 100),
          ((brackets['150kTo200k'] || 0) * 100),
          ((brackets.over200k || 0) * 100),
        ],
        backgroundColor: ['#66BB6A', '#4CAF50', '#43A047', '#388E3C', '#2E7D32'],
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
      },
      scales: {
        y: {
          ticks: { color: colors.text, callback: function(v) { return v + '%'; } },
          grid: { color: colors.grid },
        },
        x: {
          ticks: { color: colors.text },
          grid: { display: false },
        },
      },
    },
  });
}

function renderEducationChart(census) {
  if (!census?.education) return;
  let canvas = document.getElementById('precinct-education-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (chartInstances.education) chartInstances.education.destroy();

  let colors = getChartColors();
  let edu = census.education;

  chartInstances.education = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['HS or Less', 'Some College', "Bachelor's", 'Graduate+'],
      datasets: [{
        data: [
          ((edu.highSchoolOrLess || 0) * 100),
          ((edu.someCollege || 0) * 100),
          ((edu.bachelors || 0) * 100),
          ((edu.graduateProfessional || 0) * 100),
        ],
        backgroundColor: ['#64B5F6', '#42A5F5', '#2196F3', '#1565C0'],
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
      },
      scales: {
        x: {
          ticks: { color: colors.text, callback: function(v) { return v + '%'; } },
          grid: { color: colors.grid },
        },
        y: {
          ticks: { color: colors.text },
          grid: { display: false },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Mini map (enhanced — all precincts as context, interactive)
// ---------------------------------------------------------------------------

function renderMiniMap(feature, partyData) {
  let container = document.getElementById("mini-map");
  if (!container) return;

  let fillColor = "#888";
  if (partyData?.winningParty) {
    let p = partyData.winningParty.toLowerCase();
    if (p === "republican" || p === "rep") fillColor = "#E81B23";
    else if (p === "democrat" || p === "dem") fillColor = "#00AEF3";
    else if (p === "moderate" || p === "mod") fillColor = "#800080";
  }

  if (!miniMap) {
    miniMap = L.map(container, {
      zoomControl: true,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      touchZoom: true,
    });
    let url = getCurrentTheme() === "dark" ? DARK_TILE_URL : LIGHT_TILE_URL;
    tileLayer = L.tileLayer(url, { maxZoom: 18 }).addTo(miniMap);
  }

  // Remove previous layers
  if (miniMapLayer) {
    miniMap.removeLayer(miniMapLayer);
    miniMapLayer = null;
  }
  if (contextLayer) {
    miniMap.removeLayer(contextLayer);
    contextLayer = null;
  }

  // Add ALL precincts as light gray context
  let selectedCode = String(feature.properties.PRECINCT);
  contextLayer = L.geoJSON(geojsonData, {
    style: function contextStyle(f) {
      let code = String(f.properties.PRECINCT);
      if (code === selectedCode) {
        return { fillOpacity: 0, weight: 0, opacity: 0 }; // hide selected from context layer
      }
      return {
        fillColor: '#ccc',
        fillOpacity: 0.15,
        color: '#999',
        weight: 0.5,
      };
    },
    onEachFeature: function onContext(feat, layer) {
      let code = String(feat.properties.PRECINCT);
      if (code === selectedCode) return;
      layer.bindTooltip('Precinct ' + code, { sticky: true });
      layer.on('click', function onContextClick() {
        let searchInput = document.getElementById('precinct-search');
        if (searchInput) searchInput.value = code;
        selectPrecinct(code);
      });
    },
  }).addTo(miniMap);

  // Add selected precinct on top
  miniMapLayer = L.geoJSON(feature, {
    style: {
      fillColor,
      fillOpacity: 0.5,
      color: fillColor,
      weight: 3,
    },
  }).addTo(miniMap);

  miniMap.fitBounds(miniMapLayer.getBounds(), { padding: [40, 40] });
}

function updateMiniMapTiles() {
  if (!miniMap || !tileLayer) return;
  let url = getCurrentTheme() === "dark" ? DARK_TILE_URL : LIGHT_TILE_URL;
  tileLayer.setUrl(url);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateThemeIcon(btn) {
  btn.textContent = getCurrentTheme() === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19";
}

function parseHash() {
  let hash = window.location.hash.slice(1);
  let params = {};
  for (let part of hash.split("&")) {
    let [k, v] = part.split("=");
    if (k && v) params[k] = decodeURIComponent(v);
  }
  return params;
}

function getReportStructureHTML() {
  return `
    <div id="hero-section" data-section="hero-section"></div>
    <div id="strategy-section"></div>
    <div id="comparison-section"></div>
    <div id="export-bar" class="export-bar hidden">
      <button id="export-pdf" class="export-btn">Export PDF</button>
      <button id="export-md" class="export-btn">Export Markdown</button>
      <button id="export-one-pager" class="export-btn">Field One-Pager</button>
    </div>
    <div id="mini-map" class="mini-map-container"></div>
    <div id="section-party" class="report-section" data-section="section-party" data-accent="party"></div>
    <div id="section-racial" class="report-section" data-section="section-racial" data-accent="demographics"></div>
    <div id="section-officials" class="report-section" data-section="section-officials" data-accent="districts"></div>
    <div id="section-census" class="report-section" data-section="section-census" data-accent="census"></div>
    <div id="section-elections" class="report-section" data-section="section-elections" data-accent="elections">
      <div class="report-section-title">Election History</div>
      <div id="section-election-history"></div>
    </div>
    <div id="section-talking-points" class="report-section" data-section="section-talking-points" data-accent="census"></div>
    <div id="section-similar" class="report-section" data-section="section-similar" data-accent="demographics"></div>
  `;
}

function resetReport() {
  destroyAllCharts();
  currentReportData = null;
  compareMode = false;
  comparePrecinct = null;
  document.getElementById("intro-message")?.classList.remove("hidden");
  document.getElementById("export-bar")?.classList.add("hidden");
  hideSectionNav();

  if (sectionObserver) {
    sectionObserver.disconnect();
    sectionObserver = null;
  }

  let reportEl = document.getElementById("report-container");
  reportEl.classList.add("hidden");
  reportEl.innerHTML = getReportStructureHTML();

  if (miniMap) {
    miniMap.remove();
    miniMap = null;
    miniMapLayer = null;
    contextLayer = null;
    tileLayer = null;
  }

  // Re-bind export buttons
  let pdfBtn = document.getElementById("export-pdf");
  let mdBtn = document.getElementById("export-md");
  if (pdfBtn) pdfBtn.addEventListener("click", exportAsPDF);
  if (mdBtn) {
    mdBtn.addEventListener("click", function onMdExport() {
      if (currentReportData) exportAsMarkdown(currentReportData);
    });
  }
  bindOnePagerButton();
}

function ensureReportStructure(reportEl) {
  if (!document.getElementById("hero-section")) {
    reportEl.innerHTML = getReportStructureHTML();

    if (miniMap) {
      miniMap.remove();
      miniMap = null;
      miniMapLayer = null;
      contextLayer = null;
      tileLayer = null;
    }

    let pdfBtn = document.getElementById("export-pdf");
    let mdBtn = document.getElementById("export-md");
    if (pdfBtn) pdfBtn.addEventListener("click", exportAsPDF);
    if (mdBtn) {
      mdBtn.addEventListener("click", function onMdExport() {
        if (currentReportData) exportAsMarkdown(currentReportData);
      });
    }
    bindOnePagerButton();
  }
}

function showError(msg) {
  document.getElementById("intro-message")?.classList.add("hidden");
  let el = document.getElementById("report-container");
  el.classList.remove("hidden");
  el.innerHTML = `<div class="error-message">${escapeHtml(msg)}</div>`;
}

function showNotice(msg) {
  document.getElementById("intro-message")?.classList.add("hidden");
  let el = document.getElementById("report-container");
  el.classList.remove("hidden");
  el.innerHTML = `<div class="census-unavailable">${escapeHtml(msg)}</div>`;
}

// ---------------------------------------------------------------------------
// Field One-Pager
// ---------------------------------------------------------------------------

function bindOnePagerButton() {
  let btn = document.getElementById("export-one-pager");
  if (btn) {
    btn.addEventListener("click", handleOnePagerClick);
  }
}

async function handleOnePagerClick() {
  if (!currentPrecinctCode) return;

  let btn = document.getElementById("export-one-pager");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Loading...";
  }

  try {
    let data = await loadOnePagerData(currentPrecinctCode);
    let html = generateFieldOnePagerHTML(
      currentPrecinctCode,
      data.census,
      data.party,
      data.racial,
      data.officials,
      data.recentElections,
      data.trend
    );
    let text = generateFieldOnePagerText(
      currentPrecinctCode,
      data.census,
      data.party,
      data.racial,
      data.officials,
      data.recentElections,
      data.trend
    );

    let container = document.getElementById("one-pager-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "one-pager-container";
      let reportEl = document.getElementById("report-container");
      reportEl.appendChild(container);
    }
    container.innerHTML = html;
    container.scrollIntoView({ behavior: "smooth", block: "start" });

    let printBtn = document.getElementById("one-pager-print-btn");
    if (printBtn) {
      printBtn.addEventListener("click", function onPrint() {
        printOnePager(html, currentPrecinctCode);
      });
    }

    let copyBtn = document.getElementById("one-pager-copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async function onCopy() {
        let ok = await copyOnePagerToClipboard(text);
        copyBtn.textContent = ok ? "Copied!" : "Failed";
        setTimeout(function resetLabel() {
          copyBtn.textContent = "Copy to Clipboard";
        }, 2000);
      });
    }
  } catch (err) {
    console.error("One-pager generation failed:", err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Field One-Pager";
    }
  }
}

// ---------------------------------------------------------------------------
// Feature 1: PVI Competitiveness Score
// ---------------------------------------------------------------------------

function computePVI(precinctCode, allElectionData, manifest) {
  if (!allElectionData || !manifest) return { pvi: 0, label: 'N/A' };

  // Find the 2 most recent federal races (prefer President + Senator)
  let manifestByFile = {};
  for (let entry of manifest) {
    let fn = typeof entry === 'string' ? entry : entry.filename;
    manifestByFile[fn] = entry;
  }

  let federalRaces = [];
  for (let [filename, data] of Object.entries(allElectionData)) {
    let entry = manifestByFile[filename];
    if (!entry) continue;
    let cat = entry.category || categorizeRace(filename);
    if (cat !== 'Federal') continue;
    let year = entry.year || 0;
    // Only use President/Senator races for PVI
    let fn = filename.toLowerCase();
    let isPresOrSen = fn.includes('president') || fn.includes('senator');
    if (!isPresOrSen) continue;

    let precinctData = getPrecinctCandidateData(data, precinctCode);
    if (!precinctData) continue;

    let countyDemShare = computeCountyDemShare(data);
    federalRaces.push({
      year,
      filename,
      precinctDemShare: precinctData.demPct,
      countyDemShare,
    });
  }

  if (federalRaces.length === 0) return { pvi: 0, label: 'N/A' };

  // Sort by year desc, take top 2
  federalRaces.sort((a, b) => b.year - a.year);
  let recent = federalRaces.slice(0, 2);

  // Average the delta (precinct Dem share - county Dem share)
  let totalDelta = 0;
  for (let r of recent) {
    totalDelta += (r.precinctDemShare - r.countyDemShare);
  }
  let avgDelta = totalDelta / recent.length;
  let pviPoints = avgDelta * 100;

  let label;
  if (Math.abs(pviPoints) < 0.5) {
    label = 'EVEN';
  } else if (pviPoints > 0) {
    label = 'D+' + Math.abs(pviPoints).toFixed(0);
  } else {
    label = 'R+' + Math.abs(pviPoints).toFixed(0);
  }

  return { pvi: pviPoints, label };
}

function renderPVIBadge(pviResult) {
  let container = document.querySelector('.pvi-badge-container');
  if (!container) return;
  if (!pviResult || pviResult.label === 'N/A') {
    container.innerHTML = '';
    return;
  }

  let cls = 'pvi-even';
  if (pviResult.pvi > 0.5) cls = 'pvi-dem';
  else if (pviResult.pvi < -0.5) cls = 'pvi-rep';

  container.innerHTML = `<span class="pvi-badge ${cls}">${escapeHtml(pviResult.label)}</span>`;
}

// ---------------------------------------------------------------------------
// Feature 4: Strategy Classification
// ---------------------------------------------------------------------------

function classifyStrategy(precinctCode, partyData, votingHistory, pviResult) {
  if (!partyData) return null;

  let demShare = partyData.demShare || 0;
  let repShare = partyData.repShare || 0;
  let modShare = partyData.modShare || 0;
  let partyStrength = partyData.partyStrength || 0;
  let pvi = pviResult?.pvi || 0;

  // Compute average turnout from federal races
  let avgTurnout = 0;
  let federalRaces = votingHistory?.byCategory?.Federal || [];
  if (federalRaces.length > 0) {
    let totalTurnout = 0;
    let counted = 0;
    for (let race of federalRaces) {
      let t = calculateTurnout(race.totalVotes, race.registeredVoters);
      if (t > 0) { totalTurnout += t; counted++; }
    }
    avgTurnout = counted > 0 ? totalTurnout / counted : 0;
  }

  // Decision tree
  let classification, action, rationale;

  if (demShare > 0.30 && avgTurnout < 55) {
    classification = 'mobilize';
    action = 'GOTV — get Democrats to the polls';
    rationale = `Dem registration is ${(demShare * 100).toFixed(0)}% but avg federal turnout is only ${avgTurnout.toFixed(0)}%. Higher turnout here directly helps.`;
  } else if (modShare > 0.32 && Math.abs(pvi) < 8) {
    classification = 'persuade';
    action = 'Persuasion — target Moderates and weak partisans';
    rationale = `Moderate registration is ${(modShare * 100).toFixed(0)}% and the precinct is competitive (${pviResult?.label || 'near even'}). Persuasion moves the needle here.`;
  } else if (pvi > 0 && pvi < 12) {
    classification = 'defend';
    action = 'Protect — maintain Dem advantage, prevent erosion';
    rationale = `This precinct leans Dem (${pviResult?.label}) but not by a huge margin. Don't take it for granted.`;
  } else if (pvi < -5 && demShare > 0.20) {
    classification = 'grow';
    action = 'Long-term — register new voters, build infrastructure';
    rationale = `Lean GOP (${pviResult?.label}) but Dem registration is ${(demShare * 100).toFixed(0)}%. Invest in future cycles.`;
  } else if (demShare > 0.30) {
    classification = 'defend';
    action = 'Protect — solid Dem base, keep turnout high';
    rationale = `Strong Dem registration and decent PVI. Maintain engagement.`;
  } else {
    classification = 'grow';
    action = 'Long-term growth — build local party infrastructure';
    rationale = `Low Dem share (${(demShare * 100).toFixed(0)}%). Focus on registration drives and community presence.`;
  }

  return { classification, action, rationale };
}

function renderStrategyBadge(strategy) {
  let container = document.querySelector('.strategy-badge-container');
  if (!container || !strategy) {
    if (container) container.innerHTML = '';
    return;
  }

  let labels = { mobilize: 'Mobilize', persuade: 'Persuade', defend: 'Defend', grow: 'Grow' };
  let label = labels[strategy.classification] || strategy.classification;
  container.innerHTML = `<span class="strategy-badge ${strategy.classification}">${escapeHtml(label)}</span>`;
}

function renderStrategyDetail(strategy) {
  let el = document.getElementById('strategy-section');
  if (!el || !strategy) {
    if (el) el.innerHTML = '';
    return;
  }

  let icons = { mobilize: '\u{1F4E3}', persuade: '\u{1F91D}', defend: '\u{1F6E1}', grow: '\u{1F331}' };
  let titles = { mobilize: 'Mobilize Base', persuade: 'Persuade Moderates', defend: 'Defend Gains', grow: 'Grow Long-Term' };

  el.innerHTML = `<div class="strategy-detail">
    <div class="strategy-detail-title"><span class="strategy-badge ${strategy.classification}">${escapeHtml(titles[strategy.classification] || strategy.classification)}</span></div>
    <div class="strategy-detail-action">${escapeHtml(strategy.action)}</div>
    <div class="strategy-detail-rationale">${escapeHtml(strategy.rationale)}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Feature 2: Margin Trend
// ---------------------------------------------------------------------------

function renderMarginTrend(precinctCode, allElectionData, manifest) {
  let el = document.getElementById('section-election-history');
  if (!el) return;

  let manifestByFile = {};
  for (let entry of manifest) {
    let fn = typeof entry === 'string' ? entry : entry.filename;
    manifestByFile[fn] = entry;
  }

  // Collect federal races with Dem/Rep margins
  let races = [];
  for (let [filename, data] of Object.entries(allElectionData)) {
    let entry = manifestByFile[filename];
    if (!entry) continue;
    let cat = entry.category || categorizeRace(filename);
    if (cat !== 'Federal') continue;

    let fn = filename.toLowerCase();
    let isPresOrSen = fn.includes('president') || fn.includes('senator') || fn.includes('representative');
    if (!isPresOrSen) continue;

    let cd = getPrecinctCandidateData(data, precinctCode);
    if (!cd) continue;

    let year = entry.year || 0;
    let margin = cd.margin; // positive = Dem
    let displayName = formatRaceName(filename);

    races.push({ year, margin, displayName, filename });
  }

  if (races.length < 2) return;

  races.sort((a, b) => a.year - b.year);

  // Compute max margin for scaling
  let maxMargin = Math.max(...races.map(r => Math.abs(r.margin)));
  if (maxMargin < 0.01) maxMargin = 0.01;

  // Compute shift
  let first = races[0];
  let last = races[races.length - 1];
  let shiftPts = (last.margin - first.margin) * 100;
  let shiftClass = shiftPts > 0.5 ? 'dem' : shiftPts < -0.5 ? 'rep' : 'stable';
  let shiftLabel = Math.abs(shiftPts) < 0.5 ? 'No significant shift' :
    `${shiftPts > 0 ? '+' : ''}${shiftPts.toFixed(1)} pts toward ${shiftPts > 0 ? 'Dem' : 'Rep'} since ${first.year}`;

  let html = '<div class="margin-trend">';
  html += `<div class="margin-trend-title"><span>Margin Trend (Federal Races)</span><span class="margin-trend-shift ${shiftClass}">${escapeHtml(shiftLabel)}</span></div>`;

  for (let race of races) {
    let marginPct = race.margin * 100;
    let barWidthPct = (Math.abs(race.margin) / maxMargin) * 48; // max 48% of container width
    let isDem = race.margin >= 0;
    let barClass = isDem ? 'dem-bar' : 'rep-bar';
    let valClass = isDem ? 'dem-val' : 'rep-val';
    let label = isDem ? `D+${Math.abs(marginPct).toFixed(1)}` : `R+${Math.abs(marginPct).toFixed(1)}`;

    html += '<div class="margin-trend-row">';
    html += `<div class="margin-trend-label">${escapeHtml(race.displayName)}</div>`;
    html += '<div class="margin-trend-bar-container"><div class="margin-trend-center"></div>';
    html += `<div class="margin-trend-bar ${barClass}" style="width:${barWidthPct}%"></div>`;
    html += '</div>';
    html += `<div class="margin-trend-value ${valClass}">${escapeHtml(label)}</div>`;
    html += '</div>';
  }

  html += '<div class="margin-trend-axis"><span>R</span><span>Center</span><span>D</span></div>';
  html += '</div>';

  // Insert before the election history table
  let existingTrend = el.parentElement.querySelector('.margin-trend');
  if (existingTrend) existingTrend.remove();
  el.insertAdjacentHTML('beforebegin', html);
}

// ---------------------------------------------------------------------------
// Feature 3: Turnout Gap / Missing Voters
// ---------------------------------------------------------------------------

function renderTurnoutGap(precinctCode, votingHistory, partyData, allElectionData, manifest) {
  if (!votingHistory || !partyData) return;

  let manifestByFile = {};
  for (let entry of manifest) {
    let fn = typeof entry === 'string' ? entry : entry.filename;
    manifestByFile[fn] = entry;
  }

  // Get party registration proportions
  let total = (partyData.rep || 0) + (partyData.mod || 0) + (partyData.dem || 0);
  if (total === 0) return;
  let demProp = (partyData.dem || 0) / total;
  let repProp = (partyData.rep || 0) / total;
  let modProp = (partyData.mod || 0) / total;

  // Collect recent federal races
  let recentRaces = [];
  let federal = votingHistory.byCategory?.Federal || [];
  for (let race of federal) {
    let entry = manifestByFile[race.filename];
    let year = entry?.year || extractYear(race.raceName);
    if (race.registeredVoters > 0) {
      let cd = getPrecinctCandidateData(allElectionData[race.filename], precinctCode);
      recentRaces.push({
        name: race.raceName,
        year,
        registeredVoters: race.registeredVoters,
        totalVotes: race.totalVotes,
        nonVoters: Math.max(0, race.registeredVoters - race.totalVotes),
        demMargin: cd ? cd.margin : 0,
        demVotes: cd ? cd.demVotes : 0,
        repVotes: cd ? cd.repVotes : 0,
      });
    }
  }

  if (recentRaces.length === 0) return;
  recentRaces.sort((a, b) => b.year - a.year);
  recentRaces = recentRaces.slice(0, 4);

  let html = '<div class="turnout-gap">';
  html += '<div class="turnout-gap-title">Turnout Gap Analysis</div>';

  for (let race of recentRaces) {
    let estDemNonVoters = Math.round(race.nonVoters * demProp);
    let estRepNonVoters = Math.round(race.nonVoters * repProp);
    let estModNonVoters = Math.round(race.nonVoters * modProp);
    let turnout = calculateTurnout(race.totalVotes, race.registeredVoters);

    // Would full Dem turnout flip the result?
    let demIfAllVoted = race.demVotes + estDemNonVoters;
    let couldFlip = race.demVotes < race.repVotes && demIfAllVoted > race.repVotes;

    html += '<div class="turnout-gap-card">';
    html += `<div class="turnout-gap-race">${escapeHtml(race.name)} (${turnout.toFixed(0)}% turnout)</div>`;
    html += '<div class="turnout-gap-stats">';
    html += `<span class="turnout-gap-stat"><strong>${formatNum(race.nonVoters)}</strong> didn't vote</span>`;
    html += `<span class="turnout-gap-stat">Est. <strong style="color:#0088CC">${formatNum(estDemNonVoters)}</strong> Dem</span>`;
    html += `<span class="turnout-gap-stat">Est. <strong style="color:#E81B23">${formatNum(estRepNonVoters)}</strong> Rep</span>`;
    html += `<span class="turnout-gap-stat">Est. <strong>${formatNum(estModNonVoters)}</strong> Mod</span>`;
    html += '</div>';

    if (couldFlip) {
      html += `<div class="turnout-gap-highlight flip">If all estimated Dem non-voters had shown up, Democrats could have closed the ${formatNum(race.repVotes - race.demVotes)}-vote gap.</div>`;
    } else if (race.demVotes < race.repVotes) {
      let gap = race.repVotes - race.demVotes;
      html += `<div class="turnout-gap-highlight no-flip">Full Dem turnout would add ${formatNum(estDemNonVoters)} votes — not enough to close the ${formatNum(gap)}-vote gap.</div>`;
    }

    html += '</div>';
  }

  html += '</div>';

  // Insert into the elections section
  let historyEl = document.getElementById('section-election-history');
  if (!historyEl) return;
  let existingGap = historyEl.parentElement.querySelector('.turnout-gap');
  if (existingGap) existingGap.remove();
  historyEl.insertAdjacentHTML('afterend', html);
}

// ---------------------------------------------------------------------------
// Feature 7: Talking Points Generator
// ---------------------------------------------------------------------------

// Interactive, audience-targeted talking points. The chair picks an objective
// (Mobilize / Persuade / Register) and the points + a copy/print-ready door
// script retune to this precinct's numbers. Pure logic lives in
// js/talkingPointsBuilder.js (statewide; census only enriches). All interpolated
// text is escaped here before it reaches innerHTML.
function renderTalkingPoints(code, census, partyData, racialData, votingHistory, pvi, strategy) {
  let el = document.getElementById('section-talking-points');
  if (!el) return;

  let sig = derivePrecinctSignature({ partyData, racialData, votingHistory, pvi, strategy, census });
  if (!sig.hasData) {
    el.innerHTML = '';
    return;
  }

  let current = recommendAudience(sig);

  function pointsHTML(audId) {
    let pts = buildTargetedTalkingPoints(sig, audId);
    if (pts.length === 0) {
      return '<div class="tpb-empty">Not enough data to tailor points for this goal.</div>';
    }
    return pts.map((pt) => `<div class="talking-point">
        <div class="talking-point-icon">${pt.icon}</div>
        <div><div class="talking-point-category">${escapeHtml(pt.category)}</div>${escapeHtml(pt.text)}</div>
      </div>`).join('');
  }

  function audBlurb(audId) {
    let a = AUDIENCES.find((x) => x.id === audId);
    return a ? escapeHtml(a.blurb) : '';
  }

  let audBtns = AUDIENCES.map((a) => `<button type="button" class="tpb-aud-btn${a.id === current ? ' active' : ''}" data-aud="${escapeHtml(a.id)}" role="tab" aria-selected="${a.id === current ? 'true' : 'false'}">
      <span class="tpb-aud-icon" aria-hidden="true">${a.icon}</span><span class="tpb-aud-label">${escapeHtml(a.label)}</span>
    </button>`).join('');

  el.innerHTML = `
    <div class="talking-points-builder">
      <div class="talking-points-title">Precinct Chair Talking Points</div>
      <div class="tpb-intro">Choose your goal — the points and the door-knocking script below retune to <strong>this precinct's</strong> own numbers.</div>
      <div class="tpb-audience" role="tablist" aria-label="Canvassing goal">${audBtns}</div>
      <div class="tpb-blurb" id="tpb-blurb">${audBlurb(current)}</div>
      <div class="tpb-points" id="tpb-points">${pointsHTML(current)}</div>
      <div class="tpb-actions">
        <button type="button" class="tpb-action-btn" id="tpb-copy-script">Copy door script</button>
        <button type="button" class="tpb-action-btn" id="tpb-print-script">Print sheet</button>
      </div>
    </div>`;

  let audWrap = el.querySelector('.tpb-audience');
  audWrap.addEventListener('click', function onAud(e) {
    let btn = e.target.closest('.tpb-aud-btn');
    if (!btn) return;
    let id = btn.dataset.aud;
    if (!isAudience(id) || id === current) return;
    current = id;
    audWrap.querySelectorAll('.tpb-aud-btn').forEach((b) => {
      let on = b.dataset.aud === current;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    el.querySelector('#tpb-blurb').innerHTML = audBlurb(current);
    el.querySelector('#tpb-points').innerHTML = pointsHTML(current);
  });

  let copyBtn = el.querySelector('#tpb-copy-script');
  copyBtn.addEventListener('click', async function onCopy() {
    let ok = await copyOnePagerToClipboard(buildCanvassScript(sig, current, code));
    copyBtn.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(function resetLabel() { copyBtn.textContent = 'Copy door script'; }, 2000);
  });

  let printBtn = el.querySelector('#tpb-print-script');
  printBtn.addEventListener('click', function onPrintScript() {
    printCanvassSheet(code, current, sig);
  });
}

// Open a print-friendly sheet with the tailored points + door script.
function printCanvassSheet(code, audId, sig) {
  let aud = AUDIENCES.find((a) => a.id === audId);
  let points = buildTargetedTalkingPoints(sig, audId);
  let script = buildCanvassScript(sig, audId, code);
  let w = window.open('', '_blank');
  if (!w) return;

  let pointsHtml = points.map((p) => `<div class="tp"><div class="cat">${escapeHtml(p.category)}</div><div>${escapeHtml(p.text)}</div></div>`).join('');
  let styles = `<style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:0.6in;max-width:740px;margin:0 auto;color:#1a1a1a;}
    h1{font-size:22px;margin-bottom:2px;}
    .sub{color:#666;font-size:13px;margin-bottom:18px;border-bottom:2px solid #222;padding-bottom:10px;}
    .tp{margin-bottom:12px;}
    .cat{font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#0057B7;margin-bottom:2px;}
    h2{font-size:14px;text-transform:uppercase;letter-spacing:.03em;color:#717171;margin:22px 0 8px;}
    pre{white-space:pre-wrap;background:#f6f6f6;border:1px solid #e2e2e2;border-radius:8px;padding:14px;font-size:13px;line-height:1.5;}
    .foot{margin-top:18px;font-size:11px;color:#999;border-top:1px solid #ddd;padding-top:10px;}
    @page{margin:0.5in;size:letter portrait;}
  </style>`;
  w.document.write(`<!DOCTYPE html><html><head><title>Precinct ${escapeHtml(code)} — Talking Points</title>${styles}</head><body>` +
    `<h1>Precinct ${escapeHtml(code)} — Talking Points</h1>` +
    `<div class="sub">Goal: ${escapeHtml(aud ? aud.label : '')}</div>` +
    pointsHtml +
    `<h2>Door script</h2><pre>${escapeHtml(script)}</pre>` +
    `<div class="foot">Generated from collincountyelections.com</div>` +
    `</body></html>`);
  w.document.close();
  w.addEventListener('load', function onLoad() { w.print(); });
}

// ---------------------------------------------------------------------------
// Feature 8: Election Detail Drilldown
// ---------------------------------------------------------------------------

function renderElectionHistory(votingHistory, precinctCode, allElectionData) {
  let el = document.getElementById("section-election-history");

  if (!votingHistory || !votingHistory.races || votingHistory.races.length === 0) {
    el.innerHTML = '<p class="empty-state">No election history available for this precinct.</p>';
    return;
  }

  let html = "";

  // Party record summary
  let pr = votingHistory.partyRecord;
  html += '<div class="party-record-bar">';
  html += `<span class="pr-item rep">Rep: ${pr.Rep}</span>`;
  html += `<span class="pr-item dem">Dem: ${pr.Dem}</span>`;
  html += `<span class="pr-item other">Other: ${pr.Other}</span>`;

  // Win streak badge
  let streak = computeWinStreak(votingHistory);
  if (streak) {
    html += `<span class="win-streak-badge">${escapeHtml(streak)}</span>`;
  }
  html += "</div>";

  // Tab bar
  html += '<div class="election-tab-bar">';
  for (let tabName of Object.keys(TAB_CATEGORIES)) {
    let activeClass = tabName === "All" ? " active" : "";
    html += `<button class="election-tab${activeClass}" data-tab="${tabName}">${escapeHtml(tabName)}</button>`;
  }
  html += '</div>';

  // Election table (all races, filtered by JS)
  html += '<div id="election-tab-content">';
  html += renderElectionTableWithDrilldown(votingHistory, null, precinctCode, allElectionData);
  html += '</div>';

  el.innerHTML = html;

  // Attach tab click handlers
  el.querySelectorAll(".election-tab").forEach(function attachTab(btn) {
    btn.addEventListener("click", function onTab() {
      el.querySelectorAll(".election-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      let tabName = btn.dataset.tab;
      let categories = TAB_CATEGORIES[tabName];
      let contentEl = document.getElementById("election-tab-content");
      contentEl.innerHTML = renderElectionTableWithDrilldown(votingHistory, categories, precinctCode, allElectionData);
    });
  });
}

function renderElectionTableWithDrilldown(votingHistory, filterCategories, precinctCode, allElectionData) {
  let html = '';

  for (let category of CATEGORY_ORDER) {
    if (filterCategories && !filterCategories.includes(category)) continue;

    let races = votingHistory.byCategory[category];
    if (!races || races.length === 0) continue;

    html += `<div class="history-group">`;
    html += `<button class="history-group-header" aria-expanded="true">
      <span>${escapeHtml(category)} <span class="race-count">(${races.length})</span></span>
      <span class="chevron">&#9660;</span>
    </button>`;
    html += '<div class="history-group-body">';
    html += '<table class="history-table"><thead><tr><th>Race</th><th>Winner</th><th>Party</th><th>Votes</th><th>Turnout</th></tr></thead><tbody>';

    for (let race of races) {
      let turnout = calculateTurnout(race.totalVotes, race.registeredVoters);
      let partyClass = (race.winningParty || "").toLowerCase();
      // CSV column prefixes vary by year ("Rep" vs "REP") — normalize display
      let partyDisplay = race.winningParty
        ? race.winningParty.charAt(0).toUpperCase() + race.winningParty.slice(1).toLowerCase()
        : "";
      let rowId = 'race-' + race.filename.replace(/[^a-zA-Z0-9]/g, '_');
      html += `<tr class="${partyClass}" data-filename="${escapeHtml(race.filename)}" data-row-id="${rowId}">
        <td>${escapeHtml(race.raceName)}</td>
        <td>${escapeHtml(race.winner)}</td>
        <td>${escapeHtml(partyDisplay)}</td>
        <td>${Number(race.totalVotes).toLocaleString()}</td>
        <td>${turnout.toFixed(1)}%</td>
      </tr>`;
      html += `<tr class="drilldown-row" id="${rowId}" style="display:none"><td colspan="5"></td></tr>`;
    }

    html += "</tbody></table></div></div>";
  }

  if (!html) {
    html = '<p class="empty-state">No races in this category.</p>';
  }

  // Attach event handlers after render
  requestAnimationFrame(function bindHandlers() {
    let historyEl = document.getElementById("section-election-history");
    if (!historyEl) return;

    // Collapsible group headers
    historyEl.querySelectorAll(".history-group-header").forEach(function attachToggle(btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener("click", function onToggle() {
        let body = btn.nextElementSibling;
        let expanded = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!expanded));
        body.style.display = expanded ? "none" : "block";
        btn.querySelector(".chevron").style.transform = expanded ? "rotate(-90deg)" : "";
      });
    });

    // Drilldown on row click
    historyEl.querySelectorAll("tr[data-filename]").forEach(function attachDrilldown(tr) {
      if (tr._drillBound) return;
      tr._drillBound = true;
      tr.addEventListener("click", function onDrilldown() {
        let rowId = tr.dataset.rowId;
        let drilldownRow = document.getElementById(rowId);
        if (!drilldownRow) return;

        if (drilldownRow.style.display !== 'none') {
          drilldownRow.style.display = 'none';
          return;
        }

        let filename = tr.dataset.filename;
        let td = drilldownRow.querySelector('td');
        let elData = allElectionData?.[filename];

        if (!elData) {
          td.innerHTML = '<div class="drilldown-panel">Loading...</div>';
          drilldownRow.style.display = '';
          getPrecinctRaceDetail(precinctCode, filename).then(function onData(cd) {
            renderDrilldownContent(td, cd);
          }).catch(function onError(err) {
            console.error('Failed to load race detail:', err);
            td.innerHTML = '<div class="drilldown-panel">Failed to load details. Click to retry.</div>';
          });
        } else {
          let cd = getPrecinctCandidateData(elData, precinctCode);
          renderDrilldownContent(td, cd);
          drilldownRow.style.display = '';
        }
      });
    });
  });

  return html;
}

function renderDrilldownContent(td, cd) {
  if (!cd || !cd.candidates || cd.candidates.length === 0) {
    td.innerHTML = '<div class="drilldown-panel">No candidate detail available.</div>';
    return;
  }

  let html = '<div class="drilldown-panel">';
  html += '<table class="drilldown-table"><thead><tr><th>Candidate</th><th>Party</th><th>Votes</th><th>Pct</th><th>Bar</th></tr></thead><tbody>';

  for (let c of cd.candidates) {
    let partyLower = c.party.toLowerCase();
    let rowCls = partyLower === 'dem' ? 'dem-row' : partyLower === 'rep' ? 'rep-row' : '';
    let barCls = partyLower === 'dem' ? 'dem' : partyLower === 'rep' ? 'rep' : 'other';
    let pctStr = (c.pct * 100).toFixed(1) + '%';
    let barWidth = (c.pct * 100).toFixed(1);

    html += `<tr class="${rowCls}">
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.party)}</td>
      <td>${c.votes.toLocaleString()}</td>
      <td>${pctStr}</td>
      <td><div class="drilldown-bar"><div class="drilldown-bar-fill ${barCls}" style="width:${barWidth}%"></div></div></td>
    </tr>`;
  }

  html += '</tbody></table>';

  // Margin summary
  if (cd.demVotes > 0 || cd.repVotes > 0) {
    let marginPts = (cd.margin * 100).toFixed(1);
    let marginLabel = cd.margin >= 0
      ? `D+${Math.abs(cd.margin * 100).toFixed(1)}`
      : `R+${Math.abs(cd.margin * 100).toFixed(1)}`;
    let color = cd.margin >= 0 ? '#0088CC' : '#E81B23';
    html += `<div style="margin-top:8px;font-size:12px;font-weight:600;color:${color}">Margin: ${marginLabel} (${Math.abs(cd.demVotes - cd.repVotes).toLocaleString()} votes)</div>`;
  }

  html += '</div>';
  td.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Feature 5: Precinct Comparison
// ---------------------------------------------------------------------------

function bindCompareButton(currentCode) {
  let btn = document.getElementById('compare-btn');
  if (!btn) return;

  btn.addEventListener('click', function onCompare() {
    let compSection = document.getElementById('comparison-section');
    if (!compSection) return;

    if (compareMode) {
      compareMode = false;
      comparePrecinct = null;
      compSection.innerHTML = '';
      btn.textContent = 'Compare';
      return;
    }

    compareMode = true;
    btn.textContent = 'Cancel';

    compSection.innerHTML = `
      <div class="compare-search-wrapper">
        <input type="text" class="compare-search-input" placeholder="Enter second precinct number..." autocomplete="off" inputmode="numeric" id="compare-input" />
        <button class="compare-cancel-btn" id="compare-cancel">Cancel</button>
      </div>
      <div id="comparison-results"></div>
    `;

    let input = document.getElementById('compare-input');
    let cancelBtn = document.getElementById('compare-cancel');

    input.focus();

    input.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Enter') {
        let code2 = input.value.trim();
        if (code2 && code2 !== currentCode) {
          renderComparison(currentCode, code2);
        }
      } else if (e.key === 'Escape') {
        compareMode = false;
        comparePrecinct = null;
        compSection.innerHTML = '';
        btn.textContent = 'Compare';
      }
    });

    cancelBtn.addEventListener('click', function onCancel() {
      compareMode = false;
      comparePrecinct = null;
      compSection.innerHTML = '';
      btn.textContent = 'Compare';
    });
  });
}

function renderComparison(code1, code2) {
  let resultsEl = document.getElementById('comparison-results');
  if (!resultsEl) return;

  let entry2 = precinctList.find(p => p.code === String(code2));
  if (!entry2) {
    resultsEl.innerHTML = `<p class="empty-state">Precinct ${escapeHtml(code2)} not found.</p>`;
    return;
  }

  let c1 = censusProfiles ? censusProfiles[String(code1)] : null;
  let c2 = censusProfiles ? censusProfiles[String(code2)] : null;
  let p1 = dncLookup[String(code1)] || null;
  let p2 = dncLookup[String(code2)] || null;
  let r1 = racialLookup[String(code1)] || null;
  let r2 = racialLookup[String(code2)] || null;
  let pvi1 = pviCache[code1] || { label: 'N/A' };
  let pvi2 = pviCache[code2] || computePVIQuick(code2);

  let rows = [];

  // Helper to add a comparison row
  function addRow(metric, val1, val2, formatter, betterHigher) {
    let f1 = formatter ? formatter(val1) : String(val1 ?? 'N/A');
    let f2 = formatter ? formatter(val2) : String(val2 ?? 'N/A');
    let cls1 = '', cls2 = '';
    if (val1 != null && val2 != null && val1 !== val2) {
      if (betterHigher !== undefined) {
        let better1 = betterHigher ? val1 > val2 : val1 < val2;
        cls1 = better1 ? 'better better-dem' : '';
        cls2 = !better1 ? 'better better-dem' : '';
      }
    }
    rows.push({ metric, f1, f2, cls1, cls2 });
  }

  addRow('Population', c1?.population, c2?.population, formatNum, true);
  addRow('Median Income', c1?.income?.medianHousehold, c2?.income?.medianHousehold, formatCurrency, true);
  addRow('Home Value', c1?.housing?.medianHomeValue, c2?.housing?.medianHomeValue, formatCurrency, undefined);
  addRow('Median Age', c1?.age?.medianAge, c2?.age?.medianAge, v => v != null ? String(v) : 'N/A', undefined);

  let cp1 = c1?.education ? ((c1.education.bachelors || 0) + (c1.education.graduateProfessional || 0)) : null;
  let cp2 = c2?.education ? ((c2.education.bachelors || 0) + (c2.education.graduateProfessional || 0)) : null;
  addRow('College %', cp1, cp2, v => v != null ? formatPct(v) : 'N/A', true);

  addRow('Dem Share', p1?.demShare, p2?.demShare, v => v != null ? (v * 100).toFixed(1) + '%' : 'N/A', true);
  addRow('Rep Share', p1?.repShare, p2?.repShare, v => v != null ? (v * 100).toFixed(1) + '%' : 'N/A', undefined);
  addRow('Mod Share', p1?.modShare, p2?.modShare, v => v != null ? (v * 100).toFixed(1) + '%' : 'N/A', undefined);
  addRow('PVI', pvi1.label, pvi2.label, v => String(v), undefined);

  let nonWhite1 = r1 ? (1 - (r1.pct_white || 0)) : null;
  let nonWhite2 = r2 ? (1 - (r2.pct_white || 0)) : null;
  addRow('Non-White %', nonWhite1, nonWhite2, v => v != null ? (v * 100).toFixed(1) + '%' : 'N/A', undefined);

  let html = '<div class="comparison-table-wrapper">';
  html += '<table class="comparison-full-table">';
  html += `<thead><tr><th>Metric</th><th>Precinct ${escapeHtml(code1)}</th><th>Precinct ${escapeHtml(code2)}</th></tr></thead><tbody>`;

  for (let row of rows) {
    html += `<tr><td class="metric-label">${escapeHtml(row.metric)}</td><td class="${row.cls1}">${escapeHtml(row.f1)}</td><td class="${row.cls2}">${escapeHtml(row.f2)}</td></tr>`;
  }

  html += '</tbody></table></div>';
  resultsEl.innerHTML = html;
}

function computePVIQuick(code) {
  // Quick PVI for comparison target — uses cached election data if available
  try {
    // Try from pviCache first
    if (pviCache[code]) return pviCache[code];
    // Can't compute without loading data synchronously, return placeholder
    return { pvi: 0, label: 'N/A' };
  } catch { return { pvi: 0, label: 'N/A' }; }
}

// ---------------------------------------------------------------------------
// Strategic Intelligence (AI-generated insights)
// ---------------------------------------------------------------------------

function renderStrategicIntelligence(code) {
  let el = document.getElementById("section-strategic-intel");
  if (!el) return;

  let insight = strategicIntel?.[String(code)];
  if (!insight) {
    el.innerHTML = "";
    return;
  }

  // Split into paragraphs and wrap in <p> tags
  let paragraphs = insight
    .split(/\n\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join("");

  el.innerHTML = `
    <h3 class="report-section-title">Strategic Intelligence</h3>
    <div class="strategic-intel-badge">AI-Generated Analysis</div>
    <div class="strategic-intel-content">${paragraphs}</div>
  `;
}

// ---------------------------------------------------------------------------
// Feature 6: Similar Precincts
// ---------------------------------------------------------------------------

function renderSimilarPrecincts(code, census, partyData, racialData, allElectionData, manifest) {
  let el = document.getElementById('section-similar');
  if (!el) return;

  if (!census && !partyData) {
    el.innerHTML = '';
    return;
  }

  // Build feature vector for the current precinct
  let currentVec = buildFeatureVector(code, census, partyData, racialData);
  if (!currentVec) {
    el.innerHTML = '';
    return;
  }

  // Build vectors for all other precincts and compute distances
  let distances = [];
  for (let p of precinctList) {
    if (p.code === code) continue;
    let otherCensus = censusProfiles ? censusProfiles[p.code] : null;
    let otherParty = dncLookup[p.code] || null;
    let otherRacial = racialLookup[p.code] || null;

    let otherVec = buildFeatureVector(p.code, otherCensus, otherParty, otherRacial);
    if (!otherVec) continue;

    let dist = euclideanDistance(currentVec, otherVec);
    let otherPvi = pviCache[p.code] || null;

    distances.push({
      code: p.code,
      distance: dist,
      census: otherCensus,
      party: otherParty,
      racial: otherRacial,
      pvi: otherPvi,
    });
  }

  distances.sort((a, b) => a.distance - b.distance);
  let top5 = distances.slice(0, 5);

  if (top5.length === 0) {
    el.innerHTML = '';
    return;
  }

  let html = '<div class="similar-precincts">';
  html += '<div class="similar-precincts-title">Similar Precincts</div>';
  html += '<div class="similar-precincts-grid">';

  for (let sim of top5) {
    let pviLabel = sim.pvi?.label || 'N/A';
    let pviCls = (sim.pvi?.pvi || 0) > 0.5 ? 'pvi-dem' : (sim.pvi?.pvi || 0) < -0.5 ? 'pvi-rep' : 'pvi-even';

    // Find a key difference
    let diff = findKeyDifference(code, census, partyData, sim.code, sim.census, sim.party);

    html += `<div class="similar-card" data-precinct="${escapeHtml(sim.code)}">`;
    html += '<div class="similar-card-header">';
    html += `<span class="similar-card-code">Precinct ${escapeHtml(sim.code)}</span>`;
    html += `<span class="similar-card-pvi ${pviCls}">${escapeHtml(pviLabel)}</span>`;
    html += '</div>';
    html += `<div class="similar-card-diff">${escapeHtml(diff)}</div>`;
    html += '</div>';
  }

  html += '</div></div>';
  el.innerHTML = html;

  // Make cards clickable
  el.querySelectorAll('.similar-card').forEach(function attachClick(card) {
    card.addEventListener('click', function onClick() {
      let targetCode = card.dataset.precinct;
      let searchInput = document.getElementById('precinct-search');
      if (searchInput) searchInput.value = targetCode;
      selectPrecinct(targetCode);
    });
  });
}

function buildFeatureVector(code, census, partyData, racialData) {
  let vec = [];
  // Dem share (0-1)
  vec.push(partyData?.demShare || 0);
  // Median income normalized (divide by 200k to get 0-1 range)
  vec.push((census?.income?.medianHousehold || 0) / 200000);
  // College pct (0-1)
  let college = census?.education ? ((census.education.bachelors || 0) + (census.education.graduateProfessional || 0)) : 0;
  vec.push(college);
  // Median age normalized (divide by 80)
  vec.push((census?.age?.medianAge || 0) / 80);
  // Diversity index: 1 - pct_white (0-1)
  vec.push(racialData ? (1 - (racialData.pct_white || 0)) : 0);
  // Mod share (0-1)
  vec.push(partyData?.modShare || 0);

  // Only valid if we have at least party data
  if (!partyData) return null;
  return vec;
}

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function findKeyDifference(code1, census1, party1, code2, census2, party2) {
  let diffs = [];

  if (party1 && party2) {
    let demDiff = ((party2.demShare || 0) - (party1.demShare || 0)) * 100;
    if (Math.abs(demDiff) > 3) {
      diffs.push(`${demDiff > 0 ? '+' : ''}${demDiff.toFixed(0)}% Dem registration`);
    }
  }

  if (census1?.income?.medianHousehold && census2?.income?.medianHousehold) {
    let incomeDiff = census2.income.medianHousehold - census1.income.medianHousehold;
    let pctDiff = (incomeDiff / census1.income.medianHousehold) * 100;
    if (Math.abs(pctDiff) > 15) {
      diffs.push(`${pctDiff > 0 ? '+' : ''}${pctDiff.toFixed(0)}% income`);
    }
  }

  if (diffs.length > 0) {
    return 'Similar demographics, but ' + diffs[0];
  }
  return 'Very similar demographic and political profile';
}
