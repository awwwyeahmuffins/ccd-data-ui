/**
 * @jest-environment node
 */
import {
  STRATEGIES,
  STRATEGY_CATEGORIES,
  getStrategy,
  strategyAvailable,
  derivePrecinctMetrics,
  rankPrecincts,
} from "./targeting.js";

// helper to build a precinct's merged properties
function p(over = {}) {
  return {
    PRECINCT: "1",
    rep: 1000, mod: 500, dem: 800,
    repShare: 0.43, modShare: 0.22, demShare: 0.35,
    winningParty: "Rep", partyStrength: 1,
    pct_white: 0.7, total: 3000,
    ...over,
  };
}

describe("catalogue shape", () => {
  test("every strategy has the required fields and a real category", () => {
    const cats = new Set(STRATEGY_CATEGORIES.map((c) => c.id));
    for (const s of STRATEGIES) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.label).toBe("string");
      expect(typeof s.score).toBe("function");
      expect(typeof s.explain).toBe("function");
      expect(cats.has(s.cat)).toBe(true);
    }
  });
  test("offers well more than two scenarios across all four categories", () => {
    expect(STRATEGIES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(STRATEGIES.map((s) => s.cat)).size).toBe(4);
  });
  test("strategy ids are unique", () => {
    expect(new Set(STRATEGIES.map((s) => s.id)).size).toBe(STRATEGIES.length);
  });
});

describe("derivePrecinctMetrics", () => {
  test("returns null without modeled party data", () => {
    expect(derivePrecinctMetrics({ PRECINCT: "9" }, null)).toBeNull();
    expect(derivePrecinctMetrics(p({ winningParty: "" }), null)).toBeNull();
  });
  test("computes lean, margin, votes, non-white", () => {
    const m = derivePrecinctMetrics(p(), null);
    expect(m.margin).toBeCloseTo(0.08, 5);
    expect(m.lean).toBeCloseTo(0.08, 5);
    expect(m.votes).toBe(2300);
    expect(m.nonWhite).toBeCloseTo(0.3, 5);
  });
  test("turnout fields are null when no turnout passed, derived when present", () => {
    expect(derivePrecinctMetrics(p(), null).rate).toBeNull();
    const m = derivePrecinctMetrics(p(), { registered: 2000, ballots: 1200 });
    expect(m.rate).toBeCloseTo(0.6, 5);
    expect(m.dropoff).toBe(800);
  });
  test("elasticity is the high/low turnout-rate spread, null without both rates", () => {
    expect(derivePrecinctMetrics(p(), { registered: 2000, ballots: 1200 }).elasticity).toBeNull();
    const m = derivePrecinctMetrics(p(), { registered: 2000, ballots: 1200, highRate: 0.7, lowRate: 0.3 });
    expect(m.elasticity).toBeCloseTo(0.4, 5);
    // never negative even if the loader crosses them
    expect(derivePrecinctMetrics(p(), { highRate: 0.2, lowRate: 0.5 }).elasticity).toBe(0);
  });
  test("NVO is party universe still home at the marquee rate, from the leading party", () => {
    // dem 800 leads (demShare .35 vs repShare .43 → Rep leads here), rate .6
    const m = derivePrecinctMetrics(p(), { registered: 2000, ballots: 1200 });
    expect(m.nvoDem).toBe(Math.round(800 * 0.4)); // 320
    expect(m.nvoRep).toBe(Math.round(1000 * 0.4)); // 400
    expect(m.nvo).toBe(m.nvoRep); // Rep leads (lean > 0) → Rep NVO
    expect(derivePrecinctMetrics(p(), null).nvo).toBeNull(); // no rate → null
  });
  test("regGrowth is the registration delta across years, null without both endpoints", () => {
    expect(derivePrecinctMetrics(p(), { registered: 2000, ballots: 1200 }).regGrowth).toBeNull();
    const m = derivePrecinctMetrics(p(), { regFirst: 1000, regLast: 1200 });
    expect(m.regGrowth).toBeCloseTo(0.2, 5);
  });
});

