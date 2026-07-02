// turnoutSimulator.js
// ===================
// Turnout simulation engine for election forecasting.
// Allows users to model how different turnout scenarios affect race outcomes.

// ============================================================================
// VALID PARTY CODES
// ============================================================================

// Supports both mixed case (Rep, Dem) and uppercase (REP, DEM) party codes
let VALID_PARTIES = new Set([
  'Rep', 'Dem', 'Mod', 'Lib', 'Grn', 'Ind', 'Con', 'For', 'Against',
  'REP', 'DEM', 'MOD', 'LIB', 'GRN', 'IND', 'CON', 'FOR', 'AGAINST'
]);

// Map uppercase to normalized codes for turnout multipliers
let PARTY_NORMALIZE = {
  'REP': 'Rep',
  'DEM': 'Dem',
  'MOD': 'Mod',
  'LIB': 'Lib',
  'GRN': 'Grn',
  'IND': 'Ind',
  'CON': 'Con',
  'FOR': 'For',
  'AGAINST': 'Against'
};

// ============================================================================
// PURE CALCULATION FUNCTIONS
// ============================================================================

/**
 * Calculate adjusted votes based on turnout multiplier.
 * 
 * @param {number} partyRegistration - Number of registered voters for this party in precinct
 * @param {number} baseVoteShare - Original vote share (0-1) for this party's candidate
 * @param {number} turnoutMultiplier - Turnout adjustment (0.5-1.0, where 1.0 = 100% of baseline)
 * @returns {number} Adjusted vote count
 */
export function calculateAdjustedVotes(partyRegistration, baseVoteShare, turnoutMultiplier) {
  if (partyRegistration == null || isNaN(partyRegistration) || partyRegistration < 0) {
    return 0;
  }
  if (baseVoteShare == null || isNaN(baseVoteShare)) {
    return 0;
  }
  if (turnoutMultiplier == null || isNaN(turnoutMultiplier)) {
    turnoutMultiplier = 1.0;
  }
  // Clamp turnout multiplier to valid range [0.5, 1.0]
  turnoutMultiplier = Math.max(0.5, Math.min(1.0, turnoutMultiplier));
  
  // Calculate base expected votes and apply turnout multiplier
  const adjustedVotes = partyRegistration * baseVoteShare * turnoutMultiplier;
  return Math.round(adjustedVotes);
}

// ============================================================================
// ENHANCED TURNOUT FUNCTIONS (More Turnout + Voter Flip)
// ============================================================================

/**
 * Estimate how many voters of each party actually voted in this precinct.
 * Uses vote-share assumption: party's share of voters = party's share of votes.
 * 
 * @param {Object} electionRow - Election data for precinct
 * @param {Array} candidates - List of candidate names
 * @param {Object} dncRow - DNC data with Rep, Dem, Mod registration counts
 * @returns {Object} { repVoted, demVoted, modVoted, totalVoted }
 */
export function estimatePartyVotersInPrecinct(electionRow, candidates, dncRow) {
  if (!electionRow || !candidates || !dncRow) {
    return { repVoted: 0, demVoted: 0, modVoted: 0, totalVoted: 0 };
  }

  // Calculate total votes by party
  let repVotes = 0, demVotes = 0, modVotes = 0, totalVotes = 0;
  
  for (let candidate of candidates) {
    let party = extractParty(candidate);
    let normalizedParty = party ? (PARTY_NORMALIZE[party] || party) : null;
    let votes = Number(electionRow[candidate]) || 0;
    totalVotes += votes;

    if (normalizedParty === 'Rep') repVotes += votes;
    else if (normalizedParty === 'Dem') demVotes += votes;
    else if (normalizedParty === 'Mod' || normalizedParty === 'Lib' || normalizedParty === 'Grn') modVotes += votes;
  }

  if (totalVotes === 0) {
    return { repVoted: 0, demVoted: 0, modVoted: 0, totalVoted: 0 };
  }

  // Get ballots cast (total voters who participated)
  const ballotsCast = Number(electionRow['BALLOTS CAST TOTAL']) || totalVotes;

  // Estimate party voters based on vote share
  const repShare = repVotes / totalVotes;
  const demShare = demVotes / totalVotes;
  const modShare = modVotes / totalVotes;

  return {
    repVoted: Math.round(ballotsCast * repShare),
    demVoted: Math.round(ballotsCast * demShare),
    modVoted: Math.round(ballotsCast * modShare),
    totalVoted: ballotsCast
  };
}

/**
 * Calculate non-voters by party registration.
 * Assumes non-voters are distributed in proportion to DNC registration.
 * 
 * @param {Object} electionRow - Election data for precinct
 * @param {Array} candidates - List of candidate names
 * @param {Object} dncRow - DNC data with Rep, Dem, Mod registration counts
 * @returns {Object} { repNonVoters, demNonVoters, modNonVoters, totalNonVoters }
 */
export function calculateNonVotersByParty(electionRow, candidates, dncRow) {
  if (!electionRow || !dncRow) {
    return { repNonVoters: 0, demNonVoters: 0, modNonVoters: 0, totalNonVoters: 0 };
  }

  const registeredTotal = Number(electionRow['REGISTERED VOTERS TOTAL']) || 0;
  const ballotsCast = Number(electionRow['BALLOTS CAST TOTAL']) || 0;
  const totalNonVoters = Math.max(0, registeredTotal - ballotsCast);

  if (totalNonVoters === 0) {
    return { repNonVoters: 0, demNonVoters: 0, modNonVoters: 0, totalNonVoters: 0 };
  }

  // Get party registration from DNC data
  const repReg = Number(dncRow.Rep) || 0;
  const demReg = Number(dncRow.Dem) || 0;
  const modReg = Number(dncRow.Mod) || 0;
  const dncTotal = repReg + demReg + modReg;

  if (dncTotal === 0) {
    return { repNonVoters: 0, demNonVoters: 0, modNonVoters: 0, totalNonVoters };
  }

  // Non-voters by party = party registration - estimated party voters, clamped to >= 0
  // Also proportionally distribute based on DNC shares
  const repNonVoters = Math.max(0, Math.round(totalNonVoters * (repReg / dncTotal)));
  const demNonVoters = Math.max(0, Math.round(totalNonVoters * (demReg / dncTotal)));
  const modNonVoters = Math.max(0, Math.round(totalNonVoters * (modReg / dncTotal)));

  return {
    repNonVoters,
    demNonVoters,
    modNonVoters,
    totalNonVoters
  };
}

