// map/mapView.js
// --------------------------------------------------------------------------------
// The ONE Leaflet stack (REDESIGN.md §4.1; extracted from the map page
// controller in Phase 4). Owns map creation (SVG renderer by default — every
// precinct is a real, focusable, pattern-fillable DOM node; canvas is the perf
// escape hatch), the keyboard/a11y layer over precinct paths, the close-zoom
// precinct-number chips, view fitting, and the precinct.html mini-map (the
// second consumer that proves the interface). Data comes in as arguments —
// this module never fetches.

import { escapeHtml } from "../lib/dom.js";
import { MAP_CONFIG, LIGHT_TILE_URL } from "../lib/constants.js";

// Subtle CartoDB basemap for geographic grounding (precinct chairs orienting
// to their turf). Kept low-opacity in CSS so the choropleth dominates.
const BASEMAP = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const BASEMAP_ATTR =
  '&copy; <a href="https://carto.com/">CARTO</a> · &copy; OpenStreetMap';

/**
 * Create the full-page precinct map: Leaflet map + renderer + basemap, with
 * the map region announcing its keyboard interface. Layers are the page's
 * job (styling is state-driven); svgRoot() exposes the overlay SVG that
 * hosts the pattern <defs> (null on the canvas fallback).
 */
export function createMapView({ containerId, useCanvas = false }) {
  const renderer = useCanvas ? L.canvas() : L.svg({ padding: 0.3 });
  const map = L.map(containerId, {
    zoomControl: false, // added below at top-right so it never collides with the mode switch (top-left)
    attributionControl: true,
    renderer,
    zoomSnap: 0,
    minZoom: 6,
    maxZoom: 16,
  });
  L.control.zoom({ position: "topright" }).addTo(map);

  // The map region announces how to drive it without a pointer.
  const mapEl = document.getElementById(containerId);
  mapEl.setAttribute("role", "application");
  mapEl.setAttribute(
    "aria-label",
    "Precinct map. Press Tab to enter the precincts, arrow keys to move between them, Enter to open a precinct's details."
  );

  const tiles = L.tileLayer(BASEMAP, {
    attribution: BASEMAP_ATTR,
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  enableTwoFingerPan(map, mapEl);

  return {
    map,
    renderer,
    tiles,
    svgRoot: () => (useCanvas ? null : renderer._container || null),
  };
}

/**
 * Solve the mobile "scroll trap": on touch devices a one-finger drag over a
 * full-bleed map hijacks the page scroll. We require TWO fingers to pan (pinch-
 * zoom already needs two), so a one-finger swipe scrolls the page as expected,
 * and flash an opaque hint the first time someone tries to drag with one finger.
 * Mouse/trackpad users are unaffected (they never fire touch events). The
 * keyboard/List paths are untouched. No-op where touch isn't present.
 */
function enableTwoFingerPan(map, mapEl) {
  if (typeof window === "undefined") return;
  const touchCapable =
    "ontouchstart" in window ||
    (navigator.maxTouchPoints || 0) > 0 ||
    (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  if (!touchCapable || !map.dragging) return;

  // Let the browser scroll the page on a vertical one-finger gesture.
  mapEl.style.touchAction = "pan-y";

  const hint = document.createElement("div");
  hint.className = "map-pan-hint backplate";
  hint.setAttribute("aria-hidden", "true");
  hint.textContent = "Use two fingers to move the map";
  mapEl.appendChild(hint);
  let hintTimer = null;
  const flashHint = () => {
    hint.classList.add("show");
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove("show"), 1600);
  };

  // Capture phase so we set the drag state BEFORE Leaflet's own touch handler
  // reads it. Two fingers → pan; one finger → let the page scroll + hint.
  mapEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length >= 2) {
        map.dragging.enable();
        hint.classList.remove("show");
      } else {
        map.dragging.disable();
      }
    },
    { capture: true, passive: true }
  );
  mapEl.addEventListener(
    "touchmove",
    (e) => { if (e.touches.length < 2) flashHint(); },
    { capture: true, passive: true }
  );
  // Reset so a subsequent mouse drag (touch laptops) still works.
  mapEl.addEventListener("touchend", (e) => {
    if (e.touches.length === 0) map.dragging.enable();
  });
}

/** Fit the view to a layer's bounds, falling back to the county default. */
export function fitToLayer(map, layer) {
  try {
    const b = layer.getBounds();
    if (b.isValid()) { map.fitBounds(b, { padding: [30, 30] }); return; }
  } catch (_) { /* fall through */ }
  map.setView(MAP_CONFIG.center, MAP_CONFIG.zoom);
}

