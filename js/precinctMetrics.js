// precinctMetrics.js
// --------------------------------------------------------------------------------
// Pure data layer for the precinct Explorer (explore.html). No DOM.
//
// Flattens everything the app knows about a precinct — modeled party universe
// (dnc_scores), racial composition (racial.csv), the full ACS census profile
// (census_profiles.json: age, households/families, income, education, work,
// housing, commute), and turnout — into one record per precinct, then exposes a
// catalogue of sortable/filterable METRICS over those records. Nothing is
// estimated; a field that isn't on file stays null and sorts/filters as "no data".

// ---- record builder ---------------------------------------------------------
// features: GeoJSON features with merged dnc + racial props (from loadAllData)
// census:   census_profiles.json object keyed by precinct code (or null)
// turnout:  { [code]: { registered, ballots } } (or null)
export function buildRecords(features, census, turnout) {
  const out = [];
  for (const f of features || []) {
    const p = f.properties || f;
    const code = String(p.PRECINCT);
    const c = census ? census[code] : null;
    const t = turnout ? turnout[code] : null;
    const rec = { precinct: code };

    const reg = t && t.registered != null && !isNaN(t.registered) ? +t.registered : null;
    // Test the CONTENT, not the presence of the field. A precinct with zero
    // modeled voters still ships repShare 0.0 with winningParty "Rep", and a
    // precinct with zero counted residents still ships pct_white 0.00 -- both
    // would pass a presence check and render as real data ("leans Republican",
    // "100% not white"). dataService drops these rows at the merge for the
    // 2026 set; this guard is what makes the rule hold for any boundary set.
    const hasParty =
      (+p.rep || 0) + (+p.mod || 0) + (+p.dem || 0) > 0 &&
      p.repShare != null && !isNaN(p.repShare) && !!p.winningParty;
    const hasRacial = p.pct_white != null && !isNaN(p.pct_white) && (+p.total || 0) > 0;
    // Non-residential artifact: census claims a population but there's no
    // voter-file data at all (no party lean, no racial breakdown) — an
    // uninhabited sliver or commercial strip. That population is an area-weighted
    // apportionment artifact (a thin sliver can't hold thousands of people), so
    // its whole census profile is suppressed — only the real voter counts stay.
    const isArtifact = c != null && c.population > 0 && !hasParty && !hasRacial;
    rec.artifact = isArtifact;

    // politics (dnc_scores merged onto the feature)
    if (hasParty) {
      rec.repShare = +p.repShare;
      rec.demShare = +p.demShare;
      rec.modShare = +(p.modShare || 0);
      rec.margin = Math.abs(+p.repShare - +p.demShare);
      rec.partyStrength = +p.partyStrength || null;
      rec.winner = p.winningParty;
      rec.votes = (+p.rep || 0) + (+p.mod || 0) + (+p.dem || 0);
    }

    // racial composition
    if (hasRacial) {
      rec.pctWhite = +p.pct_white;
      rec.pctHispanic = +p.pct_hispanic;
      rec.pctBlack = +p.pct_black;
      rec.pctAsian = +p.pct_asian;
      rec.nonWhite = 1 - +p.pct_white;
    }

    // census profile (Collin only; districts/other views carry none). Skipped
    // entirely for non-residential artifacts — its numbers aren't real.
    if (c && !isArtifact) {
      rec.population = num(c.population);
      rec.density = num(c.populationDensity);
      if (c.age) {
        rec.medianAge = num(c.age.medianAge);
        rec.pctUnder18 = num(c.age.under18);
        rec.pct18to34 = num(c.age["18to34"]);
        rec.pct35to54 = num(c.age["35to54"]);
        rec.pct55to64 = num(c.age["55to64"]);
        rec.pct65plus = num(c.age["65plus"]);
      }
      if (c.gender) rec.pctFemale = num(c.gender.female);
      if (c.households) {
        const h = c.households;
        rec.households = num(h.total);
        rec.familyHouseholds = num(h.familyHouseholds);
        rec.marriedCouples = num(h.marriedCouples);
        rec.nonFamily = num(h.nonFamily);
        rec.avgHouseholdSize = num(h.averageSize);
        rec.singleParent = num(h.singleParent);
        if (h.total) {
          rec.pctFamily = ratio(h.familyHouseholds, h.total);
          rec.pctMarried = ratio(h.marriedCouples, h.total);
          rec.pctSingleParent = ratio(h.singleParent, h.total);
          rec.pctNonFamily = ratio(h.nonFamily, h.total);
        }
      }
      if (c.income) {
        rec.medianIncome = num(c.income.medianHousehold);
        rec.povertyRate = num(c.income.povertyRate);
        const br = c.income.brackets;
        if (br) {
          rec.pctUnder50k = num(br.under50k);
          rec.pct50to100k = num(br["50kTo100k"]);
          rec.pct100to150k = num(br["100kTo150k"]);
          rec.pct150to200k = num(br["150kTo200k"]);
          rec.pctOver200k = num(br.over200k);
        }
      }
      if (c.education) {
        const e = c.education;
        rec.pctBachelorsPlus = sumn(e.bachelors, e.graduateProfessional);
        rec.pctGradProf = num(e.graduateProfessional);
        rec.pctHsOrLess = num(e.highSchoolOrLess);
        rec.pctSomeCollege = num(e.someCollege);
      }
      if (c.employment) {
        rec.laborForce = num(c.employment.laborForceParticipation);
        rec.unemployment = num(c.employment.unemploymentRate);
        rec.topOccupation = c.employment.topOccupations?.[0]?.name || null;
        rec.topIndustry = c.employment.topIndustries?.[0]?.name || null;
      }
      if (c.housing) {
        const h = c.housing;
        rec.medianHomeValue = num(h.medianHomeValue);
        rec.medianRent = num(h.medianRent);
        rec.pctOwner = num(h.ownerOccupied);
        rec.pctRenter = num(h.renterOccupied);
      }
      if (c.commute) {
        rec.pctDroveAlone = num(c.commute.droveAlone);
        rec.pctCarpooled = num(c.commute.carpooled);
        rec.pctWFH = num(c.commute.workedFromHome);
        rec.pctTransit = num(c.commute.publicTransit);
        rec.meanCommute = num(c.commute.meanCommuteMinutes);
      }
      if (c.language) {
        rec.pctEnglishOnly = num(c.language.englishOnly);
        rec.pctSpanish = num(c.language.spanish);
        rec.pctAsianLang = num(c.language.asianLanguages);
      }
      if (c.veterans) {
        rec.veterans = num(c.veterans.total);
        rec.pctVeterans = num(c.veterans.share);
      }
      if (c.insurance) {
        rec.pctInsured = num(c.insurance.insured);
        rec.pctUninsured = num(c.insurance.uninsured);
      }
      if (c.projections) {
        const pr = c.projections;
        if (pr.population) { rec.projPopulation = num(pr.population.projected); rec.popGrowth = num(pr.population.cagr); }
        if (pr.medianIncome) { rec.projIncome = num(pr.medianIncome.projected); rec.incomeGrowth = num(pr.medianIncome.cagr); }
        if (pr.medianHomeValue) { rec.projHomeValue = num(pr.medianHomeValue.projected); rec.homeValueGrowth = num(pr.medianHomeValue.cagr); }
        if (pr.medianAge) rec.projMedianAge = num(pr.medianAge.projected);
      }
    }

    // turnout (marquee election) — always real, kept even for artifacts
    if (reg != null) {
      rec.registered = reg;
      rec.ballots = t.ballots != null && !isNaN(t.ballots) ? +t.ballots : null;
      if (reg > 0 && rec.ballots != null) rec.turnoutRate = rec.ballots / reg;
      if (rec.ballots != null) rec.nonVoters = Math.max(0, reg - rec.ballots);
    }

    out.push(rec);
  }
  return out;
}