/**
 * Simulate precinct outcome with party turnout above 100%.
 * When multiplier > 1.0, adds votes from that party's non-voters.
 * 
 * @param {Object} electionRow - Election data for precinct
 * @param {Object} dncRow - DNC data
 * @param {Object} turnoutMultipliers - { Rep: 1.1, Dem: 0.9, Mod: 1.0 } (0.5-1.5 range)
 * @param {Array} candidates - List of candidate names
 * @returns {Object} { adjustedVotes, winner, originalWinner, flipped }
 */
export function simulatePrecinctWithExtendedTurnout(electionRow, dncRow, turnoutMultipliers, candidates) {
  if (!electionRow || !dncRow || !candidates || !Array.isArray(candidates)) {
    return { adjustedVotes: {}, winner: null, originalWinner: null, flipped: false };
  }

  let adjustedVotes = {};
  let originalVotes = {};

  // Calculate non-voters by party for adding votes when multiplier > 1
  let nonVoters = calculateNonVotersByParty(electionRow, candidates, dncRow);

  // Calculate original total votes
  let originalTotalVotes = 0;
  for (let candidate of candidates) {
    let votes = Number(electionRow[candidate]) || 0;
    originalVotes[candidate] = votes;
    originalTotalVotes += votes;
  }

  if (originalTotalVotes === 0) {
    return { adjustedVotes: {}, winner: null, originalWinner: null, flipped: false };
  }

  // Calculate votes by party for proportional allocation
  let votesByParty = { Rep: 0, Dem: 0, Mod: 0 };
  for (let candidate of candidates) {
    let party = extractParty(candidate);
    let normalizedParty = party ? (PARTY_NORMALIZE[party] || party) : null;
    let votes = Number(electionRow[candidate]) || 0;

    if (normalizedParty === 'Rep') votesByParty.Rep += votes;
    else if (normalizedParty === 'Dem') votesByParty.Dem += votes;
    else if (normalizedParty === 'Mod' || normalizedParty === 'Lib' || normalizedParty === 'Grn') votesByParty.Mod += votes;
  }

  // For each candidate, apply the appropriate turnout multiplier
  for (let candidate of candidates) {
    let party = extractParty(candidate);
    let normalizedParty = party ? (PARTY_NORMALIZE[party] || party) : null;
    let originalVoteCount = Number(electionRow[candidate]) || 0;

    // Get multiplier for this party (default to 1.0)
    let multiplier = 1.0;
    let partyNonVoters = 0;
    let partyBaseVotes = 0;

    if (normalizedParty === 'Rep') {
      multiplier = turnoutMultipliers.Rep ?? 1.0;
      partyNonVoters = nonVoters.repNonVoters;
      partyBaseVotes = votesByParty.Rep;
    } else if (normalizedParty === 'Dem') {
      multiplier = turnoutMultipliers.Dem ?? 1.0;
      partyNonVoters = nonVoters.demNonVoters;
      partyBaseVotes = votesByParty.Dem;
    } else if (normalizedParty === 'Mod' || normalizedParty === 'Lib' || normalizedParty === 'Grn') {
      multiplier = turnoutMultipliers.Mod ?? 1.0;
      partyNonVoters = nonVoters.modNonVoters;
      partyBaseVotes = votesByParty.Mod;
    } else if (normalizedParty === 'For' || normalizedParty === 'Against') {
      // For propositions, use average of all multipliers
      multiplier = ((turnoutMultipliers.Rep ?? 1.0) + (turnoutMultipliers.Dem ?? 1.0) + (turnoutMultipliers.Mod ?? 1.0)) / 3;
    }

    // Clamp multiplier to valid range [0.5, 1.5]
    multiplier = Math.max(0.5, Math.min(1.5, multiplier));

    if (multiplier <= 1.0) {
      // Reduce turnout: scale down original votes
      adjustedVotes[candidate] = Math.round(originalVoteCount * multiplier);
    } else {
      // Increase turnout: add votes from non-voters
      // Calculate extra votes as percentage of baseline, capped at available non-voters
      const extraVotesNeeded = originalVoteCount * (multiplier - 1.0);
      
      // Allocate proportionally from party's non-voters
      // This candidate's share of party votes
      const candidateShareOfParty = partyBaseVotes > 0 ? originalVoteCount / partyBaseVotes : 0;
      const availableFromNonVoters = partyNonVoters * candidateShareOfParty;
      const extraVotes = Math.min(extraVotesNeeded, availableFromNonVoters);
      
      adjustedVotes[candidate] = Math.round(originalVoteCount + extraVotes);
    }
  }

  let originalWinner = determineWinner(originalVotes);
  let simulatedWinner = determineWinner(adjustedVotes);

  let flipped = originalWinner.name !== simulatedWinner.name &&
                originalWinner.name !== null &&
                simulatedWinner.name !== null;

  return {
    adjustedVotes,
    winner: simulatedWinner,
    originalWinner,
    flipped
  };
}

