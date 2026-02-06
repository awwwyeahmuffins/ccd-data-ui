// precinctProfile.js
// --------------------------------------------------------------------------------
// Census profile panel UI — renders detailed demographic/economic data for a precinct.

let cachedProfiles = null;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

function formatCurrency(n) {
  if (n == null || isNaN(n)) return "N/A";
  if (n >= 1000000) {
    return "$" + (n / 1000000).toFixed(1) + "M";
  }
  if (n >= 10000) {
    return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return "$" + n.toLocaleString("en-US");
}

function formatPct(n) {
  if (n == null || isNaN(n)) return "N/A";
  return (n * 100).toFixed(1).replace(/\.0$/, "") + "%";
}

function formatNum(n) {
  if (n == null || isNaN(n)) return "N/A";
  return Number(n).toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

export async function loadCensusProfiles() {
  if (cachedProfiles) return cachedProfiles;
  const resp = await fetch("data/precinct_census_profiles.json");
  if (!resp.ok) throw new Error(`Failed to load census profiles: ${resp.status}`);
  cachedProfiles = await resp.json();
  return cachedProfiles;
}

// ---------------------------------------------------------------------------
// Render into container
// ---------------------------------------------------------------------------

export async function renderPrecinctProfile(precinctCode, container, extraData = {}) {
  const profiles = await loadCensusProfiles();
  const profile = profiles[String(precinctCode)];
  if (!profile) {
    container.innerHTML = `<div class="precinct-profile"><p>No census data for precinct ${escapeHtml(precinctCode)}.</p></div>`;
    return;
  }
  container.innerHTML = generateProfileHTML(profile, String(precinctCode), extraData);
}

// ---------------------------------------------------------------------------
// Bar rendering helpers
// ---------------------------------------------------------------------------

function stackedBar(segments, colors) {
  let html = '<div class="profile-bar">';
  segments.forEach((seg, i) => {
    const pct = (seg.value * 100).toFixed(1);
    const w = pct + "%";
    html += `<div class="profile-bar-segment" style="width:${w};background:${colors[i]}" title="${escapeHtml(seg.label)}: ${pct}%"></div>`;
  });
  html += "</div>";
  html += '<div class="profile-bar-legend">';
  segments.forEach((seg, i) => {
    html += `<span><span class="legend-dot" style="background:${colors[i]}"></span>${escapeHtml(seg.label)}</span>`;
  });
  html += "</div>";
  return html;
}

function barsList(items, color) {
  let html = '<div class="profile-bars-list">';
  items.forEach((item) => {
    const pct = (item.value * 100).toFixed(1);
    html += `<div class="profile-bar-item"><span class="bar-label">${escapeHtml(item.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div><span class="bar-value">${pct}%</span></div>`;
  });
  html += "</div>";
  return html;
}

// ---------------------------------------------------------------------------
// Takeaway generation helper
// ---------------------------------------------------------------------------

function generateTakeaways(p) {
  const items = [];

  // Homeowners + median home value
  const ownerPct = p.housing?.ownerOccupied;
  const medHome = p.housing?.medianHomeValue;
  if (ownerPct != null && medHome != null) {
    items.push({ icon: "\u{1F3E0}", text: `${formatPct(ownerPct)} homeowners, median home ${formatCurrency(medHome)}` });
  }

  // College educated = bachelors + graduateProfessional
  const bachelors = p.education?.bachelors || 0;
  const grad = p.education?.graduateProfessional || 0;
  const collegePct = bachelors + grad;
  if (collegePct > 0) {
    items.push({ icon: "\u{1F393}", text: `${formatPct(collegePct)} college educated` });
  }

  // Median income
  const medIncome = p.income?.medianHousehold;
  if (medIncome != null) {
    items.push({ icon: "\u{1F4B0}", text: `Median income ${formatCurrency(medIncome)}` });
  }

  // Non-English speakers = 1 - englishOnly
  const englishOnly = p.language?.englishOnly;
  if (englishOnly != null) {
    const nonEnglish = 1 - englishOnly;
    items.push({ icon: "\u{1F5E3}\uFE0F", text: `${formatPct(nonEnglish)} non-English speakers` });
  }

  // Family households
  if (p.households?.total > 0 && p.households?.familyHouseholds != null) {
    const famPct = p.households.familyHouseholds / p.households.total;
    items.push({ icon: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}", text: `${formatPct(famPct)} family households` });
  }

  // Top occupation
  const topOcc = p.employment?.topOccupations?.[0];
  if (topOcc) {
    items.push({ icon: "\u{1F4BC}", text: `Top job: ${topOcc.name}` });
  }

  return items;
}

// ---------------------------------------------------------------------------
// New section renderers
// ---------------------------------------------------------------------------

function renderTakeaways(p) {
  const items = generateTakeaways(p);
  if (items.length === 0) return "";

  let html = '<div class="profile-section profile-takeaways">';
  html += '<h4 class="profile-section-title">At a Glance</h4>';
  html += '<div class="takeaway-grid">';
  items.forEach((item) => {
    html += `<div class="takeaway-item"><span class="takeaway-icon">${item.icon}</span><span>${escapeHtml(item.text)}</span></div>`;
  });
  html += "</div></div>";
  return html;
}

function renderPartyRegistration(partyData) {
  if (!partyData) return "";

  let html = '<div class="profile-section">';
  html += '<h4 class="profile-section-title">Party Registration</h4>';
  html += '<div class="profile-stats-row">';
  html += `<div class="profile-stat" style="border-left:3px solid #E81B23"><span class="profile-stat-value">${escapeHtml(formatNum(partyData.rep))}</span><span class="profile-stat-label">Republican</span></div>`;
  html += `<div class="profile-stat" style="border-left:3px solid #800080"><span class="profile-stat-value">${escapeHtml(formatNum(partyData.mod))}</span><span class="profile-stat-label">Moderate</span></div>`;
  html += `<div class="profile-stat" style="border-left:3px solid #00AEF3"><span class="profile-stat-value">${escapeHtml(formatNum(partyData.dem))}</span><span class="profile-stat-label">Democrat</span></div>`;
  html += "</div>";

  // Stacked bar of shares
  const segments = [
    { label: "Republican", value: partyData.repShare || 0 },
    { label: "Moderate", value: partyData.modShare || 0 },
    { label: "Democrat", value: partyData.demShare || 0 },
  ];
  const colors = ["#E81B23", "#800080", "#00AEF3"];
  html += stackedBar(segments, colors);

  // Winning party badge
  if (partyData.winningParty) {
    const strength = partyData.partyStrength != null ? partyData.partyStrength : "";
    const strengthLabel = strength ? ` (Strength ${escapeHtml(String(strength))}/3)` : "";
    html += `<div class="profile-party-badge">Leans ${escapeHtml(partyData.winningParty)}${strengthLabel}</div>`;
  }

  html += "</div>";
  return html;
}

function renderRacialDemographics(racialData) {
  if (!racialData) return "";

  const racialColors = {
    white: "#9467bd",
    asian: "#1f77b4",
    hispanic: "#2ca02c",
    black: "#ff7f0e",
    others: "#d62728",
  };

  let html = '<div class="profile-section">';
  html += '<h4 class="profile-section-title">Racial Demographics</h4>';

  // Stacked bar
  const segments = [
    { label: "White", value: racialData.pct_white || 0 },
    { label: "Asian", value: racialData.pct_asian || 0 },
    { label: "Hispanic", value: racialData.pct_hispanic || 0 },
    { label: "Black", value: racialData.pct_black || 0 },
    { label: "Others", value: racialData.pct_others || 0 },
  ];
  const colors = [racialColors.white, racialColors.asian, racialColors.hispanic, racialColors.black, racialColors.others];
  html += stackedBar(segments, colors);

  // Bar list with counts and percentages
  const items = [
    { label: `White (${escapeHtml(formatNum(racialData.white))})`, value: racialData.pct_white || 0 },
    { label: `Asian (${escapeHtml(formatNum(racialData.asian))})`, value: racialData.pct_asian || 0 },
    { label: `Hispanic (${escapeHtml(formatNum(racialData.hispanic))})`, value: racialData.pct_hispanic || 0 },
    { label: `Black (${escapeHtml(formatNum(racialData.black))})`, value: racialData.pct_black || 0 },
    { label: `Others (${escapeHtml(formatNum(racialData.others))})`, value: racialData.pct_others || 0 },
  ];

  html += '<div class="profile-bars-list">';
  items.forEach((item, i) => {
    const pct = (item.value * 100).toFixed(1);
    html += `<div class="profile-bar-item"><span class="bar-label">${item.label}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colors[i]}"></div></div><span class="bar-value">${pct}%</span></div>`;
  });
  html += "</div>";

  html += "</div>";
  return html;
}

function renderElectionResults(electionData) {
  if (!electionData) return "";

  let html = '<div class="profile-section">';
  html += `<h4 class="profile-section-title">Election: ${escapeHtml(electionData.electionName || "")}</h4>`;
  html += '<div class="profile-stats-row">';
  (electionData.candidates || []).forEach((c) => {
    const partyLabel = c.party ? ` (${escapeHtml(c.party)})` : "";
    html += `<div class="profile-stat"><span class="profile-stat-value">${escapeHtml(formatNum(c.votes))}</span><span class="profile-stat-label">${escapeHtml(c.name)}${partyLabel}</span></div>`;
  });
  html += "</div>";

  if (electionData.winner) {
    const marginText = electionData.margin != null ? ` \u00B7 Margin: ${electionData.margin > 0 ? "+" : ""}${escapeHtml(formatNum(electionData.margin))}` : "";
    html += `<div class="profile-election-result">Winner: ${escapeHtml(electionData.winner)}${marginText}</div>`;
  }

  html += "</div>";
  return html;
}

function renderOfficials(officials) {
  if (!officials) return "";

  const districtRows = [];

  if (officials.CONG != null) {
    const name = officials.CONG_N ? ` \u2014 ${escapeHtml(String(officials.CONG_N))}` : "";
    districtRows.push({ label: "US Congress", value: `District ${escapeHtml(String(officials.CONG))}${name}` });
  }
  if (officials.SEN != null) {
    const name = officials.SEN_N ? ` \u2014 ${escapeHtml(String(officials.SEN_N))}` : "";
    districtRows.push({ label: "TX Senate", value: `District ${escapeHtml(String(officials.SEN))}${name}` });
  }
  if (officials.SHR != null) {
    const name = officials.SHR_N ? ` \u2014 ${escapeHtml(String(officials.SHR_N))}` : "";
    districtRows.push({ label: "TX House", value: `District ${escapeHtml(String(officials.SHR))}${name}` });
  }
  if (officials.SED != null) {
    const name = officials.SED_N ? ` \u2014 ${escapeHtml(String(officials.SED_N))}` : "";
    districtRows.push({ label: "State Board of Ed", value: `District ${escapeHtml(String(officials.SED))}${name}` });
  }
  if (officials.COMMISH != null) {
    const name = officials.COMMISH_N ? ` \u2014 ${escapeHtml(String(officials.COMMISH_N))}` : "";
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
  districtRows.forEach((row) => {
    html += `<div class="official-item"><span class="official-label">${escapeHtml(row.label)}</span><span class="official-value">${row.value}</span></div>`;
  });
  html += "</div></div>";
  return html;
}

// ---------------------------------------------------------------------------
// Main HTML generation
// ---------------------------------------------------------------------------

export function generateProfileHTML(profile, precinctCode, extraData = {}) {
  const p = profile;
  const code = escapeHtml(precinctCode);

  // Header
  let html = `<div class="precinct-profile">`;
  html += `<div class="profile-header">`;
  html += `<h3>Precinct ${code} &mdash; Census Profile</h3>`;
  html += `<div class="profile-pop">Pop. ${escapeHtml(formatNum(p.population))} &middot; ${escapeHtml(formatNum(p.households?.total))} households</div>`;
  html += `</div>`;

  // Key Takeaways
  html += renderTakeaways(p);

  // Party Registration
  html += renderPartyRegistration(extraData.partyData);

  // Racial Demographics
  html += renderRacialDemographics(extraData.racialData);

  // Current Election Results
  html += renderElectionResults(extraData.electionData);

  // Elected Officials / Districts
  html += renderOfficials(extraData.officials);

  // Age & Gender
  html += `<div class="profile-section">`;
  html += `<h4 class="profile-section-title">Age &amp; Gender</h4>`;
  html += `<div class="profile-stats-row">`;
  html += statBox(p.age?.medianAge, "Median Age");
  html += statBox(formatPct(p.gender?.male), "Male");
  html += statBox(formatPct(p.gender?.female), "Female");
  html += `</div>`;

  const ageBrackets = [
    { label: "Under 18", value: p.age?.under18 || 0 },
    { label: "18-34", value: p.age?.["18to34"] || 0 },
    { label: "35-54", value: p.age?.["35to54"] || 0 },
    { label: "55-64", value: p.age?.["55to64"] || 0 },
    { label: "65+", value: p.age?.["65plus"] || 0 },
  ];
  const ageColors = ["#4FC3F7", "#29B6F6", "#0288D1", "#01579B", "#002f6c"];
  html += stackedBar(ageBrackets, ageColors);
  html += `</div>`;

  // Income
  html += `<div class="profile-section">`;
  html += `<h4 class="profile-section-title">Income</h4>`;
  html += `<div class="profile-stats-row">`;
  html += statBox(formatCurrency(p.income?.medianHousehold), "Median HHI");
  html += statBox(formatPct(p.income?.povertyRate), "Poverty Rate");
  html += `</div>`;

  const incomeBrackets = [
    { label: "Under $50K", value: p.income?.brackets?.under50k || 0 },
    { label: "$50-100K", value: p.income?.brackets?.["50kTo100k"] || 0 },
    { label: "$100-150K", value: p.income?.brackets?.["100kTo150k"] || 0 },
    { label: "$150-200K", value: p.income?.brackets?.["150kTo200k"] || 0 },
    { label: "Over $200K", value: p.income?.brackets?.over200k || 0 },
  ];
  html += barsList(incomeBrackets, "#4CAF50");
  html += `</div>`;

  // Education
  html += `<div class="profile-section">`;
  html += `<h4 class="profile-section-title">Education</h4>`;

  const eduBrackets = [
    { label: "High School or Less", value: p.education?.highSchoolOrLess || 0 },
    { label: "Some College", value: p.education?.someCollege || 0 },
    { label: "Bachelor's", value: p.education?.bachelors || 0 },
    { label: "Graduate/Professional", value: p.education?.graduateProfessional || 0 },
  ];
  html += barsList(eduBrackets, "#2196F3");
  html += `</div>`;

  // Top Occupations
  html += `<div class="profile-section">`;
  html += `<h4 class="profile-section-title">Top Occupations</h4>`;

  const occupations = (p.employment?.topOccupations || []).map((o) => ({
    label: o.name,
    value: o.share,
  }));
  html += barsList(occupations, "#FF9800");
  html += `</div>`;

  // Top Industries
  html += `<div class="profile-section">`;
  html += `<h4 class="profile-section-title">Top Industries</h4>`;

  const industries = (p.employment?.topIndustries || []).map((o) => ({
    label: o.name,
    value: o.share,
  }));
  html += barsList(industries, "#FF9800");
  html += `</div>`;

  // Housing
  html += `<div class="profile-section">`;
  html += `<h4 class="profile-section-title">Housing</h4>`;
  html += `<div class="profile-stats-row">`;
  html += statBox(formatCurrency(p.housing?.medianHomeValue), "Median Home Value");
  html += statBox(formatCurrency(p.housing?.medianRent), "Median Rent");
  html += statBox(formatPct(p.housing?.ownerOccupied), "Homeowners");
  html += `</div>`;
  html += `</div>`;

  // Households
  html += `<div class="profile-section">`;
  html += `<h4 class="profile-section-title">Households</h4>`;
  html += `<div class="profile-stats-row">`;
  html += statBox(p.households?.averageSize, "Avg Size");
  const familyPct =
    p.households?.total > 0
      ? formatPct(p.households.familyHouseholds / p.households.total)
      : "N/A";
  const marriedPct =
    p.households?.total > 0
      ? formatPct(p.households.marriedCouples / p.households.total)
      : "N/A";
  html += statBox(familyPct, "Families");
  html += statBox(marriedPct, "Married");
  html += `</div>`;
  html += `</div>`;

  // Commute
  html += `<div class="profile-section">`;
  html += `<h4 class="profile-section-title">Commute</h4>`;
  html += `<div class="profile-stats-row">`;
  html += statBox(
    p.commute?.meanCommuteMinutes != null
      ? escapeHtml(p.commute.meanCommuteMinutes.toFixed(1)) + " min"
      : "N/A",
    "Avg Commute"
  );
  html += statBox(formatPct(p.commute?.workedFromHome), "Work From Home");
  html += `</div>`;
  html += `</div>`;

  // Language
  html += `<div class="profile-section">`;
  html += `<h4 class="profile-section-title">Language</h4>`;

  const langs = [
    { label: "English Only", value: p.language?.englishOnly || 0 },
    { label: "Spanish", value: p.language?.spanish || 0 },
    { label: "Asian Languages", value: p.language?.asianLanguages || 0 },
    { label: "Other", value: p.language?.other || 0 },
  ];
  const langColors = ["#5C6BC0", "#AB47BC", "#26A69A", "#BDBDBD"];
  html += stackedBar(langs, langColors);
  html += `</div>`;

  // Other
  html += `<div class="profile-section">`;
  html += `<h4 class="profile-section-title">Other</h4>`;
  html += `<div class="profile-stats-row">`;
  html += statBox(formatPct(p.veterans?.share), "Veterans");
  html += statBox(formatPct(p.insurance?.insured), "Insured");
  html += `</div>`;
  html += `</div>`;

  html += `</div>`; // close .precinct-profile
  return html;
}

// ---------------------------------------------------------------------------
// Stat box helper
// ---------------------------------------------------------------------------

function statBox(value, label) {
  const v = value != null ? escapeHtml(String(value)) : "N/A";
  const l = escapeHtml(label);
  return `<div class="profile-stat"><span class="profile-stat-value">${v}</span><span class="profile-stat-label">${l}</span></div>`;
}