function num(v) { return v == null || v === "" || isNaN(v) ? null : +v; }
function ratio(a, b) { return b ? +a / +b : null; }
function sumn(...xs) {
  let s = 0, any = false;
  for (const x of xs) { if (x != null && !isNaN(x)) { s += +x; any = true; } }
  return any ? s : null;
}

// ---- metric catalogue -------------------------------------------------------
// fmt: pct (0..1→%) · num (integer) · usd ($) · dec (1-decimal) · text
export const METRIC_CATEGORIES = [
  { id: "politics", label: "Politics" },
  { id: "race", label: "Race & Ethnicity" },
  { id: "age", label: "Population & Age" },
  { id: "income", label: "Income & Work" },
  { id: "family", label: "Households & Families" },
  { id: "housing", label: "Housing" },
  { id: "education", label: "Education" },
  { id: "commute", label: "Commute" },
  { id: "community", label: "Language & Community" },
  { id: "growth", label: "Growth to 2030" },
  { id: "turnout", label: "Turnout" },
];

export const METRICS = [
  // politics
  { id: "winner", label: "Leans", cat: "politics", fmt: "text" },
  { id: "demShare", label: "Dem share", cat: "politics", fmt: "pct" },
  { id: "repShare", label: "Rep share", cat: "politics", fmt: "pct" },
  { id: "modShare", label: "Moderate share", cat: "politics", fmt: "pct" },
  { id: "margin", label: "Win margin", cat: "politics", fmt: "pct" },
  { id: "partyStrength", label: "Party strength", cat: "politics", fmt: "num" },
  { id: "votes", label: "Modeled voters", cat: "politics", fmt: "num" },
  // race
  { id: "nonWhite", label: "Non-white", cat: "race", fmt: "pct" },
  { id: "pctWhite", label: "White", cat: "race", fmt: "pct" },
  { id: "pctHispanic", label: "Hispanic", cat: "race", fmt: "pct" },
  { id: "pctBlack", label: "Black", cat: "race", fmt: "pct" },
  { id: "pctAsian", label: "Asian", cat: "race", fmt: "pct" },
  // population & age
  { id: "population", label: "Population", cat: "age", fmt: "num" },
  { id: "density", label: "Density (/sq mi)", cat: "age", fmt: "num" },
  { id: "medianAge", label: "Median age", cat: "age", fmt: "dec" },
  { id: "pctUnder18", label: "Under 18", cat: "age", fmt: "pct" },
  { id: "pct18to34", label: "Age 18–34", cat: "age", fmt: "pct" },
  { id: "pct35to54", label: "Age 35–54", cat: "age", fmt: "pct" },
  { id: "pct55to64", label: "Age 55–64", cat: "age", fmt: "pct" },
  { id: "pct65plus", label: "Age 65+", cat: "age", fmt: "pct" },
  { id: "pctFemale", label: "Female", cat: "age", fmt: "pct" },
  // income & work
  { id: "medianIncome", label: "Median income", cat: "income", fmt: "usd" },
  { id: "pctOver200k", label: "Income $200k+", cat: "income", fmt: "pct" },
  { id: "pct150to200k", label: "Income $150k–200k", cat: "income", fmt: "pct" },
  { id: "pct100to150k", label: "Income $100k–150k", cat: "income", fmt: "pct" },
  { id: "pct50to100k", label: "Income $50k–100k", cat: "income", fmt: "pct" },
  { id: "pctUnder50k", label: "Income under $50k", cat: "income", fmt: "pct" },
  { id: "povertyRate", label: "Poverty rate", cat: "income", fmt: "pct" },
  { id: "laborForce", label: "Labor-force part.", cat: "income", fmt: "pct" },
  { id: "unemployment", label: "Unemployment", cat: "income", fmt: "pct" },
  { id: "topOccupation", label: "Top occupation", cat: "income", fmt: "text" },
  { id: "topIndustry", label: "Top industry", cat: "income", fmt: "text" },
  // households & families
  { id: "households", label: "Households", cat: "family", fmt: "num" },
  { id: "familyHouseholds", label: "Family households", cat: "family", fmt: "num" },
  { id: "pctFamily", label: "% family households", cat: "family", fmt: "pct" },
  { id: "marriedCouples", label: "Married couples", cat: "family", fmt: "num" },
  { id: "pctMarried", label: "% married couples", cat: "family", fmt: "pct" },
  { id: "singleParent", label: "Single-parent homes", cat: "family", fmt: "num" },
  { id: "pctSingleParent", label: "% single-parent", cat: "family", fmt: "pct" },
  { id: "nonFamily", label: "Non-family homes", cat: "family", fmt: "num" },
  { id: "avgHouseholdSize", label: "Avg household size", cat: "family", fmt: "dec" },
  // housing
  { id: "medianHomeValue", label: "Median home value", cat: "housing", fmt: "usd" },
  { id: "medianRent", label: "Median rent", cat: "housing", fmt: "usd" },
  { id: "pctOwner", label: "Owner-occupied", cat: "housing", fmt: "pct" },
  { id: "pctRenter", label: "Renter-occupied", cat: "housing", fmt: "pct" },
  // education
  { id: "pctBachelorsPlus", label: "Bachelor's+", cat: "education", fmt: "pct" },
  { id: "pctGradProf", label: "Graduate/prof.", cat: "education", fmt: "pct" },
  { id: "pctSomeCollege", label: "Some college", cat: "education", fmt: "pct" },
  { id: "pctHsOrLess", label: "HS or less", cat: "education", fmt: "pct" },
  // commute
  { id: "meanCommute", label: "Mean commute (min)", cat: "commute", fmt: "dec" },
  { id: "pctDroveAlone", label: "Drove alone", cat: "commute", fmt: "pct" },
  { id: "pctCarpooled", label: "Carpooled", cat: "commute", fmt: "pct" },
  { id: "pctWFH", label: "Work from home", cat: "commute", fmt: "pct" },
  { id: "pctTransit", label: "Public transit", cat: "commute", fmt: "pct" },
  // language & community
  { id: "pctEnglishOnly", label: "English only", cat: "community", fmt: "pct" },
  { id: "pctSpanish", label: "Spanish at home", cat: "community", fmt: "pct" },
  { id: "pctAsianLang", label: "Asian lang. at home", cat: "community", fmt: "pct" },
  { id: "pctVeterans", label: "Veterans", cat: "community", fmt: "pct" },
  { id: "veterans", label: "Veterans (count)", cat: "community", fmt: "num" },
  { id: "pctInsured", label: "Health insured", cat: "community", fmt: "pct" },
  { id: "pctUninsured", label: "Uninsured", cat: "community", fmt: "pct" },
  // growth to 2030 (projections)
  { id: "incomeGrowth", label: "Income growth/yr", cat: "growth", fmt: "pct" },
  { id: "projIncome", label: "Proj. income (2030)", cat: "growth", fmt: "usd" },
  { id: "homeValueGrowth", label: "Home-value growth/yr", cat: "growth", fmt: "pct" },
  { id: "projHomeValue", label: "Proj. home value (2030)", cat: "growth", fmt: "usd" },
  { id: "popGrowth", label: "Population growth/yr", cat: "growth", fmt: "pct" },
  { id: "projPopulation", label: "Proj. population (2030)", cat: "growth", fmt: "num" },
  { id: "projMedianAge", label: "Proj. median age (2030)", cat: "growth", fmt: "dec" },
  // turnout
  { id: "turnoutRate", label: "Turnout rate", cat: "turnout", fmt: "pct" },
  { id: "registered", label: "Registered voters", cat: "turnout", fmt: "num" },
  { id: "nonVoters", label: "Non-voters", cat: "turnout", fmt: "num" },
];