/**
 * Simulate precinct outcome with target turnout percentage.
 * 
 * @param {Object} electionRow - Election data for precinct
 * @param {Object} dncRow - DNC data
 * @param {number} targetTurnoutPct - Target turnout as decimal (e.g., 0.55 for 55%)
 * @param {Array} candidates - List of candidate names
 * @returns {Object} { adjustedVotes, winner, originalWinner, flipped }
 */
export function simulatePrecinctWithTargetTurnout(electionRow, dncRow, targetTurnoutPct, candidates) {
  if (!electionRow || !dncRow || !candidates || !Array.isArray(candidates)) {
    return { adjustedVotes: {}, winner: null, originalWinner: null, flipped: false };
  }

  let registeredTotal = Number(electionRow['REGISTERED VOTERS TOTAL']) || 0;
  let ballotsCast = Number(electionRow['BALLOTS CAST TOTAL']) || 0;

  if (registeredTotal === 0) {
    return { adjustedVotes: {}, winner: null, originalWinner: null, flipped: false };
  }

  let currentTurnout = ballotsCast / registeredTotal;
  let targetBallots = Math.round(registeredTotal * targetTurnoutPct);

  let adjustedVotes = {};
  let originalVotes = {};

  // Calculate original total votes
  let originalTotalVotes = 0;
  for (let candidate of candidates) {
    let votes = Number(electionRow[candidate]) || 0;
    originalVotes[candidate] = votes;
    originalTotalVotes += votes;
  }

  if (originalTotalVotes === 0) {
    return { adjustedVotes: {}, winner: null, originalWinner: null, flipped: false };
  }

  if (targetBallots <= ballotsCast) {
    // Reduced turnout: scale down proportionally
    let scaleFactor = targetBallots / ballotsCast;
    for (let candidate of candidates) {
      let originalVoteCount = Number(electionRow[candidate]) || 0;
      adjustedVotes[candidate] = Math.round(originalVoteCount * scaleFactor);
    }
  } else {
    // Increased turnout: add votes from non-voters proportionally by party
    let extraVotes = targetBallots - ballotsCast;
    let nonVoters = calculateNonVotersByParty(electionRow, candidates, dncRow);

    // Get party registration from DNC data
    let repReg = Number(dncRow.Rep) || 0;
    let demReg = Number(dncRow.Dem) || 0;
    let modReg = Number(dncRow.Mod) || 0;
    let dncTotal = repReg + demReg + modReg || 1;

    // Calculate votes by party for proportional allocation
    let votesByParty = { Rep: 0, Dem: 0, Mod: 0 };
    for (let candidate of candidates) {
      let party = extractParty(candidate);
      let normalizedParty = party ? (PARTY_NORMALIZE[party] || party) : null;
      let votes = Number(electionRow[candidate]) || 0;

      if (normalizedParty === 'Rep') votesByParty.Rep += votes;
      else if (normalizedParty === 'Dem') votesByParty.Dem += votes;
      else if (normalizedParty === 'Mod' || normalizedParty === 'Lib' || normalizedParty === 'Grn') votesByParty.Mod += votes;
    }

    // Allocate extra votes by party proportion
    let extraRepVotes = Math.min(extraVotes * (repReg / dncTotal), nonVoters.repNonVoters);
    let extraDemVotes = Math.min(extraVotes * (demReg / dncTotal), nonVoters.demNonVoters);
    let extraModVotes = Math.min(extraVotes * (modReg / dncTotal), nonVoters.modNonVoters);

    for (let candidate of candidates) {
      let party = extractParty(candidate);
      let normalizedParty = party ? (PARTY_NORMALIZE[party] || party) : null;
      let originalVoteCount = Number(electionRow[candidate]) || 0;

      let extraForCandidate = 0;
      if (normalizedParty === 'Rep' && votesByParty.Rep > 0) {
        extraForCandidate = extraRepVotes * (originalVoteCount / votesByParty.Rep);
      } else if (normalizedParty === 'Dem' && votesByParty.Dem > 0) {
        extraForCandidate = extraDemVotes * (originalVoteCount / votesByParty.Dem);
      } else if ((normalizedParty === 'Mod' || normalizedParty === 'Lib' || normalizedParty === 'Grn') && votesByParty.Mod > 0) {
        extraForCandidate = extraModVotes * (originalVoteCount / votesByParty.Mod);
      }

      adjustedVotes[candidate] = Math.round(originalVoteCount + extraForCandidate);
    }
  }

  let originalWinner = determineWinner(originalVotes);
  let simulatedWinner = determineWinner(adjustedVotes);

  let flipped = originalWinner.name !== simulatedWinner.name &&
                originalWinner.name !== null &&
                simulatedWinner.name !== null;

  return {
    adjustedVotes,
    winner: simulatedWinner,
    originalWinner,
    flipped
  };
}

/**
 * Apply voter flip (persuasion) to precinct votes.
 * Moves a percentage of votes from one party's candidates to another party's candidates.
 * 
 * @param {Object} baseVotes - Base votes by candidate (already adjusted for turnout or original)
 * @param {Object} flipRates - { 'Rep→Dem': 0.05, 'Dem→Rep': 0.02, 'Mod→Dem': 0.10, ... }
 * @param {Array} candidates - List of candidate names
 * @returns {Object} Adjusted votes after flip
 */
