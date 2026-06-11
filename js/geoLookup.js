// geoLookup.js
// --------------------------------------------------------------------------------
// Address → precinct lookup helpers: free-text geocoding (OpenStreetMap
// Nominatim — CORS-enabled, no key) plus point-in-polygon matching against the
// loaded precinct GeoJSON. Used by precinct.html's address search and the map
// page's "find my precinct" control.

// Collin County bounding box (lon/lat), with a small buffer.
// Nominatim viewbox format: left,top,right,bottom.
const COLLIN_VIEWBOX = "-96.95,33.45,-96.25,32.95";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/**
 * Geocode a free-text address, biased and bounded to Collin County.
 * @param {string} query - e.g. "2300 Bloomdale Rd, McKinney"
 * @param {typeof fetch} [fetchImpl] - injectable for tests
 * @returns {Promise<{lat: number, lng: number, label: string} | null>}
 */
export async function geocodeAddress(query, fetchImpl = fetch) {
  const q = String(query || "").trim();
  if (!q) return null;

  const params = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    countrycodes: "us",
    viewbox: COLLIN_VIEWBOX,
    bounded: "1",
    q,
  });

  const resp = await fetchImpl(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`Geocoder returned ${resp.status}`);

  const results = await resp.json();
  if (!Array.isArray(results) || results.length === 0) return null;

  const top = results[0];
  const lat = Number(top.lat);
  const lng = Number(top.lon);
  if (!isFinite(lat) || !isFinite(lng)) return null;

  return { lat, lng, label: top.display_name || q };
}

/**
 * Even-odd ray-casting test for a single linear ring.
 * @param {number} lat
 * @param {number} lng
 * @param {Array<[number, number]>} ring - GeoJSON [lng, lat] pairs
 * @returns {boolean}
 */
function inRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-polygon for a GeoJSON Polygon or MultiPolygon feature.
 * Even-odd over all rings, so holes are handled naturally.
 * @param {number} lat
 * @param {number} lng
 * @param {object} geometry - GeoJSON geometry
 * @returns {boolean}
 */
export function pointInGeometry(lat, lng, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    let hits = 0;
    for (const ring of geometry.coordinates) {
      if (inRing(lat, lng, ring)) hits++;
    }
    return hits % 2 === 1;
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      let hits = 0;
      for (const ring of polygon) {
        if (inRing(lat, lng, ring)) hits++;
      }
      if (hits % 2 === 1) return true;
    }
    return false;
  }
  return false;
}

/**
 * Cheap bounding-box prefilter so we only ray-cast a handful of features.
 */
function inBBox(lat, lng, geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const scan = (ring) => {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };
  if (geometry.type === "Polygon") geometry.coordinates.forEach(scan);
  else if (geometry.type === "MultiPolygon")
    geometry.coordinates.forEach((p) => p.forEach(scan));
  else return false;
  return lng >= minX && lng <= maxX && lat >= minY && lat <= maxY;
}

/**
 * Find the precinct feature containing a point.
 * @param {number} lat
 * @param {number} lng
 * @param {Array<object>} features - GeoJSON features with PRECINCT property
 * @returns {object | null} the matching feature, or null
 */
export function findPrecinctForPoint(lat, lng, features) {
  if (!Array.isArray(features)) return null;
  for (const feature of features) {
    const geom = feature?.geometry;
    if (!geom) continue;
    if (!inBBox(lat, lng, geom)) continue;
    if (pointInGeometry(lat, lng, geom)) return feature;
  }
  return null;
}

/**
 * Convenience: geocode an address and resolve it to a precinct code.
 * @returns {Promise<{code: string, label: string, lat: number, lng: number} | null>}
 *   null when the address can't be geocoded; a result with code === null when
 *   the address geocodes but falls outside every precinct (outside the county).
 */
export async function findPrecinctForAddress(query, features, fetchImpl = fetch) {
  const located = await geocodeAddress(query, fetchImpl);
  if (!located) return null;
  const feature = findPrecinctForPoint(located.lat, located.lng, features);
  return {
    code: feature ? String(feature.properties.PRECINCT) : null,
    label: located.label,
    lat: located.lat,
    lng: located.lng,
  };
}
