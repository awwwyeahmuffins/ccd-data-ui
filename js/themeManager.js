export const LIGHT_TILE_URL =
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DARK_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

const STORAGE_KEY = "ccd_theme";
let currentTheme = "light";

export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  currentTheme = saved === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", currentTheme);
}

export function toggleTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  localStorage.setItem(STORAGE_KEY, currentTheme);
  document.documentElement.setAttribute("data-theme", currentTheme);
  return currentTheme;
}

export function getCurrentTheme() {
  return currentTheme;
}
