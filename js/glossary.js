// glossary.js — plain-language definitions for election jargon.
//
// The audience is precinct chairs 60+ on iPads: definitions open from a tap
// on a marked term (never hover), in a solid-backplate popover with a large
// Close button. Popover styles live in js/civic.css (.term, .glossary-pop).
//
// Pages either call termButton() to render a marked term, or hand-roll the
// same markup (`<button class="term" data-term="…">…<span class="term-mark">`)
// — precinctLookup.js does the latter — so the click handling is one
// document-level delegated listener installed by initGlossary().

import { escapeHtml } from "./utils.js";

// Plain language, short sentences, no nested jargon. Unknown keys no-op.
export const TERMS = {
  margin: {
    title: "Win margin",
    body: "How far ahead the winner finished, in percentage points. A margin of 4 points means the winner got 52% and the runner-up got 48%. Small margin = close race.",
  },
  moderate: {
    title: "Moderates",
    body: "Voters who do not reliably vote for one party. On this site the moderate share is what is left after the strong Republican and strong Democratic votes are counted. These are often the voters a close race turns on.",
  },
  turnout: {
    title: "Turnout",
    body: "The share of registered voters who actually cast a ballot. 60% turnout means 6 of every 10 registered voters voted. Low turnout means many potential votes were left on the table.",
  },
  "voter-universe": {
    title: "Voters",
    body: "The number of people this estimate covers. Where official counts are missing, the site uses modeled scores instead of exact rolls — treat the number as a good estimate, not a headcount.",
  },
  pvi: {
    title: "Party lean",
    body: "Which party a precinct usually favors, and by how much, based on its past election results. “R+8” means the precinct usually votes about 8 points more Republican than average. Lean is a habit, not a guarantee.",
  },
  lean: {
    title: "Lean",
    body: "The party a precinct usually favors, judged from several past elections at once. Strong lean = votes the same way nearly every time. Weak lean = could go either way.",
  },
  precinct: {
    title: "Precinct",
    body: "The smallest voting area — your neighborhood's slice of the county. Every address belongs to exactly one precinct, and results are counted precinct by precinct.",
  },
  registered: {
    title: "Registered voters",
    body: "People signed up to vote in this area. Not everyone registered actually votes — compare with turnout to see how many did.",
  },
  "boundary-vintage": {
    title: "Boundary year",
    body: "Precinct borders get redrawn every few years. Results are shown on the borders that were in force for that election, so an old race can use slightly different precinct shapes than today's.",
  },
};

// Render a tappable marked term. `labelHtml` is trusted HTML (callers escape
// their own text); the ⓘ mark signals "tap for a definition".
export function termButton(term, labelHtml) {
  if (!TERMS[term]) return labelHtml;
  return (
    `<button type="button" class="term" data-term="${escapeHtml(term)}" aria-haspopup="dialog">` +
    `${labelHtml} <span class="term-mark" aria-hidden="true">ⓘ</span></button>`
  );
}

let pop = null; // the single popover element, created lazily
let openedFrom = null; // button to return focus to on close

function buildPopover() {
  const el = document.createElement("div");
  el.className = "glossary-pop";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "false");
  el.setAttribute("aria-labelledby", "glossary-pop-title");
  el.hidden = true;
  el.innerHTML =
    `<div class="glossary-pop-title" id="glossary-pop-title"></div>` +
    `<p class="glossary-pop-body"></p>` +
    `<button type="button" class="glossary-pop-close">Close</button>`;
  el.querySelector(".glossary-pop-close").addEventListener("click", closePopover);
  document.body.appendChild(el);
  return el;
}

function openPopover(button, term) {
  const def = TERMS[term];
  if (!def) return;
  // Re-create if a page re-render detached the popover from the document.
  if (!pop || !document.body.contains(pop)) pop = buildPopover();
  pop.querySelector(".glossary-pop-title").textContent = def.title;
  pop.querySelector(".glossary-pop-body").textContent = def.body;
  pop.hidden = false;
  openedFrom = button;
  button.setAttribute("aria-expanded", "true");

  // Position near the button, clamped to the viewport (fixed positioning).
  const r = button.getBoundingClientRect();
  const popW = Math.min(360, window.innerWidth - 24);
  pop.style.width = `${popW}px`;
  let left = Math.min(Math.max(12, r.left), window.innerWidth - popW - 12);
  let top = r.bottom + 10;
  const popH = pop.offsetHeight;
  if (top + popH > window.innerHeight - 12) top = Math.max(12, r.top - popH - 10);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  pop.querySelector(".glossary-pop-close").focus();
}

function closePopover() {
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  if (openedFrom) {
    openedFrom.setAttribute("aria-expanded", "false");
    if (document.contains(openedFrom)) openedFrom.focus();
    openedFrom = null;
  }
}

export function initGlossary() {
  if (document.documentElement.dataset.glossaryReady) return; // idempotent
  document.documentElement.dataset.glossaryReady = "1";

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".term[data-term]");
    if (btn) {
      // Toggle: tapping the same term again closes it.
      if (openedFrom === btn && pop && !pop.hidden) closePopover();
      else openPopover(btn, btn.dataset.term);
      return;
    }
    if (pop && !pop.hidden && !e.target.closest(".glossary-pop")) closePopover();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePopover();
  });
}
