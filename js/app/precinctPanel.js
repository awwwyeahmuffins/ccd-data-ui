// precinctPanel.js
// --------------------------------------------------------------------------------
// Precinct interaction: map click selection, the floating info card, and the
// full profile slide-in panel (with election history and the disabled chat).

import { state } from "./state.js";
import { closeAllPanels, updateBreadcrumbs, showNotification } from "./uiChrome.js";
import { PRECINCT_STYLE, PARTY_COLORS } from "../constants.js";
import { extractParty } from "../turnoutSimulator.js";
import { buildRacialChartData, buildPartyChartData, formatPct, escapeHtml, getRowPrecinctCode, formatPrecinctLabel } from "../utils.js";
import { formatElectionName } from "../electionFilters.js";
import { renderPrecinctProfile } from "../precinctProfile.js";
import { loadElectionData } from "../dataLoader.js";
import { buildVotingHistory } from "../precinctHistory.js";
import { computeRaceSummary } from "../exportManager.js";
import { downloadCSV } from "../exportCSV.js";
import { buildSystemPrompt, streamChat } from "../precinctChat.js";
import { createChatSection, initChatController } from "../chatUI.js";

// Candidate results for one precinct row, best-first: shared by the info card
// and the profile panel (each row column in `cols` is "<Party> <Name>").
function computePrecinctCandidates(row, cols) {
  const candidates = (cols || [])
    .map(col => ({ name: col, votes: Number(row[col]) || 0, party: col.split(' ')[0] }))
    .filter(c => c.votes > 0)
    .sort((a, b) => b.votes - a.votes);
  if (candidates.length === 0) return null;
  const totalVotes = candidates.reduce((s, c) => s + c.votes, 0);
  const winner = candidates[0];
  const runnerUp = candidates[1];
  const margin = runnerUp ? winner.votes - runnerUp.votes : winner.votes;
  return { candidates, totalVotes, winner, runnerUp, margin };
}

export async function handlePrecinctClick(feature, layer) {
  const props = feature.properties;
  const precinctCode = String(props?.PRECINCT ?? '');

  // In the Texas statewide view each polygon IS a county (PRECINCT = slug,
  // COUNTY = name, no ':' separator, non-numeric). Clicking drills into that
  // county's full precinct view instead of showing county-level aggregate stats.
  if (props?.COUNTY && !precinctCode.includes(':') && !/^\d+$/.test(precinctCode)) {
    const { switchToCountyView } = await import('./county.js');
    await switchToCountyView(precinctCode);
    return;
  }

  // Deselect previous — restore its full base style (the selected style
  // overrides border color/weight, not just weight)
  if (state.selectedLayer) {
    state.selectedLayer.setStyle(
      state.selectedLayer._baseStyle || { weight: PRECINCT_STYLE.default.weight });
  }

  // Select new
  state.selectedPrecinct = props;
  state.selectedLayer = layer;
  layer.setStyle(PRECINCT_STYLE.selected);
  layer.bringToFront();

  // Close browse panel so the info card is visible
  closeAllPanels();

  // G9: Only show info card on click, don't auto-open profile panel
  updateInfoCard(props);
}

// Keep the user's place when the underlying map re-renders (switching races,
// boundary sets, etc.): re-find the selected precinct's layer, restore its
// highlight, and refresh its card for the new data — instead of silently
// dropping the selection back to the county view.
export function reapplyPrecinctSelection() {
  if (!state.selectedPrecinct || !state.geojsonLayer) return false;
  const code = String(state.selectedPrecinct.PRECINCT);
  let found = null;
  state.geojsonLayer.eachLayer(layer => {
    if (String(layer.feature?.properties?.PRECINCT) === code) found = layer;
  });
  if (!found) {
    // The precinct doesn't exist in this view (e.g. boundary set changed) —
    // drop the stale selection rather than pointing at nothing.
    state.selectedPrecinct = null;
    state.selectedLayer = null;
    return false;
  }
  state.selectedPrecinct = found.feature.properties;
  state.selectedLayer = found;
  found.setStyle(PRECINCT_STYLE.selected);
  found.bringToFront();
  updateInfoCard(found.feature.properties);
  return true;
}

