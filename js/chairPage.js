// chairPage.js
// --------------------------------------------------------------------------------
// Orchestrator for chair.html — the precinct chair's "Simple View" dashboard.
// Pick your precinct; see its canvassing universes (a 3x3 party-lean × voting-
// habit grid of MODELED estimates), the counts worth working (strong Dems,
// likely volunteers, inactive voters), and print a two-page packet: a meeting
// summary plus a strictly apolitical voting-information handout.
//
// Pure math lives in domain/chairMetrics.js; print HTML in chairPrint.js.
// Data honesty: anything not on file renders N/A — never a guess. The page
// renders identically for every persona (the chair persona only adds it to
// the nav); it works standalone at chair.html for anyone.

import { boundary } from "./data/dataService.js";
import { escapeHtml } from "./lib/dom.js";
import { readParams, writeParams } from "./lib/urlState.js";
import { formatNumberOrNA, formatPctWhole, formatPrecinctLabel } from "./lib/format.js";
import { SOS_ADDRESS_CHANGE_URL } from "./lib/constants.js";
import {
  turnoutBands,
  buildUniverseMatrix,
  classifyChairFocus,
  estimateVolunteerPool,
  summarizeInactive,
  inactiveDoorSnippet,
  featureCentroid,
  nearestVoteCenters,
  MATRIX_PARTIES,
  MATRIX_BANDS,
} from "./domain/chairMetrics.js";
import { initGlossary, termButton } from "./glossary.js";
import {
  generateChairSummaryHTML,
  generateGOTVHandoutHTML,
  printChairPacket,
} from "./chairPrint.js";

const svc = boundary();

const ch = {
  code: null,          // active precinct code (string) or null
  byCode: {},          // precinct code -> geojson feature
  codes: [],           // sorted precinct codes
  dncLookup: null,     // code -> dnc_scores row (may be null — profile extra)
  fieldOps: null,      // code -> { active, inactive, share } | null
  votingInfo: null,    // county voting_info.json | null
  turnout: null,       // { marquee, marqueeLabel, low, lowLabel } lookups | null
  current: null,       // last computed bundle (for the print packet)
};

const $ = (id) => document.getElementById(id);

// The same MRU the My Precinct page writes (ccd_my_precincts) — viewing your
// precinct there and here is one continuous "my precinct" memory. Kept as a
// local helper because pages never import other pages' orchestrators.
const MY_PRECINCTS_KEY = "ccd_my_precincts";
function rememberPrecinct(code) {
  try {
    const cur = JSON.parse(localStorage.getItem(MY_PRECINCTS_KEY) || "[]").filter(
      (c) => String(c) !== String(code)
    );
    cur.unshift(String(code));
    localStorage.setItem(MY_PRECINCTS_KEY, JSON.stringify(cur.slice(0, 3)));
  } catch { /* private mode */ }
}
function rememberedPrecinct() {
  try {
    const cur = JSON.parse(localStorage.getItem(MY_PRECINCTS_KEY) || "[]");
    return cur.length ? String(cur[0]) : null;
  } catch {
    return null;
  }
}

