// legendController.test.js
// Unit tests for legend controller functionality
// Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js legendController.test.js

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ============================================================================
// MOCK IMPLEMENTATIONS FOR TESTING
// These mirror the actual implementations we'll create in legendController.js
// ============================================================================

/**
 * Generate legend HTML content for a specific view type
 * @param {string} viewType - 'demographics', 'election', or 'turnout'
 * @param {Object} options - Optional configuration
 * @returns {string} HTML string for the legend content
 */
function generateLegendContent(viewType, options = {}) {
  if (!viewType || typeof viewType !== 'string') {
    return '';
  }

  switch (viewType) {
    case 'demographics':
      return generateDemographicsLegend();
    case 'election':
      return generateElectionLegend(options);
    case 'turnout':
      return generateTurnoutLegend(options);
    default:
      return '';
  }
}

/**
 * Generate demographics view legend
 */
function generateDemographicsLegend() {
  return `
    <h4 class="legend-title">Party Lean</h4>
    <div class="legend-items">
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-rep"></span>
        <span class="legend-label">Republican</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-dem"></span>
        <span class="legend-label">Democrat</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-mod"></span>
        <span class="legend-label">Moderate</span>
      </div>
    </div>
    <p class="legend-note">Color intensity indicates strength</p>
  `.trim();
}

/**
 * Generate election view legend
 * @param {Object} options - Configuration options
 * @param {boolean} options.showSimulationFlipped - Whether to show flipped precinct indicator
 * @param {number} options.flippedCount - Number of flipped precincts (if simulation active)
 */
function generateElectionLegend(options = {}) {
  const { showSimulationFlipped = false, flippedCount = 0 } = options;
  
  let html = `
    <h4 class="legend-title">Election Results</h4>
    <div class="legend-items">
      <div class="legend-item">
        <span class="legend-swatch" style="background: #E81B23"></span>
        <span class="legend-label">Republican</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: #00AEF3"></span>
        <span class="legend-label">Democrat</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: #2ECC71"></span>
        <span class="legend-label">For/Passed</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background: #E74C3C"></span>
        <span class="legend-label">Against/Failed</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-no-data"></span>
        <span class="legend-label">Not in Race</span>
      </div>
    </div>
  `.trim();

  // Add flipped precinct indicator when simulation is active
  if (showSimulationFlipped) {
    html += `
    <div class="legend-divider"></div>
    <div class="legend-simulation-section">
      <h5 class="legend-subtitle">Simulation Active</h5>
      <div class="legend-item legend-flipped-item">
        <span class="legend-swatch legend-swatch-flipped"></span>
        <span class="legend-label">Flipped Precinct${flippedCount !== 1 ? 's' : ''}</span>
        ${flippedCount > 0 ? `<span class="legend-count">${flippedCount}</span>` : ''}
      </div>
    </div>
    `.trim();
  }

  return html;
}

/**
 * Generate turnout view legend with gradient bar
 * @param {Object} options - Configuration options
 * @param {number} options.minTurnout - Minimum turnout percentage to show
 * @param {number} options.maxTurnout - Maximum turnout percentage to show
 * @param {boolean} options.showSimulationFlipped - Whether to show flipped precinct indicator
 * @param {number} options.flippedCount - Number of flipped precincts
 */
function generateTurnoutLegend(options = {}) {
  const { 
    minTurnout = 0, 
    maxTurnout = 100, 
    showSimulationFlipped = false, 
    flippedCount = 0 
  } = options;

  let html = `
    <h4 class="legend-title">Voter Turnout</h4>
    <div class="legend-gradient-container">
      <div class="legend-gradient-bar" aria-label="Turnout gradient from ${minTurnout}% to ${maxTurnout}%"></div>
      <div class="legend-gradient-labels">
        <span>${minTurnout}%</span>
        <span>${Math.round((minTurnout + maxTurnout) / 2)}%</span>
        <span>${maxTurnout}%</span>
      </div>
    </div>
    <div class="legend-items">
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-low-turnout"></span>
        <span class="legend-label">Low Turnout</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-medium-turnout"></span>
        <span class="legend-label">Medium</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-high-turnout"></span>
        <span class="legend-label">High Turnout</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch-no-data"></span>
        <span class="legend-label">No Data</span>
      </div>
    </div>
  `.trim();

  // Add flipped precinct indicator when simulation is active
  if (showSimulationFlipped) {
    html += `
    <div class="legend-divider"></div>
    <div class="legend-simulation-section">
      <h5 class="legend-subtitle">Simulation Active</h5>
      <div class="legend-item legend-flipped-item">
        <span class="legend-swatch legend-swatch-flipped"></span>
        <span class="legend-label">Flipped Precinct${flippedCount !== 1 ? 's' : ''}</span>
        ${flippedCount > 0 ? `<span class="legend-count">${flippedCount}</span>` : ''}
      </div>
    </div>
    `.trim();
  }

  return html;
}

/**
 * Check if the legend indicates simulation is active
 * @param {string} legendContent - HTML content of the legend
 * @returns {boolean}
 */
