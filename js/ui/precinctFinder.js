// ui/precinctFinder.js
// --------------------------------------------------------------------------------
// The ONE precinct finder (REDESIGN.md §4.1): the number-vs-address heuristic,
// the Nominatim address flow, the geolocation flow, and the shared
// plain-language status copy — previously duplicated between the Map and the
// Find a Precinct page (which had drifted only in phrasing). Pages keep their
// own inputs/dropdowns and pass callbacks; this module never touches their DOM.
//
// UI layer: imports lib/domain only; the geocoder fetch is injected via
// geoLookup helpers passed in by the host page, so this module stays testable
// and never fetches on its own.

export const FINDER_COPY = {
  addressLooking: "Looking up that address…",
  addressNotFound: (q) => `Couldn't find “${q}”. Try adding the city, e.g. “123 Main St, McKinney”.`,
  addressOutside: "That address appears to be outside this map's precincts.",
  addressServiceDown: "The address search service is unavailable right now. Please try again in a moment.",
  noSuchPrecinct: (q) => `No precinct "${q}" here. You can also type a street address.`,
  geoUnsupported: "Your browser doesn't support location lookup. Type your address instead.",
  geoLooking: "Finding your location…",
  geoOutside: "Your current location appears to be outside this map's precincts.",
  geoFailed: "Couldn't get your location. You can type your street address instead.",
};

// A query with letters (or longer than a precinct code) is a street address;
// otherwise it's a precinct number. The one heuristic both pages share.
export function isAddressQuery(q) {
  return /[a-zA-Z]/.test(q) || q.length > 4;
}

/**
 * @param {object} deps
 *   getFeatures        () => GeoJSON features currently on the page
 *   hasPrecinct        (code) => boolean — does this code exist here?
 *   onFound            (code) => void — select/open the precinct
 *   onStatus           (msg) => void — plain-language progress/error line
 *   findPrecinctForAddress  geoLookup.findPrecinctForAddress
 *   findPrecinctForPoint    geoLookup.findPrecinctForPoint
 *   viewbox            geoLookup.TEXAS_VIEWBOX (geocoder bounding box)
 */
export function createPrecinctFinder({
  getFeatures,
  hasPrecinct,
  onFound,
  onStatus,
  findPrecinctForAddress,
  findPrecinctForPoint,
  viewbox,
}) {
  // Core address flow. Returns { ok:true, code } or { ok:false, message } so
  // each page can render the outcome its own way (dock status, dropdown,
  // notice banner…).
  async function resolveAddress(query) {
    try {
      const result = await findPrecinctForAddress(query, getFeatures(), globalThis.fetch, viewbox);
      if (!result) return { ok: false, message: FINDER_COPY.addressNotFound(query) };
      if (!result.code) return { ok: false, message: FINDER_COPY.addressOutside };
      return { ok: true, code: String(result.code) };
    } catch (err) {
      console.error("[precinctFinder] address lookup failed:", err);
      return { ok: false, message: FINDER_COPY.addressServiceDown };
    }
  }

  // Core geolocation flow — same outcome shape as resolveAddress. geoOptions
  // lets pages keep their own timeout/cache tuning.
  function resolveLocation(geoOptions = { timeout: 12000 }) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ ok: false, message: FINDER_COPY.geoUnsupported });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const feature = findPrecinctForPoint(pos.coords.latitude, pos.coords.longitude, getFeatures());
          if (feature) resolve({ ok: true, code: String(feature.properties.PRECINCT) });
          else resolve({ ok: false, message: FINDER_COPY.geoOutside });
        },
        () => resolve({ ok: false, message: FINDER_COPY.geoFailed }),
        geoOptions
      );
    });
  }

  async function searchAddress(query) {
    onStatus(FINDER_COPY.addressLooking);
    const r = await resolveAddress(query);
    if (r.ok) onFound(r.code);
    else onStatus(r.message);
  }

  // One entry point for the search box: routes to address or precinct number.
  function search(query) {
    const q = String(query || "").trim();
    if (!q) return;
    if (isAddressQuery(q)) {
      searchAddress(q);
      return;
    }
    if (hasPrecinct(q)) onFound(q);
    else onStatus(FINDER_COPY.noSuchPrecinct(q));
  }

  // "My location" — find the precinct the user is standing in.
  async function locate() {
    if (navigator.geolocation) onStatus(FINDER_COPY.geoLooking);
    const r = await resolveLocation();
    if (r.ok) onFound(r.code);
    else onStatus(r.message);
  }

  return { search, searchAddress, locate, resolveAddress, resolveLocation };
}
