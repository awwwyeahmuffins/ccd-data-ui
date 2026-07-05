// ui/dataTable.js — the ONE column-model table renderer (REDESIGN.md §4.1, Phase 2).
// --------------------------------------------------------------------------------
// Generalizes the listView.js keeper pattern (pure row model + chunked
// animation-frame renderer) to semantic <table>s: a column model + rows come in
// as arguments, <th scope="col"> headers and escaped <td> cells come out.
// Adopters: explorePage (data grid); next per the roadmap: precinct history.
//
// imports: lib only — this is a UI-layer module. It never fetches and never
// imports dataLoader; all data arrives as arguments.

import { escapeHtml } from "../lib/dom.js";

// Column model
// ------------
//   {
//     id,                  // data-col on the <th>; default row accessor key
//     label,               // header text (escaped)
//     headerClass?,        // extra class(es) on the <th>
//     headerAttrs?,        // extra attributes on the <th> ({ name: value }, escaped)
//     sortable?,           // false opts the column out of click-to-sort (default true)
//     pinned?,             // true adds `pin-col pin-col-<i>` classes (i = index among
//                          // pinned columns) to the <th> and default-path <td>s; the
//                          // page's CSS supplies the sticky positioning. Columns with
//                          // cellHTML own their markup and add the classes themselves.
//     cellHTML?(row),      // full trusted `<td>…</td>` HTML — the CALLER escapes.
//                          // When absent, the safe accessor/format path is used:
//     accessor?(row),      // value getter (default: row[id])
//     format?(value, row), // value → display string (default: String; null/undef → "")
//     cellClass?,          // class on default-path cells (string or fn(row))
//   }
//
// Sort model
// ----------
// `sort` is either the single-column shape { key, dir: "asc"|"desc" } (the
// original contract — output is unchanged for it) or an ordered array
// [{ key, dir }, …] for multi-column sorting: the primary key renders the
// plain ↑/↓ + aria-sort, secondary keys render a superscript rank (↓² …) and
// the `sorted-secondary` class. Click handlers receive (columnId, event) so
// callers can treat shift-click as "add a secondary key".

// Normalize the sort argument to an ordered array of { key, dir }.
function normalizeSort(sort) {
  if (!sort) return [];
  return Array.isArray(sort) ? sort.filter(Boolean) : [sort];
}

// Superscript rank markers for secondary sort keys (index 1 → ², 2 → ³ …).
const SORT_RANKS = ["", "²", "³", "⁴", "⁵", "⁶"];

function attrString(attrs) {
  if (!attrs) return "";
  return Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
    .join("");
}

// One <th scope="col"> header cell. `sort` = { key, dir }, [{ key, dir }, …],
// or null. The primary sorted column gets the `sorted` class, an ↑/↓
// indicator, and aria-sort; secondary keys get a superscript rank and
// `sorted-secondary` (aria-sort stays on the primary only).
export function headerCellHTML(col, sort = null) {
  const sorts = normalizeSort(sort);
  const idx = sorts.findIndex((s) => s && s.key === col.id);
  const isSorted = idx !== -1;
  const dir = isSorted ? sorts[idx].dir : null;
  const rank = idx > 0 ? SORT_RANKS[idx] || `(${idx + 1})` : "";
  const arrow = isSorted ? `${dir === "desc" ? " ↓" : " ↑"}${rank}` : "";
  const ariaSort =
    idx === 0 ? ` aria-sort="${dir === "desc" ? "descending" : "ascending"}"` : "";
  const cls = [col.headerClass, isSorted ? "sorted" : "", idx > 0 ? "sorted-secondary" : ""]
    .filter(Boolean)
    .join(" ");
  return `<th scope="col" data-col="${escapeHtml(col.id)}" class="${escapeHtml(cls)}"${ariaSort}${attrString(col.headerAttrs)}>${escapeHtml(col.label)}${arrow}</th>`;
}