describe("elasticity / NVO / churn strategies", () => {
  const withSignals = (over) =>
    derivePrecinctMetrics(
      p({ repShare: 0.30, demShare: 0.55, winningParty: "Dem", ...over }),
      { registered: 2000, ballots: 1000, highRate: 0.7, lowRate: 0.3, regFirst: 1000, regLast: 1300 }
    );
  test("winnable-elastic scores close + elastic, null without elasticity", () => {
    const s = getStrategy("winnable-elastic");
    expect(s.score(withSignals())).toBeGreaterThan(0);
    expect(s.score(derivePrecinctMetrics(p(), { registered: 2000, ballots: 1000 }))).toBeNull();
  });
  test("elastic-gotv-dem only scores Dem-leaning precincts with elasticity", () => {
    expect(getStrategy("elastic-gotv-dem").score(withSignals())).toBeGreaterThan(0);
    expect(getStrategy("elastic-gotv-dem").score(withSignals({ repShare: 0.6, demShare: 0.3, winningParty: "Rep" }))).toBeNull();
  });
  test("net-vote-opportunity scores the leading party's untapped supporters", () => {
    expect(getStrategy("net-vote-opportunity").score(withSignals())).toBeGreaterThan(0);
  });
  test("high-growth-register scores positive roll growth only", () => {
    expect(getStrategy("high-growth-register").score(withSignals())).toBeCloseTo(0.3, 5);
    expect(getStrategy("high-growth-register").score(withSignals({}))).toBeGreaterThan(0);
    const flat = derivePrecinctMetrics(p(), { regFirst: 1000, regLast: 1000 });
    expect(getStrategy("high-growth-register").score(flat)).toBeNull();
  });
});

describe("flip strategies respect the current winner", () => {
  test("flip-dem-rep only scores Dem-won precincts", () => {
    const dem = derivePrecinctMetrics(p({ winningParty: "Dem" }), null);
    const rep = derivePrecinctMetrics(p({ winningParty: "Rep" }), null);
    expect(getStrategy("flip-dem-rep").score(dem)).toBeGreaterThan(0);
    expect(getStrategy("flip-dem-rep").score(rep)).toBeNull();
  });
  test("flip-rep-dem only scores Rep-won precincts", () => {
    const rep = derivePrecinctMetrics(p({ winningParty: "Rep" }), null);
    expect(getStrategy("flip-rep-dem").score(rep)).toBeGreaterThan(0);
    expect(getStrategy("flip-rep-dem").score(derivePrecinctMetrics(p({ winningParty: "Dem" }), null))).toBeNull();
  });
});

describe("turnout strategies need turnout, and respect lean", () => {
  test("mobilize-rep is null without turnout and for Dem-leaning precincts", () => {
    const repNoTurnout = derivePrecinctMetrics(p(), null);
    expect(getStrategy("mobilize-rep").score(repNoTurnout)).toBeNull();
    const demWithTurnout = derivePrecinctMetrics(
      p({ repShare: 0.3, demShare: 0.5, winningParty: "Dem" }),
      { registered: 2000, ballots: 1000 }
    );
    expect(getStrategy("mobilize-rep").score(demWithTurnout)).toBeNull();
    expect(getStrategy("mobilize-dem").score(demWithTurnout)).toBeGreaterThan(0);
  });
  test("strategyAvailable gates on declared needs", () => {
    const mobilize = getStrategy("mobilize-rep");
    expect(strategyAvailable(mobilize, { hasTurnout: false, hasRacial: true })).toBe(false);
    expect(strategyAvailable(mobilize, { hasTurnout: true, hasRacial: true })).toBe(true);
    expect(strategyAvailable(getStrategy("tossups"), { hasTurnout: false, hasRacial: false })).toBe(true);
    expect(strategyAvailable(getStrategy("diversifying"), { hasTurnout: true, hasRacial: false })).toBe(false);
  });
});

describe("rankPrecincts", () => {
  const features = [
    { properties: p({ PRECINCT: "A", repShare: 0.50, demShare: 0.46, modShare: 0.04, winningParty: "Rep" }) }, // margin .04
    { properties: p({ PRECINCT: "B", repShare: 0.70, demShare: 0.20, modShare: 0.10, winningParty: "Rep" }) }, // margin .50
    { properties: p({ PRECINCT: "C", repShare: 0.48, demShare: 0.49, modShare: 0.03, winningParty: "Dem" }) }, // margin .01
    { properties: { PRECINCT: "D" } }, // no party data — skipped
  ];
  test("tossups ranks the closest margin first and skips dataless precincts", () => {
    const r = rankPrecincts(features, "tossups");
    expect(r[0].code).toBe("C"); // margin .01
    expect(r.map((x) => x.code)).not.toContain("D");
    expect(r.length).toBe(3);
  });
  test("limit caps the result", () => {
    expect(rankPrecincts(features, "tossups", { limit: 2 }).length).toBe(2);
  });
  test("explain string carries the precinct's real numbers", () => {
    const r = rankPrecincts(features, "tossups", { limit: 1 });
    expect(r[0].explain).toMatch(/Dem \+1%/);
  });
  test("turnout-gap ranks the biggest non-voter pool first", () => {
    const tl = { A: { registered: 1000, ballots: 300 }, B: { registered: 1000, ballots: 950 }, C: { registered: 500, ballots: 100 } };
    const r = rankPrecincts(features, "turnout-gap", { turnoutLookup: tl });
    expect(r[0].code).toBe("A"); // dropoff 700 > C 400 > B 50
    expect(r[r.length - 1].code).toBe("B");
  });
  test("unknown strategy returns empty", () => {
    expect(rankPrecincts(features, "nope")).toEqual([]);
  });
});