const METRIC_BY_ID = Object.fromEntries(METRICS.map((m) => [m.id, m]));
export function getMetric(id) { return METRIC_BY_ID[id] || null; }

// Which metrics actually have data in this record set (so the UI hides empties).
export function availableMetricIds(records) {
  const present = new Set();
  for (const r of records) {
    for (const id in r) {
      if (id !== "precinct" && r[id] != null) present.add(id);
    }
  }
  return present;
}

// ---- format -----------------------------------------------------------------
export function formatValue(v, fmt) {
  if (v == null || (typeof v === "number" && isNaN(v))) return "—";
  switch (fmt) {
    case "pct": return `${Math.round(v * 100)}%`;
    case "usd": return `$${Math.round(v).toLocaleString()}`;
    case "num": return Math.round(v).toLocaleString();
    case "dec": return (Math.round(v * 10) / 10).toLocaleString();
    case "text": return String(v);
    default: return String(v);
  }
}

// ---- sort + filter ----------------------------------------------------------
// nulls always sort to the bottom regardless of direction.
export function sortRecords(records, key, dir = "desc") {
  const metric = getMetric(key);
  const text = metric && metric.fmt === "text";
  const sign = dir === "asc" ? 1 : -1;
  return [...records].sort((a, b) => {
    const av = a[key], bv = b[key];
    const an = av == null, bn = bv == null;
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    if (text) return sign * String(av).localeCompare(String(bv));
    return sign * (av - bv);
  });
}

// conditions: [{ key, op: 'gte'|'lte'|'eq', value }] (value: number, or string for winner)
export function filterRecords(records, { party = "all", conditions = [] } = {}) {
  return records.filter((r) => {
    if (party !== "all" && r.winner !== party) return false;
    for (const cond of conditions) {
      const v = r[cond.key];
      if (v == null) return false;
      if (cond.op === "gte" && !(v >= cond.value)) return false;
      if (cond.op === "lte" && !(v <= cond.value)) return false;
      if (cond.op === "eq" && String(v) !== String(cond.value)) return false;
    }
    return true;
  });
}