export async function openProfilePanel(precinctCode) {
  // Gap 4: Close other panels first
  closeAllPanels('precinct-profile-panel');
  const panel = document.getElementById('precinct-profile-panel');
  const body = document.getElementById('profile-panel-body');
  panel.classList.add('active');
  panel.setAttribute('aria-hidden', 'false');

  // Gather extra data for richer profile
  const extraData = {};
  const props = state.selectedPrecinct;
  if (props) {
    // Party registration (from DNC Score merge)
    if (props.rep != null) {
      extraData.partyData = {
        rep: props.rep, mod: props.mod, dem: props.dem,
        repShare: props.repShare, modShare: props.modShare, demShare: props.demShare,
        winningParty: props.winningParty, partyStrength: props.partyStrength
      };
    }
    // Racial demographics (from Racial Numbers merge)
    if (props.asian != null) {
      extraData.racialData = {
        asian: props.asian, black: props.black, hispanic: props.hispanic,
        others: props.others, white: props.white, total: props.total,
        pct_asian: props.pct_asian, pct_black: props.pct_black,
        pct_hispanic: props.pct_hispanic, pct_others: props.pct_others, pct_white: props.pct_white
      };
    }
    // District/official info (from GeoJSON native properties)
    extraData.officials = {
      CONG: props.CONG, SEN: props.SEN, SHR: props.SHR, SED: props.SED,
      COMMISH: props.COMMISH, COMMISH_N: props.COMMISH_N, JP_N: props.JP_N,
      CONST_N: props.CONST_N, CONG_N: props.CONG_N, SEN_N: props.SEN_N,
      SHR_N: props.SHR_N, SED_N: props.SED_N
    };
    // Boundary change metadata (2026 view)
    if (props._meta) {
      extraData.boundaryMeta = props._meta;
    }
  }

  // Current election results for this precinct
  if (state.currentElectionData && state.currentElection && state.simulationCandidates) {
    const pCode = String(precinctCode);
    const row = state.currentElectionData.find(r => getRowPrecinctCode(r) === pCode);
    if (row) {
      const result = computePrecinctCandidates(row, state.simulationCandidates);
      if (result) {
        extraData.electionData = {
          electionName: state.currentElection.displayName || state.currentElection.filename,
          candidates: result.candidates,
          totalVotes: result.totalVotes,
          winner: result.winner.name,
          margin: result.margin
        };
      }
    }
  }

  await renderPrecinctProfile(precinctCode, body, extraData);

  // E3: Load and display election history for this precinct
  loadPrecinctElectionHistory(precinctCode, body);

  // Chat with Precinct — intentionally disabled (June 2026 decision:
  // keep the code and deployed Lambda, but no live entry point for now).
  // Re-enable by uncommenting; requires Cognito sign-in on the live site.
  // initPrecinctChat(precinctCode, body, extraData);

  // Gap 6: Update breadcrumbs
  updateBreadcrumbs();
}

