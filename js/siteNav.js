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

const TEXT_SIZE_KEY = "ccd_text_large";
const WELCOME_KEY = "ccd_welcome_seen";

// Nav order mirrors the volunteer's workflow: see the map, look up results,
// plan, then reference material last.
const PAGES = [
  { href: "index.html", label: "Map" },
  { href: "elections.html", label: "Election Results" },
  { href: "forecast.html", label: "Forecast" },
  { href: "targets.html", label: "Priority Precincts" },
  { href: "explore.html", label: "Browse All Data" },
  { href: "precinct.html", label: "Find a Precinct" },
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

function currentPage() {
  const file = (location.pathname.split("/").pop() || "").toLowerCase();
  return file === "" ? "index.html" : file;
}

function renderHeader(header) {
  const page = currentPage();
  const links = PAGES.map((p) => {
    const current = p.href === page ? ' aria-current="page"' : "";
    return `<a href="${p.href}"${current}>${p.label}</a>`;
  }).join("");

  header.innerHTML =
    `<div class="site-header-bar">` +
    `<span class="site-brand">Texas Elections</span>` +
    `<nav class="site-nav" aria-label="Main">${links}</nav>` +
    `<button type="button" id="nav-text-size" aria-pressed="${storedTextLarge()}">` +
    `<span aria-hidden="true">A</span> Text size</button>` +
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
  wrap.innerHTML =
    `<div class="welcome-card" role="dialog" aria-modal="true" aria-labelledby="welcome-title">` +
    `<h2 id="welcome-title">Welcome</h2>` +
    `<p>This site shows real election results for every Texas precinct — no sign-ups, nothing to install.</p>` +
    `<ul>` +
    `<li><strong>Map</strong> shows which way each precinct votes.</li>` +
    `<li><strong>Find a Precinct</strong> looks up any address.</li>` +
    `<li><strong>Priority Precincts</strong> suggests where to focus.</li>` +
    `</ul>` +
    `<p>Use the <strong>Text size</strong> button in the header any time to make everything bigger.</p>` +
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
  maybeShowWelcome();
}

initSiteNav();
