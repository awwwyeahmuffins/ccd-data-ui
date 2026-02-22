// precinctChat.js
// --------------------------------------------------------------------------------
// LLM service layer for precinct chat — Bedrock via API Gateway, prompt assembly,
// conversation state.

import { getApiConfig } from './authConfig.js';
import { getIdToken } from './auth.js';

// ---------------------------------------------------------------------------
// Configuration (kept for backward compat — configureLLM/getLLMConfig are no-ops)
// ---------------------------------------------------------------------------

export function configureLLM() {}
export function getLLMConfig() { return {}; }

// ---------------------------------------------------------------------------
// Health Check — Bedrock is a managed service, always available
// ---------------------------------------------------------------------------

export async function checkLLMHealth() {
  return { ok: true, modelAvailable: true, models: ['bedrock'], reason: null };
}

// ---------------------------------------------------------------------------
// System Prompt Assembly
// ---------------------------------------------------------------------------

export function buildSystemPrompt(precinctCode, data = {}) {
  let lines = [];
  lines.push(`You are a helpful analyst for Collin County, Texas voting Precinct ${precinctCode}.`);
  lines.push('Answer questions using ONLY the data provided below. If a question cannot be answered from the data, say so.');
  lines.push('Keep answers concise — 2-4 sentences unless the user asks for detail.');
  lines.push('');

  // Census Profile
  const cp = data.censusProfile;
  if (cp) {
    lines.push('=== Census Profile ===');
    if (cp.population != null) lines.push(`Population: ${cp.population}`);
    if (cp.households?.total != null) lines.push(`Households: ${cp.households.total}, avg size ${cp.households.averageSize ?? 'N/A'}`);
    if (cp.age?.medianAge != null) lines.push(`Median Age: ${cp.age.medianAge}`);
    if (cp.gender) lines.push(`Gender: ${pct(cp.gender.male)} male, ${pct(cp.gender.female)} female`);
    if (cp.income?.medianHousehold != null) lines.push(`Median Household Income: $${cp.income.medianHousehold.toLocaleString()}`);
    if (cp.income?.povertyRate != null) lines.push(`Poverty Rate: ${pct(cp.income.povertyRate)}`);
    if (cp.education) {
      lines.push(`Education: ${pct(cp.education.highSchoolOrLess)} HS or less, ${pct(cp.education.someCollege)} some college, ${pct(cp.education.bachelors)} bachelors, ${pct(cp.education.graduateProfessional)} graduate`);
    }
    if (cp.housing) {
      lines.push(`Housing: median home $${(cp.housing.medianHomeValue || 0).toLocaleString()}, median rent $${(cp.housing.medianRent || 0).toLocaleString()}, ${pct(cp.housing.ownerOccupied)} owner-occupied`);
    }
    if (cp.language) {
      lines.push(`Language: ${pct(cp.language.englishOnly)} English only, ${pct(cp.language.spanish)} Spanish, ${pct(cp.language.asianLanguages)} Asian languages`);
    }
    if (cp.commute) {
      lines.push(`Commute: ${cp.commute.meanCommuteMinutes?.toFixed(1) ?? 'N/A'} min avg, ${pct(cp.commute.workedFromHome)} WFH`);
    }
    if (cp.employment?.topOccupations?.length) {
      lines.push(`Top Occupations: ${cp.employment.topOccupations.map(o => `${o.name} (${pct(o.share)})`).join(', ')}`);
    }
    if (cp.employment?.topIndustries?.length) {
      lines.push(`Top Industries: ${cp.employment.topIndustries.map(o => `${o.name} (${pct(o.share)})`).join(', ')}`);
    }
    if (cp.veterans?.share != null) lines.push(`Veterans: ${pct(cp.veterans.share)}`);
    if (cp.insurance?.insured != null) lines.push(`Insured: ${pct(cp.insurance.insured)}`);
    lines.push('');
  }

  // Party Registration
  const pd = data.partyData;
  if (pd) {
    lines.push('=== Party Registration ===');
    lines.push(`Republican: ${pd.rep} (${pct(pd.repShare)})`);
    lines.push(`Moderate: ${pd.mod} (${pct(pd.modShare)})`);
    lines.push(`Democrat: ${pd.dem} (${pct(pd.demShare)})`);
    if (pd.winningParty) lines.push(`Leans: ${pd.winningParty} (strength ${pd.partyStrength ?? 'N/A'}/3)`);
    lines.push('');
  }

  // Racial Demographics
  const rd = data.racialData;
  if (rd) {
    lines.push('=== Racial Demographics ===');
    lines.push(`White: ${rd.white} (${pct(rd.pct_white)})`);
    lines.push(`Asian: ${rd.asian} (${pct(rd.pct_asian)})`);
    lines.push(`Hispanic: ${rd.hispanic} (${pct(rd.pct_hispanic)})`);
    lines.push(`Black: ${rd.black} (${pct(rd.pct_black)})`);
    lines.push(`Others: ${rd.others} (${pct(rd.pct_others)})`);
    lines.push('');
  }

  // District Officials
  const off = data.officials;
  if (off) {
    lines.push('=== District Officials ===');
    if (off.CONG != null) lines.push(`US Congress: District ${off.CONG}${off.CONG_N ? ' — ' + off.CONG_N : ''}`);
    if (off.SEN != null) lines.push(`TX Senate: District ${off.SEN}${off.SEN_N ? ' — ' + off.SEN_N : ''}`);
    if (off.SHR != null) lines.push(`TX House: District ${off.SHR}${off.SHR_N ? ' — ' + off.SHR_N : ''}`);
    if (off.SED != null) lines.push(`State Board of Ed: District ${off.SED}${off.SED_N ? ' — ' + off.SED_N : ''}`);
    if (off.COMMISH != null) lines.push(`Commissioner: Precinct ${off.COMMISH}${off.COMMISH_N ? ' — ' + off.COMMISH_N : ''}`);
    if (off.JP_N) lines.push(`Justice of Peace: ${off.JP_N}`);
    if (off.CONST_N) lines.push(`Constable: ${off.CONST_N}`);
    lines.push('');
  }

  // Election History
  const eh = data.electionHistory;
  if (eh && eh.length > 0) {
    lines.push('=== Election History ===');
    for (const race of eh.slice(0, 15)) {
      const turnout = race.registeredVoters > 0
        ? ((race.totalVotes / race.registeredVoters) * 100).toFixed(1) + '%'
        : 'N/A';
      lines.push(`${race.raceName}: Winner ${race.winner} (${race.winningParty || '?'}), ${race.totalVotes} votes, turnout ${turnout}`);
    }
    lines.push('');
  }

  // Current Election
  const ce = data.currentElection;
  if (ce) {
    lines.push('=== Current Election ===');
    lines.push(`Race: ${ce.electionName}`);
    if (ce.candidates) {
      for (const c of ce.candidates) {
        lines.push(`  ${c.name}: ${c.votes} votes`);
      }
    }
    if (ce.winner) lines.push(`Winner: ${ce.winner}, margin ${ce.margin}`);
    lines.push('');
  }

  return lines.join('\n');
}

