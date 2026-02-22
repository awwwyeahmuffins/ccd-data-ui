// precinctLookup.js
// --------------------------------------------------------------------------------
// Precinct Lookup page orchestration — search, report rendering, mini map.

import {
  loadAllData,
  setActiveBoundary,
  getActiveBoundary,
  getBoundaryConfigs,
} from "./dataLoader.js";
import {
  loadCensusProfiles,
  generateProfileHTML,
  renderPartyRegistration,
  renderRacialDemographics,
  renderOfficials,
  generateTakeaways,
  escapeHtml,
  formatNum,
  formatCurrency,
  formatPct,
} from "./precinctProfile.js";
import {
  getPrecinctVotingHistory,
  clearElectionDataCache,
  CATEGORY_ORDER,
  formatRaceName,
  calculateTurnout,
} from "./precinctHistory.js";
import {
  initTheme,
  toggleTheme,
  getCurrentTheme,
  LIGHT_TILE_URL,
  DARK_TILE_URL,
} from "./themeManager.js";
import { exportAsPDF, exportAsMarkdown } from "./precinctExport.js";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let geojsonData = null;
let dncLookup = null;
let racialLookup = null;
let censusProfiles = null;
let precinctList = []; // [{code, feature, party}]
let miniMap = null;
let miniMapLayer = null;
let tileLayer = null;
let currentReportData = null;
let currentPrecinctCode = null; // track what's currently displayed
let isSwitching = false; // prevent concurrent boundary switches

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function initPrecinctLookup() {
  initTheme();

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
    // Close dropdown on outside click
    document.addEventListener("click", function onDocClick(e) {
      if (!e.target.closest(".search-wrapper")) {
        dropdown.classList.remove("open");
      }
    });
  }

  // Export buttons
  let pdfBtn = document.getElementById("export-pdf");
  let mdBtn = document.getElementById("export-md");
  if (pdfBtn) pdfBtn.addEventListener("click", exportAsPDF);
  if (mdBtn) {
    mdBtn.addEventListener("click", function onMdExport() {
      if (currentReportData) exportAsMarkdown(currentReportData);
    });
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

  // Try loading census profiles — may not exist for 2026
  try {
    censusProfiles = await loadCensusProfiles();
  } catch {
    censusProfiles = null;
  }

  // Build precinct list from GeoJSON features
  precinctList = geojsonData.features.map(function extractPrecinct(f) {
    let code = String(f.properties.PRECINCT);
    let party = f.properties.winningParty || "";
    return { code, feature: f, party };
  });
  precinctList.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

async function handleBoundarySwitch(boundaryId) {
  isSwitching = true;

  // Show loading feedback on the search section
  let searchInput = document.getElementById("precinct-search");
  if (searchInput) {
    searchInput.disabled = true;
    searchInput.placeholder = "Loading boundary data...";
  }

  try {
    setActiveBoundary(boundaryId);
    clearElectionDataCache();
    await loadBaseData();

    // Re-render the current precinct if one was selected
    if (currentPrecinctCode) {
      let exists = precinctList.find((p) => p.code === currentPrecinctCode);
      if (exists) {
        await selectPrecinct(currentPrecinctCode);
      } else {
        // Precinct doesn't exist in the new boundary — reset the report
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
// Search / autocomplete
// ---------------------------------------------------------------------------

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

  // Attach click handlers
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

  currentPrecinctCode = String(code);
  let feature = entry.feature;
  let props = feature.properties;

  // Extract data
  let partyData = dncLookup[String(code)] || null;
  let racialData = racialLookup[String(code)] || null;
  let officials = extractOfficials(props);
  let census = censusProfiles ? censusProfiles[String(code)] : null;

  // Show report container, hide intro
  document.getElementById("intro-message")?.classList.add("hidden");
  let reportEl = document.getElementById("report-container");
  reportEl.classList.remove("hidden");

  // Make sure the report structure is intact (may have been wiped by showError)
  ensureReportStructure(reportEl);

  // Show loading state for election history
  let historyEl = document.getElementById("section-election-history");
  historyEl.innerHTML = '<div class="loading-spinner">Loading election history...</div>';

  // Render immediate sections
  renderReportHeader(code, partyData);
  renderMiniMap(feature, partyData);
  renderSummaryCards(census, partyData, racialData);
  renderPartySection(partyData);
  renderRacialSection(racialData);
  renderOfficialsSection(officials);
  renderCensusSection(census, code, props._meta || null);

  // Update URL hash
  let boundary = getActiveBoundary();
  window.location.hash = `precinct=${code}&boundary=${boundary}`;

  // Load election history async
  let votingHistory;
  try {
    votingHistory = await getPrecinctVotingHistory(code);
  } catch {
    votingHistory = { races: [], byCategory: {}, partyRecord: { Rep: 0, Dem: 0, Other: 0 } };
  }
  renderElectionHistory(votingHistory);

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
  };

  // Show export buttons
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
// Section renderers
// ---------------------------------------------------------------------------

function renderReportHeader(code, partyData) {
  let el = document.getElementById("report-header");
  let configs = getBoundaryConfigs();
  let boundaryLabel = configs[getActiveBoundary()].label;

  let badge = "";
  if (partyData?.winningParty) {
    let cls = partyData.winningParty.toLowerCase();
    let strength = partyData.partyStrength != null ? ` (${partyData.partyStrength}/3)` : "";
    badge = `<span class="party-lean-badge ${cls}">${escapeHtml(partyData.winningParty)}${escapeHtml(strength)}</span>`;
  }

  el.innerHTML = `
    <h1>Precinct ${escapeHtml(code)}</h1>
    <div class="report-meta">
      <span class="boundary-label">${escapeHtml(boundaryLabel)}</span>
      ${badge}
    </div>
  `;
}

function renderSummaryCards(census, partyData, racialData) {
  let el = document.getElementById("section-summary-cards");
  let cards = [];

  if (census?.population != null) {
    cards.push({ label: "Population", value: formatNum(census.population) });
  }
  if (census?.households?.total != null) {
    cards.push({ label: "Households", value: formatNum(census.households.total) });
  }
  if (census?.income?.medianHousehold != null) {
    cards.push({ label: "Median Income", value: formatCurrency(census.income.medianHousehold) });
  }
  if (partyData) {
    let total = (partyData.rep || 0) + (partyData.mod || 0) + (partyData.dem || 0);
    cards.push({ label: "Registered Voters", value: formatNum(total) });
  }
  if (census?.housing?.medianHomeValue != null) {
    cards.push({ label: "Median Home Value", value: formatCurrency(census.housing.medianHomeValue) });
  }
  if (census?.age?.medianAge != null) {
    cards.push({ label: "Median Age", value: String(census.age.medianAge) });
  }

  if (cards.length === 0 && partyData) {
    let total = (partyData.rep || 0) + (partyData.mod || 0) + (partyData.dem || 0);
    cards.push({ label: "Registered Voters", value: formatNum(total) });
    if (partyData.winningParty) {
      cards.push({ label: "Party Lean", value: partyData.winningParty });
    }
  }

  el.innerHTML = cards.length > 0
    ? '<div class="summary-grid">' +
      cards.map((c) => `<div class="summary-card"><div class="summary-value">${escapeHtml(c.value)}</div><div class="summary-label">${escapeHtml(c.label)}</div></div>`).join("") +
      "</div>"
    : "";
}

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
    let boundary = getActiveBoundary();
    if (boundary === "2026") {
      el.innerHTML = '<div class="census-unavailable">Census profile data not yet available for 2026 boundaries. Party, racial, officials, and election data are still shown above.</div>';
    } else {
      el.innerHTML = `<div class="census-unavailable">No census data available for precinct ${escapeHtml(code)}.</div>`;
    }
    return;
  }
  let extraData = {};
  if (boundaryMeta) {
    extraData.boundaryMeta = boundaryMeta;
  }
  el.innerHTML = generateProfileHTML(census, code, extraData);
}

function renderElectionHistory(votingHistory) {
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
  html += "</div>";

  // Grouped by category
  for (let category of CATEGORY_ORDER) {
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
      html += `<tr class="${partyClass}">
        <td>${escapeHtml(race.raceName)}</td>
        <td>${escapeHtml(race.winner)}</td>
        <td>${escapeHtml(race.winningParty)}</td>
        <td>${Number(race.totalVotes).toLocaleString()}</td>
        <td>${turnout.toFixed(1)}%</td>
      </tr>`;
    }

    html += "</tbody></table></div></div>";
  }

  el.innerHTML = html;

  // Attach collapsible behavior
  el.querySelectorAll(".history-group-header").forEach(function attachToggle(btn) {
    btn.addEventListener("click", function onToggle() {
      let body = btn.nextElementSibling;
      let expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      body.style.display = expanded ? "none" : "block";
      btn.querySelector(".chevron").style.transform = expanded ? "rotate(-90deg)" : "";
    });
  });
}

// ---------------------------------------------------------------------------
// Mini map
// ---------------------------------------------------------------------------

function renderMiniMap(feature, partyData) {
  let container = document.getElementById("mini-map");
  if (!container) return;

  // Determine fill color based on party
  let fillColor = "#888";
  if (partyData?.winningParty) {
    let p = partyData.winningParty.toLowerCase();
    if (p === "republican" || p === "rep") fillColor = "#E81B23";
    else if (p === "democrat" || p === "dem") fillColor = "#00AEF3";
    else if (p === "moderate" || p === "mod") fillColor = "#800080";
  }

  if (!miniMap) {
    miniMap = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
    });
    let url = getCurrentTheme() === "dark" ? DARK_TILE_URL : LIGHT_TILE_URL;
    tileLayer = L.tileLayer(url, { maxZoom: 18 }).addTo(miniMap);
  }

  // Remove previous layer
  if (miniMapLayer) {
    miniMap.removeLayer(miniMapLayer);
  }

  miniMapLayer = L.geoJSON(feature, {
    style: {
      fillColor,
      fillOpacity: 0.4,
      color: fillColor,
      weight: 2,
    },
  }).addTo(miniMap);

  miniMap.fitBounds(miniMapLayer.getBounds(), { padding: [20, 20] });
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

