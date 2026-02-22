// simulatorPresets.js
// ===================
// Scenario presets for the turnout simulator.
// Each preset defines turnout multipliers and optional voter flip rates.

export const SIMULATOR_PRESETS = [
  { id: 'baseline', label: 'Baseline', description: 'Current turnout levels', turnout: { Rep: 1.0, Dem: 1.0, Mod: 1.0 }, flips: {} },
  { id: 'dem-surge', label: 'Dem Surge (+20%)', description: 'Strong Democratic turnout', turnout: { Rep: 1.0, Dem: 1.2, Mod: 1.0 }, flips: {} },
  { id: 'rep-surge', label: 'Rep Surge (+20%)', description: 'Strong Republican turnout', turnout: { Rep: 1.2, Dem: 1.0, Mod: 1.0 }, flips: {} },
  { id: 'suburban-shift', label: 'Suburban Revolt', description: 'Suburban areas shift Dem', turnout: { Rep: 1.0, Dem: 1.1, Mod: 1.0 }, flips: { 'Rep_to_Dem': 0.10 } },
  { id: 'low-turnout', label: 'Low Turnout', description: 'Depressed turnout across the board', turnout: { Rep: 0.7, Dem: 0.7, Mod: 0.7 }, flips: {} },
  { id: 'max-mobilize', label: 'Max Mobilization', description: 'Maximum Dem turnout effort', turnout: { Rep: 1.0, Dem: 1.5, Mod: 1.0 }, flips: {} }
];

// Map preset flip keys (underscore format) to internal flip keys (arrow format)
const FLIP_KEY_MAP = {
  'Rep_to_Dem': 'Rep\u2192Dem',
  'Rep_to_Mod': 'Rep\u2192Mod',
  'Dem_to_Rep': 'Dem\u2192Rep',
  'Dem_to_Mod': 'Dem\u2192Mod',
  'Mod_to_Rep': 'Mod\u2192Rep',
  'Mod_to_Dem': 'Mod\u2192Dem'
};

/**
 * Generate HTML for the preset selector row.
 *
 * @param {string|null} activePresetId - Currently active preset ID, or null
 * @returns {string} HTML string with pill buttons for each preset
 */
export function generatePresetSelectorHTML(activePresetId = null) {
  let buttons = '';
  for (let preset of SIMULATOR_PRESETS) {
    let activeClass = preset.id === activePresetId ? ' active' : '';
    buttons += `<button class="preset-btn${activeClass}" data-preset-id="${preset.id}" title="${preset.description}">${preset.label}</button>`;
  }
  return `<div class="simulator-presets">${buttons}</div>`;
}

/**
 * Apply a preset to slider and voter flip state managers.
 *
 * @param {string} presetId - The preset ID to apply
 * @param {Object} sliderState - Slider state manager (with setValue)
 * @param {Object} voterFlipState - Voter flip state manager (with setRate, reset)
 * @returns {boolean} True if preset was found and applied, false otherwise
 */
export function applyPreset(presetId, sliderState, voterFlipState) {
  let preset = SIMULATOR_PRESETS.find(function findPreset(p) { return p.id === presetId; });
  if (!preset) {
    return false;
  }

  // Set turnout multipliers
  for (let [party, value] of Object.entries(preset.turnout)) {
    sliderState.setValue(party, value);
  }

  // Reset flip state first, then apply preset flips
  voterFlipState.reset();
  for (let [flipKey, rate] of Object.entries(preset.flips)) {
    let internalKey = FLIP_KEY_MAP[flipKey] || flipKey;
    voterFlipState.setRate(internalKey, rate);
  }

  return true;
}
