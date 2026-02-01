// js/electionTrends.js
// ====================
// Module for election trends and comparison functionality
// Supports comparing elections across years and computing margin deltas

// ============================================================================
// RACE KEY NORMALIZATION
// ============================================================================

/**
 * Normalizes a race name to a consistent race key for comparison
 * @param {Object|string} entry - Manifest entry (object with filename) or filename string
 * @returns {string} Normalized race key (e.g. "governor", "president", "county_commissioner_precinct_4")
 */
export function getRaceKey(entry) {
  let filename;
  if (typeof entry === 'string') {
    filename = entry;
  } else if (entry && typeof entry === 'object' && entry.filename) {
    filename = entry.filename;
  } else {
    return '';
  }

  // Remove file extension
  let raceKey = filename.replace(/\.csv$/i, '');
  
  // Remove year patterns (e.g. "_2024", "_2022")
  raceKey = raceKey.replace(/_(\d{4})/g, '');
  
  // Map known aliases
  const aliases = {
    'president/vice president': 'president',
    'president_vice_president': 'president',
    'u._s._representative': 'us_representative',
    'united_states_representative': 'us_representative',
    'united_states_senator': 'us_senator',
    'u._s._senator': 'us_senator',
    'lieutenant_governor': 'lt_governor',
    'attorney_general': 'attorney_general',
    'comptroller_of_public_accounts': 'comptroller',
    'commissioner_of_agriculture': 'commissioner_agriculture',
    'commissioner_of_the_general_land_office': 'commissioner_land_office',
    'railroad_commissioner': 'railroad_commissioner',
    'state_representative': 'state_representative',
    'state_senator': 'state_senator',
    'county_commissioner': 'county_commissioner',
    'county_commissioner,_precinct': 'county_commissioner',
    'county_commissioner,_precinct_no': 'county_commissioner',
    'justice_of_the_peace': 'justice_of_the_peace',
    'constable': 'constable',
    'sheriff': 'sheriff',
    'county_judge': 'county_judge',
    'district_judge': 'district_judge',
    'city_council': 'city_council',
    'mayor': 'mayor'
  };
  
  // Normalize to lowercase
  raceKey = raceKey.toLowerCase();
  
  // Apply alias mapping
  for (const [alias, normalized] of Object.entries(aliases)) {
    if (raceKey.includes(alias)) {
      raceKey = normalized;
      break;
    }
  }
  
  // Extract precinct/district numbers and append
  const precinctMatch = raceKey.match(/precinct[_\s]*(\d+)/i);
  const districtMatch = raceKey.match(/district[_\s]*(\d+)/i);
  const placeMatch = raceKey.match(/place[_\s]*(\d+)/i);
  const seatMatch = raceKey.match(/seat[_\s]*no[_\s]*[._]*(\d+)/i);
  
  if (precinctMatch) {
    raceKey = raceKey.replace(/precinct[_\s]*\d+/i, '').trim() + '_precinct_' + precinctMatch[1];
  } else if (districtMatch) {
    raceKey = raceKey.replace(/district[_\s]*\d+/i, '').trim() + '_district_' + districtMatch[1];
  } else if (placeMatch) {
    raceKey = raceKey.replace(/place[_\s]*\d+/i, '').trim() + '_place_' + placeMatch[1];
  } else if (seatMatch) {
    raceKey = raceKey.replace(/seat[_\s]*no[_\s]*[._]*\d+/i, '').trim() + '_seat_' + seatMatch[1];
  }
  
  // Remove special characters, collapse spaces/underscores
  raceKey = raceKey
    .replace(/[^\w\s]/g, ' ')  // Replace special chars with space
    .replace(/\s+/g, '_')      // Collapse spaces to underscore
    .replace(/_+/g, '_')       // Collapse multiple underscores
    .replace(/^_+|_+$/g, '');  // Trim underscores
  
  return raceKey || 'unknown';
}

/**
 * Groups elections by race key
 * @param {Array<Object>} manifest - Array of election entries with { filename, year, category?, ... }
 * @returns {Object} Map of raceKey -> Array of entries for that race
 */
