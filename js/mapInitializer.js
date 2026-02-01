// mapInitializer.js
// --------------------------------------------------------------------------------
// Create and configure the Leaflet map (center, tile layer, zoom-snap, etc.).
//
// Usage in app.js:
//   import { initMap } from "./mapInitializer.js";
//   const map = initMap({ center: [33.1, -96.6], zoom: 9 });
// 

export function initMap({ center = [0, 0], zoom = 2, containerId = "map" } = {}) {
  const map = L.map(containerId, {
    zoomDelta: 1.25,           // Bigger steps per scroll tick
    zoomSnap: 0,               // Allow any zoom level (smooth zooming)
    wheelPxPerZoomLevel: 12,  // Much less scroll needed per zoom (default 60)
    wheelDebounceTime: 0      // No debounce - immediate response
  }).setView(center, zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  return map;
}