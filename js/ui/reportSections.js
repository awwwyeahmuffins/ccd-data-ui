// ui/reportSections.js — precinct-report HTML renderers (REDESIGN.md §4.1, Phase 2).
// --------------------------------------------------------------------------------
// The view half of the precinct.html report, split out of precinctProfile.js and
// precinctHistory.js. Every export here returns an HTML string built from data
// passed in as arguments — no fetch, no document, no dataLoader.
//
// imports: lib/ + domain/ only (enforced by eslint no-restricted-imports).
// Impure inputs are threaded in by callers:
//   - generateProfileHTML takes the active boundary as a parameter (the old
//     module read getActiveBoundary() itself; its shim still does).
//   - generateVotingHistoryHTML takes the calculateTurnout function as a
//     parameter (that computation still lives in precinctHistory.js until its
//     Phase-3 move to domain/history.js; the shim binds it).

import { escapeHtml } from "../lib/dom.js";
import {
  formatCurrency,
  formatPctCompact as formatPct,
  formatNumberOrNA as formatNum,
  populationOf,
} from "../lib/format.js";
import { CATEGORY_ORDER } from "../domain/races.js";

// ---------------------------------------------------------------------------
// Bar rendering helpers
// ---------------------------------------------------------------------------

export function stackedBar(segments, colors) {
  let html = '<div class="profile-bar">';
  for (const [i, seg] of segments.entries()) {
    const pct = (seg.value * 100).toFixed(1);
    const w = pct + "%";
    html += `<div class="profile-bar-segment" style="width:${w};background:${colors[i]}" title="${escapeHtml(seg.label)}: ${pct}%"></div>`;
  }
  html += "</div>";
  html += '<div class="profile-bar-legend">';
  for (const [i, seg] of segments.entries()) {
    html += `<span><span class="legend-dot" style="background:${colors[i]}"></span>${escapeHtml(seg.label)}</span>`;
  }
  html += "</div>";
  return html;
}

export function barsList(items, color) {
  let html = '<div class="profile-bars-list">';
  for (const item of items) {
    const pct = (item.value * 100).toFixed(1);
    html += `<div class="profile-bar-item"><span class="bar-label">${escapeHtml(item.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div><span class="bar-value">${pct}%</span></div>`;
  }
  html += "</div>";
  return html;
}

// ---------------------------------------------------------------------------
// Takeaway generation helper
// ---------------------------------------------------------------------------

