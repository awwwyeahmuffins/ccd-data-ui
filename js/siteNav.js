// siteNav.js — the one plain-language header, rendered into
// <header id="site-header"> on every page.
//
// Civic-plain rules this module owns:
//  - a single flat row of large text tabs (no hamburger, no dropdown, no
//    icon-only buttons) with aria-current on the open page;
//  - the text-size toggle (#nav-text-size -> html.text-large, persisted);
//  - the one-time welcome panel for first visits (ccd_welcome_seen);
//  - idempotent: commandCenter's init runs twice on the deployed auth path.

import { initGlossary } from "./glossary.js";
import { initHelpPanel } from "./helpPanel.js";
import { readParams, writeParams } from "./lib/urlState.js";
import {
  initActivePersona,
  setActivePersona,
  devToolsEnabled,
} from "./lib/persona.js";
import { PERSONA_LAYOUTS, layoutFor } from "./ui/personaLayouts.js";

const TEXT_SIZE_KEY = "ccd_text_large";
const WELCOME_KEY = "ccd_welcome_seen";
// The Cognito SDK persists its session under keys with this prefix; scanning
// for them lets every page offer Sign out without importing the SDK.
const COGNITO_PREFIX = "CognitoIdentityServiceProvider.";

function hasCognitoSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith(COGNITO_PREFIX)) return true;
    }
  } catch {
    /* storage unavailable */
  }
  return false;
}

function clearCognitoSession() {
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(COGNITO_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}

// Nav order mirrors the volunteer's workflow: see the map, look up results,
// plan, then reference material last.
const PAGES = [
  // The five-tab nav (REDESIGN §3.3). forecast.html lives OUTSIDE the nav —
  // linked in context from Priority Precincts and How It Works.
  { href: "index.html", label: "Map" },
  { href: "precinct.html", label: "My Precinct" },
  { href: "targets.html", label: "Priority Precincts" },
  { href: "explore.html", label: "Data Table" },
  { href: "methodology.html", label: "How It Works" },
];

function storedTextLarge() {
  try {
    return localStorage.getItem(TEXT_SIZE_KEY) === "1";
  } catch {
    return false;
  }
}

// Apply the saved size at module load, before any layout paints, so the
// reload in the e2e persistence test (and real reloads) never flash small.
function applyTextSize(on) {
  document.documentElement.classList.toggle("text-large", on);
}
applyTextSize(storedTextLarge());

// Resolve the persona (URL override > stored > public) and stamp it on <html>
// at module load, before paint — same pattern as the text-size class above.
// Plumbing only: nothing styles or branches on data-persona yet; it is the
// scoping hook future persona views will use. renderHeader re-resolves so a
// fresh initSiteNav (tests, auth double-boot) always reflects current state.
function applyPersona() {
  const persona = initActivePersona();
  document.documentElement.dataset.persona = persona;
  return persona;
}
applyPersona();

function currentPage() {
  const file = (location.pathname.split("/").pop() || "").toLowerCase();
  return file === "" ? "index.html" : file;
}

function renderHeader(header) {
  const page = currentPage();
  const activePersona = applyPersona();
  const layout = layoutFor(activePersona);
  const links = layout
    .navPages(PAGES)
    .map((p) => {
      const current = p.href === page ? ' aria-current="page"' : "";
      return `<a href="${p.href}"${current}>${p.label}</a>`;
    })
    .join("");

  const badge = layout.badge
    ? `<span class="site-persona-badge">${layout.badge}</span>`
    : "";
  // The persona switch is developer plumbing (armed with #dev=1) until real
  // persona views exist — rendered only when enabled, never hidden-but-present.
  const personaSelect = devToolsEnabled()
    ? `<select id="nav-persona" aria-label="View mode (developer)">` +
      Object.values(PERSONA_LAYOUTS)
        .map(
          (l) =>
            `<option value="${l.id}"${l.id === activePersona ? " selected" : ""}>${l.label}</option>`
        )
        .join("") +
      `</select>`
    : "";

  const signedIn = hasCognitoSession();
  header.innerHTML =
    `<div class="site-header-bar">` +
    `<span class="site-brand">Collin County Elections</span>` +
    badge +
    `<nav class="site-nav" aria-label="Main">${links}</nav>` +
    personaSelect +
    `<button type="button" id="nav-text-size" aria-pressed="${storedTextLarge()}">` +
    `<span aria-hidden="true">A</span> Text size</button>` +
    `<button type="button" id="nav-help" aria-haspopup="dialog">` +
    `<span aria-hidden="true">?</span> Help</button>` +
    (signedIn ? `<button type="button" id="nav-signout">Sign out</button>` : "") +
    `</div>`;

  header.querySelector("#nav-text-size").addEventListener("click", (e) => {
    const on = !document.documentElement.classList.contains("text-large");
    applyTextSize(on);
    e.currentTarget.setAttribute("aria-pressed", String(on));
    try {
      localStorage.setItem(TEXT_SIZE_KEY, on ? "1" : "0");
    } catch {
      /* private mode: size still applies for this page view */
    }
  });

  const persona = header.querySelector("#nav-persona");
  if (persona) {
    persona.addEventListener("change", (e) => {
      // Strip any #persona= before reloading: on pages that never rewrite the
      // hash (e.g. methodology.html) a lingering override would re-impose the
      // old persona over the choice we just persisted.
      const { persona: _p, ...rest } = readParams();
      writeParams(rest);
      setActivePersona(e.currentTarget.value);
      location.reload();
    });
  }

  const signout = header.querySelector("#nav-signout");
  if (signout) {
    signout.addEventListener("click", () => {
      clearCognitoSession();
      location.href = "index.html"; // the gate re-appears there on deployment
    });
  }

  layout.renderChromeExtras(header);
}

// The precinct page remembers the last precincts viewed (max 3) — no accounts,
// no server state. The welcome panel and the Map read it (REDESIGN §3.2).
export function rememberedPrecincts() {
  try {
    const raw = localStorage.getItem("ccd_my_precincts");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String).slice(0, 3) : [];
  } catch {
    return [];
  }
}

