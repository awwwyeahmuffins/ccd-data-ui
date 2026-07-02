// themeManager.js
// The dark theme was retired in the June 2026 civic-plain redesign — the app is
// light-only ("warm paper") for its 60+ audience. This module keeps the tile
// URL and clears any stale saved dark preference from older sessions.
export const LIGHT_TILE_URL =
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const STORAGE_KEY = "ccd_theme";

export function initTheme() {
  document.documentElement.removeAttribute("data-theme");
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
}

export function getCurrentTheme() {
  return "light";
}
