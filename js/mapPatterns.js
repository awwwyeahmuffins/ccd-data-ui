// mapPatterns.js — SVG pattern fills for the precinct map.
//
// "Never color alone": every party gets its own pattern GEOMETRY and every
// strength/bin gets a pattern DENSITY, so the map still reads under color
// blindness, low contrast sensitivity, or a bad projector:
//   Republican  = 45° diagonal hatch      Democratic = horizontal hatch
//   Moderate /
//   other       = dot grid                Not on ballot = light cross-hatch
//   Sequential bins (margin / diversity)  = dot grid, sparse → dense
//
// Each pattern paints its own background color (the data encoding — party
// colors stay locked in constants.js) plus hatch lines in ink or paper,
// whichever contrasts with that background. Patterns live in ONE <defs>
// inside Leaflet's overlay SVG; `url(#id)` also resolves from legend swatches
// elsewhere in the document.

const NS = "http://www.w3.org/2000/svg";

// spacing (px) per density level 0..4 — 0 means "solid, no pattern"
const SPACING = [0, 14, 10, 7, 5];

function relLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 1;
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

// Hatch ink: dark ink lines on light fills, warm paper lines on dark fills.
export function hatchColorFor(bg) {
  return relLuminance(bg) > 0.35 ? "rgba(28,39,51,0.42)" : "rgba(255,253,249,0.55)";
}

export function patternId(kind, level, bg) {
  return `ccpat-${kind}-${level}-${String(bg).replace("#", "").toLowerCase()}`;
}

function findOrCreateDefs(svg) {
  let defs = svg.querySelector("defs[data-ccpat]");
  if (!defs) {
    defs = document.createElementNS(NS, "defs");
    defs.setAttribute("data-ccpat", "1");
    svg.insertBefore(defs, svg.firstChild);
  }
  return defs;
}

function makeEl(name, attrs) {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// Build one pattern tile: background rect + geometry lines/dots.
function buildPattern(id, kind, level, bg) {
  const s = SPACING[Math.max(0, Math.min(SPACING.length - 1, level))] || 10;
  const ink = hatchColorFor(bg);
  const pattern = makeEl("pattern", {
    id,
    width: s,
    height: s,
    patternUnits: "userSpaceOnUse",
    ...(kind === "diag" ? { patternTransform: "rotate(45)" } : {}),
    ...(kind === "cross" ? { patternTransform: "rotate(45)" } : {}),
  });
  pattern.appendChild(makeEl("rect", { width: s, height: s, fill: bg }));
  if (kind === "diag" || kind === "horiz") {
    // one line per tile; rotate(45) turns the horizontal line diagonal
    pattern.appendChild(makeEl("line", { x1: 0, y1: 0, x2: s, y2: 0, stroke: ink, "stroke-width": 1.4 }));
  } else if (kind === "cross") {
    pattern.appendChild(makeEl("line", { x1: 0, y1: 0, x2: s, y2: 0, stroke: ink, "stroke-width": 1.2 }));
    pattern.appendChild(makeEl("line", { x1: 0, y1: 0, x2: 0, y2: s, stroke: ink, "stroke-width": 1.2 }));
  } else {
    // dots
    pattern.appendChild(makeEl("circle", { cx: s / 2, cy: s / 2, r: 1.5, fill: ink }));
  }
  return pattern;
}

// Ensure a pattern exists in this SVG and return its fill url.
// level 0 (or an unknown svg) falls back to the plain background color.
export function patternFill(svg, kind, level, bg) {
  if (!svg || level <= 0) return bg;
  const id = patternId(kind, level, bg);
  const defs = findOrCreateDefs(svg);
  // ids are [a-z0-9-] by construction (patternId strips "#", lowercases)
  if (!defs.querySelector(`#${id}`)) defs.appendChild(buildPattern(id, kind, level, bg));
  return `url(#${id})`;
}

// Party -> pattern geometry. Anything that isn't the two major parties gets
// dots so purple "Mod"/other never reads as a diluted red or blue.
export function partyKind(party) {
  const p = String(party || "").toUpperCase();
  if (p.startsWith("REP")) return "diag";
  if (p.startsWith("DEM")) return "horiz";
  return "dots";
}

// Legend swatch markup referencing the same document-wide pattern defs.
export function swatchSVG(fill, { size = 22, border = "#D8D2C6" } = {}) {
  return (
    `<svg class="cc-sw" width="${size}" height="${size}" role="img" aria-hidden="true">` +
    `<rect width="${size}" height="${size}" rx="4" fill="${fill}" stroke="${border}"/></svg>`
  );
}