/**
 * Reset the report area back to its original HTML structure.
 * Called when a precinct is not found or on boundary switch errors.
 */
function resetReport() {
  currentReportData = null;
  document.getElementById("intro-message")?.classList.remove("hidden");
  document.getElementById("export-bar")?.classList.add("hidden");

  let reportEl = document.getElementById("report-container");
  reportEl.classList.add("hidden");

  // Rebuild the structure so future selectPrecinct calls work
  reportEl.innerHTML = `
    <div id="report-header" class="report-header"></div>
    <div id="export-bar" class="export-bar hidden">
      <button id="export-pdf" class="export-btn">Export PDF</button>
      <button id="export-md" class="export-btn">Export Markdown</button>
    </div>
    <div id="mini-map" class="mini-map-container"></div>
    <div id="section-summary-cards"></div>
    <div id="section-party" class="report-section"></div>
    <div id="section-racial" class="report-section"></div>
    <div id="section-officials" class="report-section"></div>
    <div class="report-section">
      <div class="report-section-title">Election History</div>
      <div id="section-election-history"></div>
    </div>
    <div id="section-census" class="report-section"></div>
  `;

  // Destroy mini map so it can be re-created in the new container
  if (miniMap) {
    miniMap.remove();
    miniMap = null;
    miniMapLayer = null;
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
}

/**
 * Ensure the report container has its expected child elements.
 * If showError/showNotice previously replaced innerHTML, rebuild it.
 */
function ensureReportStructure(reportEl) {
  if (!document.getElementById("report-header")) {
    reportEl.innerHTML = `
      <div id="report-header" class="report-header"></div>
      <div id="export-bar" class="export-bar hidden">
        <button id="export-pdf" class="export-btn">Export PDF</button>
        <button id="export-md" class="export-btn">Export Markdown</button>
      </div>
      <div id="mini-map" class="mini-map-container"></div>
      <div id="section-summary-cards"></div>
      <div id="section-party" class="report-section"></div>
      <div id="section-racial" class="report-section"></div>
      <div id="section-officials" class="report-section"></div>
      <div class="report-section">
        <div class="report-section-title">Election History</div>
        <div id="section-election-history"></div>
      </div>
      <div id="section-census" class="report-section"></div>
    `;

    // Destroy and allow re-creation of mini map
    if (miniMap) {
      miniMap.remove();
      miniMap = null;
      miniMapLayer = null;
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
