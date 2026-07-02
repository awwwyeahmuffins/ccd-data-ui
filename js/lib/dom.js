// lib/dom.js
// --------------------------------------------------------------------------------
// Escaping + DOM-adjacent utilities (REDESIGN.md §4.1). Pure, no imports.
// Use escapeHtml for ANY innerHTML interpolation and csvEscape for ANY CSV cell.

// Escape a string for safe interpolation into HTML (text or attribute position)
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escape a value for CSV output; string values starting with =, +, -, @,
// tab, or CR are prefixed with ' so spreadsheets treat them as text, not formulas
export function csvEscape(value) {
  if (value == null) return "";
  let str = String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Debounce utility for performance-sensitive operations
export function debounce(fn, delay = 100) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}
