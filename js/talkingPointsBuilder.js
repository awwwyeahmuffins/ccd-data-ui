// talkingPointsBuilder.js
// --------------------------------------------------------------------------------
// Targeted talking-points engine for precinct chairs. Pure functions only — no
// DOM, no HTML. Given the data the precinct report already loads (party lean,
// racial demographics, election history, PVI, strategy; census optional), it
// derives a plain-language "signature" of the precinct and turns it into
// talking points + a door-knocking script TAILORED to what the chair is trying
// to do (mobilize the base, persuade swing voters, or register & grow).
//
// Works for every county: it leans on the statewide party/racial/history data
// and only ENRICHES with census when present (Collin), never requires it.
//
// The orchestrator (precinctLookup.js) is responsible for escaping any returned
// text before it reaches innerHTML — these functions emit plain strings.

import { formatNumber, formatPct } from "./lib/format.js";

// ---------------------------------------------------------------------------
// Audiences — the three things a precinct chair is usually trying to do.
// ---------------------------------------------------------------------------

export const AUDIENCES = [
  {
    id: "mobilize",
    label: "Mobilize the base",
    icon: "\u{1F4E3}",
    blurb: "Turn out supporters who already agree but don't always vote.",
  },
  {
    id: "persuade",
    label: "Persuade swing voters",
    icon: "\u{1F91D}",
    blurb: "Win over moderates and weak partisans in a competitive precinct.",
  },
  {
    id: "register",
    label: "Register & grow",
    icon: "\u{1F331}",
    blurb: "Build long-term strength: new registrations and community presence.",
  },
];

export function isAudience(id) {
  return AUDIENCES.some((a) => a.id === id);
}

// ---------------------------------------------------------------------------
// Signature — a normalized, plain-language read of the precinct.
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {object|null} input.partyData   dnc_scores row: {demShare, repShare, modShare, dem, rep, mod, winningParty}
 * @param {object|null} input.racialData  racial row: {pct_white, pct_hispanic, pct_black, pct_asian, pct_others}
 * @param {object|null} input.votingHistory {byCategory:{Federal:[...]}}
 * @param {object|null} input.pvi         {pvi:Number (+=Dem), label:String}
 * @param {object|null} input.strategy    {classification: 'mobilize'|'persuade'|'defend'|'grow'}
 * @param {object|null} [input.census]    optional ACS profile (Collin only)
 * @returns {object} signature
 */
export function derivePrecinctSignature({
  partyData = null,
  racialData = null,
  votingHistory = null,
  pvi = null,
  strategy = null,
  census = null,
} = {}) {
  const demShare = num(partyData?.demShare);
  const repShare = num(partyData?.repShare);
  const modShare = num(partyData?.modShare);

  // Lean: prefer the vote-derived PVI; fall back to party shares.
  let leanParty = "Even";
  let leanLabel = "Even";
  let pviPts = null;
  if (pvi && pvi.label && pvi.label !== "N/A" && typeof pvi.pvi === "number") {
    pviPts = pvi.pvi;
    leanLabel = pvi.label;
    leanParty = pvi.pvi > 0.5 ? "Dem" : pvi.pvi < -0.5 ? "Rep" : "Even";
  } else if (demShare || repShare) {
    leanParty = demShare > repShare ? "Dem" : repShare > demShare ? "Rep" : "Even";
    leanLabel = leanParty === "Even" ? "Even" : `${leanParty === "Dem" ? "D" : "R"} lean`;
  }

  // Competitiveness from PVI magnitude (points).
  let competitiveness = "unknown";
  if (pviPts != null) {
    const mag = Math.abs(pviPts);
    competitiveness = mag < 5 ? "battleground" : mag < 12 ? "lean" : "safe";
  }

  // Most-recent federal race → true turnout + non-voter pool.
  const federal = Array.isArray(votingHistory?.byCategory?.Federal)
    ? votingHistory.byCategory.Federal
    : [];
  let recent = null;
  if (federal.length > 0) {
    recent = [...federal].sort((a, b) => extractYear(b.raceName) - extractYear(a.raceName))[0];
  }

  const registeredVoters = num(recent?.registeredVoters) || partyTotal(partyData);
  const totalVotes = num(recent?.totalVotes);
  const turnoutPct =
    recent && recent.registeredVoters > 0 ? (totalVotes / recent.registeredVoters) * 100 : null;
  const turnoutLevel =
    turnoutPct == null ? "unknown" : turnoutPct < 50 ? "low" : turnoutPct <= 65 ? "moderate" : "high";

  const nonVoters = registeredVoters && totalVotes ? Math.max(0, registeredVoters - totalVotes) : 0;
  // Split the non-voter pool by party lean to estimate who stayed home.
  const estDemNonVoters = Math.round(nonVoters * demShare);
  const estRepNonVoters = Math.round(nonVoters * repShare);
  const estModNonVoters = Math.round(nonVoters * modShare);

  // Diversity from the racial profile.
  let nonWhitePct = null;
  let majorityMinority = false;
  let topGroups = [];
  if (racialData) {
    const whiteFrac = num(racialData.pct_white);
    nonWhitePct = (1 - whiteFrac) * 100;
    majorityMinority = nonWhitePct > 50;
    // Largest NON-white communities — these drive culturally-relevant outreach.
    // The white share is already captured by nonWhitePct / majorityMinority.
    topGroups = [
      { label: "Hispanic", frac: num(racialData.pct_hispanic) },
      { label: "Black", frac: num(racialData.pct_black) },
      { label: "Asian", frac: num(racialData.pct_asian) },
    ]
      .filter((g) => g.frac > 0)
      .sort((a, b) => b.frac - a.frac);
  }

  return {
    leanParty,
    leanLabel,
    pviPts,
    competitiveness,
    demShare,
    repShare,
    modShare,
    registeredVoters,
    recentRaceName: recent?.raceName || null,
    turnoutPct,
    turnoutLevel,
    nonVoters,
    estDemNonVoters,
    estRepNonVoters,
    estModNonVoters,
    nonWhitePct,
    majorityMinority,
    topGroups,
    medianIncome: census?.income?.medianHousehold ?? null,
    strategyClass: strategy?.classification || null,
    hasData: !!(partyData || racialData || federal.length),
  };
}

