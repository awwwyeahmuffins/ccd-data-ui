// raceAnalytics.test.js
// Unit tests for Race Analytics module (Workstream 3)
// TDD: Tests written FIRST, then implementation
// Run with: npm test

import { describe, it, expect, jest } from '@jest/globals';

// Import from actual module
import {
  calculateRaceSummary,
  buildVoteShareData,
  calculatePrecinctMargin,
  getMarginColor,
  generateRaceSummaryHTML,
  hexToRGB,
  rgbToHex
} from './raceAnalytics.js';

// ============================================================================
// TESTS FOR calculateRaceSummary
// ============================================================================

describe('calculateRaceSummary', () => {
  const sampleCandidates = ["REP Greg Abbott", "DEM Beto O'Rourke", "LIB Mark Tippetts"];
  
  const sampleElectionData = [
    {
      "PRECINCT CODE": "1",
      "REGISTERED VOTERS TOTAL": "2737",
      "BALLOTS CAST TOTAL": "1491",
      "REP Greg Abbott": "824",
      "DEM Beto O'Rourke": "638",
      "LIB Mark Tippetts": "21"
    },
    {
      "PRECINCT CODE": "2",
      "REGISTERED VOTERS TOTAL": "4654",
      "BALLOTS CAST TOTAL": "2084",
      "REP Greg Abbott": "1043",
      "DEM Beto O'Rourke": "1018",
      "LIB Mark Tippetts": "15"
    },
    {
      "PRECINCT CODE": "3",
      "REGISTERED VOTERS TOTAL": "2834",
      "BALLOTS CAST TOTAL": "835",
      "REP Greg Abbott": "249",
      "DEM Beto O'Rourke": "565",
      "LIB Mark Tippetts": "13"
    }
  ];

  it('should calculate total ballots cast across all precincts', () => {
    const summary = calculateRaceSummary(sampleElectionData, sampleCandidates);
    expect(summary.totalBallotsCast).toBe(1491 + 2084 + 835); // 4410
  });

  it('should calculate total registered voters', () => {
    const summary = calculateRaceSummary(sampleElectionData, sampleCandidates);
    expect(summary.totalRegisteredVoters).toBe(2737 + 4654 + 2834); // 10225
  });

  it('should identify the county-wide winner', () => {
    const summary = calculateRaceSummary(sampleElectionData, sampleCandidates);
    // Abbott: 824 + 1043 + 249 = 2116
    // Beto: 638 + 1018 + 565 = 2221
    // Beto wins county-wide
    expect(summary.winner).toBe("DEM Beto O'Rourke");
    expect(summary.winnerVotes).toBe(2221);
  });

  it('should identify the runner-up', () => {
    const summary = calculateRaceSummary(sampleElectionData, sampleCandidates);
    expect(summary.runnerUp).toBe("REP Greg Abbott");
    expect(summary.runnerUpVotes).toBe(2116);
  });

  it('should calculate margin of victory', () => {
    const summary = calculateRaceSummary(sampleElectionData, sampleCandidates);
    // Total candidate votes: 2116 + 2221 + 49 = 4386
    // Margin: (2221 - 2116) / 4386 = 105 / 4386 ≈ 0.0239
    const expectedMargin = (2221 - 2116) / (2116 + 2221 + 49);
    expect(summary.margin).toBeCloseTo(expectedMargin, 4);
  });

  it('should calculate turnout percentage', () => {
    const summary = calculateRaceSummary(sampleElectionData, sampleCandidates);
    // Turnout: 4410 / 10225 ≈ 0.4313
    expect(summary.turnout).toBeCloseTo(4410 / 10225, 4);
  });

  it('should aggregate votes per candidate', () => {
    const summary = calculateRaceSummary(sampleElectionData, sampleCandidates);
    expect(summary.candidateVotes["REP Greg Abbott"]).toBe(2116);
    expect(summary.candidateVotes["DEM Beto O'Rourke"]).toBe(2221);
    expect(summary.candidateVotes["LIB Mark Tippetts"]).toBe(49);
  });

  it('should skip precincts not in race (0 registered and 0 ballots)', () => {
    const dataWithNotInRace = [
      ...sampleElectionData,
      {
        "PRECINCT CODE": "999",
        "REGISTERED VOTERS TOTAL": "0",
        "BALLOTS CAST TOTAL": "0",
        "REP Greg Abbott": "0",
        "DEM Beto O'Rourke": "0",
        "LIB Mark Tippetts": "0"
      }
    ];
    const summary = calculateRaceSummary(dataWithNotInRace, sampleCandidates);
    // Should be same as without the not-in-race precinct
    expect(summary.totalBallotsCast).toBe(4410);
    expect(summary.totalRegisteredVoters).toBe(10225);
  });

  it('should return null for null electionData', () => {
    expect(calculateRaceSummary(null, sampleCandidates)).toBeNull();
  });

  it('should return null for empty electionData', () => {
    expect(calculateRaceSummary([], sampleCandidates)).toBeNull();
  });

  it('should return null for null candidates', () => {
    expect(calculateRaceSummary(sampleElectionData, null)).toBeNull();
  });

  it('should return null for empty candidates array', () => {
    expect(calculateRaceSummary(sampleElectionData, [])).toBeNull();
  });

  it('should handle string numeric values from CSV', () => {
    const summary = calculateRaceSummary(sampleElectionData, sampleCandidates);
    expect(typeof summary.totalBallotsCast).toBe('number');
    expect(typeof summary.winnerVotes).toBe('number');
  });

  it('should handle single candidate race', () => {
    const singleCandidate = ["REP Only Candidate"];
    const data = [{
      "PRECINCT CODE": "1",
      "REGISTERED VOTERS TOTAL": "1000",
      "BALLOTS CAST TOTAL": "500",
      "REP Only Candidate": "450"
    }];
    const summary = calculateRaceSummary(data, singleCandidate);
    expect(summary.winner).toBe("REP Only Candidate");
    expect(summary.runnerUp).toBeNull();
    expect(summary.margin).toBe(1); // 100% margin with single candidate
  });
});

