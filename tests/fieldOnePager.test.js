/**
 * @jest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, jest, test } from '@jest/globals';
import {
  generateFieldOnePagerHTML,
  generateFieldOnePagerText,
  loadOnePagerData,
  copyOnePagerToClipboard,
} from "./fieldOnePager.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockCensus = {
  population: 5043,
  income: { medianHousehold: 95116 },
  education: { bachelors: 0.2463, graduateProfessional: 0.1358 },
  housing: { ownerOccupied: 0.5223, medianHomeValue: 448693 },
  age: { medianAge: 38.7 },
  households: { total: 1972 },
};

const mockParty = {
  rep: 1200,
  mod: 400,
  dem: 800,
  repShare: 0.5,
  modShare: 0.167,
  demShare: 0.333,
  winningParty: "Republican",
  partyStrength: 2,
};

const mockRacial = {
  pct_white: 0.55,
  pct_asian: 0.18,
  pct_hispanic: 0.15,
  pct_black: 0.08,
  pct_others: 0.04,
  white: 2774,
  asian: 907,
  hispanic: 756,
  black: 403,
  others: 203,
};

const mockOfficials = {
  CONG: 3,
  CONG_N: "Keith Self",
  SEN: 8,
  SEN_N: "Angela Paxton",
  SHR: 89,
  SHR_N: "Candy Noble",
};

const mockRecentElections = [
  {
    filename: "President_2024.csv",
    raceName: "President 2024",
    winner: "Trump",
    winningParty: "REP",
    totalVotes: 1800,
    registeredVoters: 2400,
  },
  {
    filename: "Governor_2022.csv",
    raceName: "Governor 2022",
    winner: "Abbott",
    winningParty: "REP",
    totalVotes: 1500,
    registeredVoters: 2400,
  },
  {
    filename: "President_2020.csv",
    raceName: "President 2020",
    winner: "Biden",
    winningParty: "DEM",
    totalVotes: 1700,
    registeredVoters: 2200,
  },
];

const mockTrend = {
  direction: "dem",
  delta: 3.2,
  raceName: "President",
  year1: 2020,
  year2: 2024,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateFieldOnePagerHTML", () => {
  test("contains all sections", () => {
    let html = generateFieldOnePagerHTML(
      "100",
      mockCensus,
      mockParty,
      mockRacial,
      mockOfficials,
      mockRecentElections,
      mockTrend
    );

    // Header
    expect(html).toContain("Precinct 100");
    expect(html).toContain("field-one-pager");

    // Stats grid
    expect(html).toContain("one-pager-stats");
    expect(html).toContain("Registered Voters");
    expect(html).toContain("Median Income");
    expect(html).toContain("College Degree");
    expect(html).toContain("Homeownership");

    // Party bar
    expect(html).toContain("Party Registration");
    expect(html).toContain("one-pager-bar");

    // Racial bar
    expect(html).toContain("Racial Demographics");

    // Elections table
    expect(html).toContain("one-pager-elections");
    expect(html).toContain("President 2024");

    // Districts
    expect(html).toContain("one-pager-districts");
    expect(html).toContain("US Congress");

    // Footer
    expect(html).toContain("one-pager-footer");
    expect(html).toContain("collincountyelections.com");

    // Actions bar
    expect(html).toContain("one-pager-print-btn");
    expect(html).toContain("one-pager-copy-btn");
  });

  test("handles missing census data gracefully", () => {
    let html = generateFieldOnePagerHTML(
      "200",
      null,
      null,
      null,
      null,
      [],
      null
    );

    expect(html).toContain("Precinct 200");
    expect(html).toContain("field-one-pager");
    expect(html).toContain("N/A");
    // Should not throw
    expect(html).toContain("one-pager-footer");
  });

  test("handles partial data", () => {
    let html = generateFieldOnePagerHTML(
      "300",
      { population: 1000 },
      mockParty,
      null,
      null,
      [],
      null
    );

    expect(html).toContain("Precinct 300");
    expect(html).toContain("Pop. 1,000");
    expect(html).toContain("Party Registration");
    // No racial section when racial is null
    expect(html).not.toContain("Racial Demographics");
  });
});

describe("generateFieldOnePagerText", () => {
  test("stays under 60 lines", () => {
    let text = generateFieldOnePagerText(
      "100",
      mockCensus,
      mockParty,
      mockRacial,
      mockOfficials,
      mockRecentElections,
      mockTrend
    );

    let lines = text.split("\n");
    expect(lines.length).toBeLessThanOrEqual(60);
  });

  test("contains precinct code and key stats", () => {
    let text = generateFieldOnePagerText(
      "100",
      mockCensus,
      mockParty,
      mockRacial,
      mockOfficials,
      mockRecentElections,
      mockTrend
    );

    expect(text).toContain("PRECINCT 100");
    expect(text).toContain("KEY STATS");
    expect(text).toContain("Registered Voters");
    expect(text).toContain("Median Income");
    expect(text).toContain("College Degree");
    expect(text).toContain("Homeownership");
    expect(text).toContain("collincountyelections.com");
  });

  test("includes party and racial data", () => {
    let text = generateFieldOnePagerText(
      "100",
      mockCensus,
      mockParty,
      mockRacial,
      null,
      [],
      null
    );

    expect(text).toContain("PARTY REGISTRATION");
    expect(text).toContain("RACIAL DEMOGRAPHICS");
  });

  test("handles missing data gracefully", () => {
    let text = generateFieldOnePagerText("500", null, null, null, null, [], null);
    expect(text).toContain("PRECINCT 500");
    expect(text).toContain("N/A");
  });
});

describe("loadOnePagerData", () => {
  beforeEach(() => {
    // Mock fetch globally
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      })
    );

    // Mock d3.csv for loadAllData
    global.d3 = {
      csv: jest.fn(() => Promise.resolve([])),
    };
  });

  afterEach(() => {
    delete global.fetch;
    delete global.d3;
  });

  test("returns expected structure", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("geojson") || url.includes("GeoJSON")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              features: [
                {
                  properties: { PRECINCT: "100", CONG: 3, SEN: 8, SHR: 89 },
                },
              ],
            }),
        });
      }
      if (url.includes("elections.json")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      }
      if (url.includes("census")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ "100": mockCensus }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      });
    });

    let result = await loadOnePagerData("100");

    expect(result).toHaveProperty("census");
    expect(result).toHaveProperty("party");
    expect(result).toHaveProperty("racial");
    expect(result).toHaveProperty("officials");
    expect(result).toHaveProperty("recentElections");
    expect(Array.isArray(result.recentElections)).toBe(true);
  });
});

describe("copyOnePagerToClipboard", () => {
  test("calls navigator.clipboard.writeText", async () => {
    let writeMock = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeMock },
      writable: true,
      configurable: true,
    });

    let result = await copyOnePagerToClipboard("test text");
    expect(writeMock).toHaveBeenCalledWith("test text");
    expect(result).toBe(true);
  });

  test("returns false on failure", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: jest.fn(() => Promise.reject(new Error("denied"))),
      },
      writable: true,
      configurable: true,
    });

    // Also make execCommand fail
    document.execCommand = jest.fn(() => {
      throw new Error("not supported");
    });

    let result = await copyOnePagerToClipboard("test");
    expect(result).toBe(false);
  });
});
