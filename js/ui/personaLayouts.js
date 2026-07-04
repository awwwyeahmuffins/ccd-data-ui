// ui/personaLayouts.js
// --------------------------------------------------------------------------------
// The persona layout registry — the seam where the three personas' chrome
// diverges. One registry rather than three layout files while everything is
// still plumbing; when chair/campaign chrome actually diverges, splitting an
// entry into its own module is mechanical.
//
// Each layout is consulted by siteNav when it renders the shared header:
//  - navPages(pages): given the default five-tab list, return the tabs this
//    persona sees. Identity for public/campaign; the chair persona prepends
//    its dashboard (chair.html) — the first real persona divergence
//    (July 2026). e2e and unit tests pin both shapes.
//  - badge: a short label rendered next to the brand so a non-public persona
//    is visibly active (null = no badge).
//  - renderChromeExtras(headerEl): hook for persona-specific header chrome
//    (extra links, tools). No-op for every persona today.
// Renders what it is handed — no fetching, no persona resolution (that lives
// in js/lib/persona.js).

const noop = () => {};
const identity = (pages) => pages;

// The chair persona's dashboard tab (chair.html works standalone for anyone;
// only the nav entry is persona-gated). Exported so tests pin one literal.
export const CHAIR_DASHBOARD = Object.freeze({
  href: "chair.html",
  label: "My Dashboard",
});

export const PERSONA_LAYOUTS = Object.freeze({
  public: Object.freeze({
    id: "public",
    label: "Public",
    badge: null,
    navPages: identity,
    renderChromeExtras: noop,
  }),
  chair: Object.freeze({
    id: "chair",
    label: "Precinct Chair",
    badge: "Simple View",
    navPages: (pages) => [CHAIR_DASHBOARD, ...pages],
    renderChromeExtras: noop,
  }),
  campaign: Object.freeze({
    id: "campaign",
    label: "Campaign",
    badge: "Detailed View",
    navPages: identity,
    renderChromeExtras: noop,
  }),
});

export function layoutFor(personaId) {
  return PERSONA_LAYOUTS[personaId] || PERSONA_LAYOUTS.public;
}