async function loadPrecinctElectionHistory(precinctCode, body) {
  if (!state.elections || state.elections.length === 0) return;
  // Build history from currently loaded election and a sample of elections
  const historySection = document.createElement('div');
  historySection.className = 'profile-section';
  historySection.innerHTML = `
    <div class="profile-section-title">Election History</div>
    <div style="text-align:center;padding:12px;color:var(--text-muted);font-size:12px;">Loading history...</div>
  `;
  body.appendChild(historySection);

  try {
    // Load a sample of elections (up to 10 most recent) to build history.
    // Prefer Federal/State contests: the manifest's first entries are often
    // hyperlocal city races (one town's alderman) that most precincts don't
    // vote in, which produced empty histories. Concurrent, not sequential —
    // 10 awaited fetches in series made the panel feel stuck for seconds.
    const major = state.elections.filter(e =>
      e.category === 'Federal' || e.category === 'State');
    const electionsToLoad = (major.length ? major : state.elections).slice(0, 10);
    const loaded = await Promise.all(electionsToLoad.map(entry =>
      loadElectionData(entry).then(data => [entry.filename, data]).catch(() => null)
    ));
    const allElectionData = Object.fromEntries(loaded.filter(Boolean));

    const history = buildVotingHistory(precinctCode, allElectionData);

    if (history.races.length === 0) {
      historySection.innerHTML = `
        <div class="profile-section-title">Election History</div>
        <div style="color:var(--text-muted);font-size:12px;padding:8px 0;">No election history found for this precinct.</div>
      `;
      return;
    }

    let tableHtml = `
      <div class="profile-section-title">Election History (${history.races.length} races)</div>
      <table class="election-history-table">
        <thead><tr><th>Race</th><th>Winner</th><th>Turnout</th></tr></thead>
        <tbody>
    `;
    for (const race of history.races.slice(0, 15)) {
      const party = (race.winningParty || '').toLowerCase();
      const partyClass = party === 'rep' ? 'party-rep' : party === 'dem' ? 'party-dem' : '';
      const turnout = race.registeredVoters > 0
        ? ((race.totalVotes / race.registeredVoters) * 100).toFixed(1) + '%'
        : 'N/A';
      const name = race.raceName.length > 25 ? race.raceName.substring(0, 25) + '...' : race.raceName;
      tableHtml += `<tr><td>${name}</td><td class="${partyClass}">${race.winner}</td><td>${turnout}</td></tr>`;
    }
    tableHtml += '</tbody></table>';
    historySection.innerHTML = tableHtml;
  } catch {
    historySection.innerHTML = `
      <div class="profile-section-title">Election History</div>
      <div style="color:var(--text-muted);font-size:12px;padding:8px 0;">Could not load election history.</div>
    `;
  }
}

export function closeProfilePanel() {
  const panel = document.getElementById('precinct-profile-panel');
  panel.classList.remove('active');
  panel.setAttribute('aria-hidden', 'true');
  // Abort any active chat stream
  if (state.chatCleanup) {
    state.chatCleanup();
    state.chatCleanup = null;
  }
  // Gap 6: Update breadcrumbs
  updateBreadcrumbs();
}

// ==========================================================================
// PRECINCT CHAT INITIALIZATION (kept but intentionally disabled — see
// openProfilePanel; the deployed Lambda backend stays up)
// ==========================================================================

// eslint-disable-next-line no-unused-vars
function initPrecinctChat(precinctCode, body, extraData) {
  // Clean up previous chat
  if (state.chatCleanup) {
    state.chatCleanup();
    state.chatCleanup = null;
  }

  const chatSection = createChatSection();
  body.appendChild(chatSection);

  let healthChecked = false;

  // On first expand, show connected status
  chatSection.addEventListener('chat-expanded', () => {
    if (healthChecked) return;
    healthChecked = true;

    const statusEl = chatSection.querySelector('.chat-status');
    statusEl.style.display = 'block';
    statusEl.textContent = 'Connected to AI';
    statusEl.className = 'chat-status ok';
    setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
  });

  // Build system prompt from available data
  const censusProfile = state.censusProfiles?.[String(precinctCode)] || null;

  // Gather election history (will be populated async)
  const chatData = {
    censusProfile,
    partyData: extraData.partyData || null,
    racialData: extraData.racialData || null,
    officials: extraData.officials || null,
    currentElection: extraData.electionData || null,
    electionHistory: [],
  };

  const systemPrompt = buildSystemPrompt(precinctCode, chatData);

  // Wire up the controller
  state.chatCleanup = initChatController({
    precinctCode,
    chatSection,
    conversationManager: state.chatConversationManager,
    systemPrompt,
    streamChatFn: streamChat,
  });
}

// ==========================================================================
// INFO CARD
// ==========================================================================
const infoCard = document.getElementById('info-card');

