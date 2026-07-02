// ui/racePicker.js
// --------------------------------------------------------------------------------
// The ONE searchable race picker (REDESIGN.md §4.1): category groups, type-to-
// search across every race, keyboard/Escape handling by the host page. Used by
// the Map (index.html) and the Forecast; the elections.html catalog folds into
// this component in Phase 5. UI layer: imports lib only; races come in via
// getRaces() — this module never fetches.
//
// Markup contract (host page provides the shell; styles in js/civic.css):
//   button (toggle, contains nameEl) · menuEl (gets .open) · searchInput · listEl
// Options render as .cc-county-opt[data-race] rows (the "" id = Overview) with
// .cc-race-group collapsible headers — the classes the Map has always used.

import { escapeHtml } from "../lib/dom.js";

export const RACE_GROUP_DEFS = [
  { key: "Federal", label: "Federal — President & Congress" },
  { key: "State", label: "State — Governor & Legislature" },
  { key: "County", label: "County offices" },
  { key: "City", label: "City councils & mayors" },
  { key: "ISD", label: "School districts (ISD)" },
  { key: "MUD", label: "Utility districts (MUD)" },
];

export function createRacePicker({
  root,            // wrapper element — clicks outside it close the menu
  button,          // toggle button
  nameEl,          // label element inside the button
  menuEl,          // popup (gets .open)
  searchInput,     // search text input
  listEl,          // options container
  getRaces,        // () => normalized manifest entries
  getSelectedId,   // () => current race id ("" / null = none)
  onPick,          // (id | null) => void — null means "Overview / clear race"
  overviewLabel = "Overview — no race selected",
  placeholder = "Choose a race",
  showOverview = true, // the Map's "no race" row; pickers that require a race hide it
}) {
  const openGroups = new Set(["Federal"]);

  const raceId = (e) => e.raceKey || e.filename;

  function optHTML(e) {
    const id = raceId(e);
    const label = String(e.displayName || e.office || id);
    const year = String(e.year || "");
    const badge = year && !label.includes(year) ? year : "";
    return `<div class="cc-county-opt ${id === getSelectedId() ? "active" : ""}" data-race="${escapeHtml(id)}">
      <span>${escapeHtml(label)}</span>${badge ? `<small>${escapeHtml(badge)}</small>` : ""}</div>`;
  }

  function render(filter = "") {
    if (!listEl) return;
    const races = getRaces() || [];
    const f = String(filter).toLowerCase().trim();
    let html = showOverview
      ? `<div class="cc-county-opt ${getSelectedId() ? "" : "active"}" data-race="">
        <span>${escapeHtml(overviewLabel)}</span></div>`
      : "";
    if (f) {
      // Typing searches every race, flat.
      html += races
        .filter((e) => (e.displayName || e.office || e.filename || "").toLowerCase().includes(f))
        .slice(0, 80)
        .map(optHTML)
        .join("");
      listEl.innerHTML = html;
      return;
    }
    const byYearDesc = (a, b) =>
      (+b.year || 0) - (+a.year || 0) ||
      String(a.displayName || a.office || "").localeCompare(String(b.displayName || b.office || ""));
    const grouped = new Map(RACE_GROUP_DEFS.map((g) => [g.key, []]));
    const other = [];
    for (const e of races) (grouped.get(e.category) || other).push(e);
    const groups = other.length
      ? [...RACE_GROUP_DEFS, { key: "Other", label: "Other races" }]
      : RACE_GROUP_DEFS;
    for (const g of groups) {
      const entries = g.key === "Other" ? other : grouped.get(g.key);
      if (!entries.length) continue;
      entries.sort(byYearDesc);
      const open = openGroups.has(g.key);
      html += `<button type="button" class="cc-race-group" data-group="${g.key}" aria-expanded="${open}">
        <span>${escapeHtml(g.label)}</span><small>${entries.length} race${entries.length === 1 ? "" : "s"} ${open ? "▴" : "▾"}</small></button>`;
      if (open) html += entries.map(optHTML).join("");
    }
    listEl.innerHTML = html;
  }

  const refresh = () => render(searchInput ? searchInput.value || "" : "");

  function open() {
    menuEl.classList.add("open");
    if (searchInput) searchInput.focus();
  }
  function close() {
    menuEl.classList.remove("open");
  }

  // Keep the picked race's group open so reopening shows the selection.
  function ensureGroupOpen(category) {
    openGroups.add(RACE_GROUP_DEFS.some((g) => g.key === category) ? category : "Other");
  }

  function setLabel(text) {
    if (nameEl) nameEl.textContent = text || placeholder;
  }

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    menuEl.classList.contains("open") ? close() : open();
  });
  if (searchInput) searchInput.addEventListener("input", (e) => render(e.target.value));
  listEl.addEventListener("click", (e) => {
    const group = e.target.closest(".cc-race-group");
    if (group) {
      const key = group.dataset.group;
      openGroups.has(key) ? openGroups.delete(key) : openGroups.add(key);
      refresh();
      return;
    }
    const opt = e.target.closest(".cc-county-opt[data-race]");
    if (!opt) return;
    close();
    onPick(opt.dataset.race || null);
  });
  document.addEventListener("click", (e) => {
    if (root && !root.contains(e.target)) close();
  });

  return { render, refresh, open, close, ensureGroupOpen, setLabel };
}
