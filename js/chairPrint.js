// chairPrint.js
// --------------------------------------------------------------------------------
// The chair dashboard's two-page print packet (peer of fieldOnePager.js):
//   Page 1 — an executive summary of the precinct's metrics for local meetings.
//   Page 2 — a strictly APOLITICAL "Voting Information" handout for the door.
//
// COMPLIANCE IS STRUCTURAL: generateGOTVHandoutHTML's signature cannot receive
// party, matrix, or focus data — only the precinct code and the county's
// voting information — so no partisan content can leak onto the handout even
// by accident. tests/chairPrint.test.js locks this with a banned-term check.
// Do not add partisan inputs to that function.

import { escapeHtml } from "./lib/dom.js";
import { formatNumberOrNA, formatPctWhole } from "./lib/format.js";

// ---------------------------------------------------------------------------
// Page 1 — meeting summary (gets the full metrics bundle)
// ---------------------------------------------------------------------------

const PARTY_ROW_LABELS = { dem: "Strong Democratic", mod: "Moderate", rep: "Strong Republican" };
const BAND_LABELS = { high: "Usually votes", mid: "Sometimes", low: "Rarely" };
const ROLE_LABELS = { base: "Base", gotv: "GOTV", persuasion: "Persuade" };

export function generateChairSummaryHTML(bundle) {
  const { code, label, boundaryLabel, matrix, focus, party, volunteers, inactive } = bundle || {};

  const focusHtml = focus
    ? `<span class="packet-badge">${escapeHtml(focus.label)}</span>`
    : "";
  const rationale = focus ? `<p class="packet-note">${escapeHtml(focus.rationale)}</p>` : "";

  let matrixHtml;
  if (matrix) {
    const header =
      `<tr><th>Party lean</th>` +
      ["high", "mid", "low"].map((b) => `<th>${escapeHtml(BAND_LABELS[b])}</th>`).join("") +
      `</tr>`;
    const rows = ["dem", "mod", "rep"]
      .map((p) => {
        const cells = ["high", "mid", "low"]
          .map((b) => {
            const cell = matrix.cells.find((c) => c.party === p && c.band === b);
            const chip = cell.role ? ` <span class="packet-role">${escapeHtml(ROLE_LABELS[cell.role])}</span>` : "";
            return `<td>${formatNumberOrNA(cell.count)}${chip}</td>`;
          })
          .join("");
        return `<tr><th>${escapeHtml(PARTY_ROW_LABELS[p])}</th>${cells}</tr>`;
      })
      .join("");
    matrixHtml =
      `<table class="packet-table"><thead>${header}</thead><tbody>${rows}</tbody></table>` +
      `<p class="packet-note">Modeled estimates (turnout habit from ${escapeHtml(bundle.turnoutCaption || "the turnout files on file")}) — planning sizes, not lists of people.</p>`;
  } else {
    matrixHtml = `<p class="packet-note">Universe grid: N/A — no modeled party data or turnout history on file.</p>`;
  }

  const stats = [
    ["Strong Democratic voters", formatNumberOrNA(party?.dem), party?.dem != null ? "modeled party scores" : "not on file"],
    ["Likely volunteers", volunteers ? formatNumberOrNA(volunteers.pool) : "N/A", "modeled estimate"],
    [
      "Inactive voters",
      inactive ? formatNumberOrNA(inactive.count) : "N/A",
      inactive?.share != null ? `${formatPctWhole(inactive.share)} of the roll` : "voter-file data " + (inactive ? "" : "not on file"),
    ],
    ["Base / GOTV / Persuasion", matrix ? `${formatNumberOrNA(matrix.roles.base)} / ${formatNumberOrNA(matrix.roles.gotv)} / ${formatNumberOrNA(matrix.roles.persuasion)}` : "N/A", "modeled estimates"],
  ]
    .map(
      ([labelText, value, note]) =>
        `<div class="packet-stat"><div class="packet-stat-val">${escapeHtml(String(value))}</div>` +
        `<div class="packet-stat-label">${escapeHtml(labelText)}</div>` +
        `<div class="packet-stat-note">${escapeHtml(note || "")}</div></div>`
    )
    .join("");

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    `<section class="packet-page packet-page-1">` +
    `<header class="packet-head"><h1>${escapeHtml(label || `Precinct ${code ?? ""}`)}</h1>${focusHtml}</header>` +
    rationale +
    `<h2>Canvassing universes</h2>` +
    matrixHtml +
    `<h2>Working numbers</h2>` +
    `<div class="packet-stats">${stats}</div>` +
    `<footer class="packet-foot">Internal planning summary — ${escapeHtml(boundaryLabel || "")} · generated from collincountyelections.com, ${escapeHtml(today)}.</footer>` +
    `</section>`
  );
}

// ---------------------------------------------------------------------------
// Page 2 — apolitical voting-information handout
// ---------------------------------------------------------------------------