export function applyVoterFlip(baseVotes, flipRates, candidates) {
  if (!baseVotes || !flipRates || !candidates) {
    return { ...baseVotes };
  }

  let adjustedVotes = {};
  for (let c of candidates) {
    adjustedVotes[c] = baseVotes[c] || 0;
  }

  // Calculate total votes by party
  let votesByParty = { Rep: 0, Dem: 0, Mod: 0 };
  let candidatesByParty = { Rep: [], Dem: [], Mod: [] };

  for (let candidate of candidates) {
    let party = extractParty(candidate);
    let normalizedParty = party ? (PARTY_NORMALIZE[party] || party) : null;
    let votes = baseVotes[candidate] || 0;

    if (normalizedParty === 'Rep') {
      votesByParty.Rep += votes;
      candidatesByParty.Rep.push(candidate);
    } else if (normalizedParty === 'Dem') {
      votesByParty.Dem += votes;
      candidatesByParty.Dem.push(candidate);
    } else if (normalizedParty === 'Mod' || normalizedParty === 'Lib' || normalizedParty === 'Grn') {
      votesByParty.Mod += votes;
      candidatesByParty.Mod.push(candidate);
    }
  }

  // Apply each flip rate to ORIGINAL base votes (not chained)
  let flipDeltas = {};
  for (let c of candidates) {
    flipDeltas[c] = 0;
  }

  for (let [flipKey, rate] of Object.entries(flipRates)) {
    if (!rate || rate <= 0) continue;

    let [fromParty, toParty] = flipKey.split('→');
    if (!fromParty || !toParty) continue;

    let fromCandidates = candidatesByParty[fromParty] || [];
    let toCandidates = candidatesByParty[toParty] || [];

    if (fromCandidates.length === 0 || toCandidates.length === 0) continue;

    let fromTotalVotes = votesByParty[fromParty] || 0;
    let votesToMove = Math.round(fromTotalVotes * rate);

    if (votesToMove <= 0) continue;

    // Calculate total votes for to-party to determine distribution
    let toTotalVotes = votesByParty[toParty] || 0;

    // Subtract proportionally from "from" candidates
    for (let candidate of fromCandidates) {
      let candidateVotes = baseVotes[candidate] || 0;
      let candidateShare = fromTotalVotes > 0 ? candidateVotes / fromTotalVotes : 0;
      flipDeltas[candidate] -= votesToMove * candidateShare;
    }

    // Add proportionally to "to" candidates
    for (let candidate of toCandidates) {
      let candidateVotes = baseVotes[candidate] || 0;
      let candidateShare = toTotalVotes > 0 ? candidateVotes / toTotalVotes : (1 / toCandidates.length);
      flipDeltas[candidate] += votesToMove * candidateShare;
    }
  }

  // Apply deltas and ensure no negative votes
  for (let candidate of candidates) {
    adjustedVotes[candidate] = Math.max(0, Math.round(adjustedVotes[candidate] + flipDeltas[candidate]));
  }

  return adjustedVotes;
}

/**
 * Combined simulation with extended turnout and voter flip.
 * Order: turnout adjustment first, then voter flip.
 * 
 * @param {Object} electionRow - Election data for precinct
 * @param {Object} dncRow - DNC data
 * @param {Object} turnoutMultipliers - Party turnout multipliers (0.5-1.5)
 * @param {Object} flipRates - Voter flip rates
 * @param {Array} candidates - List of candidate names
 * @returns {Object} { adjustedVotes, winner, originalWinner, flipped }
 */
export function simulatePrecinctCombined(electionRow, dncRow, turnoutMultipliers, flipRates, candidates) {
  // First apply turnout adjustments
  let turnoutResult = simulatePrecinctWithExtendedTurnout(
    electionRow, dncRow, turnoutMultipliers, candidates
  );

  if (!turnoutResult.adjustedVotes || Object.keys(turnoutResult.adjustedVotes).length === 0) {
    return turnoutResult;
  }

  // Then apply voter flip to turnout-adjusted votes
  let adjustedVotes = applyVoterFlip(turnoutResult.adjustedVotes, flipRates, candidates);

  // Recalculate winner
  let originalVotes = {};
  for (let c of candidates) {
    originalVotes[c] = Number(electionRow[c]) || 0;
  }
  let originalWinner = determineWinner(originalVotes);
  let simulatedWinner = determineWinner(adjustedVotes);

  let flipped = originalWinner.name !== simulatedWinner.name &&
                originalWinner.name !== null &&
                simulatedWinner.name !== null;

  return {
    adjustedVotes,
    winner: simulatedWinner,
    originalWinner,
    flipped
  };
}

/**
 * Extract party prefix from candidate name.
 * 
 * @param {string} candidateName - Full candidate name (e.g., "Rep John Smith")
 * @returns {string|null} Party code (e.g., "Rep") or null if not found
 */
export function extractParty(candidateName) {
  if (!candidateName || typeof candidateName !== 'string') {
    return null;
  }
  let parts = candidateName.trim().split(' ');
  let partyCode = parts[0];
  
  return VALID_PARTIES.has(partyCode) ? partyCode : null;
}

/**
 * Determine the winner from a map of candidate votes.
 * 
 * @param {Object} candidateVotes - Map of candidate name to vote count
 * @returns {Object} Winner object with name, votes, and party
 */
export function determineWinner(candidateVotes) {
  if (!candidateVotes || typeof candidateVotes !== 'object') {
    return { name: null, votes: 0, party: null };
  }
  
  let maxVotes = 0;
  let winner = null;
  
  for (let [candidate, votes] of Object.entries(candidateVotes)) {
    let voteCount = Number(votes) || 0;
    if (voteCount > maxVotes) {
      maxVotes = voteCount;
      winner = candidate;
    }
  }
  
  if (!winner) {
    return { name: null, votes: 0, party: null };
  }
  
  // Extract party from candidate name (first word)
  const party = extractParty(winner);
  
  return { name: winner, votes: maxVotes, party };
}

/**
 * Simulate election outcome for a single precinct with adjusted turnout.
 * 
 * @param {Object} electionData - Original election data for precinct
 * @param {Object} dncData - DNC score data for precinct (party registration)
 * @param {Object} turnoutMultipliers - Multipliers by party { Rep: 0.8, Dem: 1.0, Mod: 0.9 }
 * @param {Array} candidates - List of candidate names
 * @returns {Object} Simulated result with adjusted votes and winner
 */
