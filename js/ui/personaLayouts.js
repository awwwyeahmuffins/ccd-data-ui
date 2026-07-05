// ui/personaLayouts.js
// --------------------------------------------------------------------------------
// The persona layout registry — the seam where the three personas' chrome
// diverges. One registry rather than three layout files; when an entry's
// chrome grows beyond a hook or two, splitting it into its own module is
// mechanical.
//
// Each layout is consulted by siteNav when it renders the shared header:
//  - navPages(pages): given the default five-tab list, return the tabs this
//    persona sees. Identity for public; the chair persona prepends its
//    dashboard (chair.html), the campaign persona appends its Campaign
//    Dashboard tab (campaign.html). The pages themselves never gate on
//    persona: a direct URL works for anyone, the tab is just
//    discoverability. e2e and unit tests pin all three shapes.
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

// `menuLabel` is the plain-language option text in the header View switcher
// (siteNav): what a real visitor reads to pick a mode. `label` stays the short
// internal id-ish name; `badge` is the chip shown next to the brand.
export const PERSONA_LAYOUTS = Object.freeze({
  public: Object.freeze({
    id: "public",
    label: "Public",
    menuLabel: "Public view",
    badge: null,
    navPages: identity,
    renderChromeExtras: noop,
  }),
  chair: Object.freeze({
    id: "chair",
    label: "Precinct Chair",
    menuLabel: "Simple view (chair)",
    badge: "Simple View",
    navPages: (pages) => [CHAIR_DASHBOARD, ...pages],
    renderChromeExtras: noop,
  }),
  campaign: Object.freeze({
    id: "campaign",
    label: "Campaign",
    menuLabel: "Detailed view (campaign)",
    badge: "Detailed View",
    navPages: (pages) => [...pages, { href: "campaign.html", label: "Campaign Dashboard" }],
    renderChromeExtras: noop,
  }),
});

export function layoutFor(personaId) {
  return PERSONA_LAYOUTS[personaId] || PERSONA_LAYOUTS.public;
}
