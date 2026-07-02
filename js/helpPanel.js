// helpPanel.js — the header "Help" button, available on every page (wired by
// js/siteNav.js). One tap answers "what is this page for?" and "what do these
// words mean?" without leaving the page. Complements the one-time welcome card
// (siteNav) — this one is always reachable, because a 60+ volunteer needs to
// re-read, not memorize.

import { TERMS } from "./glossary.js";

// One plain-language paragraph per page.
const PAGE_HELP = {
  "index.html": {
    title: "The Map",
    body: "This map colors every precinct by how it votes. Use the pickers to switch areas or show a specific election, and the search box to jump to a precinct number or street address. Tap any precinct to see its details.",
  },
  "precinct.html": {
    title: "Find a Precinct",
    body: "Type your street address (or a precinct number) to get a full report on that precinct — who lives there, how it votes, and ready-to-use talking points. You can print the report or a one-page field brief.",
  },
  "forecast.html": {
    title: "Forecast",
    body: "Ask “what if?” — pick a real race, change who shows up to vote, and see how the outcome shifts, precinct by precinct.",
  },
  "targets.html": {
    title: "Priority Precincts",
    body: "Pick the job you're trying to do — flip a close race, turn out supporters, persuade the middle — and see which precincts give you the best return on your effort.",
  },
  "explore.html": {
    title: "Browse All Data",
    body: "A sortable table of every precinct and every measure we have — income, age, education, turnout, party lean, and more. Click a column heading to sort.",
  },
  "methodology.html": {
    title: "How It Works",
    body: "Where every number on this site comes from, what is counted and what is estimated, and the limits you should know about.",
  },
};

let panelEl = null;
let lastFocus = null;

function currentPage() {
  const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  return PAGE_HELP[file] ? file : "index.html";
}

export function closeHelpPanel() {
  if (!panelEl) return;
  panelEl.remove();
  panelEl = null;
  document.removeEventListener("keydown", onKey);
  if (lastFocus) { lastFocus.focus(); lastFocus = null; }
}

function onKey(e) {
  if (e.key === "Escape") closeHelpPanel();
}

export function openHelpPanel() {
  closeHelpPanel();
  lastFocus = document.activeElement;

  const page = PAGE_HELP[currentPage()];
  const glossary = Object.values(TERMS)
    .map((t) => `<li><strong>${t.title}.</strong> ${t.body}</li>`)
    .join("");

  // Reuses the welcome card's classes so both dialogs look identical.
  panelEl = document.createElement("div");
  panelEl.className = "welcome-overlay";
  panelEl.id = "help-panel";
  panelEl.innerHTML =
    `<div class="welcome-card help-card" role="dialog" aria-modal="true" aria-labelledby="help-title">` +
    `<h2 id="help-title">${page.title}</h2>` +
    `<p>${page.body}</p>` +
    `<h3>What the words mean</h3>` +
    `<ul class="help-glossary">${glossary}</ul>` +
    `<p><a href="methodology.html">Read more about where the data comes from →</a></p>` +
    `<button type="button" class="welcome-dismiss">Close</button>` +
    `</div>`;

  panelEl.addEventListener("click", (e) => {
    if (e.target === panelEl) closeHelpPanel(); // backdrop tap
  });
  panelEl.querySelector(".welcome-dismiss").addEventListener("click", closeHelpPanel);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(panelEl);
  panelEl.querySelector(".welcome-dismiss").focus();
}

// Wire the header Help button (rendered by siteNav). Idempotent.
export function initHelpPanel() {
  const btn = document.getElementById("nav-help");
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", () => openHelpPanel());
}