export function simulatePrecinctOutcome(electionData, dncData, turnoutMultipliers, candidates) {
  if (!electionData || !dncData || !candidates || !Array.isArray(candidates)) {
    return { adjustedVotes: {}, winner: null, originalWinner: null, flipped: false };
  }
  
  let adjustedVotes = {};
  let originalVotes = {};

  // Get party registration totals
  let partyReg = {
    Rep: Number(dncData.Rep) || 0,
    Dem: Number(dncData.Dem) || 0,
    Mod: Number(dncData.Mod) || 0
  };
  let totalReg = partyReg.Rep + partyReg.Dem + partyReg.Mod;

  if (totalReg === 0) {
    return { adjustedVotes: {}, winner: null, originalWinner: null, flipped: false };
  }

  // Calculate original total votes
  let originalTotalVotes = 0;
  for (let candidate of candidates) {
    let votes = Number(electionData[candidate]) || 0;
    originalVotes[candidate] = votes;
    originalTotalVotes += votes;
  }

  if (originalTotalVotes === 0) {
    return { adjustedVotes: {}, winner: null, originalWinner: null, flipped: false };
  }

  // For each candidate, apply the appropriate turnout multiplier based on party
  for (let candidate of candidates) {
    let party = extractParty(candidate);
    let normalizedParty = party ? (PARTY_NORMALIZE[party] || party) : null;
    let originalVoteCount = Number(electionData[candidate]) || 0;
    
    // Get multiplier for this party (default to 1.0 if not found)
    let multiplier = 1.0;
    if (normalizedParty === 'Rep') multiplier = turnoutMultipliers.Rep ?? 1.0;
    else if (normalizedParty === 'Dem') multiplier = turnoutMultipliers.Dem ?? 1.0;
    else if (normalizedParty === 'Mod') multiplier = turnoutMultipliers.Mod ?? 1.0;
    // Libertarian/Green lean toward moderate in this model
    else if (normalizedParty === 'Lib' || normalizedParty === 'Grn') {
      multiplier = turnoutMultipliers.Mod ?? 1.0;
    }
    // For propositions (For/Against), use average of all multipliers
    else if (normalizedParty === 'For' || normalizedParty === 'Against') {
      multiplier = ((turnoutMultipliers.Rep ?? 1.0) + (turnoutMultipliers.Dem ?? 1.0) + (turnoutMultipliers.Mod ?? 1.0)) / 3;
    }
    
    // Apply multiplier to original votes
    adjustedVotes[candidate] = Math.round(originalVoteCount * multiplier);
  }

  let originalWinner = determineWinner(originalVotes);
  let simulatedWinner = determineWinner(adjustedVotes);

  // Check if winner flipped
  let flipped = originalWinner.name !== simulatedWinner.name &&
                originalWinner.name !== null &&
                simulatedWinner.name !== null;
  
  return {
    adjustedVotes,
    winner: simulatedWinner,
    originalWinner,
    flipped
  };
}

/**
 * Detect all precincts where the winner changed due to turnout simulation.
 * 
 * @param {Object} originalResults - Map of precinct code to original winner
 * @param {Object} simulatedResults - Map of precinct code to simulated winner  
 * @returns {Array} List of precinct codes that flipped
 */
export function detectFlippedPrecincts(originalResults, simulatedResults) {
  if (!originalResults || !simulatedResults) {
    return [];
  }
  
  let flipped = [];

  for (let [precinctCode, originalWinner] of Object.entries(originalResults)) {
    let simulatedWinner = simulatedResults[precinctCode];
    if (simulatedWinner && originalWinner !== simulatedWinner && 
        originalWinner !== null && simulatedWinner !== null) {
      flipped.push(precinctCode);
    }
  }
  
  return flipped;
}

/**
 * Calculate county-wide summary from all precinct results.
 * 
 * @param {Object} precinctResults - Map of precinct code to candidate votes
 * @param {Array} candidates - List of candidate names
 * @returns {Object} County totals with vote counts and percentages per candidate
 */
export function calculateCountySummary(precinctResults, candidates) {
  if (!precinctResults || !candidates || !Array.isArray(candidates)) {
    return { totalVotes: 0, candidateTotals: {}, winner: null };
  }
  
  let candidateTotals = {};
  for (let c of candidates) {
    candidateTotals[c] = 0;
  }

  let totalVotes = 0;

  for (let [precinctCode, votes] of Object.entries(precinctResults)) {
    for (let candidate of candidates) {
      let v = Number(votes[candidate]) || 0;
      candidateTotals[candidate] += v;
      totalVotes += v;
    }
  }

  let winner = determineWinner(candidateTotals);

  // Calculate percentages
  let candidatePercentages = {};
  for (let candidate of candidates) {
    candidatePercentages[candidate] = totalVotes > 0
      ? (candidateTotals[candidate] / totalVotes)
      : 0;
  }
  
  return {
    totalVotes,
    candidateTotals,
    candidatePercentages,
    winner
  };
}

// ============================================================================
// SLIDER STATE MANAGEMENT
// ============================================================================

/**
 * Create a slider state manager for turnout simulation controls.
 * Now supports extended range (50-150%) for "more turnout" feature.
 * 
 * @param {Object} initialValues - Initial turnout multipliers { Rep: 1.0, Dem: 1.0, Mod: 1.0 }
 * @param {Object} options - { minValue: 0.5, maxValue: 1.5 } for extended range
 * @returns {Object} State manager with getValue, setValue, getAll, onChange, reset methods
 */