// NO party/matrix/focus arguments — see the compliance note at the top.
export function generateGOTVHandoutHTML({ code, votingInfo, nearestCenters } = {}) {
  const e = votingInfo?.election || null;
  const vote411 = votingInfo?.links?.vote411 || "https://www.vote411.org";

  const dates = e
    ? `<div class="packet-dates">` +
      (e.name ? `<h2>${escapeHtml(e.name)}</h2>` : "") +
      (e.electionDay ? row("Election day", fmtDate(e.electionDay)) : "") +
      (e.earlyVoting?.start && e.earlyVoting?.end
        ? row("Early voting", `${fmtDate(e.earlyVoting.start)} – ${fmtDate(e.earlyVoting.end)}`)
        : "") +
      (e.mailBallotApplicationDeadline
        ? row("Mail-ballot applications due", fmtDate(e.mailBallotApplicationDeadline))
        : "") +
      `</div>`
    : `<p class="packet-note">Election dates: check vote411.org.</p>`;

  const centers = Array.isArray(nearestCenters) ? nearestCenters : [];
  const centersHtml = centers.length
    ? `<h2>Places to vote near you</h2><ul class="packet-centers">` +
      centers
        .map(
          (c) =>
            `<li><b>${escapeHtml(c.name || "Vote center")}</b>` +
            (c.distanceMiles != null ? ` <span class="packet-dist">(about ${Number(c.distanceMiles).toFixed(1)} miles away)</span>` : "") +
            `<br>${escapeHtml(c.address || "")}</li>`
        )
        .join("") +
      `</ul><p class="packet-note">In Collin County you can vote at ANY vote center in the county — pick whichever is convenient.</p>`
    : `<p class="packet-note">Find your nearest voting location at vote411.org or the county elections website.</p>`;

  return (
    `<section class="packet-page packet-page-2">` +
    `<header class="packet-head"><h1>Voting Information</h1>` +
    (code != null && code !== "" ? `<span class="packet-badge">Precinct ${escapeHtml(String(code))}</span>` : "") +
    `</header>` +
    dates +
    centersHtml +
    `<div class="packet-vote411"><h2>Everything on your ballot, explained</h2>` +
    `<p>Visit <b>${escapeHtml(vote411.replace(/^https?:\/\/(www\.)?/, ""))}</b> — enter your address to see your sample ballot, ` +
    `check your registration, and find dates and locations. Free, from the League of Women Voters.</p></div>` +
    `<footer class="packet-foot">This card is voting information for all voters. It does not support or oppose any candidate or party.</footer>` +
    `</section>`
  );
}

function row(labelText, value) {
  return `<p class="packet-row"><b>${escapeHtml(labelText)}:</b> ${escapeHtml(value)}</p>`;
}

// Parse parts — new Date("YYYY-MM-DD") is UTC and shifts a day in Texas.
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return "N/A";
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Print — the fieldOnePager new-window pattern (iframe fallback for blocked
// pop-ups), with a hard page break between summary and handout.
// ---------------------------------------------------------------------------

const PACKET_STYLES = `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 0.5in; color: #111; }
    .packet-page { max-width: 700px; margin: 0 auto 24px; }
    .packet-page-1 { page-break-after: always; }
    .packet-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 2px solid #222; }
    .packet-head h1 { font-size: 26px; }
    .packet-badge { font-size: 14px; font-weight: 700; border: 2px solid #222; border-radius: 999px; padding: 4px 12px; }
    h2 { font-size: 17px; margin: 18px 0 8px; }
    .packet-note { font-size: 13px; color: #444; margin: 8px 0; }
    .packet-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .packet-table th, .packet-table td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
    .packet-table thead th { background: #f0f0f0; font-size: 13px; }
    .packet-role { font-size: 11px; font-weight: 700; border: 1px solid #222; border-radius: 999px; padding: 1px 6px; margin-left: 4px; white-space: nowrap; }
    .packet-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .packet-stat { border: 1px solid #999; border-radius: 8px; padding: 10px 12px; }
    .packet-stat-val { font-size: 22px; font-weight: 800; }
    .packet-stat-label { font-size: 13px; font-weight: 600; }
    .packet-stat-note { font-size: 12px; color: #555; }
    .packet-row { font-size: 15px; margin: 6px 0; }
    .packet-dates h2 { margin-top: 0; }
    .packet-centers { list-style: none; }
    .packet-centers li { padding: 8px 0; border-bottom: 1px solid #ccc; font-size: 15px; }
    .packet-dist { color: #444; font-size: 13px; }
    .packet-vote411 { border: 2px solid #222; border-radius: 10px; padding: 12px 14px; margin-top: 18px; }
    .packet-vote411 p { font-size: 15px; }
    .packet-foot { margin-top: 20px; padding-top: 10px; border-top: 1px solid #999; font-size: 12px; color: #555; text-align: center; }
    @page { margin: 0.5in; size: letter portrait; }
  </style>`;

export function printChairPacket(page1Html, page2Html, precinctCode) {
  const doc =
    `<!DOCTYPE html><html><head><title>Precinct ${escapeHtml(String(precinctCode ?? ""))} - Chair Packet</title>` +
    `${PACKET_STYLES}</head><body>${page1Html}${page2Html}</body></html>`;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(doc);
    printWindow.document.close();
    printWindow.addEventListener("load", function onLoad() {
      printWindow.print();
    });
    return;
  }

  // Pop-up blocked: print via a hidden iframe instead (never a silent nothing).
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  frame.srcdoc = doc;
  frame.addEventListener("load", function onFrameLoad() {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } finally {
      setTimeout(() => frame.remove(), 60000);
    }
  });
}
