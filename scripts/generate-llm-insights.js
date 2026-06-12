#!/usr/bin/env node
// generate-llm-insights.js
// Runs each precinct's full data profile through Claude Haiku on Bedrock
// to generate unique, narrative insights that go beyond template analysis.
// Then merges the LLM insights into the existing talking points markdown.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-providers";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_ID = "us.anthropic.claude-sonnet-4-20250514-v1:0";
const AWS_PROFILE = "ccd";
const AWS_REGION = "us-east-1";
const MAX_CONCURRENT = 5; // parallel requests (lower for heavier model)
const MAX_TOKENS = 600;
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 2000;
const CACHE_FILE = "data/cache/llm-insights-cache.json";

// ---------------------------------------------------------------------------
// AWS client
// ---------------------------------------------------------------------------

const client = new BedrockRuntimeClient({
  region: AWS_REGION,
  credentials: fromIni({ profile: AWS_PROFILE }),
});

// ---------------------------------------------------------------------------
// Data loading (reused from generate-talking-points.js)
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
  const dncRaw = readFileSync(`${dataDir}/profile/dnc_scores.csv`, "utf-8");
  const racialRaw = readFileSync(`${dataDir}/Racial Numbers by Precinct.csv`, "utf-8");
  const censusRaw = readFileSync(`${dataDir}/profile/census_profiles.json`, "utf-8");

  const census = JSON.parse(censusRaw);
  const dncRows = parseCSV(dncRaw);
  const racialRows = parseCSV(racialRaw);

  const dncLookup = {};
  for (const row of dncRows) {
    dncLookup[row.Precinct] = row;
  }

  const racialLookup = {};
  for (const row of racialRows) {
    racialLookup[row.precinct] = row;
  }

  return { dncLookup, racialLookup, census };
}

function computeCountyContext(data) {
  const codes = Object.keys(data.dncLookup);
  const censusVals = codes.map((c) => data.census[c]).filter(Boolean).filter((c) => c.population > 50);

  const incomes = censusVals.map((c) => c.income?.medianHousehold).filter(Boolean).sort((a, b) => a - b);
  const ages = censusVals.map((c) => c.age?.medianAge).filter(Boolean).sort((a, b) => a - b);
  const homeVals = censusVals.map((c) => c.housing?.medianHomeValue).filter(Boolean).sort((a, b) => a - b);

  const dncVals = Object.values(data.dncLookup);
  const totalVoters = dncVals.reduce((s, r) => s + (+r.Total || 0), 0);
  const totalDem = dncVals.reduce((s, r) => s + (+r.Dem || 0), 0);
  const totalRep = dncVals.reduce((s, r) => s + (+r.Rep || 0), 0);
  const totalMod = dncVals.reduce((s, r) => s + (+r.Mod || 0), 0);

  // Find most competitive precincts
  const margins = codes.map((c) => {
    const d = data.dncLookup[c];
    return { code: c, margin: Math.abs((+d["Rep Share"]) - (+d["Dem Share"])) };
  }).sort((a, b) => a.margin - b.margin);

  return {
    totalPrecincts: codes.length,
    totalVoters,
    totalDem,
    totalRep,
    totalMod,
    medianIncome: incomes[Math.floor(incomes.length / 2)] || 0,
    medianAge: ages[Math.floor(ages.length / 2)] || 0,
    medianHomeValue: homeVals[Math.floor(homeVals.length / 2)] || 0,
    top10Competitive: margins.slice(0, 10).map((m) => m.code),
    demShare: totalDem / totalVoters,
    repShare: totalRep / totalVoters,
    modShare: totalMod / totalVoters,
  };
}

// ---------------------------------------------------------------------------
// Build the prompt for one precinct
// ---------------------------------------------------------------------------

