import { SIMULATOR_PRESETS, generatePresetSelectorHTML, applyPreset } from './simulatorPresets.js';

describe('SIMULATOR_PRESETS', () => {
  test('all presets have valid multiplier ranges (between 0.5 and 2.0)', () => {
    for (let preset of SIMULATOR_PRESETS) {
      for (let [party, value] of Object.entries(preset.turnout)) {
        expect(value).toBeGreaterThanOrEqual(0.5);
        expect(value).toBeLessThanOrEqual(2.0);
      }
    }
  });

  test('all presets have required fields', () => {
    for (let preset of SIMULATOR_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.label).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.turnout).toBeDefined();
      expect(preset.flips).toBeDefined();
    }
  });
});

describe('generatePresetSelectorHTML', () => {
  test('generates a button for each preset', () => {
    let html = generatePresetSelectorHTML();
    for (let preset of SIMULATOR_PRESETS) {
      expect(html).toContain('data-preset-id="' + preset.id + '"');
      expect(html).toContain(preset.label);
    }
  });

  test('marks active preset with active class', () => {
    let html = generatePresetSelectorHTML('dem-surge');
    // The dem-surge button should have the active class
    expect(html).toContain('class="preset-btn active" data-preset-id="dem-surge"');
  });

  test('no button has active class when activePresetId is null', () => {
    let html = generatePresetSelectorHTML(null);
    expect(html).not.toContain('active');
  });

  test('wraps buttons in simulator-presets container', () => {
    let html = generatePresetSelectorHTML();
    expect(html).toContain('class="simulator-presets"');
  });
});

describe('applyPreset', () => {
  let mockSliderState;
  let mockVoterFlipState;

  beforeEach(() => {
    mockSliderState = {
      values: { Rep: 1.0, Dem: 1.0, Mod: 1.0 },
      setValue(party, value) { this.values[party] = value; },
      getAll() { return { ...this.values }; }
    };
    mockVoterFlipState = {
      rates: {},
      resetCalled: false,
      setRate(key, value) { this.rates[key] = value; },
      reset() { this.resetCalled = true; this.rates = {}; },
      getAll() { return { ...this.rates }; }
    };
  });

  test('returns false for unknown preset ID', () => {
    let result = applyPreset('nonexistent', mockSliderState, mockVoterFlipState);
    expect(result).toBe(false);
  });

  test('returns true for valid preset ID', () => {
    let result = applyPreset('baseline', mockSliderState, mockVoterFlipState);
    expect(result).toBe(true);
  });

  test('sets correct turnout values on sliderState for dem-surge', () => {
    applyPreset('dem-surge', mockSliderState, mockVoterFlipState);
    expect(mockSliderState.values.Rep).toBe(1.0);
    expect(mockSliderState.values.Dem).toBe(1.2);
    expect(mockSliderState.values.Mod).toBe(1.0);
  });

  test('sets correct turnout values on sliderState for low-turnout', () => {
    applyPreset('low-turnout', mockSliderState, mockVoterFlipState);
    expect(mockSliderState.values.Rep).toBe(0.7);
    expect(mockSliderState.values.Dem).toBe(0.7);
    expect(mockSliderState.values.Mod).toBe(0.7);
  });

  test('resets voterFlipState before applying flips', () => {
    applyPreset('suburban-shift', mockSliderState, mockVoterFlipState);
    expect(mockVoterFlipState.resetCalled).toBe(true);
  });

  test('sets voter flip rates for suburban-shift preset', () => {
    applyPreset('suburban-shift', mockSliderState, mockVoterFlipState);
    // The suburban-shift preset has Rep_to_Dem: 0.10, which maps to Rep→Dem
    expect(mockVoterFlipState.rates['Rep\u2192Dem']).toBe(0.10);
  });

  test('baseline preset sets all turnout to 1.0 with no flips', () => {
    // First set some non-baseline values
    mockSliderState.values = { Rep: 0.8, Dem: 1.3, Mod: 0.6 };
    applyPreset('baseline', mockSliderState, mockVoterFlipState);
    expect(mockSliderState.values.Rep).toBe(1.0);
    expect(mockSliderState.values.Dem).toBe(1.0);
    expect(mockSliderState.values.Mod).toBe(1.0);
  });

  test('max-mobilize preset sets Dem to 1.5', () => {
    applyPreset('max-mobilize', mockSliderState, mockVoterFlipState);
    expect(mockSliderState.values.Dem).toBe(1.5);
    expect(mockSliderState.values.Rep).toBe(1.0);
  });
});
