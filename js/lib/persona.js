// lib/persona.js
// --------------------------------------------------------------------------------
// The persona (view mode) state module — plumbing for the three-persona
// platform: "public" (default), "chair" (Simple View), "campaign" (Detailed
// View). No persona-specific data views exist yet; consumers read the resolved
// id (siteNav stamps it as html[data-persona]) and the layout registry in
// js/ui/personaLayouts.js decides what chrome it means.
//
// State model (see docs/ADDING_FEATURES.md "Persona-aware chrome"):
//  - `#persona=` in the hash is an ENTRY/OVERRIDE param — consumed once at
//    load, persisted, never written back. Pages' updateURL() calls rebuild the
//    whole hash from their own param set, so a persona param cannot survive
//    in the URL; localStorage (ccd_persona) is the carrier across pages.
//  - Resolution: valid URL value > valid stored value > "public".
//  - Switching personas reloads the page: orchestrators render once at init
//    and never subscribe to hash changes, so a reload is the honest way to
//    re-enter with new chrome.
//  - The dev toggle is gated by ccd_dev_tools, armed with `#dev=1` (sticky —
//    nav links drop the hash, so a non-persisted flag would die on the first
//    click) and disarmed with `#dev=0`.
// No DOM access here — attribute application lives in siteNav.

import { readParams } from "./urlState.js";

export const PERSONAS = Object.freeze(["public", "chair", "campaign"]);
export const DEFAULT_PERSONA = "public";

const PERSONA_KEY = "ccd_persona";
const DEV_TOOLS_KEY = "ccd_dev_tools";

// Pure: first valid value wins, anything else falls back to the default.
export function resolvePersona({ urlValue, storedValue } = {}) {
  if (PERSONAS.includes(urlValue)) return urlValue;
  if (PERSONAS.includes(storedValue)) return storedValue;
  return DEFAULT_PERSONA;
}

function storedPersona() {
  try {
    return localStorage.getItem(PERSONA_KEY);
  } catch {
    return null; // private mode: run as public/URL-driven
  }
}

// Resolve the active persona at page load. A valid `#persona=` overrides the
// stored choice and is persisted so it survives the next (hash-less) nav click.
export function initActivePersona() {
  const urlValue = readParams().persona;
  const persona = resolvePersona({ urlValue, storedValue: storedPersona() });
  if (PERSONAS.includes(urlValue)) {
    try {
      localStorage.setItem(PERSONA_KEY, urlValue);
    } catch {
      /* private mode: the override still applies for this page view */
    }
  }
  return persona;
}

// Persist a persona choice (the dev toggle calls this, then reloads).
// Invalid ids resolve to the default rather than throwing.
export function setActivePersona(id) {
  const persona = resolvePersona({ urlValue: id });
  try {
    localStorage.setItem(PERSONA_KEY, persona);
  } catch {
    /* private mode: the choice won't stick past this page view */
  }
  return persona;
}

// Developer tools gate for the persona toggle. `#dev=1` arms it (persisted),
// `#dev=0` disarms it; otherwise the stored flag decides.
export function devToolsEnabled() {
  const dev = readParams().dev;
  if (dev === "1") {
    try {
      localStorage.setItem(DEV_TOOLS_KEY, "1");
    } catch {
      /* private mode: enabled for this page view only */
    }
    return true;
  }
  if (dev === "0") {
    try {
      localStorage.removeItem(DEV_TOOLS_KEY);
    } catch {
      /* nothing stored to clear */
    }
    return false;
  }
  try {
    return localStorage.getItem(DEV_TOOLS_KEY) === "1";
  } catch {
    return false;
  }
}
