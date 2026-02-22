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

/**
 * Add a Home button that resets the map to the given bounds.
 * @param {L.Map} map - Leaflet map instance
 * @param {L.LatLngBounds} bounds - Bounds to fit when clicked
 */
export function addHomeControl(map, bounds) {
  const HomeControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-home');
      const btn = L.DomUtil.create('a', '', container);
      btn.href = '#';
      btn.title = 'Reset map view';
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', 'Reset map view');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"/></svg>';
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        map.fitBounds(bounds, { padding: [20, 20] });
      });
      return container;
    }
  });
  new HomeControl().addTo(map);
}

/**
 * Add a basemap toggle control with multiple tile layer options.
 * @param {L.Map} map - Leaflet map instance
 * @param {L.TileLayer} tileLayer - The current tile layer to swap URLs on
 */
export function addBasemapControl(map, tileLayer) {
  const basemaps = [
    { id: 'streets', label: 'Streets', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
    { id: 'satellite', label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
    { id: 'topo', label: 'Topo', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png' },
    { id: 'dark', label: 'Dark', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' }
  ];

  const BasemapControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-basemap');
      const btn = L.DomUtil.create('a', 'basemap-toggle-btn', container);
      btn.href = '#';
      btn.title = 'Change basemap';
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', 'Change basemap');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M12 3v18"/></svg>';

      const popover = L.DomUtil.create('div', 'basemap-popover', container);
      popover.style.display = 'none';

      basemaps.forEach(bm => {
        const opt = L.DomUtil.create('button', 'basemap-option', popover);
        opt.textContent = bm.label;
        opt.dataset.basemap = bm.id;
        L.DomEvent.on(opt, 'click', (e) => {
          L.DomEvent.preventDefault(e);
          L.DomEvent.stopPropagation(e);
          tileLayer.setUrl(bm.url);
          popover.style.display = 'none';
          // Update active state
          popover.querySelectorAll('.basemap-option').forEach(o => o.classList.remove('active'));
          opt.classList.add('active');
        });
      });
      // Mark first as active
      popover.querySelector('.basemap-option').classList.add('active');

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
      });

      // Close popover when clicking elsewhere
      L.DomEvent.on(map.getContainer(), 'click', () => {
        popover.style.display = 'none';
      });

      return container;
    }
  });
  new BasemapControl().addTo(map);
}