// ---- turnout pair: the highest- and lowest-salience elections on file --------
// The classic two-election propensity split needs a marquee (highest total
// ballots — e.g. a presidential) and a low-salience file (lowest). With only
// one file the bands degrade to the single-rate model (chairMetrics notes it).
async function loadTurnoutPair() {
  try {
    const races = await svc.listRaces();
    const files = [...new Set(races.map((e) => e.turnoutFile).filter(Boolean))];
    const loaded = [];
    for (const f of files) {
      try {
        const rows = await globalThis.d3.csv(`${svc.config.dataDir}/${f}`, (d) => ({
          precinct: String(d.precinct),
          registered: +d.registered,
          ballots: +d.ballots_cast,
        }));
        const sum = rows.reduce((s, r) => s + (isNaN(r.ballots) ? 0 : r.ballots), 0);
        if (sum > 0) loaded.push({ file: f, sum, rows });
      } catch { /* skip a bad turnout file */ }
    }
    if (!loaded.length) return null;
    loaded.sort((a, b) => b.sum - a.sum);
    const toLookup = (rows) => {
      const lookup = {};
      for (const r of rows) {
        if (!r.precinct) continue;
        lookup[r.precinct] = {
          registered: isNaN(r.registered) ? null : r.registered,
          ballots: isNaN(r.ballots) ? null : r.ballots,
        };
      }
      return lookup;
    };
    const marquee = loaded[0];
    const low = loaded.length > 1 ? loaded[loaded.length - 1] : null;
    return {
      marquee: toLookup(marquee.rows),
      marqueeLabel: turnoutFileLabel(marquee.file),
      low: low ? toLookup(low.rows) : null,
      lowLabel: low ? turnoutFileLabel(low.file) : null,
    };
  } catch {
    return null;
  }
}
function turnoutFileLabel(file) {
  const m = String(file).match(/(\d{4}(?:-\d+)?)/);
  return m ? `the ${m[1]} election` : "an election on file";
}

// ---- URL / init ---------------------------------------------------------------

function urlPrecinct() {
  const p = readParams();
  const code = p.precinct != null ? String(p.precinct) : null;
  return code && ch.byCode[code] ? code : null;
}

async function init() {
  initGlossary();

  const select = $("chair-precinct-select");
  select.addEventListener("change", () => {
    if (select.value) selectPrecinct(select.value, { push: true });
  });
  $("chair-print-btn").addEventListener("click", printPacket);

  try {
    const [{ geojson, dncLookup }, turnout, fieldOps, votingInfo] = await Promise.all([
      svc.loadAll(),
      loadTurnoutPair(),
      svc.loadFieldOps(),
      svc.loadVotingInfo(),
    ]);
    ch.dncLookup = dncLookup || null;
    ch.turnout = turnout;
    ch.fieldOps = fieldOps;
    ch.votingInfo = votingInfo;

    for (const f of geojson.features || []) {
      const code = String(f.properties?.PRECINCT ?? "");
      if (/^\d+$/.test(code)) ch.byCode[code] = f;
    }
    ch.codes = Object.keys(ch.byCode).sort((a, b) => Number(a) - Number(b));
    select.innerHTML =
      '<option value="">Choose a precinct…</option>' +
      ch.codes.map((c) => `<option value="${escapeHtml(c)}">Precinct ${escapeHtml(c)}</option>`).join("");

    // Resolution order: valid #precinct= > the device's remembered precinct >
    // the "choose your precinct" empty state (never auto-pick one).
    const initial = urlPrecinct() || validCode(rememberedPrecinct());
    if (initial) {
      select.value = initial;
      selectPrecinct(initial, { push: false });
    }
  } catch (err) {
    console.error("[Chair] load failed:", err);
    $("chair-empty").innerHTML =
      'We couldn’t load the precinct data. Check your internet connection, then <button type="button" class="retry-link" onclick="location.reload()">try again</button>.';
  }
}

function validCode(code) {
  return code != null && ch.byCode[String(code)] ? String(code) : null;
}

// ---- selection ------------------------------------------------------------------

function selectPrecinct(code, { push }) {
  code = validCode(code);
  if (!code) return;
  ch.code = code;
  rememberPrecinct(code);
  // Choosing a precinct is real navigation (matches My Precinct); the initial
  // restore just reflects state. Only `precinct` is this page's param — never
  // write persona/dev back (entry params).
  writeParams({ precinct: code }, { replace: !push });
  render();
}

// ---- render ---------------------------------------------------------------------