// First visit: one welcome card, plain language, one big dismiss button.
// Front door (index.html) only — deep links to other pages are never
// interrupted. Never shown again once dismissed.
function maybeShowWelcome() {
  if (currentPage() !== "index.html") return;
  try {
    if (localStorage.getItem(WELCOME_KEY)) return;
  } catch {
    return; // can't persist "seen" -> never nag on every load
  }
  const wrap = document.createElement("div");
  wrap.className = "welcome-overlay";
  const mine = rememberedPrecincts();
  const mineCard = mine.length
    ? `<p class="welcome-mine"><a href="precinct.html#precinct=${encodeURIComponent(mine[0])}">Your precinct: ${mine[0]} — open the report</a></p>`
    : "";
  wrap.innerHTML =
    `<div class="welcome-card" role="dialog" aria-modal="true" aria-labelledby="welcome-title">` +
    `<h2 id="welcome-title">Welcome</h2>` +
    `<p>This site shows real election results for every Collin County precinct — no sign-ups, nothing to install.</p>` +
    `<ul>` +
    `<li><strong>Map</strong> shows which way each precinct votes.</li>` +
    `<li><strong>My Precinct</strong> is the full report for any precinct or address.</li>` +
    `<li><strong>Priority Precincts</strong> suggests where to focus.</li>` +
    `<li><strong>Data Table</strong> is every number, sortable.</li>` +
    `<li><strong>How It Works</strong> explains the sources and the words.</li>` +
    `</ul>` +
    mineCard +
    `<p>Use the <strong>Text size</strong> button in the header any time to make everything bigger.</p>` +
    `<a class="welcome-primary" href="precinct.html">Find your precinct</a>` +
    `<button type="button" class="welcome-dismiss">Get started</button>` +
    `</div>`;

  function dismiss() {
    try {
      localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      /* still dismiss for this view */
    }
    wrap.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") dismiss();
  }
  wrap.querySelector(".welcome-dismiss").addEventListener("click", dismiss);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(wrap);
  wrap.querySelector(".welcome-dismiss").focus();
}

export function initSiteNav() {
  const header = document.getElementById("site-header");
  if (!header || header.dataset.navRendered) return; // idempotent
  header.dataset.navRendered = "1";
  renderHeader(header);
  initGlossary();
  initHelpPanel();
  maybeShowWelcome();
}

initSiteNav();
