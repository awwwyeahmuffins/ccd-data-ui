// lib/urlState.js
// --------------------------------------------------------------------------------
// The one URL-state module (REDESIGN.md §5.3). Hash-based (S3/CloudFront-safe),
// ~50 lines. Every page reads and writes its params through this vocabulary:
//   race, precinct, view, tab, strategy, boundary, district
//   (+ matchup.html's scenario params: office, dem, rep, baseline,
//    tr/tm/td turnout percents, rd/dr/md/mr flip percents)
// Legacy `county=` is read-tolerated (readParams returns it) and will stop
// being written when Phase 3 lands. Pages pass writeParams the exact ordered
// param set they mean to publish; null/undefined/"" values are omitted, which
// is how each page expresses its own omit-the-default rule.

export function readParams() {
  const params = {};
  for (const part of window.location.hash.slice(1).split("&")) {
    const [k, v] = part.split("=");
    if (k && v) params[k] = decodeURIComponent(v);
  }
  return params;
}

export function writeParams(params, { replace = true } = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  const hash = parts.join("&");
  if (replace) {
    history.replaceState(
      null,
      "",
      hash ? `#${hash}` : window.location.pathname + window.location.search
    );
  } else if (window.location.hash !== `#${hash}`) {
    window.location.hash = hash; // push semantics — a real history entry
  }
}

// Subscribe to hash changes (back/forward, in-page pushes). Returns an
// unsubscribe function. Handlers receive the freshly parsed params.
export function onChange(fn) {
  const handler = () => fn(readParams());
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}