function render() {
  const code = ch.code;
  const feature = ch.byCode[code];
  const party = ch.dncLookup ? ch.dncLookup[code] || null : null;
  const bands = ch.turnout
    ? turnoutBands({
        marquee: ch.turnout.marquee[code],
        lowSalience: ch.turnout.low ? ch.turnout.low[code] : null,
      })
    : null;

  const matrix = buildUniverseMatrix({ party, bands });
  const focus = classifyChairFocus({ party, bands });
  const volunteers = estimateVolunteerPool({ party, bands });
  const inactive = summarizeInactive(ch.fieldOps ? ch.fieldOps[code] : null);
  const centroid = featureCentroid(feature.geometry);
  const centers = ch.votingInfo?.voteCenters || [];
  const nearest = nearestVoteCenters(centroid, centers);
  const snippet = inactiveDoorSnippet({
    code,
    count: inactive?.count ?? null,
    sosUrl: SOS_ADDRESS_CHANGE_URL,
  });

  ch.current = { code, party, bands, matrix, focus, volunteers, inactive, nearest, snippet };

  $("chair-empty").hidden = true;
  $("chair-content").hidden = false;
  $("chair-print-btn").hidden = false;
  const report = $("chair-report-link");
  report.hidden = false;
  report.href = `precinct.html#precinct=${encodeURIComponent(code)}`;

  $("chair-precinct-title").textContent = formatPrecinctLabel(feature.properties);
  renderFocus(focus);
  renderMatrix(matrix, bands);
  renderTargets(party, volunteers);
  renderInactive(inactive, snippet);
  renderVoting(nearest, centers);
  renderFineprint(bands);
}

function renderFocus(focus) {
  const badge = $("chair-focus-badge");
  const why = $("chair-focus-why");
  if (!focus) {
    badge.hidden = true;
    why.textContent =
      "No modeled party data is on file for this precinct, so we can’t suggest a focus.";
    return;
  }
  badge.hidden = false;
  badge.dataset.focus = focus.id;
  badge.textContent = focus.label;
  why.textContent = focus.rationale;
}

const PARTY_ROW_LABELS = {
  dem: "Strong Democratic voters",
  mod: "Moderate / persuadable",
  rep: "Strong Republican voters",
};
const BAND_LABELS = {
  high: "Usually votes",
  mid: "Sometimes votes",
  low: "Rarely votes",
};
const ROLE_CHIPS = {
  base: "Base — thank & recruit",
  gotv: "GOTV — turn them out",
  persuasion: "Persuade",
};

function renderMatrix(matrix, bands) {
  const sub = $("chair-matrix-sub");
  const wrap = $("chair-matrix");
  if (!matrix) {
    sub.textContent = "";
    wrap.innerHTML =
      '<p class="na-note">N/A — this precinct has no modeled party data or no turnout history on file, so the grid can’t be built.</p>';
    return;
  }
  sub.innerHTML =
    `Each cell is a ${termButton("modeled-estimate", "modeled estimate")} of voters by party lean and voting habit — ` +
    `your ${termButton("universe", "universes")}: highlighted cells are the base, ` +
    `${termButton("gotv", "GOTV")} and ${termButton("persuasion", "persuasion")} groups.`;

  const header =
    "<tr><th scope=\"col\">Party lean</th>" +
    MATRIX_BANDS.map((b) => `<th scope="col">${escapeHtml(BAND_LABELS[b])}</th>`).join("") +
    "</tr>";
  const rows = MATRIX_PARTIES.map((p) => {
    const cells = MATRIX_BANDS.map((b) => {
      const cell = matrix.cells.find((c) => c.party === p && c.band === b);
      const roleClass = cell.role ? ` class="role-${cell.role}"` : "";
      const chip = cell.role
        ? `<span class="chair-cell-role role-${cell.role}">${escapeHtml(ROLE_CHIPS[cell.role])}</span>`
        : "";
      return `<td${roleClass}><span class="chair-cell-count">${formatNumberOrNA(cell.count)}</span>${chip}</td>`;
    }).join("");
    return `<tr><th scope="row">${escapeHtml(PARTY_ROW_LABELS[p])}</th>${cells}</tr>`;
  }).join("");

  const totals =
    `<div class="chair-matrix-totals">` +
    `<div class="chair-stat"><span class="chair-stat-val">${formatNumberOrNA(matrix.roles.base)}</span><span class="chair-stat-label">base</span></div>` +
    `<div class="chair-stat"><span class="chair-stat-val">${formatNumberOrNA(matrix.roles.gotv)}</span><span class="chair-stat-label">GOTV targets</span></div>` +
    `<div class="chair-stat"><span class="chair-stat-val">${formatNumberOrNA(matrix.roles.persuasion)}</span><span class="chair-stat-label">persuasion targets</span></div>` +
    `</div>`;

  wrap.innerHTML =
    `<table class="chair-matrix">` +
    `<caption>Modeled estimates — turnout habit from ${escapeHtml(turnoutCaption(bands))}.</caption>` +
    `<thead>${header}</thead><tbody>${rows}</tbody></table>` + totals;
}