/**
 * Default audience for this precinct, derived from the strategy classification
 * (or the signature when strategy is absent).
 * @returns {'mobilize'|'persuade'|'register'}
 */
export function recommendAudience(sig) {
  if (!sig) return "mobilize";
  switch (sig.strategyClass) {
    case "persuade":
      return "persuade";
    case "grow":
      return "register";
    case "mobilize":
    case "defend":
      return "mobilize";
    default:
      break;
  }
  // No strategy: infer from the signature.
  if (sig.competitiveness === "battleground" || sig.modShare > 0.32) return "persuade";
  if (sig.leanParty === "Rep" && sig.demShare > 0.2) return "register";
  if (sig.turnoutLevel === "low" && sig.demShare > 0.25) return "mobilize";
  return "mobilize";
}

// ---------------------------------------------------------------------------
// Targeted talking points
// ---------------------------------------------------------------------------

/**
 * Build talking points tailored to a specific audience/objective.
 * @returns {Array<{icon:string, category:string, text:string}>}
 */
export function buildTargetedTalkingPoints(sig, audienceId) {
  if (!sig || !sig.hasData) return [];
  const points = [];

  if (audienceId === "mobilize") {
    if (sig.estDemNonVoters > 0 && sig.turnoutPct != null) {
      points.push({
        icon: "\u{1F5F3}",
        category: "Turnout is the whole game",
        text: `Turnout in the last federal race was ${pct(sig.turnoutPct)}. An estimated ${formatNumber(
          sig.estDemNonVoters,
        )} of our voters stayed home — that pool is bigger than most local margins. Every door you knock and every reminder you send is a vote you're adding, not persuading.`,
      });
    }
    if (sig.leanParty === "Dem" || sig.demShare >= 0.4) {
      points.push({
        icon: "\u{1F4AA}",
        category: "We already have the support",
        text: `This precinct leans ${sig.leanLabel}. You don't need to change minds here — you need to make sure supporters have a plan to vote: when, where, and how. Lead with the deadline and the polling location.`,
      });
    }
    if (sig.turnoutLevel === "low") {
      points.push({
        icon: "\u{23F0}",
        category: "Low-turnout opportunity",
        text: `Turnout here runs below average, which means a focused GOTV push moves the needle more than it would in a high-turnout precinct. Prioritize repeat contact with infrequent voters in the final two weeks.`,
      });
    }
  } else if (audienceId === "persuade") {
    if (sig.competitiveness === "battleground") {
      points.push({
        icon: "\u{2696}\u{FE0F}",
        category: "A true battleground",
        text: `This precinct is genuinely competitive (${sig.leanLabel}). Small shifts decide it, so persuasion conversations here are worth more than almost anywhere else. Listen first, find the one issue that matters to this voter, and connect it to the ballot.`,
      });
    }
    if (sig.modShare > 0.1) {
      points.push({
        icon: "\u{1F91D}",
        category: "Moderates are the deciders",
        text: `Roughly ${pct(sig.modShare * 100)} of voters here are moderates or weak partisans. Skip the base-rallying language — talk about practical results, lowering costs, and local quality-of-life. Avoid litmus-test framing that pushes them away.`,
      });
    }
    points.push({
      icon: "\u{1F4AC}",
      category: "Meet them where they are",
      text: `Swing voters respond to specifics, not slogans. Bring two or three concrete, locally relevant points and ask what THEY care about before you pitch. A respectful conversation beats a script.`,
    });
  } else if (audienceId === "register") {
    if (sig.leanParty === "Rep" && sig.demShare > 0.15) {
      points.push({
        icon: "\u{1F331}",
        category: "Untapped support",
        text: `This precinct leans ${sig.leanLabel}, but there's a real base here (${pct(
          sig.demShare * 100,
        )} of the vote). The growth play is registration and showing up consistently — invest now and it compounds over cycles.`,
      });
    }
    if (sig.majorityMinority) {
      points.push({
        icon: "\u{1F30D}",
        category: "Growing, diverse community",
        text: `This is a majority-minority precinct (${pct(
          sig.nonWhitePct,
        )} non-white). Culturally relevant, multilingual outreach and trusted local messengers register far more voters than generic mail. Partner with community institutions already here.`,
      });
    }
    points.push({
      icon: "\u{1F4CB}",
      category: "Make registration easy",
      text: `Carry registration forms and the online-registration link on every door. Capture the deadline, help with the form on the spot, and follow up to confirm they're on the roll and have a vote plan.`,
    });
  }

  // Shared context point (income enrichment, Collin only).
  if (sig.medianIncome != null && points.length < 5) {
    points.push({
      icon: "\u{1F4B0}",
      category: "Economic frame",
      text: `Median household income here is about $${formatNumber(
        Math.round(sig.medianIncome),
      )}. Tie your message to the kitchen-table issues these households actually feel — costs, wages, taxes, and services.`,
    });
  }

  return points.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Door-knocking script
// ---------------------------------------------------------------------------

/**
 * A short, copy/print-ready canvassing script with the precinct's real numbers.
 * @returns {string}
 */
export function buildCanvassScript(sig, audienceId, code) {
  if (!sig) return "";
  const aud = AUDIENCES.find((a) => a.id === audienceId) || AUDIENCES[0];
  const lines = [];
  lines.push(`PRECINCT ${code} — DOOR SCRIPT (${aud.label})`);
  lines.push("");
  lines.push(`Opener: "Hi, I'm [name], a volunteer with [organization] here in the neighborhood."`);
  lines.push("");

  if (audienceId === "mobilize") {
    lines.push(`The ask: "Can I count on you to vote this election? Do you know where your polling place is?"`);
    lines.push("");
    lines.push("Remember:");
    lines.push(`- This precinct leans ${sig.leanLabel} — you're confirming a plan, not arguing.`);
    if (sig.turnoutPct != null) {
      lines.push(`- Last federal turnout was ${pct(sig.turnoutPct)}; ~${formatNumber(sig.estDemNonVoters)} of our voters didn't show.`);
    }
    lines.push("- Pin down the WHEN (early-vote date or election day) before you leave.");
  } else if (audienceId === "persuade") {
    lines.push(`The ask: "What issues are on your mind for this election?" (Listen. Then connect.)`);
    lines.push("");
    lines.push("Remember:");
    lines.push(`- Competitive precinct (${sig.leanLabel}) — your conversation can decide it.`);
    if (sig.modShare > 0) {
      lines.push(`- ~${pct(sig.modShare * 100)} are moderates: lead with results, not labels.`);
    }
    lines.push("- One genuine, specific point beats five talking points.");
  } else {
    lines.push(`The ask: "Are you registered to vote at your current address?" (If not, help them now.)`);
    lines.push("");
    lines.push("Remember:");
    lines.push("- Carry forms + the online registration link.");
    if (sig.majorityMinority) {
      lines.push(`- ${pct(sig.nonWhitePct)} non-white — use trusted messengers and the right languages.`);
    }
    lines.push("- Get contact info and follow up to confirm registration + vote plan.");
  }

  lines.push("");
  lines.push(`Close: "Thanks for your time — here's how to reach us with any questions."`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function partyTotal(partyData) {
  if (!partyData) return 0;
  return num(partyData.rep) + num(partyData.mod) + num(partyData.dem);
}

function pct(value) {
  return formatPct(value == null ? null : value / 100);
}

function extractYear(name) {
  if (!name) return 0;
  const m = String(name).match(/(\d{4})/);
  return m ? Number(m[1]) : 0;
}
