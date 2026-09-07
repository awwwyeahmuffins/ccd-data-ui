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
import { RAMPS, legendBins, STRENGTH_WORDS } from "./mapBins.js";
import { patternFill, swatchSVG, partyKind } from "./mapPatterns.js";
import { MAP_COSMETICS, PRIMARY_YEAR, notOnBallotFill } from "./mapStyles.js";

function legendRow(fill, label) {
  return `<div class="cc-legend-row">${swatchSVG(fill)}<span>${label}</span></div>`;
}

// One row per (party, strength) exactly as leanFill paints it — same
// patternFill call, same colour ramp — so a level can never exist on the map
// without a swatch. The legend receives no precinct data, so it cannot know
// which levels occur and must show all three.
function strengthRows(svg, party, label) {
  const ramp = PARTY_STRENGTH_COLORS[party];
  if (!ramp) return "";
  return [3, 2, 1]
    .map((lvl) => legendRow(
      patternFill(svg, partyKind(party), lvl, ramp[lvl] || ramp.default),
      `${escapeHtml(STRENGTH_WORDS[lvl])} ${escapeHtml(label)}`.replace(/^./, (c) => c.toUpperCase())
    ))
    .join("");
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
      ${env.hasOtherPrecinctLayer ? `<p class="cc-legend-desc">Precincts outside Collin use the same party colors as Collin's — shown at precinct-level where we have their geometry.</p>` : ""}
      ${env.hasOtherLayer ? `<div class="cc-legend-row"><span class="cc-legend-sw cc-sw-dash"></span><span>County total (dashed outline)</span></div>` : ""}
      <p class="cc-legend-desc">Showing one race — tap Lean, Margin, or Diversity above to go back to the county overview.</p>`;
  }
  if (env.mode === "lean") {
    // The default view. It used to show strength 3 and 1 only, while leanFill
    // paints a distinct colour and density for level 2 as well — 46% of
    // precincts had no swatch, and Moderate had exactly one for three levels.
    // Nine rows is too tall for one column on an iPad, so they go two-up
    // rather than being dropped: a missing swatch is what caused the bug.
    return `
      <div class="cc-legend-title">Party Lean</div>
      <p class="cc-legend-desc">Which party each precinct usually favors, from a model of its voters — not a vote count. Denser stripes = stronger habit.</p>
      <div class="cc-legend-rows">
        ${strengthRows(svg, "Rep", "Republican")}
        ${strengthRows(svg, "Dem", "Democratic")}
        ${strengthRows(svg, "Mod", "Moderate")}
        ${noDataRow}
      </div>`;
  }
  if (env.mode === "margin") {
    return `
      <div class="cc-legend-title">Modeled Party Split</div>
      <p class="cc-legend-desc">How far apart the model puts the two parties, in percentage points — not a vote count. Pick a race above to map that race's real results. Denser dots = more lopsided.</p>
      ${binRows("margin", RAMPS.margin, svg)}
      ${noDataRow}`;
  }
  if (env.mode === "primary") {
    return `
      <div class="cc-legend-title">${PRIMARY_YEAR} Primary Ballots</div>
      <p class="cc-legend-desc">Which party's ${PRIMARY_YEAR} primary drew more voters here. Denser stripes = more one-sided. Source: official county reports.</p>
      <div class="cc-legend-rows">
        ${strengthRows(svg, "Rep", "Republican primary")}
        ${strengthRows(svg, "Dem", "Democratic primary")}
        ${noDataRow}
      </div>`;
  }
  return `
    <div class="cc-legend-title">Non-White Share</div>
    <p class="cc-legend-desc">Share of residents who are not non-Hispanic white (Census).</p>
    ${binRows("diversity", RAMPS.diversity, svg)}
    ${noDataRow}`;
}
