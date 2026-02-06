// precinctChat.js
// --------------------------------------------------------------------------------
// LLM service layer for precinct chat — Ollama API, prompt assembly, streaming,
// conversation state. Abstraction makes it trivial to swap localhost → remote.

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let config = {
  baseUrl: 'http://localhost:11434',
  model: 'llama3.1',
  chatEndpoint: '/api/chat',
  healthEndpoint: '/api/tags',
};

export function configureLLM(overrides) {
  config = { ...config, ...overrides };
}

export function getLLMConfig() {
  return { ...config };
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

export async function checkLLMHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const resp = await fetch(config.baseUrl + config.healthEndpoint, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { ok: false, modelAvailable: false, models: [], reason: `Ollama returned ${resp.status}` };
    }

    const data = await resp.json();
    const models = (data.models || []).map(m => m.name || m.model || '');
    const modelAvailable = models.some(m => m.startsWith(config.model));

    return {
      ok: true,
      modelAvailable,
      models,
      reason: modelAvailable ? null : `Model "${config.model}" not found. Run: ollama pull ${config.model}`,
    };
  } catch (err) {
    const isAbort = err.name === 'AbortError';
    return {
      ok: false,
      modelAvailable: false,
      models: [],
      reason: isAbort
        ? 'Connection timed out. Is Ollama running? Run: ollama serve'
        : `Cannot connect to Ollama. Run: ollama serve`,
    };
  }
}

// ---------------------------------------------------------------------------
// System Prompt Assembly
// ---------------------------------------------------------------------------

export function buildSystemPrompt(precinctCode, data = {}) {
  const lines = [];
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
  const body = {
    model: config.model,
    messages,
    stream: true,
    options: { num_ctx: 8192 },
  };

  let resp;
  try {
    resp = await fetch(config.baseUrl + config.chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    onError?.(err);
    return;
  }

  if (!resp.ok) {
    onError?.(new Error(`Ollama returned ${resp.status}`));
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Ollama sends newline-delimited JSON
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.message?.content) {
            fullText += chunk.message.content;
            onToken?.(chunk.message.content);
          }
          if (chunk.done) {
            onDone?.(fullText);
            return;
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer);
        if (chunk.message?.content) {
          fullText += chunk.message.content;
          onToken?.(chunk.message.content);
        }
      } catch {
        // skip
      }
    }

    onDone?.(fullText);
  } catch (err) {
    if (err.name === 'AbortError') {
      onDone?.(fullText);
    } else {
      onError?.(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Conversation Manager
// ---------------------------------------------------------------------------

const MAX_MESSAGES_PER_PRECINCT = 20;

export class ConversationManager {
  constructor() {
    this._conversations = new Map();
  }

  addUserMessage(precinctCode, content) {
    const msgs = this._getOrCreate(precinctCode);
    msgs.push({ role: 'user', content });
    this._trim(precinctCode);
  }

  addAssistantMessage(precinctCode, content) {
    const msgs = this._getOrCreate(precinctCode);
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
    const msgs = this.getMessages(precinctCode);
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
    const msgs = this._conversations.get(key);
    if (msgs && msgs.length > MAX_MESSAGES_PER_PRECINCT) {
      this._conversations.set(key, msgs.slice(msgs.length - MAX_MESSAGES_PER_PRECINCT));
    }
  }
}