export function createSliderState(initialValues = { Rep: 1.0, Dem: 1.0, Mod: 1.0 }, options = {}) {
  const minValue = options.minValue ?? 0.5;
  const maxValue = options.maxValue ?? 1.5;
  let values = { ...initialValues };
  let listeners = [];

  return {
    getValue: function getValue(party) { return values[party] ?? 1.0; },
    setValue: function setValue(party, value) {
      // Clamp to valid range [minValue, maxValue]
      let clamped = Math.max(minValue, Math.min(maxValue, value));
      values[party] = clamped;
      for (let fn of listeners) { fn(party, clamped); }
    },
    getAll: function getAll() { return { ...values }; },
    onChange: function onChange(fn) { listeners.push(fn); },
    reset: function reset() {
      values = { Rep: 1.0, Dem: 1.0, Mod: 1.0 };
      for (let fn of listeners) { fn('all', values); }
    },
    getRange: function getRange() { return { min: minValue, max: maxValue }; }
  };
}

/**
 * Create a voter flip state manager.
 * Tracks flip rates between parties: Rep→Dem, Dem→Rep, Mod→Dem, Mod→Rep, etc.
 * 
 * @param {Object} initialRates - Initial flip rates (default all 0)
 * @returns {Object} State manager for voter flip
 */
export function createVoterFlipState(initialRates = {}) {
  let defaultRates = {
    'Rep→Dem': 0,
    'Rep→Mod': 0,
    'Dem→Rep': 0,
    'Dem→Mod': 0,
    'Mod→Rep': 0,
    'Mod→Dem': 0
  };
  let rates = { ...defaultRates, ...initialRates };
  let listeners = [];

  return {
    getRate: function getRate(flipKey) { return rates[flipKey] ?? 0; },
    setRate: function setRate(flipKey, value) {
      // Clamp to valid range [0, 0.25] (0-25%)
      let clamped = Math.max(0, Math.min(0.25, value));
      rates[flipKey] = clamped;
      for (let fn of listeners) { fn(flipKey, clamped); }
    },
    getAll: function getAll() { return { ...rates }; },
    onChange: function onChange(fn) { listeners.push(fn); },
    reset: function reset() {
      rates = { ...defaultRates };
      for (let fn of listeners) { fn('all', rates); }
    },
    hasAnyFlips: function hasAnyFlips() { return Object.values(rates).some(function checkRate(r) { return r > 0; }); }
  };
}

// ============================================================================
// SIMULATION ORCHESTRATOR
// ============================================================================

/**
 * Run full turnout simulation across all precincts for a given election.
 * Now supports extended turnout (50-150%) and voter flip.
 * 
 * @param {Array} electionData - Array of election records by precinct
 * @param {Object} dncDataByPrecinct - Map of precinct code to DNC data
 * @param {Array} candidates - List of candidate names
 * @param {Object} turnoutMultipliers - Turnout multipliers by party (0.5-1.5)
 * @param {Object} options - Optional { voterFlipRates, targetTurnoutPct }
 * @returns {Object} Full simulation results with per-precinct and county-wide data
 */
export function runFullSimulation(electionData, dncDataByPrecinct, candidates, turnoutMultipliers, options = {}) {
  if (!electionData || !Array.isArray(electionData) || !dncDataByPrecinct || !candidates) {
    return {
      precinctResults: {},
      originalWinners: {},
      simulatedWinners: {},
      flippedPrecincts: [],
      originalSummary: null,
      simulatedSummary: null
    };
  }

  let { voterFlipRates = {}, targetTurnoutPct = null } = options;
  let hasVoterFlips = voterFlipRates && Object.values(voterFlipRates).some(function checkRate(r) { return r > 0; });
  let hasExtendedTurnout = turnoutMultipliers && Object.values(turnoutMultipliers).some(function checkMultiplier(m) { return m !== 1.0; });

  let precinctResults = {};
  let originalWinners = {};
  let simulatedWinners = {};
  let originalVotesByPrecinct = {};
  let simulatedVotesByPrecinct = {};

  // Process each precinct
  for (let record of electionData) {
    let precinctCode = record['PRECINCT CODE'];
    if (!precinctCode) continue;

    let dncData = dncDataByPrecinct[precinctCode];
    if (!dncData) continue;

    let result;

    if (targetTurnoutPct !== null) {
      // Target turnout mode
      result = simulatePrecinctWithTargetTurnout(record, dncData, targetTurnoutPct, candidates);
      // Apply voter flip if present
      if (hasVoterFlips) {
        let flippedVotes = applyVoterFlip(result.adjustedVotes, voterFlipRates, candidates);
        let originalVotes = {};
        for (let c of candidates) { originalVotes[c] = Number(record[c]) || 0; }
        let originalWinner = determineWinner(originalVotes);
        let simulatedWinner = determineWinner(flippedVotes);
        result = {
          adjustedVotes: flippedVotes,
          winner: simulatedWinner,
          originalWinner,
          flipped: originalWinner.name !== simulatedWinner.name && originalWinner.name !== null && simulatedWinner.name !== null
        };
      }
    } else if (hasVoterFlips || hasExtendedTurnout) {
      // Combined turnout + flip mode
      result = simulatePrecinctCombined(record, dncData, turnoutMultipliers, voterFlipRates, candidates);
    } else {
      // Legacy mode (no changes or only <= 100% turnout)
      result = simulatePrecinctOutcome(record, dncData, turnoutMultipliers, candidates);
    }
    
    precinctResults[precinctCode] = result;
    originalWinners[precinctCode] = result.originalWinner?.name;
    simulatedWinners[precinctCode] = result.winner?.name;
    
    // Store votes for county summary
    let originalVotes = {};
    for (let c of candidates) {
      originalVotes[c] = Number(record[c]) || 0;
    }
    originalVotesByPrecinct[precinctCode] = originalVotes;
    simulatedVotesByPrecinct[precinctCode] = result.adjustedVotes;
  }
  
  // Detect flipped precincts
  let flippedPrecincts = detectFlippedPrecincts(originalWinners, simulatedWinners);

  // Calculate county-wide summaries
  let originalSummary = calculateCountySummary(originalVotesByPrecinct, candidates);
  let simulatedSummary = calculateCountySummary(simulatedVotesByPrecinct, candidates);
  
  return {
    precinctResults,
    originalWinners,
    simulatedWinners,
    flippedPrecincts,
    originalSummary,
    simulatedSummary,
    countyFlipped: originalSummary.winner?.name !== simulatedSummary.winner?.name
  };
}