function pct(v) {
  if (v == null || isNaN(v)) return 'N/A';
  return (v * 100).toFixed(1) + '%';
}

// ---------------------------------------------------------------------------
// Streaming Chat
// ---------------------------------------------------------------------------

export async function streamChat(messages, { onToken, onDone, onError, signal } = {}) {
  const { chatEndpoint } = getApiConfig();

  let token;
  try {
    token = await getIdToken();
  } catch (err) {
    window.dispatchEvent(new CustomEvent('auth-expired'));
    onError?.(new Error('Authentication expired. Please sign in again.'));
    return;
  }

  let resp;
  try {
    resp = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    onError?.(err);
    return;
  }

  if (resp.status === 401) {
    window.dispatchEvent(new CustomEvent('auth-expired'));
    onError?.(new Error('Session expired. Please sign in again.'));
    return;
  }

  if (!resp.ok) {
    onError?.(new Error(`Chat API returned ${resp.status}`));
    return;
  }

  try {
    let data = await resp.json();
    const fullText = data.message?.content || '';
    onToken?.(fullText);
    onDone?.(fullText);
  } catch (err) {
    onError?.(err);
  }
}

// ---------------------------------------------------------------------------
// Conversation Manager
// ---------------------------------------------------------------------------

const MAX_MESSAGES_PER_PRECINCT = 20;

export class ConversationManager {
  constructor() {
    /** @type {Map<string, Array>} */
    this._conversations = new Map();
  }

  addUserMessage(precinctCode, content) {
    let msgs = this._getOrCreate(precinctCode);
    msgs.push({ role: 'user', content });
    this._trim(precinctCode);
  }

  addAssistantMessage(precinctCode, content) {
    let msgs = this._getOrCreate(precinctCode);
    msgs.push({ role: 'assistant', content });
    this._trim(precinctCode);
  }

  getMessages(precinctCode) {
    return this._conversations.get(String(precinctCode)) || [];
  }

  clear(precinctCode) {
    this._conversations.delete(String(precinctCode));
  }

  clearAll() {
    this._conversations.clear();
  }

  buildFullMessages(precinctCode, systemPrompt) {
    let msgs = this.getMessages(precinctCode);
    return [{ role: 'system', content: systemPrompt }, ...msgs];
  }

  _getOrCreate(precinctCode) {
    const key = String(precinctCode);
    if (!this._conversations.has(key)) {
      this._conversations.set(key, []);
    }
    return this._conversations.get(key);
  }

  _trim(precinctCode) {
    const key = String(precinctCode);
    let msgs = this._conversations.get(key);
    if (msgs && msgs.length > MAX_MESSAGES_PER_PRECINCT) {
      this._conversations.set(key, msgs.slice(msgs.length - MAX_MESSAGES_PER_PRECINCT));
    }
  }
}