// ============================================================================
// TESTS FOR buildVoteShareData
// ============================================================================

describe('buildVoteShareData', () => {
  const mockSummary = {
    totalCandidateVotes: 4386,
    candidateVotes: {
      "REP Greg Abbott": 2116,
      "DEM Beto O'Rourke": 2221,
      "LIB Mark Tippetts": 49
    }
  };

  it('should return array sorted by votes descending', () => {
    const result = buildVoteShareData(mockSummary);
    expect(result[0].candidate).toBe("DEM Beto O'Rourke");
    expect(result[1].candidate).toBe("REP Greg Abbott");
    expect(result[2].candidate).toBe("LIB Mark Tippetts");
  });

  it('should calculate percentage for each candidate', () => {
    const result = buildVoteShareData(mockSummary);
    expect(result[0].percentage).toBeCloseTo(2221 / 4386 * 100, 2);
    expect(result[1].percentage).toBeCloseTo(2116 / 4386 * 100, 2);
    expect(result[2].percentage).toBeCloseTo(49 / 4386 * 100, 2);
  });

  it('should extract party from candidate name', () => {
    const result = buildVoteShareData(mockSummary);
    expect(result[0].party).toBe("DEM");
    expect(result[1].party).toBe("REP");
    expect(result[2].party).toBe("LIB");
  });

  it('should include vote counts', () => {
    const result = buildVoteShareData(mockSummary);
    expect(result[0].votes).toBe(2221);
    expect(result[1].votes).toBe(2116);
    expect(result[2].votes).toBe(49);
  });

  it('should return empty array for null summary', () => {
    expect(buildVoteShareData(null)).toEqual([]);
  });

  it('should return empty array for summary without candidateVotes', () => {
    expect(buildVoteShareData({ totalCandidateVotes: 100 })).toEqual([]);
  });

  it('should handle zero total votes', () => {
    const zeroSummary = {
      totalCandidateVotes: 0,
      candidateVotes: { "REP Test": 0, "DEM Test": 0 }
    };
    const result = buildVoteShareData(zeroSummary);
    expect(result[0].percentage).toBe(0);
  });
});

// ============================================================================
// TESTS FOR calculatePrecinctMargin
// ============================================================================