/**
 * SVG accessibility layer: every precinct path becomes a labelled, keyboard-
 * reachable button (roving tabindex; code order). Canvas fallback returns []
 * (no DOM paths) — the List View remains the fully keyboard/AT path there.
 * @returns the keyboard-ordered layer array
 */
export function decoratePrecinctPaths(layer, { useCanvas = false, describe }) {
  const kb = [];
  if (!layer || useCanvas) return kb;
  layer.eachLayer((l) => { if (l._path) kb.push(l); });
  kb.sort((a, b) => {
    const ca = String(a.feature.properties.PRECINCT), cb = String(b.feature.properties.PRECINCT);
    return (parseInt(ca, 10) || 0) - (parseInt(cb, 10) || 0) || ca.localeCompare(cb);
  });
  kb.forEach((l, i) => {
    const path = l._path;
    path.setAttribute("role", "button");
    path.setAttribute("tabindex", i === 0 ? "0" : "-1");
    path.setAttribute("aria-label", describe(l.feature.properties));
  });
  return kb;
}

/**
 * Arrow-key navigation over the decorated paths. getKb() is read per keydown
 * so the page can rebuild the layer without rewiring.
 */
export function wirePrecinctKeyboard(containerEl, { useCanvas = false, getKb, onPick }) {
  if (useCanvas) return;
  containerEl.addEventListener("keydown", (e) => {
    const kb = getKb();
    const idx = kb.findIndex((l) => l._path === e.target);
    if (idx === -1) return;
    const move = (to) => {
      const next = kb[Math.max(0, Math.min(kb.length - 1, to))];
      if (!next) return;
      kb.forEach((l) => l._path.setAttribute("tabindex", l === next ? "0" : "-1"));
      next._path.focus();
      next._path.scrollIntoView?.({ block: "nearest" });
    };
    switch (e.key) {
      case "ArrowRight": case "ArrowDown": e.preventDefault(); move(idx + 1); break;
      case "ArrowLeft": case "ArrowUp": e.preventDefault(); move(idx - 1); break;
      case "Home": e.preventDefault(); move(0); break;
      case "End": e.preventDefault(); move(kb.length - 1); break;
      case "Enter": case " ": e.preventDefault(); onPick(String(kb[idx].feature.properties.PRECINCT)); break;
    }
  });
}

/**
 * Precinct-number chips: at close zoom every big-enough polygon carries its
 * number on a solid backplate — the number is on the map itself, not hidden
 * behind a hover. Small polygons stay unlabelled (declutter). Pass the
 * previous label layer; returns the replacement (or null below min zoom).
 */
export function updatePrecinctLabels(map, layer, prevLabelLayer, { minZoom = 11 } = {}) {
  if (prevLabelLayer) prevLabelLayer.remove();
  if (!map || !layer || map.getZoom() < minZoom) return null;
  const markers = [];
  layer.eachLayer((l) => {
    let b;
    try { b = l.getBounds(); } catch (_) { return; }
    if (!b || !b.isValid()) return;
    const p1 = map.latLngToContainerPoint(b.getNorthWest());
    const p2 = map.latLngToContainerPoint(b.getSouthEast());
    if (Math.abs(p2.x - p1.x) < 62 || Math.abs(p2.y - p1.y) < 36) return; // too small for a chip
    const code = String(l.feature.properties.PRECINCT).split(":").pop();
    markers.push(
      L.marker(b.getCenter(), {
        icon: L.divIcon({ className: "cc-plabel-wrap", html: `<span class="cc-plabel">${escapeHtml(code)}</span>` }),
        interactive: false,
        keyboard: false,
      })
    );
  });
  return markers.length ? L.layerGroup(markers).addTo(map) : null;
}

/**
 * The precinct report's mini-map shell: interactive Leaflet map on the light
 * basemap (the second consumer of this module — precinct.html). The report
 * page owns its own layers (selected precinct + all-precincts context) and
 * reuses the instance across renders; this owns the one way map instances +
 * tiles are created.
 */
export function createMiniMap(container) {
  const map = L.map(container, {
    zoomControl: true,
    attributionControl: false,
    dragging: true,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    touchZoom: true,
  });
  L.tileLayer(LIGHT_TILE_URL, { maxZoom: 18 }).addTo(map);
  return map;
}
