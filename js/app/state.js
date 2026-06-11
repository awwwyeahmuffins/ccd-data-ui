// state.js
// --------------------------------------------------------------------------------
// The single shared mutable state object for the map viewer (index.html).
// Every js/app/ module imports this directly; there is no other app-level state.
//
// Rule for js/app/ modules: never CALL an imported binding at module top level —
// top-level code may only declare, look up its own DOM elements, and register
// listeners using locally defined handlers. (Keeps the function-level import
// cycles between app modules safe.)

import { ConversationManager } from "../precinctChat.js";

export const state = {
  map: null,
  tileLayer: null,
  geojsonLayer: null,
  geojsonData: null,
  labelCleanup: null,
  labelsVisible: false,
  dncLookup: null,
  racialLookup: null,
  elections: [],
  filteredElections: [],
  currentElection: null,
  currentElectionData: null,
  selectedPrecinct: null,
  selectedLayer: null,
  recentlyViewed: [],
  viewMode: 'demographics', // 'demographics' | 'election' | 'turnout'
  electionColorMode: 'party', // 'party' | 'margin'
  heatmapMetric: null, // null = party lean, or a HEATMAP_METRICS id
  censusProfiles: null,
  simulationResult: null,
  sliderState: null,
  voterFlipState: null,
  dncDataByPrecinct: null,
  simulationCandidates: null,
  filters: {
    search: '',
    year: null,
    category: 'All'
  },
  commandSelectedIndex: 0,
  commands: [],
  chatConversationManager: new ConversationManager(),
  chatCleanup: null,
  activeElectionTab: 'browse', // Gap 5: 'browse' | 'forecast' | 'saved'
};
