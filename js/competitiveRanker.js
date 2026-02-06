// competitiveRanker.js
// --------------------------------------------------------------------------------
// Ranks precincts by competitiveness (smallest margin of victory) for a given
// election. Includes demographic context from census profiles and GeoJSON features.

import { PARTY_COLORS } from "./constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

function getRegisteredVoters(row) {
  return (
    Number(row["REGISTERED VOTERS TOTAL"]) ||
    Number(row["REGISTERED VOTERS - TOTAL"]) ||
    0
  );
}

function getBallotsCast(row) {
  return (
    Number(row["BALLOTS CAST TOTAL"]) ||
    Number(row["BALLOTS CAST - TOTAL"]) ||
    0
  );
}

function partyFromColumn(columnName) {
  if (!columnName) return "";
  return columnName.split(" ")[0] || "";
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return "N/A";
  return n.toFixed(1) + "%";
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return "N/A";
  return Number(n).toLocaleString("en-US");
}

function fmtCurrency(n) {
  if (n == null || isNaN(n)) return "N/A";
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(1) + "M";
  if (n >= 10000) return "$" + (n / 1000).toFixed(0) + "K";
  return "$" + Number(n).toLocaleString("en-US");
}

// Build a lookup from precinct code -> GeoJSON feature properties
function buildFeatureLookup(geojsonFeatures) {
  const lookup = {};
  if (!Array.isArray(geojsonFeatures)) return lookup;
  for (const feature of geojsonFeatures) {
    if (feature && feature.properties && feature.properties.PRECINCT != null) {
      lookup[String(feature.properties.PRECINCT)] = feature.properties;
    }
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Core ranking function
// ---------------------------------------------------------------------------

/**
 * Rank precincts by competitiveness (smallest margin of victory first).
 *
 * @param {Array} electionData - Array of CSV row objects
 * @param {Array} candidateColumns - Array of candidate column names
 * @param {Object} censusProfiles - Census profiles keyed by precinct code string
 * @param {Array} geojsonFeatures - Array of GeoJSON features
 * @returns {Array} Sorted array of precinct ranking objects
 */
export function rankCompetitivePrecincts(
  electionData,
  candidateColumns,
  censusProfiles,
  geojsonFeatures
) {
  if (!Array.isArray(electionData) || !Array.isArray(candidateColumns)) {
    return [];
  }
  if (candidateColumns.length < 2) return [];

  const featureLookup = buildFeatureLookup(geojsonFeatures);
  const profiles = censusProfiles || {};
  const results = [];

  for (const row of electionData) {
    const precinctCode = String(row["PRECINCT CODE"] || "").trim();
    if (!precinctCode) continue;

    // Tally candidate votes for this precinct
    const voteTallies = [];
    let totalCandidateVotes = 0;
    for (const col of candidateColumns) {
      const votes = Number(row[col]) || 0;
      totalCandidateVotes += votes;
      voteTallies.push({ name: col, votes });
    }

    // Skip non-participating precincts
    if (totalCandidateVotes === 0) continue;

    // Sort by votes descending
    voteTallies.sort((a, b) => b.votes - a.votes);

    const winner = voteTallies[0];
    const runnerUp = voteTallies[1] || { name: "", votes: 0 };

    const margin = winner.votes - runnerUp.votes;
    const marginPct =
      totalCandidateVotes > 0
        ? (margin / totalCandidateVotes) * 100
        : 0;

    const registeredVoters = getRegisteredVoters(row);
    const ballotsCast = getBallotsCast(row);
    const turnoutPct =
      registeredVoters > 0 ? (ballotsCast / registeredVoters) * 100 : 0;

    // Census data
    const profile = profiles[precinctCode];
    let population = null;
    let medianIncome = null;
    let collegePct = null;

    if (profile) {
      population = profile.population ?? null;
      medianIncome = profile.income?.medianHousehold ?? null;
      const bachelors = profile.education?.bachelors ?? 0;
      const grad = profile.education?.graduateProfessional ?? 0;
      collegePct = (bachelors + grad) * 100;
    }

    // GeoJSON feature properties
    const featureProps = featureLookup[precinctCode] || {};
    const hispanicPct =
      featureProps.pct_hispanic != null
        ? featureProps.pct_hispanic * 100
        : null;
    const partyLean = featureProps.winningParty || null;
    const partyStrength = featureProps.partyStrength || null;

    results.push({
      precinctCode,
      margin,
      marginPct: Math.round(marginPct * 10) / 10,
      winner: winner.name,
      runnerUp: runnerUp.name,
      winnerVotes: winner.votes,
      runnerUpVotes: runnerUp.votes,
      totalVotes: totalCandidateVotes,
      winnerParty: partyFromColumn(winner.name),
      registeredVoters,
      turnoutPct: Math.round(turnoutPct * 10) / 10,
      population,
      medianIncome,
      collegePct: collegePct != null ? Math.round(collegePct * 10) / 10 : null,
      hispanicPct: hispanicPct != null ? Math.round(hispanicPct * 10) / 10 : null,
      partyLean,
      partyStrength,
    });
  }

  // Sort by margin ascending (tightest races first)
  results.sort((a, b) => a.margin - b.margin);

  return results;
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

/**
 * Generate an HTML string rendering the ranked precincts as compact cards.
 *
 * @param {Array} rankedPrecincts - Output from rankCompetitivePrecincts
 * @param {number} limit - Max number of precincts to display (default 20)
 * @returns {string} HTML string
 */
export function generateRankerHTML(rankedPrecincts, limit = 20) {
  if (!Array.isArray(rankedPrecincts) || rankedPrecincts.length === 0) {
    return '<div class="ranker-empty">No competitive precinct data available.</div>';
  }

  const items = rankedPrecincts.slice(0, limit);

  let html = '<div class="ranker-container">';
  html += '<div class="ranker-header">Competitive Precinct Ranking</div>';

  items.forEach((p, i) => {
    const rank = i + 1;
    const winnerColor = PARTY_COLORS[p.winnerParty] || PARTY_COLORS.default;
    const leanColor = PARTY_COLORS[p.partyLean] || PARTY_COLORS.default;

    html += `<div class="ranker-card">`;

    // Rank + Precinct header
    html += `<div class="ranker-card-header">`;
    html += `<span class="ranker-rank">#${rank}</span>`;
    html += `<span class="ranker-precinct">Precinct ${escapeHtml(p.precinctCode)}</span>`;
    if (p.partyLean) {
      html += `<span class="ranker-lean-badge" style="background:${leanColor};color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;">`;
      html += `${escapeHtml(p.partyLean)}${p.partyStrength ? " (" + p.partyStrength + ")" : ""}`;
      html += `</span>`;
    }
    html += `</div>`;

    // Margin line
    html += `<div class="ranker-margin">`;
    html += `Margin: <strong>${fmtNum(p.margin)} votes</strong> (${fmtPct(p.marginPct)})`;
    html += `</div>`;

    // Winner / Runner-up
    html += `<div class="ranker-candidates">`;
    html += `<span class="ranker-winner" style="color:${winnerColor};font-weight:600;">`;
    html += `${escapeHtml(p.winner)}: ${fmtNum(p.winnerVotes)}</span>`;
    html += ` vs `;
    const runnerUpParty = partyFromColumn(p.runnerUp);
    const runnerUpColor = PARTY_COLORS[runnerUpParty] || PARTY_COLORS.default;
    html += `<span class="ranker-runnerup" style="color:${runnerUpColor};">`;
    html += `${escapeHtml(p.runnerUp)}: ${fmtNum(p.runnerUpVotes)}</span>`;
    html += `</div>`;

    // Demographics row
    html += `<div class="ranker-demographics">`;
    html += `<span>Pop: ${fmtNum(p.population)}</span>`;
    html += `<span>Income: ${fmtCurrency(p.medianIncome)}</span>`;
    html += `<span>College: ${fmtPct(p.collegePct)}</span>`;
    html += `</div>`;

    html += `</div>`; // .ranker-card
  });

  html += "</div>"; // .ranker-container
  return html;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/**
 * Generate a CSV string for export of ranked precincts.
 *
 * @param {Array} rankedPrecincts - Output from rankCompetitivePrecincts
 * @param {number} [limit] - Max rows (defaults to all)
 * @returns {string} CSV string
 */
export function generateRankerCSV(rankedPrecincts, limit) {
  if (!Array.isArray(rankedPrecincts) || rankedPrecincts.length === 0) {
    return "";
  }

  const items = limit ? rankedPrecincts.slice(0, limit) : rankedPrecincts;

  const headers = [
    "Rank",
    "Precinct",
    "Margin Votes",
    "Margin %",
    "Winner",
    "Runner-Up",
    "Winner Votes",
    "Runner-Up Votes",
    "Total Votes",
    "Registered Voters",
    "Turnout %",
    "Population",
    "Median Income",
    "College %",
    "Hispanic %",
    "Party Lean",
    "Party Strength",
  ];

  const csvEscape = (val) => {
    if (val == null) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const rows = [headers.join(",")];

  items.forEach((p, i) => {
    const row = [
      i + 1,
      p.precinctCode,
      p.margin,
      p.marginPct,
      p.winner,
      p.runnerUp,
      p.winnerVotes,
      p.runnerUpVotes,
      p.totalVotes,
      p.registeredVoters,
      p.turnoutPct,
      p.population ?? "",
      p.medianIncome ?? "",
      p.collegePct ?? "",
      p.hispanicPct ?? "",
      p.partyLean ?? "",
      p.partyStrength ?? "",
    ];
    rows.push(row.map(csvEscape).join(","));
  });

  return rows.join("\n");
}
