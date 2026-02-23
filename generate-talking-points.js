#!/usr/bin/env node
// generate-talking-points.js
// Deep analytical talking points — rankings, archetypes, cross-cutting insights,
// computed targets, and peer comparisons for every precinct.

import { readFileSync, writeFileSync } from "fs";

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function parseCSV(raw) {
  const lines = raw.trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const obj = {};
    headers.forEach((h, i) => (obj[h.trim()] = vals[i]?.trim()));
    return obj;
  });
}

function loadBoundaryData(dataDir) {
  const dncRaw = readFileSync(`${dataDir}/DNC Score By Precinct.csv`, "utf-8");
  const racialRaw = readFileSync(`${dataDir}/Racial Numbers by Precinct.csv`, "utf-8");
  const censusRaw = readFileSync(`${dataDir}/precinct_census_profiles.json`, "utf-8");

  const census = JSON.parse(censusRaw);
  const dncRows = parseCSV(dncRaw);
  const racialRows = parseCSV(racialRaw);

  const dncLookup = {};
  for (const row of dncRows) {
    dncLookup[row.Precinct] = {
      rep: +row.Rep,
      mod: +row.Mod,
      dem: +row.Dem,
      total: +row.Total,
      repShare: +row["Rep Share"],
      modShare: +row["Mod Share"],
      demShare: +row["Dem Share"],
      winningParty: row["Winning Party"],
      partyStrength: +row["Party Strength"],
    };
  }

  const racialLookup = {};
  for (const row of racialRows) {
    racialLookup[row.precinct] = {
      asian: +row.asian,
      black: +row.black,
      hispanic: +row.hispanic,
      others: +row.others,
      white: +row.white,
      total: +row.total,
      pctAsian: parseFloat(row.pct_asian) / 100,
      pctBlack: parseFloat(row.pct_black) / 100,
      pctHispanic: parseFloat(row.pct_hispanic) / 100,
      pctOthers: parseFloat(row.pct_others) / 100,
      pctWhite: parseFloat(row.pct_white) / 100,
    };
  }

  return { dncLookup, racialLookup, census };
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentileRank(value, sortedArr) {
  if (!sortedArr.length) return 50;
  let count = 0;
  for (const v of sortedArr) {
    if (v < value) count++;
    else break;
  }
  return Math.round((count / sortedArr.length) * 100);
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function pct(n) {
  if (n == null) return "N/A";
  return (n * 100).toFixed(1) + "%";
}

function cur(n) {
  if (n == null) return "N/A";
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(1) + "M";
  return "$" + Number(Math.round(n)).toLocaleString("en-US");
}

function num(n) {
  return Number(Math.round(n)).toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Build analytics context — rankings, distributions, county stats
// ---------------------------------------------------------------------------

function buildAnalytics(dncLookup, racialLookup, census) {
  const codes = Object.keys(dncLookup).sort((a, b) => +a - +b);
  const totalPrecincts = codes.length;

  // Extract arrays for ranking
  const metrics = {};
  const precinctData = {};

  for (const code of codes) {
    const p = dncLookup[code];
    const r = racialLookup[code];
    const c = census[code];

    const d = {
      code,
      demShare: p?.demShare ?? null,
      repShare: p?.repShare ?? null,
      modShare: p?.modShare ?? null,
      partyStrength: p?.partyStrength ?? null,
      winningParty: p?.winningParty ?? null,
      total: p?.total ?? 0,
      rep: p?.rep ?? 0,
      dem: p?.dem ?? 0,
      mod: p?.mod ?? 0,
      margin: p ? Math.abs(p.repShare - p.demShare) : null,
      demMargin: p ? p.demShare - p.repShare : null,
      nonWhite: r ? 1 - r.pctWhite : null,
      pctAsian: r?.pctAsian ?? null,
      pctHispanic: r?.pctHispanic ?? null,
      pctBlack: r?.pctBlack ?? null,
      pctWhite: r?.pctWhite ?? null,
      population: c?.population ?? null,
      income: c?.income?.medianHousehold ?? null,
      povertyRate: c?.income?.povertyRate ?? null,
      homeValue: c?.housing?.medianHomeValue ?? null,
      rent: c?.housing?.medianRent ?? null,
      ownerOccupied: c?.housing?.ownerOccupied ?? null,
      renterOccupied: c?.housing?.renterOccupied ?? null,
      medianAge: c?.age?.medianAge ?? null,
      under18: c?.age?.under18 ?? null,
      age18to34: c?.age?.["18to34"] ?? null,
      age65plus: c?.age?.["65plus"] ?? null,
      college: c?.education ? (c.education.bachelors || 0) + (c.education.graduateProfessional || 0) : null,
      highSchoolOrLess: c?.education?.highSchoolOrLess ?? null,
      wfh: c?.commute?.workedFromHome ?? null,
      commute: c?.commute?.meanCommuteMinutes ?? null,
      uninsured: c?.insurance?.uninsured ?? null,
      veterans: c?.veterans?.share ?? null,
      unemployment: c?.employment?.unemploymentRate ?? null,
      nonEnglish: c?.language ? 1 - (c.language.englishOnly || 1) : null,
      spanish: c?.language?.spanish ?? null,
      asianLanguages: c?.language?.asianLanguages ?? null,
      singleParentRate: c?.households?.total ? c.households.singleParent / c.households.total : null,
      marriedRate: c?.households?.total ? c.households.marriedCouples / c.households.total : null,
      popGrowth: c?.projections?.population?.cagr ?? null,
      incomeGrowth: c?.projections?.medianIncome?.cagr ?? null,
      homeGrowth: c?.projections?.medianHomeValue?.cagr ?? null,
      topOccupation: c?.employment?.topOccupations?.[0]?.name ?? null,
      topOccShare: c?.employment?.topOccupations?.[0]?.share ?? null,
      topIndustry: c?.employment?.topIndustries?.[0]?.name ?? null,
      topIndShare: c?.employment?.topIndustries?.[0]?.share ?? null,
    };
    precinctData[code] = d;
  }

  // Build sorted arrays for each metric (for percentile ranking)
  const metricKeys = [
    "demShare", "repShare", "modShare", "margin", "demMargin", "total",
    "nonWhite", "pctAsian", "pctHispanic", "pctBlack",
    "population", "income", "povertyRate", "homeValue", "rent",
    "ownerOccupied", "renterOccupied", "medianAge", "under18",
    "age18to34", "age65plus", "college", "highSchoolOrLess",
    "wfh", "commute", "uninsured", "veterans", "unemployment",
    "nonEnglish", "spanish", "singleParentRate", "marriedRate",
    "popGrowth", "incomeGrowth", "homeGrowth",
  ];

  const sorted = {};
  for (const key of metricKeys) {
    sorted[key] = Object.values(precinctData)
      .map((d) => d[key])
      .filter((v) => v != null)
      .sort((a, b) => a - b);
  }

  // Rankings (1 = highest value)
  const rankings = {};
  for (const key of metricKeys) {
    const ranked = Object.values(precinctData)
      .filter((d) => d[key] != null)
      .sort((a, b) => b[key] - a[key]);
    rankings[key] = {};
    ranked.forEach((d, i) => (rankings[key][d.code] = i + 1));
  }

  // County averages
  const vals = Object.values(precinctData);
  const county = {
    income: median(vals.map((d) => d.income).filter(Boolean)),
    homeValue: median(vals.map((d) => d.homeValue).filter(Boolean)),
    medianAge: median(vals.map((d) => d.medianAge).filter(Boolean)),
    college: avg(vals.map((d) => d.college).filter((x) => x != null)),
    poverty: avg(vals.map((d) => d.povertyRate).filter((x) => x != null)),
    ownerOccupied: avg(vals.map((d) => d.ownerOccupied).filter((x) => x != null)),
    rent: median(vals.map((d) => d.rent).filter(Boolean)),
    population: avg(vals.map((d) => d.population).filter(Boolean)),
    wfh: avg(vals.map((d) => d.wfh).filter((x) => x != null)),
    unemployment: avg(vals.map((d) => d.unemployment).filter((x) => x != null)),
    demShare: avg(vals.map((d) => d.demShare).filter((x) => x != null)),
    repShare: avg(vals.map((d) => d.repShare).filter((x) => x != null)),
    modShare: avg(vals.map((d) => d.modShare).filter((x) => x != null)),
    nonWhite: avg(vals.map((d) => d.nonWhite).filter((x) => x != null)),
    uninsured: avg(vals.map((d) => d.uninsured).filter((x) => x != null)),
    nonEnglish: avg(vals.map((d) => d.nonEnglish).filter((x) => x != null)),
  };

  // Competitive precincts (sorted by smallest margin)
  const competitiveRank = Object.values(precinctData)
    .filter((d) => d.margin != null)
    .sort((a, b) => a.margin - b.margin)
    .map((d, i) => ({ code: d.code, rank: i + 1 }));
  const competitiveRankLookup = {};
  competitiveRank.forEach((c) => (competitiveRankLookup[c.code] = c.rank));

  // Find peer precincts (similarity by normalized metrics)
  function findPeers(code, topN = 5) {
    const d = precinctData[code];
    if (!d) return [];
    const compareKeys = ["demShare", "income", "nonWhite", "college", "medianAge", "renterOccupied"];
    const ranges = {};
    for (const k of compareKeys) {
      const vals = sorted[k];
      if (vals && vals.length > 1) {
        ranges[k] = vals[vals.length - 1] - vals[0];
      }
    }

    const scores = [];
    for (const otherCode of codes) {
      if (otherCode === code) continue;
      const o = precinctData[otherCode];
      let dist = 0;
      let dims = 0;
      for (const k of compareKeys) {
        if (d[k] != null && o[k] != null && ranges[k] && ranges[k] > 0) {
          dist += ((d[k] - o[k]) / ranges[k]) ** 2;
          dims++;
        }
      }
      if (dims > 0) {
        scores.push({ code: otherCode, dist: Math.sqrt(dist / dims) });
      }
    }
    return scores.sort((a, b) => a.dist - b.dist).slice(0, topN);
  }

  return { codes, totalPrecincts, precinctData, sorted, rankings, county, competitiveRankLookup, findPeers };
}

// ---------------------------------------------------------------------------
// Archetype classification
// ---------------------------------------------------------------------------

function classifyArchetype(d) {
  if (!d.demShare && !d.income) return { name: "Insufficient Data", emoji: "" };

  const demLean = d.demShare > d.repShare;
  const repLean = d.repShare > d.demShare;
  const modDominant = d.winningParty === "Mod";
  const competitive = d.margin != null && d.margin < 0.08;
  const highIncome = d.income > 150000;
  const lowIncome = d.income != null && d.income < 70000;
  const young = d.medianAge != null && d.medianAge < 35;
  const old = d.medianAge != null && d.medianAge > 50;
  const diverse = d.nonWhite != null && d.nonWhite > 0.40;
  const majorityMinority = d.nonWhite != null && d.nonWhite > 0.50;
  const educated = d.college != null && d.college > 0.55;
  const renterHeavy = d.renterOccupied != null && d.renterOccupied > 0.40;
  const highPoverty = d.povertyRate != null && d.povertyRate > 0.12;
  const affluent = highIncome && d.povertyRate != null && d.povertyRate < 0.05;

  // Priority-ordered archetype matching
  if (demLean && majorityMinority && lowIncome)
    return { name: "Diverse Working-Class Base", desc: "Strong Democratic lean with majority-minority population and below-average incomes. These precincts are core base territory — turnout is everything." };
  if (competitive && modDominant && educated)
    return { name: "Educated Swing Suburb", desc: "Moderate-dominated with high education and tight margins. The prototypical swing precinct — won by whoever speaks to practical suburban concerns without ideological baggage." };
  if (competitive && diverse)
    return { name: "Diverse Battleground", desc: "Tight margins in a diverse precinct. Both parties have a real path here — community-level engagement and culturally responsive outreach determine who wins." };
  if (competitive && modDominant)
    return { name: "Moderate Toss-Up", desc: "Neither party owns this precinct. The Moderate bloc is the kingmaker and responds to competence over ideology." };
  if (competitive)
    return { name: "Pure Toss-Up", desc: "Razor-thin margins. A few dozen voters in either direction flip this precinct. Maximum ground-game ROI." };
  if (demLean && affluent && educated)
    return { name: "Affluent Progressive Enclave", desc: "Wealthy, highly educated, and Democratic-leaning. These voters have post-material values — they care about governance quality, environment, and social issues." };
  if (demLean && young && diverse)
    return { name: "Young Diverse Rising", desc: "Young, diverse, and trending blue. High potential but low turnout — the gap between registration and voting is where elections are won or lost." };
  if (demLean && renterHeavy)
    return { name: "Urban-Style Democratic", desc: "Renter-heavy, Democratic-leaning — an urban profile in suburban Collin County. Transience makes voter contact timing critical." };
  if (demLean && diverse)
    return { name: "Diverse Democratic Base", desc: "Diverse and solidly Democratic. Culturally responsive outreach and multilingual operations are baseline requirements." };
  if (demLean && educated)
    return { name: "Educated Democratic Lean", desc: "College-educated and Democratic-leaning. Policy substance and candidate quality matter more than party loyalty." };
  if (demLean)
    return { name: "Democratic Base", desc: "Reliable Democratic territory. The goal is protecting turnout, especially in off-year and down-ballot races where drop-off costs seats." };
  if (repLean && affluent)
    return { name: "Affluent Red Suburb", desc: "Wealthy Republican stronghold. These voters are fiscally conservative but can be socially moderate — the type of precinct where culture-war messaging can backfire." };
  if (repLean && old && d.repShare > 0.50)
    return { name: "Senior Conservative Stronghold", desc: "Older, solidly Republican. These voters never miss an election. Long-term demographic change may shift this, but for now it's deep red." };
  if (repLean && d.repShare > 0.50 && !diverse)
    return { name: "Red Stronghold", desc: "Solidly Republican. Democratic investment here is about building infrastructure for future cycles, not winning this one." };
  if (repLean && modDominant)
    return { name: "Right-Leaning Moderate", desc: "Republicans have the edge but Moderates are the largest bloc. Persuasion-first territory." };
  if (repLean && diverse)
    return { name: "Diverse but Republican-Leaning", desc: "An unusual profile — diverse population but Republican-leaning registration. Community engagement could shift this over time." };
  if (repLean)
    return { name: "Republican-Leaning", desc: "Republican advantage that ranges from modest to significant. Moderate outreach and registration drives are the long game." };
  if (modDominant && affluent)
    return { name: "Affluent Independent", desc: "Wealthy Moderate-dominated precinct. These voters are politically unattached and evaluate candidates on merit. The ultimate persuasion target." };
  if (modDominant)
    return { name: "Moderate Territory", desc: "Moderate-dominated with no clear party advantage. Issue-based, non-ideological messaging wins here." };

  return { name: "Mixed Profile", desc: "No single defining characteristic dominates. A flexible, multi-pronged approach is needed." };
}

// ---------------------------------------------------------------------------
// Cross-cutting insight generators
// ---------------------------------------------------------------------------

function genUniqueInsights(d, analytics) {
  const { rankings, totalPrecincts, county, sorted } = analytics;
  const insights = [];

  // --- Superlative rankings ---
  const superlatives = [];
  const checkTop = (key, label, format) => {
    const rank = rankings[key]?.[d.code];
    if (rank && rank <= 3) {
      superlatives.push(`**#${rank} ${label}** in the county (${format(d[key])})`);
    }
  };
  const checkBottom = (key, label, format) => {
    const rank = rankings[key]?.[d.code];
    const total = sorted[key]?.length;
    if (rank && total && rank >= total - 2) {
      superlatives.push(`**#${total - rank + 1} lowest ${label}** in the county (${format(d[key])})`);
    }
  };

  checkTop("demShare", "highest Dem registration", pct);
  checkTop("repShare", "highest Rep registration", pct);
  checkTop("modShare", "highest Moderate registration", pct);
  checkTop("income", "highest median income", cur);
  checkTop("population", "most populous precinct", num);
  checkTop("nonWhite", "most diverse", pct);
  checkTop("college", "most college-educated", pct);
  checkTop("age65plus", "highest senior population", pct);
  checkTop("age18to34", "highest young adult share", pct);
  checkTop("wfh", "highest work-from-home rate", pct);
  checkTop("renterOccupied", "highest renter share", pct);
  checkTop("povertyRate", "highest poverty rate", pct);
  checkTop("uninsured", "highest uninsured rate", pct);
  checkTop("veterans", "highest veteran share", pct);
  checkTop("total", "most registered voters", num);
  checkTop("homeValue", "highest home values", cur);

  checkBottom("income", "median income", cur);
  checkBottom("demShare", "Dem registration", pct);
  checkBottom("medianAge", "median age (youngest)", (v) => v.toFixed(1));
  checkBottom("margin", "party margin (tightest race)", pct);

  if (superlatives.length > 0) {
    insights.push({
      category: "County Standouts",
      point: superlatives.join(". ") + ".",
    });
  }

  // --- Percentile positioning ---
  const pctile = (key) => percentileRank(d[key], sorted[key]);
  const rankOf = (key) => rankings[key]?.[d.code];

  if (d.income != null && d.demShare != null) {
    const incomePctile = pctile("income");
    const demPctile = pctile("demShare");

    if (incomePctile > 75 && demPctile > 75) {
      insights.push({
        category: "Cross-Cut: Affluent + Blue",
        point: `An unusual combination — this precinct is in the top quartile for both income (${ordinal(incomePctile)} percentile, ${cur(d.income)}) and Democratic registration (${ordinal(demPctile)} percentile, ${pct(d.demShare)}). Affluent Democratic precincts respond to governance quality, education investment, and environmental messaging. They donate at higher rates — prioritize fundraising alongside GOTV.`,
      });
    }
    if (incomePctile < 25 && demPctile < 35) {
      insights.push({
        category: "Cross-Cut: Working-Class + Red-Leaning",
        point: `Lower-income (${ordinal(incomePctile)} percentile, ${cur(d.income)}) but not strongly Democratic (${pct(d.demShare)}). This is the profile where economic populism can break through partisan defaults. Speak to healthcare costs, wage stagnation, and local job creation — not national culture wars.`,
      });
    }
  }

  if (d.nonWhite != null && d.repShare != null && d.nonWhite > 0.35 && d.repShare > d.demShare) {
    insights.push({
      category: "Cross-Cut: Diverse + Republican-Leaning",
      point: `${pct(d.nonWhite)} non-white population but Republicans lead ${pct(d.repShare)} to ${pct(d.demShare)}. This is a persuasion opportunity that many campaigns overlook. The diverse population here isn't monolithically Democratic — community-specific outreach that doesn't assume partisanship will outperform generic messaging.`,
    });
  }

  if (d.college != null && d.highSchoolOrLess != null && d.college > 0.50 && d.povertyRate != null && d.povertyRate > 0.08) {
    insights.push({
      category: "Cross-Cut: Educated + Economically Stressed",
      point: `High education (${pct(d.college)} college+) but elevated poverty (${pct(d.povertyRate)}). Likely a mix of young professionals carrying debt and established professionals in a precinct with pockets of need. Don't assume education = wealth. Student loan policy, childcare costs, and healthcare access resonate here.`,
    });
  }

  if (d.renterOccupied != null && d.age18to34 != null && d.renterOccupied > 0.40 && d.age18to34 > 0.25) {
    insights.push({
      category: "Cross-Cut: Young + Renter-Heavy",
      point: `Young adults (${pct(d.age18to34)} aged 18-34) in a renter-heavy precinct (${pct(d.renterOccupied)}). This population is mobile — they might not be here next cycle. Capture them now. Digital-first outreach, peer texting, and housing affordability messaging. Traditional mailers go straight to recycling.`,
    });
  }

  if (d.age65plus != null && d.renterOccupied != null && d.age65plus > 0.20 && d.renterOccupied > 0.35) {
    insights.push({
      category: "Cross-Cut: Senior Renters",
      point: `Significant seniors (${pct(d.age65plus)} over 65) in a renter-heavy area (${pct(d.renterOccupied)}). Senior renters face unique vulnerability — fixed incomes vs. rising rents. They vote reliably but respond to different messaging than senior homeowners. Focus on Medicare, rent stability, and senior services access.`,
    });
  }

  if (d.wfh != null && d.income != null && d.wfh > 0.20 && d.income > 130000) {
    insights.push({
      category: "Cross-Cut: Remote Professionals",
      point: `High work-from-home rate (${pct(d.wfh)}) with strong incomes (${cur(d.income)}). These are white-collar remote workers — they're home during the day (mid-day canvassing works), deeply invested in their neighborhood quality, and care about internet infrastructure, local amenities, and school ratings. High donor potential.`,
    });
  }

  if (d.nonEnglish != null && d.demShare != null && d.nonEnglish > 0.25 && d.demShare < 0.30) {
    insights.push({
      category: "Cross-Cut: Multilingual + Untapped",
      point: `${pct(d.nonEnglish)} speak a non-English language at home but Dem registration is only ${pct(d.demShare)}. This community is being under-engaged — language-barrier voters who aren't contacted default to not voting or following community leader cues. Bilingual outreach here has outsized ROI.`,
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Competitive analysis and vote targets
// ---------------------------------------------------------------------------

function genCompetitiveAnalysis(d, analytics) {
  const { competitiveRankLookup, totalPrecincts, county } = analytics;
  const insights = [];

  if (d.margin == null || d.total == null) return insights;

  const compRank = competitiveRankLookup[d.code];
  const marginVotes = Math.round(d.margin * d.total);

  if (d.margin < 0.05) {
    const votersToFlip = Math.ceil(marginVotes / 2) + 1;
    insights.push({
      category: `Competitiveness: #${compRank} of ${totalPrecincts}`,
      point: `This is the ${ordinal(compRank)} most competitive precinct in the county. The margin is just ${(d.margin * 100).toFixed(1)} points — only **${marginVotes} votes** separate the parties out of ${num(d.total)} registered. Flipping this precinct requires persuading or mobilizing just **${votersToFlip} voters**. That's one block party, one community event, one weekend of focused door-knocking.`,
    });
  } else if (d.margin < 0.10) {
    const votersToFlip = Math.ceil(marginVotes / 2) + 1;
    insights.push({
      category: `Competitiveness: #${compRank} of ${totalPrecincts}`,
      point: `Competitive precinct — ranked #${compRank} in the county by margin. The ${(d.margin * 100).toFixed(1)}-point gap translates to **${marginVotes} votes** out of ${num(d.total)}. Flipping requires moving **${votersToFlip} voters** — achievable with sustained effort. This is a precinct where campaign investment has measurable returns.`,
    });
  } else if (d.margin < 0.20) {
    insights.push({
      category: `Competitiveness: #${compRank} of ${totalPrecincts}`,
      point: `Leaning but not locked — the ${(d.margin * 100).toFixed(1)}-point margin (${marginVotes} votes) is meaningful but not insurmountable in a wave year. Ranked #${compRank} of ${totalPrecincts} precincts. In a high-turnout election with strong top-of-ticket, this precinct is in play.`,
    });
  } else {
    insights.push({
      category: `Competitiveness: #${compRank} of ${totalPrecincts}`,
      point: `Not currently competitive — ${(d.margin * 100).toFixed(1)}-point margin (${marginVotes} votes, rank #${compRank}/${totalPrecincts}). Resources are better spent elsewhere for near-term wins. Focus here is voter registration and long-term infrastructure.`,
    });
  }

  // Dem-specific mobilization targets
  if (d.winningParty === "Rep" && d.demShare > 0.20) {
    const demVoters = d.dem;
    const repVoters = d.rep;
    const gap = repVoters - demVoters;
    const modVoters = d.mod;
    const modNeeded = Math.ceil(gap * 0.6); // assume need ~60% of gap from mods, rest from turnout
    insights.push({
      category: "Democratic Path to Win",
      point: `Republicans lead by **${num(gap)} registrations** (${num(repVoters)} R vs ${num(demVoters)} D). The ${num(modVoters)} Moderates are the key — Democrats need roughly **${num(modNeeded)} Moderates** to break their way (assuming full Dem turnout). That's ${pct(modNeeded / modVoters)} of the Moderate bloc. ${modNeeded / modVoters < 0.5 ? "Achievable with strong local-issue messaging." : "A tough ask requiring exceptional candidate appeal and turnout."}`,
    });
  }

  if (d.winningParty === "Dem") {
    const cushion = d.dem - d.rep;
    const turnoutThreshold = cushion / d.dem;
    insights.push({
      category: "Defending the Lead",
      point: `Democrats lead by **${num(cushion)} registrations**. But leads on paper don't vote — turnout does. If Democratic turnout drops below ~${pct(1 - turnoutThreshold)} while Republicans maintain theirs, this precinct flips. Off-year elections are the danger zone. Persistent voter contact is the insurance policy.`,
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Peer comparison
// ---------------------------------------------------------------------------

function genPeerComparison(d, analytics) {
  const peers = analytics.findPeers(d.code, 5);
  if (peers.length === 0) return null;

  const peerLabels = peers.map((p) => {
    const pd = analytics.precinctData[p.code];
    const party = pd.winningParty || "?";
    return `Pct ${p.code} (${party}, ${cur(pd.income)}, ${pct(pd.nonWhite)} diverse)`;
  });

  return {
    category: "Most Similar Precincts",
    point: `Based on party registration, income, diversity, education, age, and housing mix, this precinct's closest peers are: ${peerLabels.join(" | ")}. What works in these peer precincts — messaging, volunteer strategies, event formats — is likely transferable here.`,
  };
}

// ---------------------------------------------------------------------------
// Data-driven narrative (replaces old template generators with richer versions)
// ---------------------------------------------------------------------------

function genPartyNarrative(d, analytics) {
  if (d.demShare == null) return null;
  const { rankings, totalPrecincts, county } = analytics;

  const demRank = rankings.demShare[d.code];
  const repRank = rankings.repShare[d.code];
  const modRank = rankings.modShare[d.code];

  const parts = [];

  // Party composition with ranking context
  parts.push(`**${d.winningParty}** leads with strength ${d.partyStrength}/3.`);
  parts.push(`Registration: R ${pct(d.repShare)} (${ordinal(repRank)}/${totalPrecincts}) | M ${pct(d.modShare)} (${ordinal(modRank)}/${totalPrecincts}) | D ${pct(d.demShare)} (${ordinal(demRank)}/${totalPrecincts}).`);

  // Context vs county
  const demDelta = (d.demShare - county.demShare) * 100;
  if (Math.abs(demDelta) > 5) {
    parts.push(`Dem registration is ${Math.abs(demDelta).toFixed(1)}pp ${demDelta > 0 ? "above" : "below"} the county average of ${pct(county.demShare)}.`);
  }

  // Voter pool size context
  if (d.total > 5000) {
    parts.push(`Large voter pool of ${num(d.total)} — this precinct carries significant weight in district-level outcomes.`);
  } else if (d.total < 1000) {
    parts.push(`Small voter pool of only ${num(d.total)} — individual outreach here has amplified per-voter impact.`);
  }

  return { category: "Party Registration Profile", point: parts.join(" ") };
}

function genDemographicNarrative(d, analytics) {
  if (d.nonWhite == null) return null;
  const { rankings, totalPrecincts, county } = analytics;
  const rank = rankings.nonWhite[d.code];
  const parts = [];

  parts.push(`${pct(d.nonWhite)} non-white (${ordinal(rank)}/${totalPrecincts} in diversity).`);

  const groups = [
    { name: "Asian", val: d.pctAsian },
    { name: "Hispanic", val: d.pctHispanic },
    { name: "Black", val: d.pctBlack },
  ].filter((g) => g.val != null && g.val > 0.03).sort((a, b) => b.val - a.val);

  if (groups.length > 0) {
    parts.push("Breakdown: " + groups.map((g) => `${g.name} ${pct(g.val)}`).join(", ") + ".");
  }

  const diversityDelta = (d.nonWhite - county.nonWhite) * 100;
  if (diversityDelta > 15) {
    parts.push(`Far more diverse than the county average (${pct(county.nonWhite)}) — culturally responsive outreach is a baseline requirement, not an add-on.`);
  } else if (diversityDelta < -10) {
    parts.push(`Less diverse than the county average (${pct(county.nonWhite)}).`);
  }

  return { category: "Demographics", point: parts.join(" ") };
}

function genEconomicNarrative(d, analytics) {
  if (d.income == null) return null;
  const { rankings, totalPrecincts, county } = analytics;
  const rank = rankings.income[d.code];
  const pctile = percentileRank(d.income, analytics.sorted.income);
  const parts = [];

  parts.push(`Median income ${cur(d.income)} — ${ordinal(rank)} of ${totalPrecincts} (${ordinal(pctile)} percentile).`);

  if (d.homeValue) {
    const hvRank = rankings.homeValue[d.code];
    parts.push(`Median home value ${cur(d.homeValue)} (${ordinal(hvRank)}/${totalPrecincts}).`);
  }
  if (d.povertyRate != null) {
    if (d.povertyRate > 0.12) {
      const povRank = rankings.povertyRate[d.code];
      parts.push(`Poverty rate ${pct(d.povertyRate)} — ${ordinal(povRank)} highest in the county. Economic survival messaging, not aspiration.`);
    } else if (d.povertyRate < 0.03) {
      parts.push(`Near-zero poverty (${pct(d.povertyRate)}). Voters here are insulated from economic anxiety — lead with quality-of-life and values.`);
    }
  }
  if (d.rent && d.renterOccupied > 0.30) {
    parts.push(`Median rent ${cur(d.rent)}/mo with ${pct(d.renterOccupied)} renters — housing costs are a daily pressure point.`);
  }

  return { category: "Economic Profile", point: parts.join(" ") };
}

function genCommunityProfile(d, analytics) {
  const parts = [];

  // Age
  if (d.medianAge != null) {
    const ageRank = analytics.rankings.medianAge[d.code];
    if (d.medianAge < 33) {
      parts.push(`Very young (median age ${d.medianAge.toFixed(1)}, ${ordinal(ageRank)}/${analytics.totalPrecincts}). Digital-first outreach, peer texting > mailers.`);
    } else if (d.medianAge > 50) {
      parts.push(`Older community (median age ${d.medianAge.toFixed(1)}, ${ordinal(ageRank)}/${analytics.totalPrecincts}). Highest-reliability voters — they vote every election.`);
    } else if (d.under18 > 0.28) {
      parts.push(`Family precinct — ${pct(d.under18)} under 18 (median age ${d.medianAge.toFixed(1)}). Schools and childcare dominate the conversation.`);
    }
  }

  // Education
  if (d.college != null) {
    const eduRank = analytics.rankings.college[d.code];
    if (d.college > 0.60) {
      parts.push(`Highly educated (${pct(d.college)} college+, ${ordinal(eduRank)}/${analytics.totalPrecincts}). These voters want policy depth, not slogans.`);
    } else if (d.highSchoolOrLess > 0.35) {
      parts.push(`Working-class education profile (${pct(d.highSchoolOrLess)} HS or less). Plain language and relatable messengers build trust.`);
    }
  }

  // Employment
  if (d.topOccupation && d.topOccShare > 0.40) {
    parts.push(`Dominated by ${d.topOccupation} workers (${pct(d.topOccShare)}).`);
  }
  if (d.unemployment != null && d.unemployment > 0.06) {
    parts.push(`Elevated unemployment at ${pct(d.unemployment)} — job creation messaging lands here.`);
  }

  // Commute/WFH
  if (d.wfh != null && d.wfh > 0.25) {
    const wfhRank = analytics.rankings.wfh[d.code];
    parts.push(`Remote work hub (${pct(d.wfh)} WFH, ${ordinal(wfhRank)}/${analytics.totalPrecincts}). Home during the day, invested in neighborhood quality.`);
  } else if (d.commute != null && d.commute > 35) {
    parts.push(`Long commuters (${d.commute.toFixed(0)} min avg). Transportation is a visceral daily frustration.`);
  }

  // Veterans
  if (d.veterans != null && d.veterans > 0.08) {
    const vetRank = analytics.rankings.veterans[d.code];
    parts.push(`Significant veteran community (${pct(d.veterans)}, ${ordinal(vetRank)}/${analytics.totalPrecincts}). Service-oriented messaging and vet endorsements carry weight.`);
  }

  // Language
  if (d.nonEnglish != null && d.nonEnglish > 0.25) {
    parts.push(`Multilingual (${pct(d.nonEnglish)} non-English at home). Bilingual canvassers and translated materials are essential, not optional.`);
  } else if (d.spanish != null && d.spanish > 0.12) {
    parts.push(`Spanish-speaking community (${pct(d.spanish)}). Bilingual outreach signals respect and boosts engagement.`);
  } else if (d.asianLanguages != null && d.asianLanguages > 0.08) {
    parts.push(`Asian language community (${pct(d.asianLanguages)}). Language-specific materials dramatically increase contact rates.`);
  }

  // Uninsured
  if (d.uninsured != null && d.uninsured > 0.10) {
    const insRank = analytics.rankings.uninsured[d.code];
    parts.push(`${pct(d.uninsured)} uninsured (${ordinal(insRank)}/${analytics.totalPrecincts}). Healthcare access is a concrete, personal issue here.`);
  }

  if (parts.length === 0) return null;
  return { category: "Community Profile", point: parts.join(" ") };
}

function genGrowthTrajectory(d, analytics) {
  if (!d.popGrowth && !d.incomeGrowth && !d.homeGrowth) return null;
  const parts = [];

  if (d.popGrowth != null && d.popGrowth > 0.01) {
    parts.push(`population +${(d.popGrowth * 100).toFixed(1)}%/yr`);
  } else if (d.popGrowth != null && d.popGrowth < -0.005) {
    parts.push(`population shrinking ${(d.popGrowth * 100).toFixed(1)}%/yr`);
  }
  if (d.incomeGrowth != null && d.incomeGrowth > 0.02) {
    parts.push(`incomes +${(d.incomeGrowth * 100).toFixed(1)}%/yr`);
  }
  if (d.homeGrowth != null && d.homeGrowth > 0.03) {
    parts.push(`home values +${(d.homeGrowth * 100).toFixed(1)}%/yr`);
  }

  if (parts.length === 0) return null;

  let narrative;
  if (d.popGrowth > 0.02) {
    narrative = `Fast-growing (${parts.join(", ")}). New residents haven't formed local political habits — early contact with newcomers is the highest-ROI investment.`;
  } else if (d.popGrowth < -0.005) {
    narrative = `Contracting (${parts.join(", ")}). Shrinking populations concentrate the remaining voters' influence. Every registered voter matters more here over time.`;
  } else {
    narrative = `Projected trends: ${parts.join(", ")}. The precinct's character is shifting — adjust strategy to where it's going, not just where it is.`;
  }

  return { category: "Growth Trajectory", point: narrative };
}

// ---------------------------------------------------------------------------
// Campaign strategy (richer version with computed numbers)
// ---------------------------------------------------------------------------

function genCampaignStrategy(d, analytics) {
  if (d.demShare == null) return null;

  const strategies = [];

  // Primary strategy classification
  if (d.winningParty === "Dem" && d.partyStrength >= 2) {
    const cushion = d.dem - d.rep;
    strategies.push(`**PROTECT** — Dem lead of ${num(cushion)} voters. Off-year turnout drop-off is the #1 threat. Target: ensure ${pct(0.85)}+ of registered Democrats vote in every cycle.`);
  } else if (d.margin < 0.08 && d.modShare > 0.30) {
    const modsNeeded = Math.ceil(d.mod * 0.45);
    strategies.push(`**PERSUADE** — Win ${num(modsNeeded)} of ${num(d.mod)} Moderates (45%). Lead with local issues: property taxes, schools, traffic. National partisan framing actively hurts here.`);
  } else if (d.demShare > 0.25 && d.repShare > d.demShare && d.margin < 0.15) {
    const gap = d.rep - d.dem;
    const turnoutTarget = Math.ceil(gap * 0.7);
    strategies.push(`**MOBILIZE** — Close the ${num(gap)}-voter gap. Need ~${num(turnoutTarget)} additional Dem voters through turnout. Peer-to-peer contact from neighbors > generic outreach.`);
  } else if (d.demShare < 0.20 && d.repShare > 0.45) {
    const demsRegistered = d.dem;
    const regTarget = Math.ceil(demsRegistered * 0.25);
    strategies.push(`**LONG-TERM BUILD** — ${num(d.dem)} registered Dems today. Target: add ${num(regTarget)} new registrations per cycle through community presence and registration drives.`);
  } else if (d.winningParty === "Mod") {
    strategies.push(`**PERSUADE MODERATES** — ${num(d.mod)} Moderates (${pct(d.modShare)}) are the prize. They respond to competence, problem-solving, and local track record — not ideology.`);
  } else {
    strategies.push(`**ENGAGE** — Mixed dynamics. Balance Dem turnout (${num(d.dem)} registered), Moderate persuasion (${num(d.mod)} available), and visibility.`);
  }

  // Secondary tactical recommendations
  if (d.age18to34 != null && d.age18to34 > 0.22 && d.renterOccupied != null && d.renterOccupied > 0.35) {
    strategies.push(`Tactical: Young renter population — digital-first outreach, early canvassing (they move), housing/cost messaging.`);
  }
  if (d.nonEnglish != null && d.nonEnglish > 0.20) {
    strategies.push(`Tactical: ${pct(d.nonEnglish)} non-English speakers — bilingual canvassers are force multipliers, not nice-to-haves.`);
  }
  if (d.total > 5000) {
    strategies.push(`Tactical: Large precinct (${num(d.total)} voters) — consider sub-precinct geographic targeting. Not all blocks here are the same.`);
  }
  if (d.wfh != null && d.wfh > 0.20) {
    strategies.push(`Tactical: High WFH rate — mid-day canvassing is viable and under-utilized by most campaigns.`);
  }

  return { category: "Campaign Strategy", point: strategies.join("\n\n") };
}

// ---------------------------------------------------------------------------
// Assemble full precinct analysis
// ---------------------------------------------------------------------------

function buildPrecinctAnalysis(code, analytics) {
  const d = analytics.precinctData[code];
  if (!d) return { code, archetype: null, points: [] };

  const archetype = classifyArchetype(d);
  const points = [];

  // 1. Archetype + quick context
  points.push({
    category: `Archetype: ${archetype.name}`,
    point: archetype.desc,
  });

  // 2. Party registration with rankings
  const party = genPartyNarrative(d, analytics);
  if (party) points.push(party);

  // 3. Campaign strategy with computed targets
  const strategy = genCampaignStrategy(d, analytics);
  if (strategy) points.push(strategy);

  // 4. Competitiveness analysis
  const competitive = genCompetitiveAnalysis(d, analytics);
  points.push(...competitive);

  // 5. Demographics with rankings
  const demo = genDemographicNarrative(d, analytics);
  if (demo) points.push(demo);

  // 6. Economic profile
  const econ = genEconomicNarrative(d, analytics);
  if (econ) points.push(econ);

  // 7. Community profile (age, education, employment, language, etc.)
  const community = genCommunityProfile(d, analytics);
  if (community) points.push(community);

  // 8. Cross-cutting insights
  const crossCuts = genUniqueInsights(d, analytics);
  points.push(...crossCuts);

  // 9. Growth trajectory
  const growth = genGrowthTrajectory(d, analytics);
  if (growth) points.push(growth);

  // 10. Peer comparison
  const peers = genPeerComparison(d, analytics);
  if (peers) points.push(peers);

  return { code, archetype, data: d, points };
}

// ---------------------------------------------------------------------------
// County-wide summary
// ---------------------------------------------------------------------------

function generateCountySummary(analytics) {
  const { precinctData, totalPrecincts, county, sorted } = analytics;
  const vals = Object.values(precinctData);
  const lines = [];

  lines.push("## County-Wide Summary");
  lines.push("");

  // Party breakdown
  const demPrecincts = vals.filter((d) => d.winningParty === "Dem").length;
  const repPrecincts = vals.filter((d) => d.winningParty === "Rep").length;
  const modPrecincts = vals.filter((d) => d.winningParty === "Mod").length;
  const competitive = vals.filter((d) => d.margin != null && d.margin < 0.08).length;
  const tossup = vals.filter((d) => d.margin != null && d.margin < 0.05).length;

  lines.push(`**${totalPrecincts} precincts**: ${repPrecincts} Republican-leaning, ${demPrecincts} Democratic-leaning, ${modPrecincts} Moderate-dominated.`);
  lines.push("");
  lines.push(`**${competitive} competitive precincts** (margin < 8 pts), of which **${tossup} are true toss-ups** (margin < 5 pts).`);
  lines.push("");

  // Key metrics
  lines.push("| Metric | County Median/Avg | Range |");
  lines.push("|--------|-------------------|-------|");
  lines.push(`| Median Income | ${cur(county.income)} | ${cur(sorted.income[0])} – ${cur(sorted.income[sorted.income.length - 1])} |`);
  lines.push(`| Dem Registration | ${pct(county.demShare)} | ${pct(sorted.demShare[0])} – ${pct(sorted.demShare[sorted.demShare.length - 1])} |`);
  lines.push(`| Non-White Share | ${pct(county.nonWhite)} | ${pct(sorted.nonWhite[0])} – ${pct(sorted.nonWhite[sorted.nonWhite.length - 1])} |`);
  lines.push(`| Uninsured Rate | ${pct(county.uninsured)} | ${pct(sorted.uninsured?.[0])} – ${pct(sorted.uninsured?.[sorted.uninsured?.length - 1])} |`);
  lines.push(`| Non-English Speakers | ${pct(county.nonEnglish)} | ${pct(sorted.nonEnglish?.[0])} – ${pct(sorted.nonEnglish?.[sorted.nonEnglish?.length - 1])} |`);
  lines.push("");

  // Archetype distribution
  const archetypeCounts = {};
  for (const d of vals) {
    const a = classifyArchetype(d);
    archetypeCounts[a.name] = (archetypeCounts[a.name] || 0) + 1;
  }
  const sortedArchetypes = Object.entries(archetypeCounts).sort((a, b) => b[1] - a[1]);

  lines.push("**Precinct Archetypes:**");
  lines.push("");
  for (const [name, count] of sortedArchetypes) {
    const bar = "█".repeat(Math.round(count / 2));
    lines.push(`- ${name}: **${count}** ${bar}`);
  }
  lines.push("");

  // Top 10 most competitive
  const topCompetitive = vals
    .filter((d) => d.margin != null)
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 10);

  lines.push("**Top 10 Most Competitive Precincts:**");
  lines.push("");
  lines.push("| Rank | Precinct | Margin | Leader | Voters | Votes to Flip |");
  lines.push("|------|----------|--------|--------|--------|---------------|");
  topCompetitive.forEach((d, i) => {
    const votesToFlip = Math.ceil(Math.round(d.margin * d.total) / 2) + 1;
    lines.push(`| ${i + 1} | ${d.code} | ${(d.margin * 100).toFixed(1)}pts | ${d.winningParty} | ${num(d.total)} | ${num(votesToFlip)} |`);
  });
  lines.push("");

  // Top 10 highest Dem share (base protection targets)
  const topDem = vals
    .filter((d) => d.demShare != null)
    .sort((a, b) => b.demShare - a.demShare)
    .slice(0, 10);

  lines.push("**Top 10 Dem Base Precincts (protect turnout):**");
  lines.push("");
  lines.push("| Rank | Precinct | Dem% | Voters | Archetype |");
  lines.push("|------|----------|------|--------|-----------|");
  topDem.forEach((d, i) => {
    const a = classifyArchetype(d);
    lines.push(`| ${i + 1} | ${d.code} | ${pct(d.demShare)} | ${num(d.total)} | ${a.name} |`);
  });
  lines.push("");

  // Top 10 largest Moderate blocs (persuasion targets)
  const topMod = vals
    .filter((d) => d.mod != null && d.modShare > 0.30)
    .sort((a, b) => b.mod - a.mod)
    .slice(0, 10);

  lines.push("**Top 10 Largest Moderate Blocs (persuasion targets):**");
  lines.push("");
  lines.push("| Rank | Precinct | Moderates | Mod% | Current Leader |");
  lines.push("|------|----------|-----------|------|----------------|");
  topMod.forEach((d, i) => {
    lines.push(`| ${i + 1} | ${d.code} | ${num(d.mod)} | ${pct(d.modShare)} | ${d.winningParty} |`);
  });
  lines.push("");

  // Total voter universe
  const totalDem = vals.reduce((s, d) => s + (d.dem || 0), 0);
  const totalRep = vals.reduce((s, d) => s + (d.rep || 0), 0);
  const totalMod = vals.reduce((s, d) => s + (d.mod || 0), 0);
  const totalAll = vals.reduce((s, d) => s + (d.total || 0), 0);

  lines.push("**Total Voter Universe:**");
  lines.push("");
  lines.push(`- Total registered: **${num(totalAll)}**`);
  lines.push(`- Republican: **${num(totalRep)}** (${pct(totalRep / totalAll)})`);
  lines.push(`- Moderate: **${num(totalMod)}** (${pct(totalMod / totalAll)})`);
  lines.push(`- Democrat: **${num(totalDem)}** (${pct(totalDem / totalAll)})`);
  lines.push("");

  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Generate section for one boundary set
// ---------------------------------------------------------------------------

function generateSection(label, dncLookup, racialLookup, census) {
  console.log(`  Building analytics for ${label}...`);
  const analytics = buildAnalytics(dncLookup, racialLookup, census);

  const lines = [];
  lines.push(`# ${label}`);
  lines.push("");
  lines.push(`*${analytics.totalPrecincts} precincts analyzed*`);
  lines.push("");

  // County summary
  lines.push(generateCountySummary(analytics));

  // Table of contents with archetype
  lines.push("## Precinct Directory");
  lines.push("");
  for (const code of analytics.codes) {
    const d = analytics.precinctData[code];
    const archetype = classifyArchetype(d);
    const party = d.winningParty || "?";
    lines.push(`- [Precinct ${code}](#precinct-${code}) — ${party} | ${archetype.name}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Individual precincts
  for (const code of analytics.codes) {
    const result = buildPrecinctAnalysis(code, analytics);

    lines.push(`## Precinct ${code}`);
    lines.push("");

    // Quick stats bar
    const d = result.data || {};
    const statParts = [];
    if (d.winningParty) statParts.push(`**${d.winningParty}** (${d.partyStrength}/3)`);
    if (d.total) statParts.push(`${num(d.total)} voters`);
    if (d.population) statParts.push(`Pop ${num(d.population)}`);
    if (d.income) statParts.push(`Income ${cur(d.income)}`);
    if (d.nonWhite != null) statParts.push(`${pct(d.nonWhite)} diverse`);
    if (d.college != null) statParts.push(`${pct(d.college)} college`);
    if (d.medianAge != null) statParts.push(`Age ${d.medianAge.toFixed(0)}`);

    if (statParts.length > 0) {
      lines.push(`> ${statParts.join(" | ")}`);
      lines.push("");
    }

    if (result.points.length === 0) {
      lines.push("*Insufficient data for this precinct.*");
    } else {
      for (const pt of result.points) {
        // Handle multi-line points (strategy can have multiple paragraphs)
        const pointLines = pt.point.split("\n\n");
        if (pointLines.length > 1) {
          lines.push(`**${pt.category}:**`);
          lines.push("");
          for (const pl of pointLines) {
            lines.push(pl);
            lines.push("");
          }
        } else {
          lines.push(`**${pt.category}:** ${pt.point}`);
          lines.push("");
        }
      }
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("Loading data...");
const data2024 = loadBoundaryData("data");
const data2026 = loadBoundaryData("data/2026");

const header = [
  "# Collin County Precinct Talking Points — Deep Analysis",
  "",
  `*Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}*`,
  "",
  "This document provides **deep analytical talking points** for every precinct in Collin County, covering both the 2024 and 2026 boundary sets. Unlike simple data summaries, each precinct analysis includes:",
  "",
  "- **Precinct archetype** classification based on cross-variable analysis",
  "- **County-wide rankings** and percentile positioning for every key metric",
  "- **Competitiveness scoring** with exact vote targets needed to flip or defend",
  "- **Cross-cutting insights** that surface unusual combinations (e.g. diverse + Republican, affluent + high-poverty)",
  "- **Campaign strategy** with computed voter mobilization and persuasion numbers",
  "- **Peer precinct matching** to transfer successful tactics between similar precincts",
  "",
  "---",
  "",
].join("\n");

console.log("Generating 2024 boundary analysis...");
const section2024 = generateSection(
  "2024 Boundaries",
  data2024.dncLookup,
  data2024.racialLookup,
  data2024.census
);

console.log("Generating 2026 boundary analysis...");
const section2026 = generateSection(
  "2026 Boundaries",
  data2026.dncLookup,
  data2026.racialLookup,
  data2026.census
);

const md = header + section2024 + "\n\n" + section2026;
writeFileSync("precinct-talking-points.md", md, "utf-8");

const lineCount = md.split("\n").length;
console.log(`\nDone. Wrote precinct-talking-points.md`);
console.log(`  Size: ${(md.length / 1024).toFixed(0)} KB, ${num(lineCount)} lines`);
console.log(`  Precincts: ${Object.keys(data2024.dncLookup).length} (2024) + ${Object.keys(data2026.dncLookup).length} (2026)`);