describe('calculatePrecinctMargin', () => {
  const candidates = ["REP Greg Abbott", "DEM Beto O'Rourke", "LIB Mark Tippetts"];

  it('should calculate margin for a precinct with clear winner', () => {
    const precinct = {
      "REGISTERED VOTERS TOTAL": "2737",
      "BALLOTS CAST TOTAL": "1491",
      "REP Greg Abbott": "824",
      "DEM Beto O'Rourke": "638",
      "LIB Mark Tippetts": "21"
    };
    const result = calculatePrecinctMargin(precinct, candidates);
    // Total: 824 + 638 + 21 = 1483
    // Margin: (824 - 638) / 1483 = 186 / 1483 ≈ 0.1254
    expect(result.margin).toBeCloseTo(186 / 1483, 4);
    expect(result.winner).toBe("REP Greg Abbott");
    expect(result.winnerParty).toBe("REP");
  });

  it('should calculate margin for a close race', () => {
    const precinct = {
      "REGISTERED VOTERS TOTAL": "4654",
      "BALLOTS CAST TOTAL": "2084",
      "REP Greg Abbott": "1043",
      "DEM Beto O'Rourke": "1018",
      "LIB Mark Tippetts": "15"
    };
    const result = calculatePrecinctMargin(precinct, candidates);
    // Total: 1043 + 1018 + 15 = 2076
    // Margin: (1043 - 1018) / 2076 = 25 / 2076 ≈ 0.012
    expect(result.margin).toBeCloseTo(25 / 2076, 4);
    expect(result.margin).toBeLessThan(0.02); // Close race
  });

  it('should return null for precinct not in race', () => {
    const precinct = {
      "REGISTERED VOTERS TOTAL": "0",
      "BALLOTS CAST TOTAL": "0",
      "REP Greg Abbott": "0",
      "DEM Beto O'Rourke": "0"
    };
    expect(calculatePrecinctMargin(precinct, candidates)).toBeNull();
  });

  it('should return null for precinct with no candidate votes', () => {
    const precinct = {
      "REGISTERED VOTERS TOTAL": "1000",
      "BALLOTS CAST TOTAL": "500",
      "REP Greg Abbott": "0",
      "DEM Beto O'Rourke": "0",
      "LIB Mark Tippetts": "0"
    };
    expect(calculatePrecinctMargin(precinct, candidates)).toBeNull();
  });

  it('should return null for null precinctData', () => {
    expect(calculatePrecinctMargin(null, candidates)).toBeNull();
  });

  it('should return null for null candidates', () => {
    const precinct = { "REP Test": "100" };
    expect(calculatePrecinctMargin(precinct, null)).toBeNull();
  });

  it('should handle Democratic winner', () => {
    const precinct = {
      "REGISTERED VOTERS TOTAL": "2834",
      "BALLOTS CAST TOTAL": "835",
      "REP Greg Abbott": "249",
      "DEM Beto O'Rourke": "565",
      "LIB Mark Tippetts": "13"
    };
    const result = calculatePrecinctMargin(precinct, candidates);
    expect(result.winner).toBe("DEM Beto O'Rourke");
    expect(result.winnerParty).toBe("DEM");
  });
});

// ============================================================================
// TESTS FOR getMarginColor
// ============================================================================

