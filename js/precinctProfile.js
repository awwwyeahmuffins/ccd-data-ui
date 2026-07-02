// precinctProfile.js
// --------------------------------------------------------------------------------
// Census profile data loading for the precinct report. The HTML/view half moved
// to js/ui/reportSections.js (REDESIGN.md Phase 2); this module keeps the
// fetch-coupled parts (loadCensusProfiles, renderPrecinctProfile) plus one-line
// re-export shims for the moved generators until Phase 6 deletes them. The pure
// remainder's future home is domain/profile.js (Phase 3).

import { getActiveBoundary, getBoundaryConfigs } from "./dataLoader.js";
import {
  generateProfileHTML as buildProfileHTML,
  renderPartyRegistration,
  renderRacialDemographics,
  renderElectionResults,
  renderOfficials,
} from "./ui/reportSections.js";

let cachedProfiles = null;
let cachedBoundary = null;

// ---------------------------------------------------------------------------
// Formatting helpers — now aliases of js/lib (Phase 1); re-exported because
// precinctLookup and friends import them from here until Phase 2's view split.
// ---------------------------------------------------------------------------

import { escapeHtml } from "./lib/dom.js";
import {
  formatCurrency,
  formatPctCompact as formatPct,
  formatNumberOrNA as formatNum
} from "./lib/format.js";
export { escapeHtml, formatCurrency, formatPct, formatNum };

// ---------------------------------------------------------------------------
// Moved-generator shims (REDESIGN move policy; deleted in Phase 6).
// The renderers now live in js/ui/reportSections.js — import them from there.
// ---------------------------------------------------------------------------

export {
  stackedBar,
  barsList,
  generateTakeaways,
  renderPartyRegistration,
  renderRacialDemographics,
  renderOfficials,
  renderBoundaryChanges,
  renderTrendArrow,
  statBox,
} from "./ui/reportSections.js";

// Legacy signature: reads the active boundary itself. New code should call
// ui/reportSections.js generateProfileHTML(profile, code, extraData, boundary).
export const generateProfileHTML = (profile, precinctCode, extraData = {}) =>
  buildProfileHTML(profile, precinctCode, extraData, getActiveBoundary());

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

export async function loadCensusProfiles() {
  const boundary = getActiveBoundary();
  if (cachedProfiles && cachedBoundary === boundary) return cachedProfiles;
  const config = getBoundaryConfigs()[boundary];
  let resp = await fetch(`${config.profileDir}/census_profiles.json`);
  if (!resp.ok) throw new Error(`Failed to load census profiles: ${resp.status}`);
  cachedProfiles = await resp.json();
  cachedBoundary = boundary;
  return cachedProfiles;
}

// ---------------------------------------------------------------------------
// Render into container (fused to fetching — stays here, not in ui/)
// ---------------------------------------------------------------------------

export async function renderPrecinctProfile(precinctCode, container, extraData = {}) {
  let profiles;
  try {
    profiles = await loadCensusProfiles();
  } catch {
    // census_profiles.json absent (district/county views other than Collin) — degrade gracefully
    profiles = {};
  }
  let profile = profiles[String(precinctCode)];
  if (!profile) {
    // No census record. Render whatever contextual data was passed in (party
    // lean, racial demographics, election results) so the panel is still useful.
    const hasExtra = extraData.partyData || extraData.racialData || extraData.electionData;
    if (hasExtra) {
      const code = escapeHtml(String(precinctCode));
      let html = `<div class="precinct-profile">`;
      html += `<div class="profile-header"><h3>Precinct ${code}</h3></div>`;
      html += `<div class="profile-disclaimer">Census data not available for this precinct.</div>`;
      html += renderPartyRegistration(extraData.partyData);
      html += renderRacialDemographics(extraData.racialData);
      html += renderElectionResults(extraData.electionData);
      html += renderOfficials(extraData.officials);
      html += `</div>`;
      container.innerHTML = html;
    } else {
      container.innerHTML = `<div class="precinct-profile"><p>No data available for precinct ${escapeHtml(String(precinctCode))}.</p></div>`;
    }
    return;
  }
  container.innerHTML = buildProfileHTML(profile, String(precinctCode), extraData, getActiveBoundary());
}
