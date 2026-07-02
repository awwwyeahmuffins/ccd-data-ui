// map/legend.js
// --------------------------------------------------------------------------------
// The map legend (REDESIGN.md §4.1; extracted from the map page controller in
// Phase 4). Discrete named bins with pattern-bearing swatches — the EXACT
// fills the map uses (same pattern defs via url(#…)), with numeric ranges
// written out. Never a gradient bar a 60+ eye has to interpolate.
//
// legendHTML(env) returns the innerHTML string; the page assigns it.
// env: { svg, mode, raceId, race, primary, hasOtherPrecinctLayer, hasOtherLayer }

import { escapeHtml } from "../lib/dom.js";
import { PARTY_COLORS, PARTY_STRENGTH_COLORS } from "../lib/constants.js";
import { RAMPS, legendBins } from "./mapBins.js";
import { patternFill, swatchSVG } from "./mapPatterns.js";
import { MAP_COSMETICS, PRIMARY_YEAR, notOnBallotFill } from "./mapStyles.js";

function legendRow(fill, label) {
  return `<div class="cc-legend-row">${swatchSVG(fill)}<span>${label}</span></div>`;
}

function binRows(kind, ramp, svg) {
  return legendBins(kind)
    .map((b) => legendRow(patternFill(svg, "dots", b.index, ramp[b.index]), `${escapeHtml(b.name)} — ${escapeHtml(b.range)}`))
    .join("");
}

export function legendHTML(env) {
  const svg = env.svg;
  const notBallotRow = legendRow(notOnBallotFill(env), "Not on this ballot");
  const noDataRow = legendRow(MAP_COSMETICS.noData, "No data (N/A)");

  if (env.raceId && env.race) {
    // Non-partisan / single-party race: neutral decisiveness bins, not Rep/Dem.
    if (env.race.partisan === false) {
      return `
        <div class="cc-legend-title">${escapeHtml(env.race.label)}</div>
        <p class="cc-legend-desc">How decisively the leading candidate won each precinct.</p>
        ${binRows("margin", RAMPS.nonpartisan, svg)}
        ${notBallotRow}
        <p class="cc-legend-desc">Showing one race — tap Lean, Margin, or Diversity above to go back to the county overview.</p>`;
    }
    return `
      <div class="cc-legend-title">${escapeHtml(env.race.label)}</div>
      <p class="cc-legend-desc">Which party won each precinct in this race. Stripes lean with the party: Republican ↗, Democratic —.</p>
      ${legendRow(patternFill(svg, "diag", 2, PARTY_COLORS.Rep), "Republican win")}
      ${legendRow(patternFill(svg, "horiz", 2, PARTY_COLORS.Dem), "Democratic win")}
      ${legendRow(patternFill(svg, "dots", 2, PARTY_COLORS.Mod || "#800080"), "Other / Moderate win")}
      ${notBallotRow}
      ${env.hasOtherPrecinctLayer ? legendRow(patternFill(svg, "diag", 2, PARTY_COLORS.Rep), "Other county · precinct-level") : ""}
      ${env.hasOtherLayer ? `<div class="cc-legend-row"><span class="cc-legend-sw cc-sw-dash"></span><span>County total (dashed outline)</span></div>` : ""}
      <p class="cc-legend-desc">Showing one race — tap Lean, Margin, or Diversity above to go back to the county overview.</p>`;
  }
  if (env.mode === "lean") {
    const P = PARTY_STRENGTH_COLORS;
    return `
      <div class="cc-legend-title">Party Lean</div>
      <p class="cc-legend-desc">Which party each precinct usually favors. Denser stripes = stronger habit.</p>
      ${legendRow(patternFill(svg, "diag", 3, P.Rep[3]), "Strong Republican")}
      ${legendRow(patternFill(svg, "diag", 1, P.Rep[1]), "Slight Republican")}
      ${legendRow(patternFill(svg, "horiz", 1, P.Dem[1]), "Slight Democratic")}
      ${legendRow(patternFill(svg, "horiz", 3, P.Dem[3]), "Strong Democratic")}
      ${legendRow(patternFill(svg, "dots", 2, P.Mod ? P.Mod[2] : "#B19CD9"), "Moderate / mixed")}
      ${noDataRow}`;
  }
  if (env.mode === "margin") {
    return `
      <div class="cc-legend-title">Victory Margin</div>
      <p class="cc-legend-desc">How close the vote was, in percentage points. Denser dots = more lopsided.</p>
      ${binRows("margin", RAMPS.margin, svg)}
      ${noDataRow}`;
  }
  if (env.mode === "primary") {
    const P = PARTY_STRENGTH_COLORS;
    return `
      <div class="cc-legend-title">${PRIMARY_YEAR} Primary Ballots</div>
      <p class="cc-legend-desc">Which party's ${PRIMARY_YEAR} primary drew more voters here. Denser stripes = more one-sided. Source: official county reports.</p>
      ${legendRow(patternFill(svg, "diag", 3, P.Rep[3]), "Strongly Republican primary")}
      ${legendRow(patternFill(svg, "diag", 1, P.Rep[1]), "Slightly Republican primary")}
      ${legendRow(patternFill(svg, "horiz", 1, P.Dem[1]), "Slightly Democratic primary")}
      ${legendRow(patternFill(svg, "horiz", 3, P.Dem[3]), "Strongly Democratic primary")}
      ${noDataRow}`;
  }
  return `
    <div class="cc-legend-title">Non-White Share</div>
    <p class="cc-legend-desc">Share of residents who are not non-Hispanic white (Census).</p>
    ${binRows("diversity", RAMPS.diversity, svg)}
    ${noDataRow}`;
}