// ============================================================================
// UI COMPONENT GENERATORS
// ============================================================================

/**
 * Generate HTML for turnout simulator controls.
 * Now supports extended range (50-150%) for "more turnout" and voter flip controls.
 * 
 * @param {Object} currentValues - Current slider values { Rep: 1.0, Dem: 1.0, Mod: 1.0 }
 * @param {Object} flipRates - Current voter flip rates (optional)
 * @param {Object} options - { showVoterFlip: true, minPct: 50, maxPct: 150 }
 * @returns {string} HTML string for the simulator controls
 */
export function generateSimulatorControlsHTML(currentValues = { Rep: 1.0, Dem: 1.0, Mod: 1.0 }, flipRates = {}, options = {}) {
  let { showVoterFlip = true, minPct = 50, maxPct = 150 } = options;

  function formatPct(val) { return Math.round(val * 100) + '%'; }
  function formatFlipPct(val) { return (val * 100).toFixed(0) + '%'; }

  // Generate turnout slider HTML
  let turnoutSlidersHTML = `
    <div class="simulator-section">
      <h4 class="section-title">Party Turnout</h4>
      <p class="section-hint">Below 100%: fewer voters. Above 100%: mobilize non-voters.</p>
      
      <div class="slider-group">
        <label for="rep-turnout">
          <span class="party-label rep">Republican</span>
          <span class="slider-value" id="rep-value">${formatPct(currentValues.Rep)}</span>
        </label>
        <input type="range" id="rep-turnout" name="rep-turnout" 
               min="${minPct}" max="${maxPct}" value="${Math.round(currentValues.Rep * 100)}"
               class="turnout-slider rep-slider" data-party="Rep">
        <div class="slider-markers">
          <span>50%</span>
          <span class="baseline-marker">100%</span>
          <span>150%</span>
        </div>
      </div>
      
      <div class="slider-group">
        <label for="dem-turnout">
          <span class="party-label dem">Democrat</span>
          <span class="slider-value" id="dem-value">${formatPct(currentValues.Dem)}</span>
        </label>
        <input type="range" id="dem-turnout" name="dem-turnout" 
               min="${minPct}" max="${maxPct}" value="${Math.round(currentValues.Dem * 100)}"
               class="turnout-slider dem-slider" data-party="Dem">
        <div class="slider-markers">
          <span>50%</span>
          <span class="baseline-marker">100%</span>
          <span>150%</span>
        </div>
      </div>
      
      <div class="slider-group">
        <label for="mod-turnout">
          <span class="party-label mod">Moderate/Other</span>
          <span class="slider-value" id="mod-value">${formatPct(currentValues.Mod)}</span>
        </label>
        <input type="range" id="mod-turnout" name="mod-turnout" 
               min="${minPct}" max="${maxPct}" value="${Math.round(currentValues.Mod * 100)}"
               class="turnout-slider mod-slider" data-party="Mod">
        <div class="slider-markers">
          <span>50%</span>
          <span class="baseline-marker">100%</span>
          <span>150%</span>
        </div>
      </div>
    </div>
  `;
  
  // Generate voter flip controls HTML
  const voterFlipHTML = showVoterFlip ? `
    <div class="simulator-section voter-flip-section">
      <div class="section-header collapsible" id="voter-flip-toggle">
        <h4 class="section-title">
          <svg width="12" height="12" viewBox="0 0 12 12" class="collapse-icon">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
          </svg>
          Voter Persuasion (Flip)
        </h4>
        <span class="section-badge" id="flip-active-badge" style="display: none;">Active</span>
      </div>
      <div class="section-content" id="voter-flip-content">
        <p class="section-hint">Model persuasion: what if X% of one party's voters switched to another?</p>
        
        <div class="flip-controls-grid">
          <div class="flip-control">
            <label for="flip-rep-dem">
              <span class="flip-label">Rep → Dem</span>
              <span class="flip-value" id="flip-rep-dem-value">${formatFlipPct(flipRates['Rep→Dem'] || 0)}</span>
            </label>
            <input type="range" id="flip-rep-dem" name="flip-rep-dem" 
                   min="0" max="25" value="${Math.round((flipRates['Rep→Dem'] || 0) * 100)}"
                   class="flip-slider" data-flip="Rep→Dem">
          </div>
          
          <div class="flip-control">
            <label for="flip-dem-rep">
              <span class="flip-label">Dem → Rep</span>
              <span class="flip-value" id="flip-dem-rep-value">${formatFlipPct(flipRates['Dem→Rep'] || 0)}</span>
            </label>
            <input type="range" id="flip-dem-rep" name="flip-dem-rep" 
                   min="0" max="25" value="${Math.round((flipRates['Dem→Rep'] || 0) * 100)}"
                   class="flip-slider" data-flip="Dem→Rep">
          </div>
          
          <div class="flip-control">
            <label for="flip-mod-dem">
              <span class="flip-label">Mod → Dem</span>
              <span class="flip-value" id="flip-mod-dem-value">${formatFlipPct(flipRates['Mod→Dem'] || 0)}</span>
            </label>
            <input type="range" id="flip-mod-dem" name="flip-mod-dem" 
                   min="0" max="25" value="${Math.round((flipRates['Mod→Dem'] || 0) * 100)}"
                   class="flip-slider" data-flip="Mod→Dem">
          </div>
          
          <div class="flip-control">
            <label for="flip-mod-rep">
              <span class="flip-label">Mod → Rep</span>
              <span class="flip-value" id="flip-mod-rep-value">${formatFlipPct(flipRates['Mod→Rep'] || 0)}</span>
            </label>
            <input type="range" id="flip-mod-rep" name="flip-mod-rep" 
                   min="0" max="25" value="${Math.round((flipRates['Mod→Rep'] || 0) * 100)}"
                   class="flip-slider" data-flip="Mod→Rep">
          </div>
        </div>
      </div>
    </div>
  ` : '';
  
  // Assumptions note
  const assumptionsHTML = `
    <div class="simulator-assumptions" id="simulator-assumptions">
      <details>
        <summary>Assumptions</summary>
        <ul>
          <li><strong>Non-voter party mix:</strong> People who didn't vote are split between the parties in the same proportions as each precinct's registered voters.</li>
          <li><strong>Same-race:</strong> "More turnout" adds votes only in this race.</li>
          <li><strong>Persuasion:</strong> Flip % applied uniformly across precincts.</li>
          <li><strong>Order:</strong> Turnout adjustment first, then persuasion.</li>
        </ul>
      </details>
    </div>
  `;

  return `
    <div class="turnout-simulator" id="turnout-simulator">
      <h3>Turnout Simulator</h3>
      <p class="simulator-description">Model how turnout changes and voter persuasion affect election outcomes.</p>
      
      ${turnoutSlidersHTML}
      
      ${voterFlipHTML}
      
      <div class="simulator-actions">
        <button id="reset-turnout" class="reset-btn" aria-label="Reset all to baseline">
          Reset All
        </button>
      </div>
      
      ${assumptionsHTML}
      
      <div id="simulation-summary" class="simulation-summary"></div>
    </div>
  `;
}

