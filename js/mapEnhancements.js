// mapEnhancements.js
// Precinct number labels on the Leaflet map.
// Labels appear at zoom >= 12 and hide at lower zoom levels.

// Inject CSS for precinct label icons (once)
let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.precinct-label-icon {
  background: none;
  border: none;
  font-size: 11px;
  font-weight: 600;
  color: #333;
  text-shadow: 1px 1px 2px rgba(255,255,255,0.9), -1px -1px 2px rgba(255,255,255,0.9);
  text-align: center;
  white-space: nowrap;
  pointer-events: none;
}
[data-theme="dark"] .precinct-label-icon {
  color: #e0e0e0;
  text-shadow: 1px 1px 2px rgba(0,0,0,0.9), -1px -1px 2px rgba(0,0,0,0.9);
}
`;
  document.head.appendChild(style);
}

const LABEL_ZOOM_THRESHOLD = 12;

/**
 * Add precinct number labels to the map.
 * Labels are visible only at zoom >= 12.
 *
 * @param {L.Map} map - The Leaflet map instance
 * @param {L.GeoJSON} geojsonLayer - The GeoJSON layer containing precinct features
 * @returns {Function} Cleanup function that removes labels and the zoom listener
 */
export function setupPrecinctLabels(map, geojsonLayer) {
  injectStyles();

  const labelLayer = L.layerGroup();

  geojsonLayer.eachLayer((layer) => {
    const feature = layer.feature;
    if (!feature || !feature.properties || !feature.properties.PRECINCT) return;

    const center = layer.getBounds().getCenter();
    const marker = L.marker(center, {
      icon: L.divIcon({
        className: 'precinct-label-icon',
        html: String(feature.properties.PRECINCT),
        iconSize: [40, 16],
        iconAnchor: [20, 8],
      }),
      interactive: false,
    });
    labelLayer.addLayer(marker);
  });

  function onZoomEnd() {
    if (map.getZoom() >= LABEL_ZOOM_THRESHOLD) {
      if (!map.hasLayer(labelLayer)) {
        map.addLayer(labelLayer);
      }
    } else {
      if (map.hasLayer(labelLayer)) {
        map.removeLayer(labelLayer);
      }
    }
  }

  map.on('zoomend', onZoomEnd);

  // Set initial visibility
  if (map.getZoom() >= LABEL_ZOOM_THRESHOLD) {
    map.addLayer(labelLayer);
  }

  // Return cleanup function
  return function cleanup() {
    map.off('zoomend', onZoomEnd);
    if (map.hasLayer(labelLayer)) {
      map.removeLayer(labelLayer);
    }
  };
}

/**
 * Remove precinct labels by calling the cleanup function returned from setupPrecinctLabels.
 *
 * @param {Function} cleanupFn - The cleanup function returned by setupPrecinctLabels
 */
export function removePrecinctLabels(cleanupFn) {
  if (typeof cleanupFn === 'function') {
    cleanupFn();
  }
}