export function updateInfoCard(precinctProps) {
  if (!precinctProps) return;

  const title = formatPrecinctLabel(precinctProps);
  const party = precinctProps.winningParty || 'N/A';
  const strength = precinctProps.partyStrength || 'N/A';

  document.querySelector('.info-card-title').textContent = title;
  const partyLabel = party === 'Mod' ? 'Moderate' : party;
  document.querySelector('.info-card-meta').textContent = `${partyLabel} • Strength ${strength}`;

  // If an election is loaded, show candidate votes for this precinct
  let electionStatsHtml = '';
  if (state.currentElectionData && state.simulationCandidates) {
    const pCode = String(precinctProps.PRECINCT);
    const row = state.currentElectionData.find(r => getRowPrecinctCode(r) === pCode);
    if (row) {
      const result = computePrecinctCandidates(row, state.simulationCandidates);
      if (result) {
        const { candidates, winner, margin } = result;
        const sign = margin > 0 ? '+' : '';
        electionStatsHtml = candidates.slice(0, 3).map(c => {
          const isWinner = c === winner;
          const name = c.name.length > 18 ? c.name.substring(0, 18) + '...' : c.name;
          return `<div class="stat-item"><div class="stat-label">${escapeHtml(name)}</div><div class="stat-value">${c.votes.toLocaleString()}${isWinner ? ' ✓' : ''}</div></div>`;
        }).join('');
        electionStatsHtml += `<div class="stat-item"><div class="stat-label">Margin</div><div class="stat-value">${sign}${margin.toLocaleString()}</div></div>`;
      }
    }
  }

  if (electionStatsHtml) {
    document.querySelector('.info-card-stats').innerHTML = electionStatsHtml;
  } else {
    document.querySelector('.info-card-stats').innerHTML = `
      <div class="stat-item">
        <div class="stat-label">Rep</div>
        <div class="stat-value">${precinctProps.rep?.toLocaleString() ?? 'N/A'}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label" title="Moderate / Independent voters">Mod</div>
        <div class="stat-value">${precinctProps.mod?.toLocaleString() ?? 'N/A'}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Dem</div>
        <div class="stat-value">${precinctProps.dem?.toLocaleString() ?? 'N/A'}</div>
      </div>
    `;
  }

  const demoEl = document.querySelector('.info-card-demographics');
  const racialData = buildRacialChartData(precinctProps);
  const partyData = buildPartyChartData(precinctProps);
  let demoHtml = '';

  if (partyData.length > 0) {
    const total = (precinctProps.rep ?? 0) + (precinctProps.mod ?? 0) + (precinctProps.dem ?? 0);
    const pct = (label) => {
      if (precinctProps.repShare != null) {
        if (label === 'Rep') return formatPct(precinctProps.repShare);
        if (label === 'Dem') return formatPct(precinctProps.demShare);
        return formatPct(precinctProps.modShare);
      }
      const val = label === 'Rep' ? precinctProps.rep : label === 'Dem' ? precinctProps.dem : precinctProps.mod;
      return total > 0 ? ((val ?? 0) / total * 100).toFixed(1) + '%' : '0%';
    };
    demoHtml += '<div class="demo-section-title">Party share</div>';
    partyData.forEach(d => {
      demoHtml += `<div class="demo-row"><span>${d.label}</span><span>${pct(d.label)}</span></div>`;
    });
  }
  if (racialData.length > 0) {
    const total = racialData.reduce((s, d) => s + d.value, 0);
    demoHtml += '<div class="demo-section-title" style="margin-top:12px">Racial demographics</div>';
    racialData.forEach(d => {
      const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) + '%' : '0%';
      demoHtml += `<div class="demo-row"><span>${d.label}</span><span>${d.value.toLocaleString()} (${pct})</span></div>`;
    });
  }

  // G8: Add district info
  const districtTags = [];
  if (precinctProps.CONG) districtTags.push(`CD-${escapeHtml(precinctProps.CONG)}`);
  if (precinctProps.COMMISH_N) districtTags.push(`Comm: ${escapeHtml(precinctProps.COMMISH_N)}`);
  if (precinctProps.JP_N) districtTags.push(`JP: ${escapeHtml(precinctProps.JP_N)}`);
  if (districtTags.length > 0) {
    demoHtml += `<div class="info-card-districts">${districtTags.map(t => `<span class="district-tag">${t}</span>`).join('')}</div>`;
  }

  // G9: Add "View Full Profile" button
  demoHtml += `<button class="view-profile-link" id="view-profile-btn">View Full Profile <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 6 15 12 9 18"></polyline></svg></button>`;

  demoEl.innerHTML = demoHtml;

  // G9: Wire up the profile button
  const profileBtn = document.getElementById('view-profile-btn');
  if (profileBtn) {
    profileBtn.addEventListener('click', () => {
      openProfilePanel(precinctProps.PRECINCT);
    });
  }

  infoCard.classList.add('visible');
}