/**
 * Generate detailed HTML for all flipped precincts.
 * Shows first 5 by default with a "Show all N" toggle.
 *
 * @param {Array} flippedPrecincts - List of precinct codes that flipped
 * @param {Object} originalSummary - Original county-wide results (for context)
 * @param {Object} simulatedSummary - Simulated county-wide results (for context)
 * @returns {string} HTML string for the flipped precincts detail list
 */
function generateFlippedPrecinctsDetailHTML(flippedPrecincts, originalSummary, simulatedSummary) {
  if (!flippedPrecincts || flippedPrecincts.length === 0) {
    return '<p class="no-flips">No precincts flipped with current settings.</p>';
  }

  let total = flippedPrecincts.length;
  let initialShow = 5;
  let items = '';

  for (let i = 0; i < total; i++) {
    let code = flippedPrecincts[i];
    let hiddenClass = i >= initialShow ? ' hidden' : '';
    items += `<div class="flipped-list-item${hiddenClass}" data-flip-index="${i}">
        <span class="flipped-precinct-code">${code}</span>
      </div>`;
  }

  let toggleHTML = total > initialShow
    ? `<button class="flipped-list-toggle" data-expanded="false">Show all ${total} precincts</button>`
    : '';

  return `<div class="flipped-list">${items}${toggleHTML}</div>`;
}

/**
 * Generate HTML for simulation results summary.
 *
 * @param {Object} originalSummary - Original county-wide results
 * @param {Object} simulatedSummary - Simulated county-wide results
 * @param {Array} flippedPrecincts - List of precincts that flipped
 * @param {boolean} countyFlipped - Whether the county-wide winner changed
 * @returns {string} HTML string for the results summary
 */
export function generateSimulationResultsHTML(originalSummary, simulatedSummary, flippedPrecincts, countyFlipped) {
  if (!originalSummary || !simulatedSummary) {
    return '<p class="no-data">Select an election to begin simulation.</p>';
  }
  
  function formatNum(val) { return val.toLocaleString(); }

  // Build candidate comparison rows
  let candidateRows = '';
  let candidates = Object.keys(originalSummary.candidateTotals);
  for (let candidate of candidates) {
    let origVotes = originalSummary.candidateTotals[candidate];
    let simVotes = simulatedSummary.candidateTotals[candidate];
    let diff = simVotes - origVotes;
    let diffClass = diff > 0 ? 'positive' : diff < 0 ? 'negative' : '';
    let diffSign = diff > 0 ? '+' : '';

    candidateRows += `
      <tr>
        <td>${candidate}</td>
        <td>${formatNum(origVotes)}</td>
        <td>${formatNum(simVotes)}</td>
        <td class="${diffClass}">${diffSign}${formatNum(diff)}</td>
      </tr>
    `;
  }
  
  const flippedCount = flippedPrecincts.length;
  const flippedClass = countyFlipped ? 'county-flipped' : '';
  const winnerChangeHTML = countyFlipped 
    ? `<div class="winner-change alert">
         <strong>County Winner Changed!</strong>
         <p>${originalSummary.winner?.name} → ${simulatedSummary.winner?.name}</p>
       </div>`
    : '';
  
  return `
    <div class="simulation-results ${flippedClass}">
      ${winnerChangeHTML}
      
      <h4>Vote Comparison</h4>
      <table class="comparison-table">
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Original</th>
            <th>Simulated</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          ${candidateRows}
        </tbody>
      </table>
      
      <div class="flipped-precincts">
        <h4>Flipped Precincts: <span class="flip-count">${flippedCount}</span></h4>
        ${generateFlippedPrecinctsDetailHTML(flippedPrecincts, originalSummary, simulatedSummary)}
      </div>
    </div>
  `;
}
