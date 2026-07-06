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

import { escapeHtml } from "./lib/dom.js";

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
  isd: {
    title: "ISD — school district",
    body: "Independent School District. ISD races elect school board trustees and decide school bond measures. Each district runs its own elections, which is why there are so many of them.",
  },
  mud: {
    title: "MUD — utility district",
    body: "Municipal Utility District — a small local body that manages water, sewer, and drainage for a neighborhood. MUD races elect its board. They affect only the homes inside that district.",
  },
  diversity: {
    title: "Diversity (non-white share)",
    body: "The share of residents who are not non-Hispanic white, from the Census. A higher number means a more racially and ethnically mixed precinct. It says nothing about how anyone votes.",
  },
  universe: {
    title: "Universe",
    body: "A canvassing “universe” is the group of voters a campaign plans to contact — for example, likely supporters who skip some elections. The grid on this page splits the precinct into nine such groups by party lean and voting habit.",
  },
  gotv: {
    title: "GOTV — Get Out The Vote",
    body: "Reminding your own likely supporters to actually go vote. GOTV work is aimed at people who already agree with you but skip some elections — a knock, a call, or a ride to the polls, not an argument.",
  },
  persuasion: {
    title: "Persuasion",
    body: "Conversations with voters who could go either way. Persuasion work matters most where the parties are close and moderate voters decide the outcome.",
  },
  inactive: {
    title: "Inactive voters",
    body: "Voters the county has marked inactive — usually after mailing a confirmation notice because their address may be out of date. They can still vote, but with extra steps. Updating the address online takes about two minutes and keeps their ballot smooth.",
  },
  elasticity: {
    title: "Turnout elasticity",
    body: "How much a precinct's turnout swings between big elections (like a presidential year) and quiet ones (like a city or off-year election). A big swing means the voters are there — they just skip the small elections, so a reminder brings them out. A small swing means turnout is steady no matter what, so winning takes persuasion, not reminders.",
  },
  "net-vote-opportunity": {
    title: "Net vote opportunity",
    body: "Your own likely supporters who stayed home, not the raw number of supporters. A precinct with 800 supporters where 300 stay home is a better place to knock than one with 2,000 supporters who almost all vote already — the gap is where new votes come from.",
  },
  churn: {
    title: "Roll growth / churn",
    body: "How fast a precinct's voter list is changing — new subdivisions, apartments, and move-ins. Where the list is growing fast, last election's read goes stale quickly, and the first job is registering new residents and fixing addresses before any get-out-the-vote work.",
  },
  "modeled-estimate": {
    title: "Modeled estimate",
    body: "A best estimate built from the precinct's overall totals, not a count of actual individual people. Use it to size the work, not as an exact list of names.",
  },
  "vote-center": {
    title: "Vote center",
    body: "In Collin County, any registered voter can vote at ANY vote center in the county — you are not tied to one polling place. Pick whichever location is convenient.",
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