export function generateTakeaways(p) {
  let items = [];

  const ownerPct = p.housing?.ownerOccupied;
  const medHome = p.housing?.medianHomeValue;
  if (ownerPct != null && medHome != null) {
    items.push({ icon: "\u{1F3E0}", text: `${formatPct(ownerPct)} homeowners, median home ${formatCurrency(medHome)}` });
  }

  const bachelors = p.education?.bachelors || 0;
  const grad = p.education?.graduateProfessional || 0;
  const collegePct = bachelors + grad;
  if (collegePct > 0) {
    items.push({ icon: "\u{1F393}", text: `${formatPct(collegePct)} college educated` });
  }

  const medIncome = p.income?.medianHousehold;
  if (medIncome != null) {
    items.push({ icon: "\u{1F4B0}", text: `Median income ${formatCurrency(medIncome)}` });
  }

  const englishOnly = p.language?.englishOnly;
  if (englishOnly != null) {
    const nonEnglish = 1 - englishOnly;
    items.push({ icon: "\u{1F5E3}\uFE0F", text: `${formatPct(nonEnglish)} non-English speakers` });
  }

  if (p.households?.total > 0 && p.households?.familyHouseholds != null) {
    const famPct = p.households.familyHouseholds / p.households.total;
    items.push({ icon: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}", text: `${formatPct(famPct)} family households` });
  }

  const topOcc = p.employment?.topOccupations?.[0];
  if (topOcc) {
    items.push({ icon: "\u{1F4BC}", text: `Top job: ${topOcc.name}` });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Collapsible section wrapper helper
// ---------------------------------------------------------------------------

function collapsibleSection(title, content, expanded = true) {
  let ariaState = expanded ? "true" : "false";
  let bodyClass = expanded ? "census-collapsible" : "census-collapsible collapsed";
  let html = '<div class="profile-section">';
  html += `<button class="census-toggle-btn" aria-expanded="${ariaState}">`;
  html += `<h4 class="profile-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">${title}</h4>`;
  html += '<span class="toggle-chevron">&#9660;</span>';
  html += '</button>';
  html += `<div class="${bodyClass}" style="margin-top:10px">`;
  html += content;
  html += '</div></div>';
  return html;
}

// ---------------------------------------------------------------------------
// Profile section renderers
// ---------------------------------------------------------------------------

function renderTakeaways(p) {
  let items = generateTakeaways(p);
  if (items.length === 0) return "";

  let content = '<div class="takeaway-grid">';
  for (const item of items) {
    content += `<div class="takeaway-item"><span class="takeaway-icon">${item.icon}</span><span>${escapeHtml(item.text)}</span></div>`;
  }
  content += "</div>";

  let html = '<div class="profile-section profile-takeaways">';
  html += '<h4 class="profile-section-title">At a Glance</h4>';
  html += content;
  html += "</div>";
  return html;
}

export function renderPartyRegistration(partyData) {
  if (!partyData) return "";

  let html = '<div class="profile-section">';
  html += '<h4 class="profile-section-title">Party Registration</h4>';

  html += '<div class="profile-stats-row">';
  html += `<div class="profile-stat" style="border-left:3px solid #E81B23"><span class="profile-stat-value">${escapeHtml(formatNum(partyData.rep))}</span><span class="profile-stat-label">Republican</span></div>`;
  html += `<div class="profile-stat" style="border-left:3px solid #800080"><span class="profile-stat-value">${escapeHtml(formatNum(partyData.mod))}</span><span class="profile-stat-label">Moderate</span></div>`;
  html += `<div class="profile-stat" style="border-left:3px solid #00AEF3"><span class="profile-stat-value">${escapeHtml(formatNum(partyData.dem))}</span><span class="profile-stat-label">Democrat</span></div>`;
  html += "</div>";

  let total = (partyData.rep || 0) + (partyData.mod || 0) + (partyData.dem || 0);
  if (total > 0) {
    let segments = [
      { label: "Republican", value: (partyData.rep || 0) / total },
      { label: "Moderate", value: (partyData.mod || 0) / total },
      { label: "Democrat", value: (partyData.dem || 0) / total },
    ];
    html += stackedBar(segments, ["#E81B23", "#800080", "#00AEF3"]);
  }

  if (partyData.winningParty) {
    const strength = partyData.partyStrength != null ? partyData.partyStrength : "";
    const strengthLabel = strength ? ` (Strength ${escapeHtml(String(strength))}/3)` : "";
    html += `<div class="profile-party-badge">Leans ${escapeHtml(partyData.winningParty)}${strengthLabel}</div>`;
  }

  html += "</div>";
  return html;
}

export function renderRacialDemographics(racialData) {
  if (!racialData) return "";

  let racialColors = {
    white: "#9467bd",
    asian: "#1f77b4",
    hispanic: "#2ca02c",
    black: "#ff7f0e",
    others: "#d62728",
  };

  let html = '<div class="profile-section">';
  html += '<h4 class="profile-section-title">Racial Demographics</h4>';

  let total =
    (racialData.white || 0) +
    (racialData.asian || 0) +
    (racialData.hispanic || 0) +
    (racialData.black || 0) +
    (racialData.others || 0);

  if (total > 0) {
    let segments = [
      { label: "White", value: (racialData.white || 0) / total },
      { label: "Asian", value: (racialData.asian || 0) / total },
      { label: "Hispanic", value: (racialData.hispanic || 0) / total },
      { label: "Black", value: (racialData.black || 0) / total },
      { label: "Others", value: (racialData.others || 0) / total },
    ];
    let colors = [racialColors.white, racialColors.asian, racialColors.hispanic, racialColors.black, racialColors.others];
    html += stackedBar(segments, colors);
  }

  let items = [
    { label: `White (${escapeHtml(formatNum(racialData.white))})`, value: racialData.pct_white || 0, color: racialColors.white },
    { label: `Asian (${escapeHtml(formatNum(racialData.asian))})`, value: racialData.pct_asian || 0, color: racialColors.asian },
    { label: `Hispanic (${escapeHtml(formatNum(racialData.hispanic))})`, value: racialData.pct_hispanic || 0, color: racialColors.hispanic },
    { label: `Black (${escapeHtml(formatNum(racialData.black))})`, value: racialData.pct_black || 0, color: racialColors.black },
    { label: `Others (${escapeHtml(formatNum(racialData.others))})`, value: racialData.pct_others || 0, color: racialColors.others },
  ];

  html += '<div class="profile-bars-list">';
  for (let item of items) {
    let pct = (item.value * 100).toFixed(1);
    html += `<div class="profile-bar-item"><span class="bar-label">${item.label}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${item.color}"></div></div><span class="bar-value">${pct}%</span></div>`;
  }
  html += "</div>";

  html += "</div>";
  return html;
}

export function renderElectionResults(electionData) {
  if (!electionData) return "";

  let html = '<div class="profile-section">';
  html += `<h4 class="profile-section-title">Election: ${escapeHtml(electionData.electionName || "")}</h4>`;
  html += '<div class="profile-stats-row">';
  for (const c of (electionData.candidates || [])) {
    const partyLabel = c.party ? ` (${escapeHtml(c.party)})` : "";
    html += `<div class="profile-stat"><span class="profile-stat-value">${escapeHtml(formatNum(c.votes))}</span><span class="profile-stat-label">${escapeHtml(c.name)}${partyLabel}</span></div>`;
  }
  html += "</div>";

  if (electionData.winner) {
    const marginText = electionData.margin != null ? ` · Margin: ${electionData.margin > 0 ? "+" : ""}${escapeHtml(formatNum(electionData.margin))}` : "";
    html += `<div class="profile-election-result">Winner: ${escapeHtml(electionData.winner)}${marginText}</div>`;
  }

  html += "</div>";
  return html;
}

export function renderOfficials(officials) {
  if (!officials) return "";

  let districtRows = [];

  if (officials.CONG != null) {
    const name = officials.CONG_N ? ` — ${escapeHtml(String(officials.CONG_N))}` : "";
    districtRows.push({ label: "US Congress", value: `District ${escapeHtml(String(officials.CONG))}${name}` });
  }
  if (officials.SEN != null) {
    const name = officials.SEN_N ? ` — ${escapeHtml(String(officials.SEN_N))}` : "";
    districtRows.push({ label: "TX Senate", value: `District ${escapeHtml(String(officials.SEN))}${name}` });
  }
  if (officials.SHR != null) {
    const name = officials.SHR_N ? ` — ${escapeHtml(String(officials.SHR_N))}` : "";
    districtRows.push({ label: "TX House", value: `District ${escapeHtml(String(officials.SHR))}${name}` });
  }
  if (officials.SED != null) {
    const name = officials.SED_N ? ` — ${escapeHtml(String(officials.SED_N))}` : "";
    districtRows.push({ label: "State Board of Ed", value: `District ${escapeHtml(String(officials.SED))}${name}` });
  }
  if (officials.COMMISH != null) {
    const name = officials.COMMISH_N ? ` — ${escapeHtml(String(officials.COMMISH_N))}` : "";
    districtRows.push({ label: "Commissioner", value: `Precinct ${escapeHtml(String(officials.COMMISH))}${name}` });
  }
  if (officials.JP_N != null) {
    districtRows.push({ label: "Justice of Peace", value: escapeHtml(String(officials.JP_N)) });
  }
  if (officials.CONST_N != null) {
    districtRows.push({ label: "Constable", value: escapeHtml(String(officials.CONST_N)) });
  }

  if (districtRows.length === 0) return "";

  let html = '<div class="profile-section">';
  html += '<h4 class="profile-section-title">Districts &amp; Officials</h4>';
  html += '<div class="profile-officials-grid">';
  for (const row of districtRows) {
    html += `<div class="official-item"><span class="official-label">${escapeHtml(row.label)}</span><span class="official-value">${row.value}</span></div>`;
  }
  html += "</div></div>";
  return html;
}

// ---------------------------------------------------------------------------
// Boundary changes renderer (2026 view only)
// ---------------------------------------------------------------------------

export function renderBoundaryChanges(metadata) {
  if (!metadata) return "";

  const type = metadata.interpolationType;
  const sources = metadata.sources || [];

  let badgeColor, badgeText;

  switch (type) {
    case "unchanged":
      badgeColor = "#145239";
      badgeText = `Unchanged from Precinct ${sources[0]?.old || "?"}`;
      break;
    case "split":
      badgeColor = "#FF9800";
      badgeText = `Split from Precinct ${sources[0]?.old || "?"}`;
      break;
    case "merged":
      badgeColor = "#2196F3";
      badgeText = `Merged from Precincts ${sources.map(s => s.old).join(", ")}`;
      break;
    case "new_boundary":
      badgeColor = "#FFC107";
      badgeText = "New boundary";
      break;
    case "sliver":
      badgeColor = "#9E9E9E";
      badgeText = "Sliver precinct";
      break;
    default:
      return "";
  }

  let html = '<div class="profile-section">';
  html += '<h4 class="profile-section-title">Boundary Changes</h4>';
  html += `<div style="display:inline-block;padding:4px 10px;border-radius:4px;background:${badgeColor};color:#fff;font-size:0.85em;font-weight:600;margin-bottom:8px">${escapeHtml(badgeText)}</div>`;

  if ((type === "split" || type === "merged") && sources.length > 0) {
    html += '<div class="profile-bars-list" style="margin-top:8px">';
    for (const src of sources) {
      const pct = (src.weight * 100).toFixed(1);
      html += `<div class="profile-bar-item">`;
      html += `<span class="bar-label">Precinct ${escapeHtml(String(src.old))}</span>`;
      html += `<div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${badgeColor}"></div></div>`;
      html += `<span class="bar-value">${pct}%</span>`;
      html += `</div>`;
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

// ---------------------------------------------------------------------------
// 2030 Projections renderer
// ---------------------------------------------------------------------------

function renderProjections(p) {
  const proj = p.projections;
  if (!proj) return "";

  const metrics = [
    { key: "population", label: "Population", fmt: formatNum },
    { key: "medianIncome", label: "Median Income", fmt: formatCurrency },
    { key: "medianHomeValue", label: "Home Value", fmt: formatCurrency },
    { key: "ownerOccupied", label: "Homeownership", fmt: formatPct },
    { key: "medianAge", label: "Median Age", fmt: (v) => v != null ? String(v) : "N/A" },
  ];

  let rows = "";
  for (const m of metrics) {
    const d = proj[m.key];
    if (!d) continue;

    const cur = m.fmt(d.current);
    const projected = m.fmt(d.projected);
    const cagr = d.cagr || 0;
    const arrow = cagr > 0 ? "↑" : cagr < 0 ? "↓" : "→";
    const arrowColor = cagr > 0 ? "#145239" : cagr < 0 ? "#A01218" : "#44505C";
    const changePct = (Math.abs(cagr) * 100).toFixed(1) + "%/yr";

    rows += `<div class="profile-bar-item" style="align-items:center">`;
    rows += `<span class="bar-label" style="min-width:120px">${escapeHtml(m.label)}</span>`;
    rows += `<span style="min-width:80px;text-align:right">${escapeHtml(cur)}</span>`;
    rows += `<span style="color:${arrowColor};font-weight:bold;padding:0 6px">${arrow}</span>`;
    rows += `<span style="min-width:80px">${escapeHtml(projected)}</span>`;
    rows += `<span style="color:${arrowColor};font-size:0.8em;margin-left:4px">${changePct}</span>`;
    rows += `</div>`;
  }

  if (!rows) return "";

  let content = '<div class="profile-bars-list">';
  content += rows;
  content += '</div>';
  content += '<div class="profile-disclaimer" style="margin-top:6px;font-size:0.75em;color:#888">';
  content += 'Rough estimate from the 5-year ACS trend (2018→2023). Growth rates are capped, so fast-changing precincts may outpace these numbers.';
  content += '</div>';

  return collapsibleSection(`${proj.targetYear} Projections`, content, false);
}

// ---------------------------------------------------------------------------
// Main profile HTML generation
// ---------------------------------------------------------------------------

/**
 * Generate the full census-profile panel HTML.
 * @param {Object} profile - Census profile record for the precinct
 * @param {string} precinctCode - Precinct code
 * @param {Object} extraData - { partyData, racialData, electionData, officials, boundaryMeta }
 * @param {string|null} boundary - Active boundary set ("2026" enables the
 *   boundary-changes section). Threaded in by the caller — ui/ never reads
 *   dataLoader state itself.
 * @returns {string} - HTML string
 */
export function generateProfileHTML(profile, precinctCode, extraData = {}, boundary = null) {
  const p = profile;
  const code = escapeHtml(precinctCode);

  // Header
  let html = `<div class="precinct-profile">`;
  html += `<div class="profile-header">`;
  html += `<h3>Precinct ${code} &mdash; Census Profile</h3>`;
  let popDensity = "";
  if (p.populationDensity != null) {
    popDensity = ` &middot; ${escapeHtml(formatNum(Math.round(p.populationDensity)))} per sq mi`;
  }
  // "Pop." = racial-data total (sitewide convention); other census fields below
  // remain census. Falls back to census.population only if no racial row exists.
  let popVal = populationOf(extraData.racialData, p);
  html += `<div class="profile-pop">Pop. ${escapeHtml(formatNum(popVal))} &middot; ${escapeHtml(formatNum(p.households?.total))} households${popDensity}</div>`;
  html += `</div>`;

  html += `<div class="profile-disclaimer">`;
  html += `Census data from ACS 2019&ndash;2023 5-year estimates, aggregated from block groups.`;
  html += `</div>`;

  // Key Takeaways (expanded by default)
  html += renderTakeaways(p);

  // Party Registration
  html += renderPartyRegistration(extraData.partyData);

  // Racial Demographics
  html += renderRacialDemographics(extraData.racialData);

  // Current Election Results
  html += renderElectionResults(extraData.electionData);

  // Elected Officials / Districts
  html += renderOfficials(extraData.officials);

  // Boundary Changes (2026 view only)
  if (boundary === "2026" && extraData.boundaryMeta) {
    html += renderBoundaryChanges(extraData.boundaryMeta);
  }

  // Age & Gender (expanded by default)
  let ageContent = '';
  ageContent += `<div class="profile-stats-row">`;
  ageContent += statBox(p.age?.medianAge, "Median Age");
  ageContent += statBox(formatPct(p.gender?.male), "Male");
  ageContent += statBox(formatPct(p.gender?.female), "Female");
  ageContent += `</div>`;

  // Gender split bar
  if (p.gender?.male != null && p.gender?.female != null) {
    let genderSegs = [
      { label: "Male", value: p.gender.male },
      { label: "Female", value: p.gender.female },
    ];
    ageContent += stackedBar(genderSegs, ["#42A5F5", "#EF5350"]);
  }

  let ageBrackets = [
    { label: "Under 18", value: p.age?.under18 || 0 },
    { label: "18-34", value: p.age?.["18to34"] || 0 },
    { label: "35-54", value: p.age?.["35to54"] || 0 },
    { label: "55-64", value: p.age?.["55to64"] || 0 },
    { label: "65+", value: p.age?.["65plus"] || 0 },
  ];
  let ageColors = ["#4FC3F7", "#29B6F6", "#0288D1", "#01579B", "#002f6c"];
  ageContent += stackedBar(ageBrackets, ageColors);
  html += collapsibleSection("Age &amp; Gender", ageContent, true);

  // Income (expanded by default)
  let incomeContent = '';
  incomeContent += `<div class="profile-stats-row">`;
  incomeContent += statBox(formatCurrency(p.income?.medianHousehold), "Median HHI");
  incomeContent += statBox(formatPct(p.income?.povertyRate), "Poverty Rate");
  incomeContent += `</div>`;

  let incomeBrackets = [
    { label: "Under $50K", value: p.income?.brackets?.under50k || 0 },
    { label: "$50K-$100K", value: p.income?.brackets?.["50kTo100k"] || 0 },
    { label: "$100K-$150K", value: p.income?.brackets?.["100kTo150k"] || 0 },
    { label: "$150K-$200K", value: p.income?.brackets?.["150kTo200k"] || 0 },
    { label: "$200K+", value: p.income?.brackets?.over200k || 0 },
  ];
  incomeContent += barsList(incomeBrackets, "#4CAF50");
  html += collapsibleSection("Income", incomeContent, true);

  // Education (expanded by default)
  let eduContent = '';
  let eduBrackets = [
    { label: "HS or Less", value: p.education?.highSchoolOrLess || 0 },
    { label: "Some College", value: p.education?.someCollege || 0 },
    { label: "Bachelor's", value: p.education?.bachelors || 0 },
    { label: "Graduate+", value: p.education?.graduateProfessional || 0 },
  ];
  eduContent += barsList(eduBrackets, "#2196F3");
  html += collapsibleSection("Education", eduContent, true);

  // Top Occupations (collapsed by default)
  let occContent = '';
  // Labor force participation + unemployment
  if (p.employment?.laborForceParticipation != null || p.employment?.unemploymentRate != null) {
    occContent += '<div class="profile-stats-row">';
    if (p.employment?.laborForceParticipation != null) {
      occContent += statBox(formatPct(p.employment.laborForceParticipation), "Labor Force");
    }
    if (p.employment?.unemploymentRate != null) {
      occContent += statBox(formatPct(p.employment.unemploymentRate), "Unemployment");
    }
    occContent += '</div>';
  }
  let occupations = (p.employment?.topOccupations || []).map((o) => ({
    label: o.name,
    value: o.share,
  }));
  occContent += barsList(occupations, "#FF9800");
  html += collapsibleSection("Top Occupations", occContent, false);

  // Top Industries (collapsed by default)
  let indContent = '';
  let industries = (p.employment?.topIndustries || []).map((o) => ({
    label: o.name,
    value: o.share,
  }));
  indContent += barsList(industries, "#FF9800");
  html += collapsibleSection("Top Industries", indContent, false);

  // Housing (collapsed by default)
  let housingContent = '';
  housingContent += `<div class="profile-stats-row">`;
  housingContent += statBox(formatCurrency(p.housing?.medianHomeValue), "Median Home Value");
  housingContent += statBox(formatCurrency(p.housing?.medianRent), "Median Rent");
  housingContent += statBox(formatPct(p.housing?.ownerOccupied), "Homeowners");
  housingContent += `</div>`;
  html += collapsibleSection("Housing", housingContent, false);

  // Households (collapsed by default)
  let hhContent = '';
  hhContent += `<div class="profile-stats-row">`;
  hhContent += statBox(p.households?.averageSize, "Avg Size");
  const familyPct =
    p.households?.total > 0
      ? formatPct(p.households.familyHouseholds / p.households.total)
      : "N/A";
  const marriedPct =
    p.households?.total > 0
      ? formatPct(p.households.marriedCouples / p.households.total)
      : "N/A";
  hhContent += statBox(familyPct, "Families");
  hhContent += statBox(marriedPct, "Married");
  hhContent += `</div>`;
  // Single-parent + non-family households
  if (p.households?.total > 0) {
    let extraStats = '<div class="profile-stats-row">';
    if (p.households?.singleParent != null) {
      let spPct = formatPct(p.households.singleParent / p.households.total);
      extraStats += statBox(spPct, "Single Parent");
    }
    if (p.households?.nonFamily != null) {
      let nfPct = formatPct(p.households.nonFamily / p.households.total);
      extraStats += statBox(nfPct, "Non-Family");
    }
    extraStats += '</div>';
    if (p.households?.singleParent != null || p.households?.nonFamily != null) {
      hhContent += extraStats;
    }
  }
  html += collapsibleSection("Households", hhContent, false);

  // Commute (collapsed by default)
  let commuteContent = '';
  commuteContent += `<div class="profile-stats-row">`;
  commuteContent += statBox(
    p.commute?.meanCommuteMinutes != null
      ? escapeHtml(p.commute.meanCommuteMinutes.toFixed(1)) + " min"
      : "N/A",
    "Avg Commute"
  );
  commuteContent += statBox(formatPct(p.commute?.workedFromHome), "Work From Home");
  commuteContent += `</div>`;
  html += collapsibleSection("Commute", commuteContent, false);

  // Language (collapsed by default)
  let langContent = '';
  let langs = [
    { label: "English Only", value: p.language?.englishOnly || 0 },
    { label: "Spanish", value: p.language?.spanish || 0 },
    { label: "Asian Languages", value: p.language?.asianLanguages || 0 },
    { label: "Other", value: p.language?.other || 0 },
  ];
  let langColors = ["#5C6BC0", "#AB47BC", "#26A69A", "#BDBDBD"];
  langContent += stackedBar(langs, langColors);
  html += collapsibleSection("Language", langContent, false);

  // Other (collapsed by default)
  let otherContent = '';
  otherContent += `<div class="profile-stats-row">`;
  otherContent += statBox(formatPct(p.veterans?.share), "Veterans");
  otherContent += statBox(formatPct(p.insurance?.insured), "Insured");
  otherContent += `</div>`;
  html += collapsibleSection("Other", otherContent, false);

  // 2030 Projections (collapsed by default)
  html += renderProjections(p);

  html += `</div>`; // close .precinct-profile
  return html;
}

// ---------------------------------------------------------------------------
// Trend arrow badge
// ---------------------------------------------------------------------------

export function renderTrendArrow(trendData) {
  if (!trendData) return '';
  let { direction, delta, raceName, year1, year2 } = trendData;
  let absDelta = Math.abs(delta).toFixed(1);
  let icon, label, cls;

  if (direction === 'dem') {
    icon = '↑';
    label = `+${absDelta}% toward Dem`;
    cls = 'dem';
  } else if (direction === 'rep') {
    icon = '↓';
    label = `-${absDelta}% toward Rep`;
    cls = 'rep';
  } else {
    icon = '—';
    label = 'Stable';
    cls = 'stable';
  }

  let period = (year1 && year2) ? ` (${escapeHtml(String(raceName))} ${year1}→${year2})` : '';
  return `<span class="trend-arrow-badge ${cls}"><span class="trend-arrow-icon">${icon}</span>${escapeHtml(label)}${period}</span>`;
}

// ---------------------------------------------------------------------------
// Stat box helper
// ---------------------------------------------------------------------------

export function statBox(value, label) {
  const v = value != null ? escapeHtml(String(value)) : "N/A";
  const l = escapeHtml(label);
  return `<div class="profile-stat"><span class="profile-stat-value">${v}</span><span class="profile-stat-label">${l}</span></div>`;
}

// ---------------------------------------------------------------------------
// Voting-history + comparison renderers (from precinctHistory.js)
// ---------------------------------------------------------------------------

/**
 * Generate HTML for voting history display
 * @param {Object} history - Voting history object from buildVotingHistory
 * @param {Function} calcTurnout - (ballotsCast, registeredVoters) => 0-100
 *   turnout pct. The computation lives in precinctHistory.js (future
 *   domain/history.js); ui/ receives it as an argument.
 * @returns {string} - HTML string
 */
export function generateVotingHistoryHTML(history, calcTurnout) {
  if (!history || !history.races || history.races.length === 0) {
    return '<p class="empty-state">No voting history available for this precinct.</p>';
  }

  let html = '<div class="voting-history">';

  // Party record summary
  html += '<div class="party-record">';
  html += `<span class="party-win rep" title="Republican wins">Rep: ${history.partyRecord.Rep}</span>`;
  html += `<span class="party-win dem" title="Democrat wins">Dem: ${history.partyRecord.Dem}</span>`;
  html += `<span class="party-win other" title="Other party wins">Other: ${history.partyRecord.Other}</span>`;
  // Ties are counted separately (an exact tie is nobody's win) but must still be
  // SHOWN, or the record silently drops races and Rep+Dem+Other stops summing to
  // the number of races listed below it. Hidden only when there are none, so the
  // common precinct is unchanged.
  if (history.partyRecord.Tied > 0) {
    html += `<span class="party-win other" title="Races that ended in an exact tie">Tied: ${history.partyRecord.Tied}</span>`;
  }
  html += '</div>';

  // Grouped by category
  for (const category of CATEGORY_ORDER) {
    const races = history.byCategory[category];
    if (!races || races.length === 0) continue;

    html += `<div class="history-category">`;
    html += `<h5 class="category-header">${category} <span class="race-count">(${races.length})</span></h5>`;
    html += '<ul class="race-list">';

    for (const race of races) {
      const partyClass = (race.winningParty || '').toLowerCase();
      const turnout = calcTurnout(race.totalVotes, race.registeredVoters);
      html += `<li class="race-item ${partyClass}">`;
      html += `<span class="race-name">${race.raceName}</span>`;
      html += `<span class="race-winner">${race.winner}</span>`;
      html += `<span class="race-turnout">${turnout.toFixed(1)}% turnout</span>`;
      html += '</li>';
    }

    html += '</ul></div>';
  }

  html += '</div>';
  return html;
}

/**
 * Generate HTML for precinct comparison display
 * @param {Object} demographics - Demographics comparison from compareDemographics
 * @param {Object} electionComparison - Election comparison from comparePrecincts (optional)
 * @param {string} raceName - Name of the race being compared (optional)
 * @returns {string} - HTML string
 */
export function generateComparisonHTML(demographics, electionComparison, raceName) {
  if (!demographics) {
    return '<p class="error-state">Unable to compare precincts.</p>';
  }

  let html = '<div class="comparison-panel">';
  html += `<h4 class="comparison-title">Comparing Precincts ${demographics.precinct1.code} vs ${demographics.precinct2.code}</h4>`;

  // Demographics comparison table
  html += '<div class="comparison-section demographics">';
  html += '<h5>Demographics</h5>';
  html += '<table class="comparison-table">';
  html += `<thead><tr><th>Metric</th><th>Pct ${demographics.precinct1.code}</th><th>Pct ${demographics.precinct2.code}</th><th>Diff</th></tr></thead>`;
  html += '<tbody>';
  html += `<tr class="rep"><td>Rep Share</td><td>${(demographics.precinct1.repShare * 100).toFixed(1)}%</td><td>${(demographics.precinct2.repShare * 100).toFixed(1)}%</td><td>${(demographics.differences.repShare * 100).toFixed(1)}%</td></tr>`;
  html += `<tr class="mod"><td>Mod Share</td><td>${(demographics.precinct1.modShare * 100).toFixed(1)}%</td><td>${(demographics.precinct2.modShare * 100).toFixed(1)}%</td><td>${(demographics.differences.modShare * 100).toFixed(1)}%</td></tr>`;
  html += `<tr class="dem"><td>Dem Share</td><td>${(demographics.precinct1.demShare * 100).toFixed(1)}%</td><td>${(demographics.precinct2.demShare * 100).toFixed(1)}%</td><td>${(demographics.differences.demShare * 100).toFixed(1)}%</td></tr>`;
  html += `<tr><td>Party Lean</td><td>${demographics.precinct1.winningParty}</td><td>${demographics.precinct2.winningParty}</td><td>-</td></tr>`;
  html += `<tr><td>Strength</td><td>${demographics.precinct1.partyStrength}/3</td><td>${demographics.precinct2.partyStrength}/3</td><td>-</td></tr>`;
  html += '</tbody></table>';
  html += '</div>';

  // Election comparison (if provided)
  if (electionComparison && raceName) {
    html += '<div class="comparison-section election">';
    html += `<h5>Election: ${raceName}</h5>`;

    if (electionComparison.bothParticipated) {
      const p1 = electionComparison.precinct1;
      const p2 = electionComparison.precinct2;
      html += '<table class="comparison-table">';
      html += `<thead><tr><th>Precinct</th><th>Winner</th><th>Total Votes</th></tr></thead>`;
      html += '<tbody>';
      html += `<tr><td>${p1.code}</td><td>${p1.result.winner}</td><td>${p1.result.totalVotes.toLocaleString()}</td></tr>`;
      html += `<tr><td>${p2.code}</td><td>${p2.result.winner}</td><td>${p2.result.totalVotes.toLocaleString()}</td></tr>`;
      html += '</tbody></table>';
      html += `<p class="same-winner-indicator ${electionComparison.sameWinner ? 'same' : 'different'}">`;
      html += electionComparison.sameWinner ? '✓ Same winner in both precincts' : '✗ Different winners';
      html += '</p>';
    } else {
      html += '<p class="no-participation">One or both precincts did not participate in this race.</p>';
    }

    html += '</div>';
  }

  html += '</div>';
  return html;
}
