// map/mapStyles.js
// --------------------------------------------------------------------------------
// FILL ENGINES — one per map mode (REDESIGN.md §4.1; extracted from the map
// page controller in Phase 4). Each takes a feature's merged properties plus a
// small env object and returns an SVG fill: a pattern url (color + party
// geometry + bin density, NEVER color alone — a11y compliance) or a plain
// color on the canvas fallback / no-data case. Bin edges and ramp colors live
// in mapBins.js — shared with the legend, aria-labels, readout card, and List
// View so they can never disagree.
//
// env: { svg,        the overlay SVG hosting the pattern <defs> (null = canvas)
//        mode,       "lean" | "margin" | "diversity" | "primary"
//        raceId,     active race id or null
//        race,       { partisan, byPrecinct } when a race is showing
//        primary }   party-primary ballots lookup or null

import { PARTY_COLORS, PARTY_STRENGTH_COLORS } from "../lib/constants.js";
import { RAMPS, marginBin, diversityBin } from "./mapBins.js";
import { patternFill, partyKind } from "./mapPatterns.js";

// Map cosmetics that can't come from CSS variables (vector fills).
export const MAP_COSMETICS = { noData: "#DAD3C6", stroke: "#FFFDF9", hover: "#1560C4", sel: "#0B4DA2", notBallot: "#EFEBE2" };

export const PRIMARY_YEAR = 2026;

// Lean: fill = locked PARTY_STRENGTH_COLORS tint; pattern geometry by party
// (Rep diagonal / Dem horizontal / other dots); density = strength 1..3.
export function leanFill(p, env) {
  const party = p.winningParty;
  const strength = p.partyStrength;
  if (!party || !PARTY_STRENGTH_COLORS[party]) return MAP_COSMETICS.noData;
  const ramp = PARTY_STRENGTH_COLORS[party];
  const bg = ramp[strength] || ramp.default;
  const level = Math.max(1, Math.min(3, +strength || 1));
  return patternFill(env.svg, partyKind(party), level, bg);
}

// Margin: 5 named numeric bins (mapBins.MARGIN_BINS); dot density rises with
// the bin. Bin 0 (very close) stays solid pale so close races pop as "clean".
export function marginFill(p, env) {
  if (p.demShare == null || p.repShare == null || isNaN(p.demShare)) return MAP_COSMETICS.noData;
  const bin = marginBin(Math.abs(p.demShare - p.repShare));
  return patternFill(env.svg, "dots", bin, RAMPS.margin[bin]);
}

// Diversity: 5 fixed 20-point bins of non-white share.
export function diversityFill(p, env) {
  if (p.pct_white == null || isNaN(p.pct_white)) return MAP_COSMETICS.noData;
  const bin = diversityBin(1 - p.pct_white);
  return patternFill(env.svg, "dots", bin, RAMPS.diversity[bin]);
}

// Race results: fill by the winning party — but ONLY for precincts that
// actually participated (candidate votes > 0). computeWinners() assigns a
// "winner" to every precinct via an alphabetical-first-max rule even when a
// precinct had 0 votes (it wasn't on that ballot), so a sub-county race like
// CD-3 would otherwise light up the whole county. Non-participants → the
// distinct "not on this ballot" cross-hatch, never plain gray.
export function raceFill(p, env) {
  if (!env.race) return MAP_COSMETICS.noData;
  const r = env.race.byPrecinct[String(p.PRECINCT)];
  if (!r || r.total === 0 || !r.winner) return MAP_COSMETICS.noData;
  // Non-partisan / single-party race: "Winning Party" is a candidate-name
  // fragment, not Rep/Dem, so PARTY_COLORS would fall through to gray. Fill by
  // the winner's margin on a neutral ramp instead (decisiveness, not party).
  if (env.race.partisan === false) {
    const bin = marginBin(r.margin || 0);
    return patternFill(env.svg, "dots", bin, RAMPS.nonpartisan[bin]);
  }
  const bg = PARTY_COLORS[r.winner] || PARTY_COLORS.default;
  return patternFill(env.svg, partyKind(r.winner), 2, bg);
}

// The distinct texture for "was part of the map but not on this ballot" —
// readable (unlike the old 0.06 opacity ghost) and different from no-data gray.
export function notOnBallotFill(env) {
  return patternFill(env.svg, "cross", 2, MAP_COSMETICS.notBallot);
}

// Primary energy: which party's primary drew more ballots, in the exact lean
// visual language (party pattern, denser = more one-sided).
export function primaryFill(p, env) {
  const rec = env.primary?.[String(p.PRECINCT)]?.[PRIMARY_YEAR];
  if (!rec || rec.dem + rec.rep === 0) return MAP_COSMETICS.noData;
  const share = rec.dem / (rec.dem + rec.rep);
  const party = share >= 0.5 ? "Dem" : "Rep";
  const diff = Math.abs(share - 0.5);
  const level = diff < 0.05 ? 1 : diff < 0.15 ? 2 : 3;
  const ramp = PARTY_STRENGTH_COLORS[party];
  return patternFill(env.svg, partyKind(party), level, ramp[level] || ramp.default);
}

export function fillFor(p, env) {
  if (env.raceId) return raceFill(p, env);
  if (env.mode === "margin") return marginFill(p, env);
  if (env.mode === "diversity") return diversityFill(p, env);
  if (env.mode === "primary") return primaryFill(p, env);
  return leanFill(p, env);
}