export function getElectionsByRaceKey(manifest) {
  const grouped = {};
  
  manifest.forEach(entry => {
    const raceKey = getRaceKey(entry);
    if (!grouped[raceKey]) {
      grouped[raceKey] = [];
    }
    grouped[raceKey].push(entry);
  });
  
  // Sort entries within each race by year (descending)
  Object.keys(grouped).forEach(raceKey => {
    grouped[raceKey].sort((a, b) => {
      const yearA = a.year || 0;
      const yearB = b.year || 0;
      return yearB - yearA;
    });
  });
  
  return grouped;
}

// ============================================================================
// TREND COLOR CONSTANTS
// ============================================================================

/**
 * Color constants for trend visualization
 */
export const TREND_COLORS = {
  // Swing to Democrat (more Dem in year2)
  swingDem: {
    light: '#D6EAF8',    // Very light blue
    medium: '#6D9EEB',   // Medium blue
    dark: '#27408B',     // Dark blue
    default: '#00AEF3'   // Standard Dem blue
  },
  // Swing to Republican (more Rep in year2)
  swingRep: {
    light: '#fc9a9a',    // Very light red
    medium: '#d13636',   // Medium red
    dark: '#630202',     // Dark red
    default: '#E81B23'   // Standard Rep red
  },
  // No change / neutral
  neutral: '#888888',
  // Flipped (winner changed)
  flipped: '#FFD700',    // Gold
  // No data / missing precinct
  noData: '#f5f5f5'
};

/**
 * Gets a color for a margin delta value
 * @param {number} delta - Margin delta (year2 - year1), typically -100 to +100
 * @param {string} side - Which side to measure ('Dem' or 'Rep')
 * @returns {string} Hex color code
 */
export function getTrendColor(delta, side = 'Dem') {
  if (delta === null || delta === undefined || isNaN(delta)) {
    return TREND_COLORS.noData;
  }
  
  // Normalize delta: positive = swing to Dem, negative = swing to Rep
  // If measuring Rep side, flip the sign
  const normalizedDelta = side === 'Rep' ? -delta : delta;
  
  if (Math.abs(normalizedDelta) < 0.1) {
    return TREND_COLORS.neutral;
  }
  
  const absDelta = Math.abs(normalizedDelta);
  
  if (normalizedDelta > 0) {
    // Swing to Dem
    if (absDelta > 10) return TREND_COLORS.swingDem.dark;
    if (absDelta > 5) return TREND_COLORS.swingDem.medium;
    return TREND_COLORS.swingDem.light;
  } else {
    // Swing to Rep
    if (absDelta > 10) return TREND_COLORS.swingRep.dark;
    if (absDelta > 5) return TREND_COLORS.swingRep.medium;
    return TREND_COLORS.swingRep.light;
  }
}

// ============================================================================
// DELTA COMPUTATION
// ============================================================================

/**
 * Computes precinct-level deltas between two elections
 * @param {Array<Object>} electionData1 - First election data (array of precinct records)
 * @param {Array<Object>} electionData2 - Second election data (array of precinct records)
 * @param {Array<string>} candidates1 - Candidate names from first election
 * @param {Array<string>} candidates2 - Candidate names from second election
 * @param {string} side - Which side to measure ('Dem' or 'Rep')
 * @returns {Object} Map of precinct code -> { delta, margin1, margin2, flipped, winner1, winner2, ... }
 */
