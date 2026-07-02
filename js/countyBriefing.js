// countyBriefing.js — the pure "so what" model for a county (or district).
//
// Turns the map's merged precinct features into:
//   headline — one plain-language sentence a 60+ volunteer reads first,
//   stats    — at most four tiles (plus the lean bar) for the dock,
//   lean     — integer percents for the stacked lean bar,
// with honest N/A everywhere data is missing (VEST-tier counties). DOM-free:
// rendered by commandCenter.js (dock) and listView.js (list header), and
// unit-tested directly.

export function leanCounts(features) {
  let rep = 0, dem = 0, mod = 0, nd = 0;
  for (const f of features) {
    const w = f.properties.winningParty;
    if (w === "Rep") rep++;
    else if (w === "Dem") dem++;
    else if (w === "Mod") mod++;
    else nd++;
  }
  return { rep, dem, mod, nd, total: features.length };
}

// Precincts decided by under 10 share points (the dock's "Competitive" tile).
export function competitiveCount(features) {
  let n = 0;
  for (const f of features) {
    const p = f.properties;
    if (p.demShare != null && !isNaN(p.demShare) && Math.abs(p.demShare - p.repShare) < 0.1) n++;
  }
  return n;
}

export function buildCountyBriefing(features, { countyName = "This county", isDistrict = false } = {}) {
  const c = leanCounts(features);
  const scored = c.rep + c.dem + c.mod;

  // share-weighted county lean (avg of precinct shares that exist)
  let sumR = 0, sumD = 0, n = 0;
  let sumNonWhite = 0, racialN = 0;
  for (const f of features) {
    const p = f.properties;
    if (p.demShare != null && !isNaN(p.demShare)) { sumR += p.repShare; sumD += p.demShare; n++; }
    if (p.pct_white != null && !isNaN(p.pct_white)) { sumNonWhite += 1 - p.pct_white; racialN++; }
  }
  const avgR = n ? sumR / n : null;
  const avgD = n ? sumD / n : null;
  const avgNonWhite = racialN ? sumNonWhite / racialN : null;
  const competitive = competitiveCount(features);

  const label = isDistrict ? countyName : `${countyName} County`;

  // headline: lean direction + how much of the map is genuinely in play
  let headline;
  if (avgR == null) {
    headline = `${label} has no precinct party data on file.`;
  } else {
    const gap = avgR - avgD;
    const direction =
      Math.abs(gap) < 0.03
        ? "is closely divided"
        : gap > 0
          ? `leans Republican by ${Math.round(gap * 100)} points`
          : `leans Democratic by ${Math.round(-gap * 100)} points`;
    headline = `${label} ${direction}. ${competitive} of ${c.total} precincts were decided by under 10 points.`;
  }

  const lean =
    avgR == null
      ? null
      : (() => {
          const r = Math.round(avgR * 100);
          const d = Math.round(avgD * 100);
          return { rep: r, dem: d, mod: Math.max(0, 100 - r - d) };
        })();

  // at most four tiles; every value is text, N/A when unknown
  const stats = [
    { label: "Republican precincts", value: `${c.rep}`, suffix: ` / ${c.total}`, party: "Rep" },
    { label: "Democratic precincts", value: `${c.dem}`, suffix: ` / ${c.total}`, party: "Dem" },
    { label: "Decided by under 10 pts", value: avgR == null ? "N/A" : `${competitive}`, term: "margin" },
    { label: "Non-white residents", value: avgNonWhite == null ? "N/A" : `${Math.round(avgNonWhite * 100)}%`, term: "diversity" },
  ];

  return {
    headline,
    sub: `${c.total} precincts · ${scored} with party data`,
    lean,
    stats,
    counts: c,
  };
}
