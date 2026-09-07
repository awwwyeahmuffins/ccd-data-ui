// v3Pivot.js
// --------------------------------------------------------------------------------
// Pure transforms for the v3 normalized election data format (DATA_LAYOUT_SPEC v3).
//
// v3 stores races in long form (precinct,party,candidate,votes) with turnout in
// separate per-election files (precinct,registered,ballots_cast,blank). The app
// (simulator, margin view, exports, profiles) consumes the LEGACY in-memory row
// shape — one object per precinct with "<PARTY> <Candidate>" vote columns and
// turnout columns inline. pivotRace() rebuilds that shape at load time, and
// computeWinners() derives the winner columns the legacy files used to store.
//
// All values stay STRINGS, matching what the legacy CSV parser produced.

// Reserved pseudo-candidate rows in v3 race files (party is empty for these).
// They pivot back to the legacy special columns.
const RESERVED_ROWS = {
  'write-in': 'Write-in',
  'over votes': 'OVER VOTES',
  'under votes': 'UNDER VOTES',
};

// Columns that are never candidates (mirror of the legacy metadata set in
// electionSchema.CSV_SCHEMA / unified_parser CANONICAL_*_COLS)
const META_COLUMNS = new Set([
  'COUNTY NUMBER', 'PRECINCT CODE', 'PRECINCT NAME',
  'REGISTERED VOTERS TOTAL', 'BALLOTS CAST TOTAL', 'BALLOTS CAST BLANK',
  'Write-in', 'OVER VOTES', 'UNDER VOTES', 'Winning Candidate', 'Winning Party',
  'Tie',
]);

/**
 * Pivot a v3 long race file (+ optional turnout file) into legacy row objects.
 *
 * @param {Array<{precinct,party,candidate,votes}>} longRows - parsed race CSV rows
 * @param {Array<{precinct,registered,ballots_cast,blank}>|null} turnoutRows
 * @returns {Array<Object>} one row per precinct in the legacy in-memory shape
 */
export function pivotRace(longRows, turnoutRows) {
  const turnoutByPrecinct = {};
  for (const t of turnoutRows || []) {
    turnoutByPrecinct[String(t.precinct).trim()] = t;
  }

  // Group candidate values per precinct, preserving honest gaps as ''
  const byPrecinct = new Map(); // precinct -> { specials: {}, candidates: {} }
  for (const r of longRows || []) {
    const precinct = String(r.precinct ?? '').trim();
    if (!precinct) continue;
    if (!byPrecinct.has(precinct)) {
      byPrecinct.set(precinct, { specials: {}, candidates: {} });
    }
    const rec = byPrecinct.get(precinct);
    const party = String(r.party ?? '').trim();
    const candidate = String(r.candidate ?? '').trim();
    const votes = String(r.votes ?? '').trim();

    const reserved = party === '' ? RESERVED_ROWS[candidate.toLowerCase()] : undefined;
    if (reserved) {
      rec.specials[reserved] = votes;
    } else if (candidate) {
      const col = party ? `${party} ${candidate}` : candidate;
      rec.candidates[col] = votes;
    }
  }

  // Candidate columns sorted alphabetically — the legacy canonical order
  // (unified_parser.ensure_canonical_columns sorts them the same way)
  const allCandidateCols = [...new Set(
    [...byPrecinct.values()].flatMap(rec => Object.keys(rec.candidates))
  )].sort();
  const hasWriteIn = [...byPrecinct.values()].some(rec => 'Write-in' in rec.specials);
  const hasOver = [...byPrecinct.values()].some(rec => 'OVER VOTES' in rec.specials);
  const hasUnder = [...byPrecinct.values()].some(rec => 'UNDER VOTES' in rec.specials);

  const rows = [];
  for (const [precinct, rec] of byPrecinct) {
    const t = turnoutByPrecinct[precinct] || {};
    const row = {
      'PRECINCT CODE': precinct,
      'REGISTERED VOTERS TOTAL': String(t.registered ?? '').trim(),
      'BALLOTS CAST TOTAL': String(t.ballots_cast ?? '').trim(),
      'BALLOTS CAST BLANK': String(t.blank ?? '').trim(),
    };
    if (hasWriteIn) row['Write-in'] = rec.specials['Write-in'] ?? '0';
    for (const col of allCandidateCols) {
      row[col] = rec.candidates[col] ?? '0';
    }
    if (hasOver) row['OVER VOTES'] = rec.specials['OVER VOTES'] ?? '0';
    if (hasUnder) row['UNDER VOTES'] = rec.specials['UNDER VOTES'] ?? '0';
    rows.push(row);
  }

  // Stable precinct order (numeric where possible, like the legacy files)
  rows.sort((a, b) => {
    const na = Number(a['PRECINCT CODE']), nb = Number(b['PRECINCT CODE']);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a['PRECINCT CODE'] < b['PRECINCT CODE'] ? -1 : 1;
  });
  return rows;
}

/**
 * Derive 'Winning Candidate' / 'Winning Party' for each row — exact mirror of
 * data_processor/unified_parser.compute_winning_candidate: candidate columns
 * (excluding metadata and Write-in) in ALPHABETICAL order, winner is the FIRST
 * maximum, party is the first whitespace token of the winning column name.
 * Mutates and returns the rows.
 *
 * First-max means an exact tie is silently awarded to whichever candidate sorts
 * first — and because "DEM …" sorts before "REP …", every Rep/Dem tie in the
 * shipped data reports as a Democratic win. There are 239 such precinct-races.
 * We keep the first-max pick (blanking the winner would repaint a genuine
 * 794–794 tie as "no data", a different wrong answer) and set a 'Tie' flag
 * beside it so the map, the readout and the history record can say "tied"
 * instead of naming a winner that does not exist.
 */
export function computeWinners(rows) {
  if (!rows.length) return rows;
  const candidateCols = Object.keys(rows[0])
    .filter(c => !META_COLUMNS.has(c))
    .sort();

  for (const row of rows) {
    if (candidateCols.length === 0) {
      row['Winning Candidate'] = '';
      row['Winning Party'] = '';
      row['Tie'] = false;
      continue;
    }
    let winner = candidateCols[0];
    let best = Number(row[winner]) || 0;
    let tied = false;
    for (const col of candidateCols.slice(1)) {
      const v = Number(row[col]) || 0;
      if (v > best) { best = v; winner = col; tied = false; }
      else if (v === best) { tied = true; }
    }
    row['Winning Candidate'] = winner;
    row['Winning Party'] = winner.split(/\s+/)[0] || '';
    // A precinct where nobody got a vote is empty, not tied.
    row['Tie'] = tied && best > 0;
  }
  return rows;
}