export function updateInfoCardForElection(entry, electionData) {
  document.querySelector('.info-card-title').textContent = entry.displayName || formatElectionName(entry.filename);
  document.querySelector('.info-card-meta').textContent = `${entry.year || ''} • ${entry.category || 'Election'}`;

  // G7: Compute race summary
  const summary = computeRaceSummary(electionData, state.simulationCandidates || []);

  // Coverage honesty: in district/texas views (and partial races anywhere),
  // results may cover only part of the map — say so instead of presenting a
  // partial aggregate as the full result. Units = counties in the texas view.
  const mapUnits = state.geojsonData?.features?.length || 0;
  const first = state.geojsonData?.features?.[0]?.properties;
  const countyUnits = !!first?.COUNTY &&
    !String(first.PRECINCT).includes(':') && !/^\d+$/.test(String(first.PRECINCT));
  const unitLabel = countyUnits ? 'Counties' : 'Precincts';
  const coverage = mapUnits > 0 && summary.activePrecincts < mapUnits
    ? `${summary.activePrecincts} of ${mapUnits}`
    : `${summary.activePrecincts}`;

  // The topline owns the headline (winner, margin %, turnout). The card
  // complements it with the full candidate breakdown — vote bars, ranked.
  const totals = summary.candidateTotals || {};
  const ranked = Object.entries(totals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const totalCand = ranked.reduce((s, [, v]) => s + v, 0) || 1;
  let statsHtml = ranked.slice(0, 5).map(([name, votes]) => {
    const party = extractParty(name);
    const color = (party && PARTY_COLORS[party]) || 'var(--text-muted)';
    // Drop the party prefix and the running mate ("Trump/Vance" → "Trump").
    const disp = (party ? name.replace(/^\S+\s+/, '') : name).split('/')[0].trim();
    const dispShort = disp.length > 24 ? disp.slice(0, 24) + '…' : disp;
    const pct = (votes / totalCand) * 100;
    return `
      <div class="ic-cand">
        <div class="ic-cand-head">
          <span class="ic-cand-name">${escapeHtml(dispShort)}</span>
          <span class="ic-cand-figs">${votes.toLocaleString()}<span class="ic-cand-pct">${pct.toFixed(1)}%</span></span>
        </div>
        <div class="ic-cand-track"><div class="ic-cand-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      </div>`;
  }).join('');
  const turnoutNote = (summary.turnout && summary.turnout !== 'N/A') ? ` · ${escapeHtml(summary.turnout)} turnout` : '';
  statsHtml += `<div class="ic-coverage">${escapeHtml(coverage)} ${escapeHtml(unitLabel.toLowerCase())} reporting${turnoutNote}</div>`;

  document.querySelector('.info-card-stats').innerHTML = statsHtml;
  document.querySelector('.info-card-demographics').innerHTML = '';

  infoCard.classList.add('visible');

  updateResultTopline(entry, summary, unitLabel, coverage, mapUnits);
}

// The prominent, always-visible "so what" headline over the map: where, what
// race, who won, by how much, and turnout. Reuses the same race summary as the
// info card so the two never disagree.
export function updateResultTopline(entry, summary, unitLabel, coverage, mapUnits) {
  const el = document.getElementById('result-topline');
  if (!el) return;

  // County / district name straight from the selector (synchronous + correct
  // for every view: "Collin County", a district name, or "Texas").
  const countySel = document.getElementById('county-select');
  const place = countySel?.selectedOptions?.[0]?.textContent?.trim() || '';
  const race = entry.displayName || formatElectionName(entry.filename);

  // Stat-header layout: hairline-divided cells, quiet eyebrow + hero value.
  const cells = [];
  cells.push(`
    <div class="tl-cell tl-context-cell">
      <span class="tl-eyebrow">${escapeHtml(place || 'Result')}</span>
      <span class="tl-value tl-race">${escapeHtml(race)}</span>
    </div>`);

  if (summary.winner) {
    const party = extractParty(summary.winner);
    const color = (party && PARTY_COLORS[party]) || 'var(--text-primary)';
    // Candidate columns read "<Party> <Name>"; show just the principal's name
    // (drop the party prefix and the running mate after "/").
    const name = (party ? summary.winner.replace(/^\S+\s+/, '') : summary.winner).split('/')[0].trim();
    const display = name.length > 28 ? name.slice(0, 28) + '…' : name;
    const margin = (summary.marginPct && summary.marginPct !== 'N/A')
      ? `<span class="tl-margin">+${escapeHtml(summary.marginPct)}</span>` : '';
    cells.push(`
      <div class="tl-cell">
        <span class="tl-eyebrow">Winner</span>
        <span class="tl-value tl-winner" style="color:${color}">${escapeHtml(display)}${margin}</span>
      </div>`);
  }
  if (summary.turnout && summary.turnout !== 'N/A') {
    cells.push(`
      <div class="tl-cell">
        <span class="tl-eyebrow">Turnout</span>
        <span class="tl-value">${escapeHtml(summary.turnout)}</span>
      </div>`);
  }

  el.innerHTML = cells.join('');
  el.hidden = false;
}

export function hideResultTopline() {
  const el = document.getElementById('result-topline');
  if (el) el.hidden = true;
}

export function showResultTopline() {
  const el = document.getElementById('result-topline');
  if (el && el.innerHTML.trim()) el.hidden = false;
}

export function hideInfoCard() {
  infoCard.classList.remove('visible');
}

// init()-time wiring (called from the page init; kept out of module top level
// to preserve the existing registration profile on the re-init auth path)
export function initProfilePanelControls() {
  // Profile panel close button
  document.getElementById('close-profile-panel').addEventListener('click', closeProfilePanel);

  // E1: Export precinct data button in profile panel header
  document.getElementById('export-precinct-csv').addEventListener('click', () => {
    if (!state.selectedPrecinct) {
      showNotification('No precinct selected');
      return;
    }
    const code = state.selectedPrecinct.PRECINCT;
    const props = state.selectedPrecinct;
    const rows = [{
      'Precinct': code,
      'Winning Party': props.winningParty || '',
      'Party Strength': props.partyStrength || '',
      'Rep Voters': props.rep || 0,
      'Mod Voters': props.mod || 0,
      'Dem Voters': props.dem || 0,
      'Rep Share': props.repShare || 0,
      'Mod Share': props.modShare || 0,
      'Dem Share': props.demShare || 0,
      'Congressional District': props.CONG || '',
      'Commissioner': props.COMMISH_N || '',
      'Justice of Peace': props.JP_N || ''
    }];
    downloadCSV(rows, `precinct_${code}_profile.csv`);
    showNotification(`Precinct ${code} data exported`);
  });
}

export function initInfoCardControls() {
  // Info card close button — hide the card and deselect the precinct
  const infoCardCloseBtn = document.getElementById('info-card-close');
  if (infoCardCloseBtn) {
    infoCardCloseBtn.addEventListener('click', () => {
      if (state.selectedLayer) {
        state.selectedLayer.setStyle({ weight: PRECINCT_STYLE.default.weight });
        state.selectedLayer = null;
        state.selectedPrecinct = null;
      }
      hideInfoCard();
    });
  }
}