// One <td>. Columns with cellHTML own their markup (and their escaping);
// everything else goes through the escaped accessor/format path.
export function bodyCellHTML(col, row) {
  if (col.cellHTML) return col.cellHTML(row);
  const value = col.accessor ? col.accessor(row) : row[col.id];
  const text = col.format ? col.format(value, row) : value == null ? "" : String(value);
  const cls = typeof col.cellClass === "function" ? col.cellClass(row) : col.cellClass;
  return `<td${cls ? ` class="${escapeHtml(cls)}"` : ""}>${escapeHtml(text)}</td>`;
}

// One <tr>. `rowAttrs(row)` may supply attributes (e.g. { class: "tiny-row" }).
export function rowHTML(columns, row, rowAttrs = null) {
  const attrs = rowAttrs ? rowAttrs(row) : null;
  return `<tr${attrString(attrs)}>${columns.map((c) => bodyCellHTML(c, row)).join("")}</tr>`;
}

// Append the pin classes to a column list: each `pinned: true` column gets
// `pin-col pin-col-<i>` on its <th> and (default-path) <td>s so the page's
// CSS can make them sticky. cellHTML columns own their markup — they add the
// classes themselves.
function applyPinning(columns) {
  let pinIndex = 0;
  return columns.map((col) => {
    if (!col.pinned) return col;
    const pinCls = `pin-col pin-col-${pinIndex++}`;
    const orig = col.cellClass;
    return {
      ...col,
      headerClass: [col.headerClass, pinCls].filter(Boolean).join(" "),
      cellClass: col.cellHTML
        ? col.cellClass
        : (row) => {
            const c = typeof orig === "function" ? orig(row) : orig;
            return [c, pinCls].filter(Boolean).join(" ");
          },
    };
  });
}

// Render a full table into existing containers.
//   head         the header <tr> element (inside <thead>) — optional
//   body         the <tbody> element — required
//   columns      column model array (above; `pinned` columns get pin classes)
//   rows         data rows
//   sort         { key, dir: "asc"|"desc" } or [{ key, dir }, …] — drives the
//                header indicators (see the sort model note above)
//   onSort(id, event)  click-to-sort handler, attached to every sortable
//                header; `event` lets callers treat shift-click specially
//   rowAttrs(r)  per-row attributes (e.g. conditional classes)
//   emptyMessage empty-state text (escaped), rendered as a single
//                `<td class="empty-note" colspan=N>` row
//   batch        > 0 chunks body rendering into animation-frame batches of this
//                size (the listView.js pattern — for large tables); 0 = sync
// Returns a cancel function (a no-op unless a chunked render is in flight).
export function renderDataTable({
  head = null,
  body,
  columns: rawColumns,
  rows,
  sort = null,
  onSort = null,
  rowAttrs = null,
  emptyMessage = "No rows to show.",
  batch = 0,
} = {}) {
  const columns = applyPinning(rawColumns);
  if (head) {
    head.innerHTML = columns.map((c) => headerCellHTML(c, sort)).join("");
    if (onSort) {
      head.querySelectorAll("th[data-col]").forEach((th) => {
        const col = columns.find((c) => c.id === th.dataset.col);
        if (!col || col.sortable === false) return;
        th.addEventListener("click", (event) => onSort(col.id, event));
      });
    }
  }

  if (!rows || !rows.length) {
    body.innerHTML = `<tr><td class="empty-note" colspan="${columns.length}">${escapeHtml(emptyMessage)}</td></tr>`;
    return () => {};
  }

  const chunkHTML = (slice) => slice.map((r) => rowHTML(columns, r, rowAttrs)).join("");

  if (!batch || rows.length <= batch) {
    body.innerHTML = chunkHTML(rows);
    return () => {};
  }

  // Chunked: animation-frame batches, cancellable (mirrors listView.renderRows).
  body.innerHTML = "";
  let i = 0;
  let cancelled = false;
  function step() {
    if (cancelled || i >= rows.length) return;
    body.insertAdjacentHTML("beforeend", chunkHTML(rows.slice(i, i + batch)));
    i += batch;
    if (i < rows.length) requestAnimationFrame(step);
  }
  step();
  return () => { cancelled = true; };
}