export function computePrecinctDeltas(electionData1, electionData2, candidates1, candidates2, side = 'Dem') {
  const deltas = {};
  
  // Build lookup maps by precinct code
  const data1ByPrecinct = {};
  const data2ByPrecinct = {};
  
  electionData1.forEach(row => {
    const code = String(row['PRECINCT CODE'] || '');
    if (code) {
      data1ByPrecinct[code] = row;
    }
  });
  
  electionData2.forEach(row => {
    const code = String(row['PRECINCT CODE'] || '');
    if (code) {
      data2ByPrecinct[code] = row;
    }
  });
  
  // Get all unique precinct codes
  const allPrecincts = new Set([
    ...Object.keys(data1ByPrecinct),
    ...Object.keys(data2ByPrecinct)
  ]);
  
  // Helper to compute margin for a side
  const computeMargin = (row, candidates, targetSide) => {
    let targetVotes = 0;
    let otherVotes = 0;
    let totalVotes = 0;
    
    candidates.forEach(candidate => {
      const votes = Number(row[candidate]) || 0;
      totalVotes += votes;
      
      const party = candidate.split(' ')[0].toUpperCase();
      if (party === targetSide.toUpperCase()) {
        targetVotes += votes;
      } else {
        otherVotes += votes;
      }
    });
    
    if (totalVotes === 0) return null;
    
    const margin = ((targetVotes - otherVotes) / totalVotes) * 100;
    return margin;
  };
  
  // Helper to get winner
  const getWinner = (row, candidates) => {
    let topCandidate = null;
    let topVotes = 0;
    
    candidates.forEach(candidate => {
      const votes = Number(row[candidate]) || 0;
      if (votes > topVotes) {
        topVotes = votes;
        topCandidate = candidate;
      }
    });
    
    return topCandidate;
  };
  
  // Compute deltas for each precinct
  allPrecincts.forEach(precinctCode => {
    const row1 = data1ByPrecinct[precinctCode];
    const row2 = data2ByPrecinct[precinctCode];
    
    if (!row1 || !row2) {
      // Precinct missing in one election
      deltas[precinctCode] = {
        delta: null,
        margin1: null,
        margin2: null,
        flipped: false,
        winner1: row1 ? getWinner(row1, candidates1) : null,
        winner2: row2 ? getWinner(row2, candidates2) : null,
        votes1: row1 ? candidates1.reduce((sum, c) => sum + (Number(row1[c]) || 0), 0) : null,
        votes2: row2 ? candidates2.reduce((sum, c) => sum + (Number(row2[c]) || 0), 0) : null,
        missing: !row1 ? 'year1' : 'year2'
      };
      return;
    }
    
    const margin1 = computeMargin(row1, candidates1, side);
    const margin2 = computeMargin(row2, candidates2, side);
    const winner1 = getWinner(row1, candidates1);
    const winner2 = getWinner(row2, candidates2);
    
    // Determine if flipped (winner changed)
    const flipped = winner1 && winner2 && winner1 !== winner2;
    
    // Compute delta (year2 - year1)
    const delta = (margin1 !== null && margin2 !== null) ? margin2 - margin1 : null;
    
    deltas[precinctCode] = {
      delta,
      margin1,
      margin2,
      flipped,
      winner1,
      winner2,
      votes1: candidates1.reduce((sum, c) => sum + (Number(row1[c]) || 0), 0),
      votes2: candidates2.reduce((sum, c) => sum + (Number(row2[c]) || 0), 0)
    };
  });
  
  return deltas;
}

/**
 * Computes county-wide summary statistics for a trend
 * @param {Object} deltas - Result from computePrecinctDeltas
 * @returns {Object} Summary stats
 */
export function computeTrendSummary(deltas) {
  const precincts = Object.values(deltas);
  
  const validDeltas = precincts.filter(p => p.delta !== null && p.delta !== undefined);
  const flippedPrecincts = precincts.filter(p => p.flipped);
  
  const avgDelta = validDeltas.length > 0
    ? validDeltas.reduce((sum, p) => sum + p.delta, 0) / validDeltas.length
    : null;
  
  const totalVotes1 = precincts.reduce((sum, p) => sum + (p.votes1 || 0), 0);
  const totalVotes2 = precincts.reduce((sum, p) => sum + (p.votes2 || 0), 0);
  
  return {
    totalPrecincts: precincts.length,
    validPrecincts: validDeltas.length,
    flippedPrecincts: flippedPrecincts.length,
    avgDelta,
    totalVotes1,
    totalVotes2,
    flippedPrecinctCodes: flippedPrecincts.map(p => {
      const code = Object.keys(deltas).find(k => deltas[k] === p);
      return code;
    }).filter(Boolean)
  };
}