describe('getMarginColor', () => {
  it('should return light color for low margin (close race)', () => {
    const color = getMarginColor(0.05, "REP");
    // Should be close to light red #FFCCCC
    expect(color).toMatch(/^#[A-F0-9]{6}$/i);
  });

  it('should return dark color for high margin (decisive win)', () => {
    const color = getMarginColor(0.9, "REP");
    // Should be close to dark red #8B0000
    expect(color).toMatch(/^#[A-F0-9]{6}$/i);
  });

  it('should return different colors for different parties', () => {
    const repColor = getMarginColor(0.5, "REP");
    const demColor = getMarginColor(0.5, "DEM");
    expect(repColor).not.toBe(demColor);
  });

  it('should handle REP party', () => {
    const color = getMarginColor(0.5, "REP");
    expect(color).toMatch(/^#[A-F0-9]{6}$/i);
  });

  it('should handle DEM party', () => {
    const color = getMarginColor(0.5, "DEM");
    expect(color).toMatch(/^#[A-F0-9]{6}$/i);
  });

  it('should handle LIB party', () => {
    const color = getMarginColor(0.5, "LIB");
    expect(color).toMatch(/^#[A-F0-9]{6}$/i);
  });

  it('should handle GRN party', () => {
    const color = getMarginColor(0.5, "GRN");
    expect(color).toMatch(/^#[A-F0-9]{6}$/i);
  });

  it('should handle unknown party with default color', () => {
    const color = getMarginColor(0.5, "UNKNOWN");
    expect(color).toMatch(/^#[A-F0-9]{6}$/i);
  });

  it('should clamp margin to [0, 1]', () => {
    const colorNegative = getMarginColor(-0.5, "REP");
    const colorZero = getMarginColor(0, "REP");
    expect(colorNegative).toBe(colorZero);

    const colorOver = getMarginColor(1.5, "REP");
    const colorOne = getMarginColor(1, "REP");
    expect(colorOver).toBe(colorOne);
  });

  it('should return exactly light color at margin 0', () => {
    const color = getMarginColor(0, "REP");
    expect(color).toBe("#FFCCCC");
  });

  it('should return exactly dark color at margin 1', () => {
    const color = getMarginColor(1, "REP");
    expect(color).toBe("#8B0000");
  });
});

// ============================================================================
// TESTS FOR generateRaceSummaryHTML
// ============================================================================

describe('generateRaceSummaryHTML', () => {
  const mockSummary = {
    totalBallotsCast: 4410,
    totalRegisteredVoters: 10225,
    candidateVotes: {
      "REP Greg Abbott": 2116,
      "DEM Beto O'Rourke": 2221
    },
    winner: "DEM Beto O'Rourke",
    winnerVotes: 2221,
    runnerUp: "REP Greg Abbott",
    runnerUpVotes: 2116,
    margin: 0.024,
    turnout: 0.4313,
    totalCandidateVotes: 4337
  };

  it('should include race name', () => {
    const html = generateRaceSummaryHTML(mockSummary, "Governor 2018");
    expect(html).toContain("Governor 2018");
  });

  it('should include winner name without party prefix', () => {
    const html = generateRaceSummaryHTML(mockSummary, "Governor");
    expect(html).toContain("Beto O'Rourke");
    expect(html).toContain("(DEM)");
  });

  it('should include margin percentage', () => {
    const html = generateRaceSummaryHTML(mockSummary, "Governor");
    expect(html).toContain("2.4%"); // 0.024 * 100
  });

  it('should include total votes formatted', () => {
    const html = generateRaceSummaryHTML(mockSummary, "Governor");
    expect(html).toContain("4,337"); // toLocaleString
  });

  it('should include turnout percentage', () => {
    const html = generateRaceSummaryHTML(mockSummary, "Governor");
    expect(html).toContain("43.1%");
  });

  it('should include canvas for vote share chart', () => {
    const html = generateRaceSummaryHTML(mockSummary, "Governor");
    expect(html).toContain('id="vote-share-canvas"');
    expect(html).toContain('canvas');
  });

  it('should add winner class for styling', () => {
    const html = generateRaceSummaryHTML(mockSummary, "Governor");
    expect(html).toContain('winner-dem');
  });

  it('should return error message for null summary', () => {
    const html = generateRaceSummaryHTML(null, "Governor");
    expect(html).toContain('error-state');
    expect(html).toContain('Unable to calculate');
  });

  it('should have accessible chart canvas', () => {
    const html = generateRaceSummaryHTML(mockSummary, "Governor");
    expect(html).toContain('aria-label');
  });
});

// ============================================================================
// TESTS FOR hexToRGB and rgbToHex helpers
// ============================================================================

describe('hexToRGB', () => {
  it('should convert hex to RGB object', () => {
    expect(hexToRGB("#FF0000")).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRGB("#00FF00")).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRGB("#0000FF")).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('should handle lowercase hex', () => {
    expect(hexToRGB("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('should handle hex without # prefix', () => {
    expect(hexToRGB("FF0000")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('should return black for invalid hex', () => {
    expect(hexToRGB("invalid")).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('rgbToHex', () => {
  it('should convert RGB to hex string', () => {
    expect(rgbToHex(255, 0, 0)).toBe("#FF0000");
    expect(rgbToHex(0, 255, 0)).toBe("#00FF00");
    expect(rgbToHex(0, 0, 255)).toBe("#0000FF");
  });

  it('should pad single digit hex values', () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
    expect(rgbToHex(15, 15, 15)).toBe("#0F0F0F");
  });

  it('should handle mid-range values', () => {
    expect(rgbToHex(128, 128, 128)).toBe("#808080");
  });
});

// ============================================================================
// INTEGRATION TEST: Full workflow
// ============================================================================

describe('Race Analytics Integration', () => {
  const candidates = ["REP Greg Abbott", "DEM Beto O'Rourke", "LIB Mark Tippetts"];
  
  const electionData = [
    {
      "PRECINCT CODE": "1",
      "REGISTERED VOTERS TOTAL": "2737",
      "BALLOTS CAST TOTAL": "1491",
      "REP Greg Abbott": "824",
      "DEM Beto O'Rourke": "638",
      "LIB Mark Tippetts": "21"
    },
    {
      "PRECINCT CODE": "2",
      "REGISTERED VOTERS TOTAL": "4654",
      "BALLOTS CAST TOTAL": "2084",
      "REP Greg Abbott": "1043",
      "DEM Beto O'Rourke": "1018",
      "LIB Mark Tippetts": "15"
    }
  ];

  it('should work end-to-end: calculate summary, build vote share, generate HTML', () => {
    // Step 1: Calculate summary
    const summary = calculateRaceSummary(electionData, candidates);
    expect(summary).not.toBeNull();
    expect(summary.winner).toBeDefined();

    // Step 2: Build vote share data
    const voteShare = buildVoteShareData(summary);
    expect(voteShare.length).toBe(3);
    expect(voteShare[0].votes).toBeGreaterThan(voteShare[1].votes);

    // Step 3: Generate HTML
    const html = generateRaceSummaryHTML(summary, "Governor 2018");
    expect(html).toContain("County-Wide Results");
    expect(html).toContain(summary.winner.split(" ").slice(1).join(" "));
  });

  it('should calculate margin colors for all precincts', () => {
    electionData.forEach(precinct => {
      const marginResult = calculatePrecinctMargin(precinct, candidates);
      if (marginResult) {
        const color = getMarginColor(marginResult.margin, marginResult.winnerParty);
        expect(color).toMatch(/^#[A-F0-9]{6}$/i);
      }
    });
  });
});