function buildPrompt(code, data, countyCtx, boundaryLabel) {
  const dnc = data.dncLookup[code];
  const racial = data.racialLookup[code];
  const census = data.census[code];
  const isCompetitive = countyCtx.top10Competitive.includes(code);

  // Build compact data blob
  let dataBlock = `PRECINCT ${code} (${boundaryLabel})\n`;

  if (dnc) {
    dataBlock += `\nPARTY REGISTRATION:\n`;
    dataBlock += `  Total voters: ${dnc.Total}\n`;
    dataBlock += `  Republican: ${dnc.Rep} (${(+dnc["Rep Share"] * 100).toFixed(1)}%)\n`;
    dataBlock += `  Moderate: ${dnc.Mod} (${(+dnc["Mod Share"] * 100).toFixed(1)}%)\n`;
    dataBlock += `  Democrat: ${dnc.Dem} (${(+dnc["Dem Share"] * 100).toFixed(1)}%)\n`;
    dataBlock += `  Winning party: ${dnc["Winning Party"]} (strength ${dnc["Party Strength"]}/3)\n`;
    if (isCompetitive) dataBlock += `  ** TOP 10 MOST COMPETITIVE PRECINCT IN THE COUNTY **\n`;
  }

  if (racial) {
    dataBlock += `\nRACIAL DEMOGRAPHICS:\n`;
    dataBlock += `  White: ${racial.pct_white} | Asian: ${racial.pct_asian} | Hispanic: ${racial.pct_hispanic} | Black: ${racial.pct_black} | Other: ${racial.pct_others}\n`;
    dataBlock += `  Total population (racial): ${racial.total}\n`;
  }

  if (census) {
    dataBlock += `\nCENSUS PROFILE:\n`;
    dataBlock += `  Population: ${census.population} | Density: ${census.populationDensity}/sq mi\n`;

    if (census.age) {
      dataBlock += `  Age: median ${census.age.medianAge} | Under 18: ${(census.age.under18 * 100).toFixed(1)}% | 18-34: ${(census.age["18to34"] * 100).toFixed(1)}% | 35-54: ${(census.age["35to54"] * 100).toFixed(1)}% | 55-64: ${(census.age["55to64"] * 100).toFixed(1)}% | 65+: ${(census.age["65plus"] * 100).toFixed(1)}%\n`;
    }
    if (census.income) {
      dataBlock += `  Income: median $${census.income.medianHousehold?.toLocaleString()} | Poverty: ${(census.income.povertyRate * 100).toFixed(1)}%\n`;
      if (census.income.brackets) {
        dataBlock += `  Brackets: <$50k: ${(census.income.brackets.under50k * 100).toFixed(1)}% | $50-100k: ${(census.income.brackets["50kTo100k"] * 100).toFixed(1)}% | $100-150k: ${(census.income.brackets["100kTo150k"] * 100).toFixed(1)}% | $150-200k: ${(census.income.brackets["150kTo200k"] * 100).toFixed(1)}% | >$200k: ${(census.income.brackets.over200k * 100).toFixed(1)}%\n`;
      }
    }
    if (census.education) {
      dataBlock += `  Education: HS or less ${(census.education.highSchoolOrLess * 100).toFixed(1)}% | Some college ${(census.education.someCollege * 100).toFixed(1)}% | Bachelor's ${(census.education.bachelors * 100).toFixed(1)}% | Graduate ${(census.education.graduateProfessional * 100).toFixed(1)}%\n`;
    }
    if (census.housing) {
      dataBlock += `  Housing: Owner ${(census.housing.ownerOccupied * 100).toFixed(1)}% | Renter ${(census.housing.renterOccupied * 100).toFixed(1)}% | Home value $${census.housing.medianHomeValue?.toLocaleString()} | Rent $${census.housing.medianRent?.toLocaleString()}/mo\n`;
    }
    if (census.employment) {
      dataBlock += `  Employment: Unemployment ${(census.employment.unemploymentRate * 100).toFixed(1)}% | Labor force ${(census.employment.laborForceParticipation * 100).toFixed(1)}%\n`;
      if (census.employment.topOccupations?.length) {
        dataBlock += `  Top occupations: ${census.employment.topOccupations.map((o) => `${o.name} ${(o.share * 100).toFixed(0)}%`).join(", ")}\n`;
      }
      if (census.employment.topIndustries?.length) {
        dataBlock += `  Top industries: ${census.employment.topIndustries.map((o) => `${o.name} ${(o.share * 100).toFixed(0)}%`).join(", ")}\n`;
      }
    }
    if (census.commute) {
      dataBlock += `  Commute: Drove alone ${(census.commute.droveAlone * 100).toFixed(1)}% | WFH ${(census.commute.workedFromHome * 100).toFixed(1)}% | Mean ${census.commute.meanCommuteMinutes?.toFixed(1)} min\n`;
    }
    if (census.language) {
      dataBlock += `  Language: English only ${(census.language.englishOnly * 100).toFixed(1)}% | Spanish ${(census.language.spanish * 100).toFixed(1)}% | Asian languages ${(census.language.asianLanguages * 100).toFixed(1)}%\n`;
    }
    if (census.veterans) {
      dataBlock += `  Veterans: ${census.veterans.total} (${(census.veterans.share * 100).toFixed(1)}%)\n`;
    }
    if (census.insurance) {
      dataBlock += `  Insurance: Insured ${(census.insurance.insured * 100).toFixed(1)}% | Uninsured ${(census.insurance.uninsured * 100).toFixed(1)}%\n`;
    }
    if (census.households) {
      dataBlock += `  Households: ${census.households.total} total | Married couples ${census.households.marriedCouples} | Single parent ${census.households.singleParent} | Avg size ${census.households.averageSize}\n`;
    }
    if (census.projections) {
      const p = census.projections;
      dataBlock += `  Projections (${p.targetYear}): Pop ${p.population?.projected?.toLocaleString()} (${(p.population?.cagr * 100).toFixed(1)}%/yr)`;
      if (p.medianIncome) dataBlock += ` | Income $${p.medianIncome.projected?.toLocaleString()} (${(p.medianIncome.cagr * 100).toFixed(1)}%/yr)`;
      if (p.medianHomeValue) dataBlock += ` | Home $${p.medianHomeValue.projected?.toLocaleString()} (${(p.medianHomeValue.cagr * 100).toFixed(1)}%/yr)`;
      dataBlock += `\n`;
    }
  }

  // County context for comparison
  let countyBlock = `\nCOUNTY CONTEXT (${countyCtx.totalPrecincts} precincts):\n`;
  countyBlock += `  Total voters: ${countyCtx.totalVoters.toLocaleString()} | R ${(countyCtx.repShare * 100).toFixed(1)}% / M ${(countyCtx.modShare * 100).toFixed(1)}% / D ${(countyCtx.demShare * 100).toFixed(1)}%\n`;
  countyBlock += `  County median income: $${countyCtx.medianIncome.toLocaleString()} | Median age: ${countyCtx.medianAge} | Median home value: $${countyCtx.medianHomeValue.toLocaleString()}\n`;

  const systemPrompt = `You are a senior Democratic campaign strategist with 20+ years in Texas suburban politics — specifically Collin County (Plano, Frisco, McKinney, Allen, Wylie, Princeton, Celina, Prosper, Lucas, Fairview, Murphy, Sachse, Richardson north). You've run field operations, managed precinct-level targeting, and know these communities block by block.

Your job: analyze one precinct's complete data profile and produce insights that a campaign staffer can ONLY get from expert synthesis — not from reading raw numbers.

STRICT RULES:
1. NEVER restate data. The staffer has the spreadsheet. Every sentence must pass: "Could I get this from the numbers alone?" If yes, DELETE it.
2. SYNTHESIZE across dimensions. What does the COMBINATION of variables mean? (e.g. high Asian + high income + moderate-lean + WFH = specific voter persona with specific concerns)
3. NAME voter personas you see in the data — be specific. Not "educated voters" but "dual-income tech couples in new-build subdivisions" or "retired military officers in established neighborhoods."
4. Give CONCRETE tactics: what events to host, what doors to knock first, what time of day to canvass, what platform to advertise on, what community organizations to partner with.
5. Identify what makes this precinct UNUSUAL or CONTRADICTORY. Internal tensions in the data (diverse + Republican, poor + educated, old + renter) reveal the real story.
6. Be DIRECT and OPINIONATED. No hedging. Say what you'd actually tell a campaign manager in a strategy meeting.
7. Reference SPECIFIC Collin County context — name cities, corridors (US-75, DNT, Sam Rayburn Tollway), school districts (Plano ISD, Frisco ISD, Allen ISD, McKinney ISD), major employers (Toyota, JPMorgan Chase, Capital One, Liberty Mutual, Frito-Lay), and known community dynamics.
8. Write exactly 3 paragraphs. Each paragraph = one distinct strategic insight. No overlap between paragraphs.
9. No headers, no bullet points, no markdown. Flowing prose only.
10. Maximum 200 words per paragraph. Be dense with insight, not words.`;

  const userPrompt = `Analyze this precinct and give me insights I can't get from the spreadsheet alone.

${dataBlock}
${countyBlock}`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// Call Bedrock
// ---------------------------------------------------------------------------

async function callBedrock(systemPrompt, userPrompt) {
  const cmd = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const resp = await client.send(cmd);
  const result = JSON.parse(new TextDecoder().decode(resp.body));
  return {
    text: result.content[0].text,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
  };
}

async function callBedrockWithRetry(systemPrompt, userPrompt) {
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try {
      return await callBedrock(systemPrompt, userPrompt);
    } catch (err) {
      if (attempt === RETRY_LIMIT) throw err;
      const isThrottle = err.name === "ThrottlingException" || err.$metadata?.httpStatusCode === 429;
      const delay = isThrottle ? RETRY_DELAY_MS * attempt * 2 : RETRY_DELAY_MS * attempt;
      console.warn(`  Retry ${attempt}/${RETRY_LIMIT} after ${delay}ms: ${err.message}`);
      await sleep(delay);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Process all precincts with concurrency control
// ---------------------------------------------------------------------------

async function processAllPrecincts(data, countyCtx, boundaryLabel, cache) {
  const codes = Object.keys(data.dncLookup).sort((a, b) => +a - +b);
  const cacheKey = boundaryLabel.replace(/\s+/g, "_").toLowerCase();
  const results = {};
  let totalInput = 0;
  let totalOutput = 0;
  let cached = 0;
  let generated = 0;

  // Check cache
  const toGenerate = [];
  for (const code of codes) {
    const key = `${cacheKey}_${code}`;
    if (cache[key]) {
      results[code] = cache[key];
      cached++;
    } else {
      toGenerate.push(code);
    }
  }

  if (cached > 0) {
    console.log(`  ${cached} precincts loaded from cache, ${toGenerate.length} to generate`);
  }

  // Process in batches
  for (let i = 0; i < toGenerate.length; i += MAX_CONCURRENT) {
    const batch = toGenerate.slice(i, i + MAX_CONCURRENT);
    const promises = batch.map(async (code) => {
      const { systemPrompt, userPrompt } = buildPrompt(code, data, countyCtx, boundaryLabel);
      const result = await callBedrockWithRetry(systemPrompt, userPrompt);
      return { code, ...result };
    });

    const batchResults = await Promise.all(promises);

    for (const r of batchResults) {
      results[r.code] = r.text;
      cache[`${cacheKey}_${r.code}`] = r.text;
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;
      generated++;
    }

    // Progress
    const done = cached + generated;
    const pctDone = ((done / codes.length) * 100).toFixed(0);
    const costSoFar = (totalInput * 3.0 + totalOutput * 15.0) / 1_000_000;
    process.stdout.write(`\r  ${boundaryLabel}: ${done}/${codes.length} (${pctDone}%) — ${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out — $${costSoFar.toFixed(3)}`);

    // Small delay between batches to avoid throttling
    if (i + MAX_CONCURRENT < toGenerate.length) {
      await sleep(200);
    }
  }

  const totalCost = (totalInput * 3.0 + totalOutput * 15.0) / 1_000_000;
  console.log(`\n  Done: ${generated} generated, ${cached} cached. Cost: $${totalCost.toFixed(3)} (${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out)`);

  return { results, totalInput, totalOutput };
}

// ---------------------------------------------------------------------------
// Merge LLM insights into the existing markdown
// ---------------------------------------------------------------------------

function mergeIntoMarkdown(existingMd, insights2024, insights2026) {
  let md = existingMd;

  // For each precinct in both sets, insert the LLM insight after the last point
  // We'll look for the pattern "---" that follows each precinct and insert before it

  function insertInsights(text, insights, sectionLabel) {
    const codes = Object.keys(insights).sort((a, b) => +a - +b);

    for (const code of codes) {
      const insight = insights[code];
      if (!insight) continue;

      // Find the precinct header in this section
      // We need to match within the right boundary section
      const precinctHeader = `## Precinct ${code}\n`;

      // Find all occurrences of this header
      let searchFrom = 0;
      if (sectionLabel === "2026 Boundaries") {
        // Find the 2026 section start
        const sectionStart = text.indexOf("# 2026 Boundaries");
        if (sectionStart !== -1) searchFrom = sectionStart;
      }

      const headerIdx = text.indexOf(precinctHeader, searchFrom);
      if (headerIdx === -1) continue;

      // Find the "---" that ends this precinct's section
      const nextSeparator = text.indexOf("\n---\n", headerIdx + precinctHeader.length);
      if (nextSeparator === -1) continue;

      // Insert the LLM insight before the separator
      const insertText = `**Strategic Intelligence (AI Analysis):** ${insight}\n\n`;
      text = text.slice(0, nextSeparator) + "\n" + insertText + text.slice(nextSeparator);
    }

    return text;
  }

  md = insertInsights(md, insights2024, "2024 Boundaries");
  md = insertInsights(md, insights2026, "2026 Boundaries");

  return md;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== LLM Insight Generator ===");
  console.log(`Model: ${MODEL_ID}`);
  console.log(`Max concurrent: ${MAX_CONCURRENT}\n`);

  // Load cache
  let cache = {};
  if (existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
      console.log(`Loaded ${Object.keys(cache).length} cached insights from ${CACHE_FILE}`);
    } catch (e) {
      console.log("Cache file corrupted, starting fresh");
    }
  }

  // Load data
  console.log("Loading 2024 boundary data...");
  const data2024 = loadBoundaryData("data/tx/collin/2024");
  const ctx2024 = computeCountyContext(data2024);

  console.log("Loading 2026 boundary data...");
  const data2026 = loadBoundaryData("data/tx/collin/2026");
  const ctx2026 = computeCountyContext(data2026);

  // Generate insights
  console.log(`\nGenerating LLM insights for ${Object.keys(data2024.dncLookup).length} (2024) + ${Object.keys(data2026.dncLookup).length} (2026) precincts...\n`);

  const r2024 = await processAllPrecincts(data2024, ctx2024, "2024 Boundaries", cache);
  const r2026 = await processAllPrecincts(data2026, ctx2026, "2026 Boundaries", cache);

  // Save cache
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  console.log(`\nCache saved to ${CACHE_FILE}`);

  // Total cost
  const totalInput = r2024.totalInput + r2026.totalInput;
  const totalOutput = r2024.totalOutput + r2026.totalOutput;
  const totalCost = (totalInput * 3.0 + totalOutput * 15.0) / 1_000_000;
  console.log(`Total cost: $${totalCost.toFixed(3)} (${totalInput.toLocaleString()} input + ${totalOutput.toLocaleString()} output tokens)`);

  // Merge into existing markdown
  console.log("\nMerging insights into precinct-talking-points.md...");
  const existingMd = readFileSync("precinct-talking-points.md", "utf-8");
  const mergedMd = mergeIntoMarkdown(existingMd, r2024.results, r2026.results);
  writeFileSync("precinct-talking-points.md", mergedMd, "utf-8");

  const lines = mergedMd.split("\n").length;
  console.log(`Done. Updated precinct-talking-points.md (${(mergedMd.length / 1024).toFixed(0)} KB, ${lines.toLocaleString()} lines)`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
