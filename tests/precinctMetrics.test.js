/**
 * @jest-environment node
 */
import {
  buildRecords,
  METRICS,
  METRIC_CATEGORIES,
  getMetric,
  availableMetricIds,
  formatValue,
  sortRecords,
  filterRecords,
} from "./precinctMetrics.js";

function feature(over = {}) {
  return {
    properties: {
      PRECINCT: "1",
      repShare: 0.4, modShare: 0.2, demShare: 0.4, winningParty: "Dem", partyStrength: 1,
      rep: 400, mod: 200, dem: 400,
      pct_white: 0.6, pct_hispanic: 0.2, pct_black: 0.1, pct_asian: 0.1, total: 3000,
      ...over,
    },
  };
}

const census = {
  "1": {
    population: 5000, populationDensity: 4000,
    age: { medianAge: 38.7, under18: 0.25, "18to34": 0.18, "35to54": 0.3, "55to64": 0.14, "65plus": 0.11 },
    gender: { female: 0.55 },
    households: { total: 2000, familyHouseholds: 1200, marriedCouples: 800, singleParent: 400, nonFamily: 800, averageSize: 2.5 },
    income: { medianHousehold: 95000, povertyRate: 0.12, brackets: { over200k: 0.2, under50k: 0.29 } },
    education: { bachelors: 0.25, graduateProfessional: 0.13, highSchoolOrLess: 0.3, someCollege: 0.32 },
    employment: { laborForceParticipation: 0.73, unemploymentRate: 0.04 },
    housing: { medianHomeValue: 450000, medianRent: 1700, ownerOccupied: 0.52, renterOccupied: 0.48 },
    commute: { droveAlone: 0.74, workedFromHome: 0.14, publicTransit: 0.0, meanCommuteMinutes: 27 },
  },
};
const turnout = { "1": { registered: 2645, ballots: 1700 } };

describe("catalogue", () => {
  test("covers many categories and dozens of metrics", () => {
    expect(METRICS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(METRICS.map((m) => m.cat)).size).toBe(METRIC_CATEGORIES.length);
    for (const m of METRICS) expect(getMetric(m.id)).toBe(m);
  });
});

describe("buildRecords", () => {
  const recs = buildRecords([feature()], census, turnout);
  const r = recs[0];
  test("flattens politics, race, census, and turnout", () => {
    expect(r.precinct).toBe("1");
    expect(r.winner).toBe("Dem");
    expect(r.margin).toBeCloseTo(0, 5);
    expect(r.nonWhite).toBeCloseTo(0.4, 5);
    expect(r.medianIncome).toBe(95000);
    expect(r.medianAge).toBe(38.7);
    expect(r.turnoutRate).toBeCloseTo(1700 / 2645, 5);
    expect(r.nonVoters).toBe(945);
  });
  test("derives household + education percentages", () => {
    expect(r.pctFamily).toBeCloseTo(0.6, 5);      // 1200/2000
    expect(r.pctMarried).toBeCloseTo(0.4, 5);     // 800/2000
    expect(r.pctBachelorsPlus).toBeCloseTo(0.38, 5); // .25 + .13
  });
  test("leaves missing census fields null (e.g. a district with no profile)", () => {
    const noCensus = buildRecords([feature({ PRECINCT: "9" })], null, null)[0];
    expect(noCensus.medianIncome).toBeUndefined();
    expect(noCensus.demShare).toBe(0.4); // politics still present
    expect(noCensus.turnoutRate).toBeUndefined();
  });
});

describe("availableMetricIds", () => {
  test("reports only metrics with data present", () => {
    const ids = availableMetricIds(buildRecords([feature()], null, null));
    expect(ids.has("demShare")).toBe(true);
    expect(ids.has("medianIncome")).toBe(false); // no census passed
  });
});

describe("formatValue", () => {
  test("formats by type", () => {
    expect(formatValue(0.123, "pct")).toBe("12%");
    expect(formatValue(95000, "usd")).toBe("$95,000");
    expect(formatValue(2645, "num")).toBe("2,645");
    expect(formatValue(38.74, "dec")).toBe("38.7");
    expect(formatValue(null, "usd")).toBe("—");
  });
});

describe("sortRecords", () => {
  const recs = [
    { precinct: "A", medianIncome: 50000 },
    { precinct: "B", medianIncome: 120000 },
    { precinct: "C", medianIncome: null },
    { precinct: "D", medianIncome: 80000 },
  ];
  test("desc ranks highest first, nulls last", () => {
    expect(sortRecords(recs, "medianIncome", "desc").map((r) => r.precinct)).toEqual(["B", "D", "A", "C"]);
  });
  test("asc ranks lowest first, nulls still last", () => {
    expect(sortRecords(recs, "medianIncome", "asc").map((r) => r.precinct)).toEqual(["A", "D", "B", "C"]);
  });
});

describe("filterRecords", () => {
  const recs = [
    { precinct: "A", winner: "Dem", medianIncome: 50000 },
    { precinct: "B", winner: "Rep", medianIncome: 120000 },
    { precinct: "C", winner: "Dem", medianIncome: 200000 },
  ];
  test("party filter", () => {
    expect(filterRecords(recs, { party: "Dem" }).map((r) => r.precinct)).toEqual(["A", "C"]);
  });
  test("numeric condition (gte) drops nulls", () => {
    const recs2 = [...recs, { precinct: "D", winner: "Dem", medianIncome: null }];
    expect(filterRecords(recs2, { conditions: [{ key: "medianIncome", op: "gte", value: 100000 }] }).map((r) => r.precinct))
      .toEqual(["B", "C"]);
  });
  test("combined party + range", () => {
    expect(filterRecords(recs, { party: "Dem", conditions: [{ key: "medianIncome", op: "gte", value: 100000 }] }).map((r) => r.precinct))
      .toEqual(["C"]);
  });
});
