// fieldOnePager.js
// --------------------------------------------------------------------------------
// Printable one-page field brief for a precinct — compact layout for canvassers.

import { boundary } from "./data/dataService.js";
import { loadCensusProfiles } from "./precinctProfile.js";
import { getPrecinctVotingHistory, computePrecinctTrend, calculateTurnout } from "./precinctHistory.js";
import { populationOf } from "./lib/format.js";

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/**
 * Bundle all data needed for the one-pager.
 * @param {string} precinctCode
 * @returns {Promise<{census, party, racial, officials, recentElections, trend}>}
 */
export async function loadOnePagerData(precinctCode) {
  let census;
  let party;
  let racial;
  let officials = null;
  let recentElections = [];
  let trend;

  // Load base data (DNC + racial lookups)
  let baseData;
  try {
    baseData = await boundary().loadAll();
  } catch {
    baseData = { dncLookup: {}, racialLookup: {}, geojson: { features: [] } };
  }

  let code = String(precinctCode);
  party = baseData.dncLookup[code] || null;
  racial = baseData.racialLookup[code] || null;

  // Extract officials from GeoJSON feature properties
  let feature = baseData.geojson.features.find(
    (f) => String(f.properties.PRECINCT) === code
  );
  if (feature) {
    let props = feature.properties;
    let officialKeys = ["CONG", "CONG_N", "SEN", "SEN_N", "SHR", "SHR_N", "SED", "SED_N", "COMMISH", "COMMISH_N", "JP_N", "CONST_N"];
    let o = {};
    for (let k of officialKeys) {
      if (props[k] != null) o[k] = props[k];
    }
    officials = Object.keys(o).length > 0 ? o : null;
  }

  // Load census profiles
  try {
    let profiles = await loadCensusProfiles();
    census = profiles[code] || null;
  } catch {
    census = null;
  }

  // Load voting history
  try {
    let history = await getPrecinctVotingHistory(code);
    if (history && history.races) {
      // Sort by most recent first, take last 3
      let sorted = [...history.races].sort((a, b) => {
        let yA = extractYear(a.filename);
        let yB = extractYear(b.filename);
        return yB - yA;
      });
      recentElections = sorted.slice(0, 3);
    }
  } catch {
    recentElections = [];
  }

  // Compute trend
  try {
    trend = await computePrecinctTrend(code);
  } catch {
    trend = null;
  }

  return { census, party, racial, officials, recentElections, trend };
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

/**
 * Generate a compact single-page HTML layout for print/display.
 */
export function generateFieldOnePagerHTML(precinctCode, census, party, racial, officials, recentElections, trend) {
  let code = esc(String(precinctCode));

  // ROW 1: Header — "Population" = racial-data total (sitewide convention)
  let popVal = populationOf(racial, census);
  let popBadge = popVal != null ? `<span class="header-badge">Pop. ${fmtNum(popVal)}</span>` : "";
  let partyBadge = "";
  if (party?.winningParty) {
    let cls = party.winningParty.toLowerCase();
    partyBadge = `<span class="header-badge party-badge-${cls}">${esc(party.winningParty)}</span>`;
  }
  let trendBadge = "";
  if (trend) {
    let icon = trend.direction === "dem" ? "\u2191" : trend.direction === "rep" ? "\u2193" : "\u2014";
    let label = trend.direction === "stable" ? "Stable" : `${Math.abs(trend.delta).toFixed(1)}% ${trend.direction === "dem" ? "Dem" : "Rep"}`;
    trendBadge = `<span class="header-badge trend-badge-${trend.direction}">${icon} ${esc(label)}</span>`;
  }

  // ROW 2: Key stats
  let regVoters = "N/A";
  if (party) {
    let total = (party.rep || 0) + (party.mod || 0) + (party.dem || 0);
    regVoters = fmtNum(total);
  } else if (recentElections.length > 0 && recentElections[0].registeredVoters) {
    regVoters = fmtNum(recentElections[0].registeredVoters);
  }
  let medianIncome = census?.income?.medianHousehold != null ? fmtCurrency(census.income.medianHousehold) : "N/A";
  let collegePct = "N/A";
  if (census?.education) {
    let bach = census.education.bachelors || 0;
    let grad = census.education.graduateProfessional || 0;
    let pct = bach + grad;
    if (pct > 0) collegePct = (pct * 100).toFixed(1) + "%";
  }
  let homeownership = census?.housing?.ownerOccupied != null ? (census.housing.ownerOccupied * 100).toFixed(1) + "%" : "N/A";

  // ROW 3: Party registration bar
  let partyBarHTML = "";
  if (party) {
    let repPct = ((party.repShare || 0) * 100).toFixed(1);
    let modPct = ((party.modShare || 0) * 100).toFixed(1);
    let demPct = ((party.demShare || 0) * 100).toFixed(1);
    partyBarHTML = `
      <div class="one-pager-bar">
        <div class="one-pager-bar-label">Party Registration</div>
        <div class="one-pager-bar-container">
          <div class="one-pager-bar-segment" style="width:${repPct}%;background:#E81B23">R ${repPct}%</div>
          <div class="one-pager-bar-segment" style="width:${modPct}%;background:#800080">M ${modPct}%</div>
          <div class="one-pager-bar-segment" style="width:${demPct}%;background:#00AEF3">D ${demPct}%</div>
        </div>
      </div>`;
  }

  // ROW 4: Racial demographics bar
  let racialBarHTML = "";
  if (racial) {
    let segments = [
      { label: "White", pct: ((racial.pct_white || 0) * 100).toFixed(1), color: "#9467bd" },
      { label: "Asian", pct: ((racial.pct_asian || 0) * 100).toFixed(1), color: "#1f77b4" },
      { label: "Hisp", pct: ((racial.pct_hispanic || 0) * 100).toFixed(1), color: "#2ca02c" },
      { label: "Black", pct: ((racial.pct_black || 0) * 100).toFixed(1), color: "#ff7f0e" },
      { label: "Other", pct: ((racial.pct_others || 0) * 100).toFixed(1), color: "#d62728" },
    ];
    let segs = segments.map((s) => `<div class="one-pager-bar-segment" style="width:${s.pct}%;background:${s.color}" title="${s.label}: ${s.pct}%">${s.pct > 8 ? s.label + " " + s.pct + "%" : ""}</div>`).join("");
    let legend = segments.map((s) => `<span style="font-size:10px;margin-right:8px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.color};margin-right:3px;vertical-align:middle"></span>${s.label} ${s.pct}%</span>`).join("");
    racialBarHTML = `
      <div class="one-pager-bar">
        <div class="one-pager-bar-label">Racial Demographics</div>
        <div class="one-pager-bar-container">${segs}</div>
        <div style="margin-top:4px">${legend}</div>
      </div>`;
  }

  // ROW 5: Last 3 elections table
  let electionsHTML = "";
  if (recentElections && recentElections.length > 0) {
    let rows = recentElections.map((r) => {
      let year = extractYear(r.filename) || "";
      let name = r.raceName || "";
      // Truncate long race names
      if (name.length > 30) name = name.slice(0, 28) + "...";
      let winner = r.winner || "N/A";
      let winnerParty = r.winningParty || "";
      let turnout = r.registeredVoters > 0 ? calculateTurnout(r.totalVotes, r.registeredVoters).toFixed(1) + "%" : "N/A";
      let partyClass = winnerParty.toLowerCase();
      return `<tr class="${esc(partyClass)}"><td>${esc(name)}</td><td>${year}</td><td>${esc(winner)}</td><td>${esc(winnerParty)}</td><td>${turnout}</td></tr>`;
    }).join("");
    electionsHTML = `
      <table class="one-pager-elections">
        <thead><tr><th>Race</th><th>Year</th><th>Winner</th><th>Party</th><th>Turnout</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ROW 6: Districts
  let districtsHTML = "";
  if (officials) {
    let items = [];
    if (officials.CONG != null) items.push({ type: "US Congress", value: "Dist. " + officials.CONG });
    if (officials.SEN != null) items.push({ type: "TX Senate", value: "Dist. " + officials.SEN });
    if (officials.SHR != null) items.push({ type: "TX House", value: "Dist. " + officials.SHR });
    if (items.length > 0) {
      districtsHTML = `<div class="one-pager-districts">${items.map((d) => `<div class="one-pager-district"><div class="district-type">${esc(d.type)}</div><div class="district-value">${esc(d.value)}</div></div>`).join("")}</div>`;
    }
  }

  // FOOTER
  let today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let footer = `<div class="one-pager-footer">Generated from collincountyelections.com &bull; ${esc(today)}</div>`;

  // Actions bar (hidden in print)
  let actions = `
    <div class="one-pager-actions">
      <button class="print-btn" id="one-pager-print-btn">Print</button>
      <button class="copy-btn" id="one-pager-copy-btn">Copy to Clipboard</button>
    </div>`;

  return `
    <div class="field-one-pager">
      <div class="one-pager-header">
        <span class="precinct-code">Precinct ${code}</span>
        <div class="header-badges">${popBadge}${partyBadge}${trendBadge}</div>
      </div>
      <div class="one-pager-stats">
        <div class="one-pager-stat"><div class="stat-value">${regVoters}</div><div class="stat-label">Registered Voters</div></div>
        <div class="one-pager-stat"><div class="stat-value">${medianIncome}</div><div class="stat-label">Median Income</div></div>
        <div class="one-pager-stat"><div class="stat-value">${collegePct}</div><div class="stat-label">College Degree</div></div>
        <div class="one-pager-stat"><div class="stat-value">${homeownership}</div><div class="stat-label">Homeownership</div></div>
      </div>
      ${partyBarHTML}
      ${racialBarHTML}
      ${electionsHTML}
      ${districtsHTML}
      ${footer}
      ${actions}
    </div>`;
}

// ---------------------------------------------------------------------------
// Plain text generation
// ---------------------------------------------------------------------------

/**
 * Generate a plain text ASCII version for clipboard/Slack.
 * Stays under 60 lines.
 */
export function generateFieldOnePagerText(precinctCode, census, party, racial, officials, recentElections, trend) {
  let lines = [];
  let code = String(precinctCode);

  lines.push("============================");
  lines.push(`PRECINCT ${code} - Field Brief`);
  lines.push("============================");

  // Population and party lean — "Population" = racial-data total (sitewide)
  let parts = [];
  let popVal = populationOf(racial, census);
  if (popVal != null) parts.push(`Population: ${fmtNum(popVal)}`);
  if (party?.winningParty) parts.push(`Party Lean: ${party.winningParty}`);
  if (trend) {
    let dir = trend.direction === "dem" ? "Dem" : trend.direction === "rep" ? "Rep" : "Stable";
    let arrow = trend.direction === "dem" ? "\u2191" : trend.direction === "rep" ? "\u2193" : "-";
    parts.push(`Trend: ${arrow} ${Math.abs(trend.delta).toFixed(1)}% ${dir}`);
  }
  if (parts.length > 0) lines.push(parts.join(" | "));
  lines.push("");

  // Key stats
  lines.push("KEY STATS");
  lines.push("---------");
  let regVoters = "N/A";
  if (party) {
    regVoters = fmtNum((party.rep || 0) + (party.mod || 0) + (party.dem || 0));
  }
  lines.push(`Registered Voters: ${regVoters}`);
  lines.push(`Median Income:     ${census?.income?.medianHousehold != null ? fmtCurrency(census.income.medianHousehold) : "N/A"}`);
  let collegePct = "N/A";
  if (census?.education) {
    let pct = (census.education.bachelors || 0) + (census.education.graduateProfessional || 0);
    if (pct > 0) collegePct = (pct * 100).toFixed(1) + "%";
  }
  lines.push(`College Degree:    ${collegePct}`);
  lines.push(`Homeownership:     ${census?.housing?.ownerOccupied != null ? (census.housing.ownerOccupied * 100).toFixed(1) + "%" : "N/A"}`);
  lines.push("");

  // Party registration
  if (party) {
    lines.push("PARTY REGISTRATION");
    lines.push("------------------");
    let repPct = ((party.repShare || 0) * 100).toFixed(1);
    let modPct = ((party.modShare || 0) * 100).toFixed(1);
    let demPct = ((party.demShare || 0) * 100).toFixed(1);
    lines.push(`Rep: ${repPct}%  |  Mod: ${modPct}%  |  Dem: ${demPct}%`);
    lines.push("");
  }

  // Racial demographics
  if (racial) {
    lines.push("RACIAL DEMOGRAPHICS");
    lines.push("-------------------");
    lines.push(`White: ${((racial.pct_white || 0) * 100).toFixed(1)}%  Asian: ${((racial.pct_asian || 0) * 100).toFixed(1)}%  Hispanic: ${((racial.pct_hispanic || 0) * 100).toFixed(1)}%  Black: ${((racial.pct_black || 0) * 100).toFixed(1)}%  Other: ${((racial.pct_others || 0) * 100).toFixed(1)}%`);
    lines.push("");
  }

  // Recent elections
  if (recentElections && recentElections.length > 0) {
    lines.push("RECENT ELECTIONS");
    lines.push("----------------");
    lines.push(padRight("Race", 28) + padRight("Year", 6) + padRight("Winner", 20) + "Turnout");
    for (let r of recentElections) {
      let year = String(extractYear(r.filename) || "");
      let name = (r.raceName || "").slice(0, 26);
      let winner = (r.winner || "N/A").slice(0, 18);
      let turnout = r.registeredVoters > 0 ? calculateTurnout(r.totalVotes, r.registeredVoters).toFixed(1) + "%" : "N/A";
      lines.push(padRight(name, 28) + padRight(year, 6) + padRight(winner, 20) + turnout);
    }
    lines.push("");
  }

  // Districts
  if (officials) {
    lines.push("DISTRICTS");
    lines.push("---------");
    if (officials.CONG != null) lines.push(`US Congress:  District ${officials.CONG}`);
    if (officials.SEN != null) lines.push(`TX Senate:    District ${officials.SEN}`);
    if (officials.SHR != null) lines.push(`TX House:     District ${officials.SHR}`);
    lines.push("");
  }

  let today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  lines.push(`Generated from collincountyelections.com - ${today}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

/**
 * Open a print-friendly window with the one-pager HTML. If the browser blocks
 * the pop-up, fall back to printing through a hidden iframe so the user still
 * gets their printout (and never a silent nothing).
 */
export function printOnePager(html, precinctCode) {
  let printWindow = window.open("", "_blank");

  let printStyles = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 0.5in; }
      .field-one-pager { max-width: 700px; margin: 0 auto; }
      .one-pager-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #222; }
      .precinct-code { font-size: 28px; font-weight: 800; }
      .header-badges { display: flex; gap: 8px; flex-wrap: wrap; }
      .header-badge { font-size: 13px; padding: 3px 8px; border-radius: 4px; background: #f0f0f0; }
      .party-badge-republican, .party-badge-rep { background: rgba(232,27,35,0.12); color: #E81B23; }
      .party-badge-democrat, .party-badge-dem { background: rgba(0,174,243,0.12); color: #0088CC; }
      .party-badge-moderate, .party-badge-mod { background: rgba(128,0,128,0.12); color: #800080; }
      .trend-badge-dem { color: #0088CC; }
      .trend-badge-rep { color: #E81B23; }
      .one-pager-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
      .one-pager-stat { text-align: center; padding: 12px 8px; background: #f7f7f7; border-radius: 6px; }
      .stat-value { font-size: 20px; font-weight: 700; }
      .stat-label { font-size: 13px; color: #717171; }
      .one-pager-bar { margin-bottom: 16px; }
      .one-pager-bar-label { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
      .one-pager-bar-container { height: 24px; border-radius: 6px; overflow: hidden; display: flex; width: 100%; }
      .one-pager-bar-segment { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; color: white; min-width: 20px; }
      .one-pager-elections { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
      .one-pager-elections th { text-align: left; padding: 6px 8px; border-bottom: 2px solid #222; font-size: 13px; text-transform: uppercase; }
      .one-pager-elections td { padding: 6px 8px; border-bottom: 1px solid #ddd; }
      .one-pager-districts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
      .one-pager-district { padding: 8px; background: #f7f7f7; border-radius: 6px; font-size: 13px; }
      .district-type { font-weight: 600; font-size: 13px; color: #717171; }
      .district-value { font-size: 14px; font-weight: 600; }
      .one-pager-footer { text-align: center; font-size: 13px; color: #999; padding-top: 12px; border-top: 1px solid #ddd; }
      .one-pager-actions { display: none !important; }
      @page { margin: 0.5in; size: letter portrait; }
    </style>`;

  let doc = `<!DOCTYPE html><html><head><title>Precinct ${esc(String(precinctCode))} - Field Brief</title>${printStyles}</head><body>${html}</body></html>`;

  if (printWindow) {
    printWindow.document.write(doc);
    printWindow.document.close();
    printWindow.addEventListener("load", function onLoad() {
      printWindow.print();
    });
    return;
  }

  // Pop-up blocked: print via a hidden iframe instead.
  let frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  frame.srcdoc = doc;
  frame.addEventListener("load", function onFrameLoad() {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } finally {
      // Leave time for the print dialog to grab the document before cleanup.
      setTimeout(() => frame.remove(), 60000);
    }
  });
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/**
 * Copy plain text to clipboard.
 * @returns {Promise<boolean>}
 */
export async function copyOnePagerToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    try {
      let textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(str) {
  if (typeof document !== "undefined") {
    let div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return "N/A";
  return Number(n).toLocaleString("en-US");
}

function fmtCurrency(n) {
  if (n == null || isNaN(n)) return "N/A";
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(1) + "M";
  if (n >= 10000) return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return "$" + Number(n).toLocaleString("en-US");
}

function extractYear(filename) {
  if (!filename) return 0;
  let m = filename.match(/(\d{4})/);
  return m ? Number(m[1]) : 0;
}

function padRight(str, len) {
  str = String(str);
  while (str.length < len) str += " ";
  return str;
}