function hasSimulationIndicator(legendContent) {
  return legendContent.includes('legend-simulation-section') && 
         legendContent.includes('Simulation Active');
}

/**
 * Check if the legend has a gradient bar
 * @param {string} legendContent - HTML content of the legend
 * @returns {boolean}
 */
function hasGradientBar(legendContent) {
  return legendContent.includes('legend-gradient-bar') && 
         legendContent.includes('legend-gradient-labels');
}

/**
 * Extract flipped count from legend content
 * @param {string} legendContent - HTML content of the legend
 * @returns {number|null}
 */
function extractFlippedCount(legendContent) {
  const match = legendContent.match(/legend-count">(\d+)</);
  return match ? parseInt(match[1], 10) : null;
}

// ============================================================================
// TESTS FOR generateLegendContent
// ============================================================================

describe('generateLegendContent', () => {
  describe('input validation', () => {
    it('should return empty string for null viewType', () => {
      expect(generateLegendContent(null)).toBe('');
    });

    it('should return empty string for undefined viewType', () => {
      expect(generateLegendContent(undefined)).toBe('');
    });

    it('should return empty string for invalid viewType', () => {
      expect(generateLegendContent('invalid')).toBe('');
      expect(generateLegendContent(123)).toBe('');
      expect(generateLegendContent({})).toBe('');
    });

    it('should return empty string for empty string viewType', () => {
      expect(generateLegendContent('')).toBe('');
    });
  });

  describe('demographics view', () => {
    it('should generate valid demographics legend', () => {
      const result = generateLegendContent('demographics');
      
      expect(result).toContain('Party Lean');
      expect(result).toContain('Republican');
      expect(result).toContain('Democrat');
      expect(result).toContain('Moderate');
      expect(result).toContain('legend-swatch-rep');
      expect(result).toContain('legend-swatch-dem');
      expect(result).toContain('legend-swatch-mod');
    });

    it('should include intensity note', () => {
      const result = generateLegendContent('demographics');
      expect(result).toContain('Color intensity indicates strength');
    });

    it('should NOT show simulation indicator by default', () => {
      const result = generateLegendContent('demographics');
      expect(hasSimulationIndicator(result)).toBe(false);
    });
  });

  describe('election view', () => {
    it('should generate valid election legend', () => {
      const result = generateLegendContent('election');
      
      expect(result).toContain('Election Results');
      expect(result).toContain('Republican');
      expect(result).toContain('Democrat');
      expect(result).toContain('For/Passed');
      expect(result).toContain('Against/Failed');
      expect(result).toContain('Not in Race');
    });

    it('should include party colors', () => {
      const result = generateLegendContent('election');
      expect(result).toContain('#E81B23'); // Republican red
      expect(result).toContain('#00AEF3'); // Democrat blue
      expect(result).toContain('#2ECC71'); // For/Passed green
      expect(result).toContain('#E74C3C'); // Against/Failed red
    });

    it('should NOT show simulation indicator by default', () => {
      const result = generateLegendContent('election');
      expect(hasSimulationIndicator(result)).toBe(false);
    });

    it('should show simulation indicator when showSimulationFlipped is true', () => {
      const result = generateLegendContent('election', { showSimulationFlipped: true });
      expect(hasSimulationIndicator(result)).toBe(true);
      expect(result).toContain('legend-swatch-flipped');
    });

    it('should show flipped precinct count when provided', () => {
      const result = generateLegendContent('election', { 
        showSimulationFlipped: true, 
        flippedCount: 5 
      });
      expect(extractFlippedCount(result)).toBe(5);
    });

    it('should use singular "Precinct" when count is 1', () => {
      const result = generateLegendContent('election', { 
        showSimulationFlipped: true, 
        flippedCount: 1 
      });
      expect(result).toContain('Flipped Precinct<');
      expect(result).not.toContain('Flipped Precincts');
    });

    it('should use plural "Precincts" when count is not 1', () => {
      const result = generateLegendContent('election', { 
        showSimulationFlipped: true, 
        flippedCount: 3 
      });
      expect(result).toContain('Flipped Precincts');
    });
  });

  describe('turnout view', () => {
    it('should generate valid turnout legend', () => {
      const result = generateLegendContent('turnout');
      
      expect(result).toContain('Voter Turnout');
      expect(result).toContain('Low Turnout');
      expect(result).toContain('Medium');
      expect(result).toContain('High Turnout');
      expect(result).toContain('No Data');
    });

    it('should include gradient bar', () => {
      const result = generateLegendContent('turnout');
      expect(hasGradientBar(result)).toBe(true);
    });

    it('should show default turnout range (0-100%)', () => {
      const result = generateLegendContent('turnout');
      expect(result).toContain('0%');
      expect(result).toContain('50%');
      expect(result).toContain('100%');
    });

    it('should show custom turnout range when provided', () => {
      const result = generateLegendContent('turnout', { 
        minTurnout: 20, 
        maxTurnout: 80 
      });
      expect(result).toContain('20%');
      expect(result).toContain('50%'); // midpoint
      expect(result).toContain('80%');
    });

    it('should include aria-label for gradient bar accessibility', () => {
      const result = generateLegendContent('turnout', { 
        minTurnout: 10, 
        maxTurnout: 90 
      });
      expect(result).toContain('aria-label="Turnout gradient from 10% to 90%"');
    });

    it('should show simulation indicator when showSimulationFlipped is true', () => {
      const result = generateLegendContent('turnout', { showSimulationFlipped: true });
      expect(hasSimulationIndicator(result)).toBe(true);
    });

    it('should show flipped count in turnout legend', () => {
      const result = generateLegendContent('turnout', { 
        showSimulationFlipped: true, 
        flippedCount: 7 
      });
      expect(extractFlippedCount(result)).toBe(7);
    });
  });
});

// ============================================================================
// TESTS FOR hasSimulationIndicator helper
// ============================================================================

describe('hasSimulationIndicator', () => {
  it('should return false for empty content', () => {
    expect(hasSimulationIndicator('')).toBe(false);
  });

  it('should return false for content without simulation section', () => {
    const content = '<div class="legend-items">Test</div>';
    expect(hasSimulationIndicator(content)).toBe(false);
  });

  it('should return true when simulation section is present', () => {
    const content = '<div class="legend-simulation-section"><h5>Simulation Active</h5></div>';
    expect(hasSimulationIndicator(content)).toBe(true);
  });

  it('should return false if only one indicator is present', () => {
    expect(hasSimulationIndicator('<div class="legend-simulation-section"></div>')).toBe(false);
    expect(hasSimulationIndicator('<h5>Simulation Active</h5>')).toBe(false);
  });
});

// ============================================================================
// TESTS FOR hasGradientBar helper
// ============================================================================

describe('hasGradientBar', () => {
  it('should return false for empty content', () => {
    expect(hasGradientBar('')).toBe(false);
  });

  it('should return false for content without gradient elements', () => {
    const content = '<div class="legend-items">Test</div>';
    expect(hasGradientBar(content)).toBe(false);
  });

  it('should return true when both gradient bar and labels are present', () => {
    const content = '<div class="legend-gradient-bar"></div><div class="legend-gradient-labels"></div>';
    expect(hasGradientBar(content)).toBe(true);
  });

  it('should return false if only one element is present', () => {
    expect(hasGradientBar('<div class="legend-gradient-bar"></div>')).toBe(false);
    expect(hasGradientBar('<div class="legend-gradient-labels"></div>')).toBe(false);
  });
});

// ============================================================================
// TESTS FOR extractFlippedCount helper
// ============================================================================

describe('extractFlippedCount', () => {
  it('should return null for empty content', () => {
    expect(extractFlippedCount('')).toBe(null);
  });

  it('should return null when no count is present', () => {
    const content = '<div class="legend-item">No count here</div>';
    expect(extractFlippedCount(content)).toBe(null);
  });

  it('should extract count when present', () => {
    const content = '<span class="legend-count">42</span>';
    expect(extractFlippedCount(content)).toBe(42);
  });

  it('should extract single digit count', () => {
    const content = '<span class="legend-count">5</span>';
    expect(extractFlippedCount(content)).toBe(5);
  });

  it('should extract large count', () => {
    const content = '<span class="legend-count">999</span>';
    expect(extractFlippedCount(content)).toBe(999);
  });
});

// ============================================================================
// TESTS FOR updateLegend (DOM manipulation)
// ============================================================================

describe('updateLegend DOM integration', () => {
  let legendContainer;

  // Function to test (uses the actual DOM)
  function updateLegend(viewType, options = {}) {
    const container = document.getElementById('map-legend');
    if (!container) return false;

    const content = generateLegendContent(viewType, options);
    if (!content) return false;

    container.innerHTML = content;

    // Add/remove simulation class
    if (options.showSimulationFlipped) {
      container.classList.add('simulation-active');
    } else {
      container.classList.remove('simulation-active');
    }

    return true;
  }

  beforeEach(() => {
    // Create real DOM element
    legendContainer = document.createElement('div');
    legendContainer.id = 'map-legend';
    document.body.appendChild(legendContainer);
    
    // Spy on classList methods
    jest.spyOn(legendContainer.classList, 'add');
    jest.spyOn(legendContainer.classList, 'remove');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('should return false when container not found', () => {
    document.body.innerHTML = ''; // Remove the container
    expect(updateLegend('demographics')).toBe(false);
  });

  it('should return false for invalid viewType', () => {
    expect(updateLegend('invalid')).toBe(false);
  });

  it('should update innerHTML for valid viewType', () => {
    updateLegend('demographics');
    expect(legendContainer.innerHTML).toContain('Party Lean');
  });

  it('should add simulation-active class when simulation is active', () => {
    updateLegend('election', { showSimulationFlipped: true });
    expect(legendContainer.classList.add).toHaveBeenCalledWith('simulation-active');
  });

  it('should remove simulation-active class when simulation is not active', () => {
    updateLegend('election', { showSimulationFlipped: false });
    expect(legendContainer.classList.remove).toHaveBeenCalledWith('simulation-active');
  });

  it('should return true on successful update', () => {
    expect(updateLegend('turnout')).toBe(true);
  });
});
