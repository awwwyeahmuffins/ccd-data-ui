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
  "trends.html": {
    title: "Trends",
    body: "Which way each precinct MOVED between two elections — not who won, but who gained. Arrows point toward the party that gained ground; longer arrows mean more votes changed hands. A precinct can add Democratic votes and still move Republican, and the filters can show you exactly those.",
  },
  "campaign.html": {
    title: "Campaign Dashboard",
    body: "Stack filters — margin, turnout drop-off, share non-white, doors already knocked — to narrow 273 precincts down to your target list, see the win number for each, and export the list for your canvassing tool.",
  },
  "chair.html": {
    title: "My Dashboard",
    body: "Everything for the precinct you chair: how many of your neighbors are reliable voters, occasional voters, or rarely vote; who has fallen inactive on the rolls; where and when to vote; and a two-page packet you can print and hand out.",
  },
  "matchup.html": {
    title: "Matchup",
    body: "Put two elections side by side and see how the same precincts behaved in each.",
  },
};

// A page with no entry gets this rather than inheriting another page's copy —
// which is what used to happen: trends, campaign, chair and matchup all opened
// Help titled "The Map", describing a race picker and address search that are
// not on those pages.
const GENERIC_HELP = {
  title: "About this site",
  body: "This site shows Collin County election data precinct by precinct. Use the tabs at the top to move between the map, your own precinct, priority precincts, trends, and the full data table. Tap any underlined term for a plain-language definition.",
};

let panelEl = null;
let lastFocus = null;

function currentHelp() {
  const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  return PAGE_HELP[file] || GENERIC_HELP;
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

  const page = currentHelp();
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
    `<p id="help-body">${page.body}</p>` +
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