function turnoutCaption(bands) {
  if (!ch.turnout) return "turnout files on file";
  if (bands?.mode === "single" || !ch.turnout.lowLabel) {
    return `${ch.turnout.marqueeLabel} (the only turnout file on file)`;
  }
  return `${ch.turnout.marqueeLabel} vs ${ch.turnout.lowLabel}`;
}

function renderTargets(party, volunteers) {
  const el = $("chair-targets");
  const strongDem =
    `<div class="chair-stat"><span class="chair-stat-val">${formatNumberOrNA(party?.dem)}</span>` +
    `<span class="chair-stat-label">strong Democratic voters</span></div>` +
    (party?.dem != null
      ? `<p class="chair-method">From the precinct's modeled party scores.</p>`
      : `<p class="na-note">No modeled party data on file for this precinct.</p>`);
  const vols = volunteers
    ? `<div class="chair-stat"><span class="chair-stat-val">${formatNumberOrNA(volunteers.pool)}</span>` +
      `<span class="chair-stat-label">likely volunteers</span><span class="chair-tag">modeled estimate</span></div>` +
      `<p class="chair-method">${escapeHtml(volunteers.method)}.</p>`
    : `<div class="chair-stat"><span class="chair-stat-val">N/A</span><span class="chair-stat-label">likely volunteers</span></div>` +
      `<p class="na-note">Needs modeled party data plus turnout history — one of them isn't on file here.</p>`;
  el.innerHTML = strongDem + "<hr style=\"border:none;border-top:1px solid var(--color-border);margin:14px 0;\">" + vols;
}

function renderInactive(inactive, snippet) {
  const sub = $("chair-inactive-sub");
  const el = $("chair-inactive");
  sub.innerHTML = `Voters marked ${termButton("inactive", "inactive")} usually just need an address update — an easy, high-value door.`;

  const stat = inactive
    ? `<div class="chair-stat"><span class="chair-stat-val">${formatNumberOrNA(inactive.count)}</span>` +
      `<span class="chair-stat-label">inactive voters${inactive.share != null ? ` (${formatPctWhole(inactive.share)} of the roll)` : ""}</span></div>`
    : `<div class="chair-stat"><span class="chair-stat-val">N/A</span><span class="chair-stat-label">inactive voters</span></div>` +
      `<p class="na-note">Voter-file data not on file. A maintainer can generate it with data_processor/build_field_ops.py.</p>`;

  el.innerHTML =
    stat +
    `<div class="chair-share-box">` +
    `<pre id="chair-snippet">${escapeHtml(snippet)}</pre>` +
    `<button type="button" class="chair-btn" id="chair-copy-btn">Copy text for the door</button>` +
    `<span class="copy-status" id="chair-copy-status" role="status" aria-live="polite"></span>` +
    `</div>`;

  $("chair-copy-btn").addEventListener("click", async () => {
    const status = $("chair-copy-status");
    try {
      await navigator.clipboard.writeText(snippet);
      status.textContent = "Copied.";
    } catch {
      status.textContent = "Couldn’t copy — select the text above instead.";
    }
    setTimeout(() => { status.textContent = ""; }, 4000);
  });
}

