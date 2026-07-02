// lib/format.js
// --------------------------------------------------------------------------------
// The one home for number/label formatting (REDESIGN.md §4.1). Pure functions,
// no imports. Consolidates utils.js plus the per-page copies that used to live
// in precinctProfile.js, turnoutSimulator.js, and commandCenter.js. The three
// percentage styles kept distinct names on purpose — they render differently
// and each page's existing output is preserved exactly.

// Safe number parser - returns the default for invalid values
export function safeNumber(value, defaultValue = 0) {
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

// "1,234" — locale thousands separator; invalid input renders as 0
export function formatNumber(value) {
  return safeNumber(value).toLocaleString();
}

// "1,234" or "N/A" — for surfaces where a missing value must read as missing
export function formatNumberOrNA(value) {
  if (value == null || isNaN(value)) return "N/A";
  return Number(value).toLocaleString("en-US");
}

// "12.3%" (one decimal) or "N/A" — fraction in, percent out
export function formatPct(fraction) {
  if (fraction == null || isNaN(fraction)) return "N/A";
  return (fraction * 100).toFixed(1) + "%";
}

// "12.3%" but whole values drop the ".0" ("52%") — the precinct report style
export function formatPctCompact(fraction) {
  if (fraction == null || isNaN(fraction)) return "N/A";
  return (fraction * 100).toFixed(1).replace(/\.0$/, "") + "%";
}

// "52%" rounded to the nearest whole percent, or "N/A" — the map readout style
export function formatPctWhole(fraction) {
  if (fraction == null || isNaN(fraction)) return "N/A";
  return Math.round(fraction * 100) + "%";
}

// "$1.2M" / "$45.3K" / "$1,234" or "N/A"
export function formatCurrency(n) {
  if (n == null || isNaN(n)) return "N/A";
  if (n >= 1000000) {
    return "$" + (n / 1000000).toFixed(1) + "M";
  }
  if (n >= 10000) {
    return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return "$" + n.toLocaleString("en-US");
}

// The one "Population" number used sitewide: the racial-data total (the
// voter universe), NOT census.population (an unreliable ACS apportionment).
// Both the map and the precinct report read this so the two views agree. Falls
// back to census.population only when a precinct has no racial row; returns null
// (→ "N/A") when neither is available. `census` is optional (the map omits it).
export function populationOf(racial, census) {
  const total = racial && Number(racial.total);
  if (total > 0) return total;
  const cp = census && Number(census.population);
  return cp > 0 ? cp : null;
}

// Human label for a map unit. Plain counties use bare precinct codes
// ("Precinct 42"); cross-county district views prefix codes with the county
// slug ("collin:42" → "Collin · Precinct 42"); county-level aggregate units
// ARE counties (PRECINCT = county slug, COUNTY = county name → "Collin County").
export function formatPrecinctLabel(props) {
  const code = String(props?.PRECINCT ?? '');
  if (props?.COUNTY) {
    if (code.includes(':')) {
      return `${props.COUNTY} · Precinct ${code.split(':')[1]}`;
    }
    if (!/^\d+$/.test(code)) {
      return `${props.COUNTY} County`;
    }
  }
  return `Precinct ${code}`;
}
