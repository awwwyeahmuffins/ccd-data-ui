// js/electionFilters.js — LEGACY SHIM (deleted in Phase 6, REDESIGN.md §4.2
// move policy). The pure categorization/filter/search functions live in
// js/domain/races.js; existing importers (dataLoader, electionsPage, tests)
// keep working through these re-exports until the last one migrates.
//
// Deleted with Phase 2 (dead code — zero consumers outside their own tests):
// ElectionFilterManager, handleDropdownKeyboard, mergeOverlappingMatches.
// They served the deleted js/app monolith's dropdown UI; the shared
// js/ui/racePicker.js is that UI's replacement and never needed them.

import { ELECTION_CATEGORIES } from "./domain/races.js";

export {
  ELECTION_CATEGORIES,
  categorizeElection,
  categorizeByOffice,
  districtViewSlugForRace,
  filterByCategory,
  filterByYear,
  searchElections,
  getCategoryCounts,
  formatElectionName,
  highlightMatches,
} from "./domain/races.js";

// Chip display order for the elections catalog page (All first; the full
// taxonomy order lives in domain/races.js CATEGORY_ORDER).
export const CATEGORY_ORDER = [
  ELECTION_CATEGORIES.ALL,
  ELECTION_CATEGORIES.FEDERAL,
  ELECTION_CATEGORIES.STATE,
  ELECTION_CATEGORIES.COUNTY,
  ELECTION_CATEGORIES.CITY,
  ELECTION_CATEGORIES.ISD,
  ELECTION_CATEGORIES.MUD
];
