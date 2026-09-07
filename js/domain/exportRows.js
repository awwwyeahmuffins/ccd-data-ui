// domain/exportRows.js — turn a table's live rows into a CSV file.
//
// The campaign dashboard already shipped a VAN target-list export
// (domain/campaign.js buildTargetCSV); the two NAV-LEVEL analysis pages —
// Priority Precincts and the Data Table — produced no file at all, so a field
// director with 25 ranked precincts had to retype them into a spreadsheet.
// This is the shared, generic half of that pattern.
//
// REDESIGN.md §657 assigns both exports to a future reporting/export.js; this
// is the smallest honest landing spot until that module exists.
//
// One rule worth stating: export RAW record values, never the display
// formatter's output. precinctMetrics.formatValue turns 0.62 into "62%"
// (losing precision), 1234 into "1,234" (which imports as text), and null into
// an em dash. A spreadsheet needs numbers, and a missing value is an empty
// cell — never a fabricated 0.

import { csvEscape } from "../lib/dom.js";

/**
 * @param {Array<{key: string, label: string}>} columns - header order
 * @param {Array<Object>} rows - records keyed by column key
 * @returns {string} RFC-4180 CSV (CRLF line endings, trailing newline)
 */
export function toCsv(columns, rows) {
  const cols = columns || [];
  const lines = [cols.map((c) => csvEscape(c.label ?? c.key)).join(",")];
  for (const row of rows || []) {
    lines.push(cols.map((c) => csvEscape(cell(row ? row[c.key] : null))).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

// Missing stays empty. Numbers stay numbers. Everything else is its own text.
function cell(v) {
  if (v == null) return "";
  // Round off binary-float noise (0.43 - 0.35 - 0.22 => 0.020000000000000018)
  // at the 10th decimal. That is far below any precision this data carries, so
  // it cannot lose a real digit, and it keeps the spreadsheet readable.
  if (typeof v === "number") return isNaN(v) ? "" : Number(v.toFixed(10));
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/**
 * A filename that says what the file contains, so a folder of exports is still
 * readable a week later. Callers pass live state, not a constant.
 */
export function exportFilename(base, parts = []) {
  const tail = parts.filter(Boolean).map((p) => String(p).replace(/[^A-Za-z0-9_-]+/g, "-")).join("-");
  return `${base}${tail ? `-${tail}` : ""}.csv`;
}