function renderVoting(nearest, centers) {
  const el = $("chair-voting");
  const info = ch.votingInfo;
  const vote411 = info?.links?.vote411 || "https://www.vote411.org";
  const vote411Line =
    `<p class="chair-method">Voters can confirm locations, dates, and everything on their ballot at ` +
    `<a href="${escapeHtml(vote411)}" target="_blank" rel="noopener">vote411.org</a>.</p>`;

  if (!info || !info.election) {
    el.innerHTML = `<p class="na-note">No election dates on file yet.</p>` + vote411Line;
    return;
  }

  const e = info.election;
  const passed = isPast(e.electionDay);
  const dates = passed
    ? `<p class="na-note">${escapeHtml(e.name || "This election")} has passed — check vote411.org for the next one.</p>`
    : `<p><b>${escapeHtml(e.name || "Next election")}</b><br>` +
      `Election day: <b>${escapeHtml(fmtDate(e.electionDay))}</b><br>` +
      (e.earlyVoting?.start && e.earlyVoting?.end
        ? `Early voting: <b>${escapeHtml(fmtDate(e.earlyVoting.start))} – ${escapeHtml(fmtDate(e.earlyVoting.end))}</b><br>`
        : "") +
      (e.mailBallotApplicationDeadline
        ? `Mail-ballot applications due: <b>${escapeHtml(fmtDate(e.mailBallotApplicationDeadline))}</b>`
        : "") +
      `</p>`;

  // Prefer centers with verified coordinates (sorted by distance); fall back
  // to listing centers without distances; N/A when none are on file.
  const list = nearest.length ? nearest : centers.slice(0, 3);
  const centersHtml = list.length
    ? `<ul class="chair-vc-list">` +
      list
        .map(
          (c) =>
            `<li><span class="chair-vc-name">${escapeHtml(c.name || "Vote center")}</span>` +
            (c.distanceMiles != null ? ` <span class="chair-vc-addr">(~${c.distanceMiles.toFixed(1)} mi from the precinct's center)</span>` : "") +
            `<br><span class="chair-vc-addr">${escapeHtml(c.address || "")}</span></li>`
        )
        .join("") +
      `</ul><p class="chair-method">${termButton("vote-center", "Any Collin County vote center")} works — voters aren't tied to one location.</p>`
    : `<p class="na-note">No vote-center locations on file yet.</p>`;

  el.innerHTML = dates + centersHtml + vote411Line;
}

function renderFineprint(bands) {
  const notes = [
    "Universe counts assume voting habit is spread evenly across party groups within the precinct — treat them as planning sizes, not lists of people.",
  ];
  if (bands?.mode === "single") {
    notes.push(
      "Only one election's turnout file is available, so “rarely votes” can't be separated from “sometimes votes.”"
    );
  }
  notes.push(`Boundary set: ${svc.label}.`);
  $("chair-fineprint").textContent = notes.join(" ");
}

// ---- dates (parse parts — new Date("YYYY-MM-DD") is UTC and shifts a day) ------
function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function fmtDate(iso) {
  const d = parseISO(iso);
  return d
    ? d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "N/A";
}
function isPast(iso) {
  const d = parseISO(iso);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

// ---- print packet ---------------------------------------------------------------

function printPacket() {
  if (!ch.current) return;
  const feature = ch.byCode[ch.current.code];
  const page1 = generateChairSummaryHTML({
    ...ch.current,
    label: formatPrecinctLabel(feature.properties),
    boundaryLabel: svc.label,
    turnoutCaption: turnoutCaption(ch.current.bands),
  });
  const page2 = generateGOTVHandoutHTML({
    code: ch.current.code,
    votingInfo: ch.votingInfo,
    nearestCenters: ch.current.nearest,
  });
  printChairPacket(page1, page2, ch.current.code);
}

// ---- boot -----------------------------------------------------------------------
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
