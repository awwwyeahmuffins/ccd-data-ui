// precinctLayer.test.js
// Unit tests for precinct layer tooltip functionality
// Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js precinctLayer.test.js

import { describe, it, expect, beforeEach } from '@jest/globals';

// ============================================================================
// MOCK IMPLEMENTATIONS FOR TESTING
// These mirror the actual implementations we'll create in precinctLayer.js
// ============================================================================

/**
 * Get turnout level class based on percentage
 * @param {number} turnout - Turnout percentage (0-100)
 * @returns {string} CSS class name: 'low', 'medium', or 'high'
 */
function getTurnoutClass(turnout) {
  if (turnout == null || isNaN(turnout)) return 'low';
  if (turnout < 40) return 'low';
  if (turnout < 60) return 'medium';
  return 'high';
}

/**
 * Generate enhanced tooltip HTML content
 * @param {Object} properties - Feature properties from GeoJSON
 * @param {Object} options - Additional options
 * @param {number} options.turnout - Current turnout percentage
 * @param {number} options.countyAverage - County average turnout for comparison
 * @param {boolean} options.isFlipped - Whether this precinct flipped in simulation
 * @param {string} options.viewType - Current view type: 'demographics', 'election', 'turnout'
 * @returns {string} HTML string for tooltip content
 */
function generateEnhancedTooltip(properties, options = {}) {
  if (!properties || typeof properties !== 'object') {
    return '';
  }

  const {
    turnout = null,
    countyAverage = null,
    isFlipped = false,
    viewType = 'demographics'
  } = options;

  const precinctCode = properties.PRECINCT || 'Unknown';
  
  // Base content
  let html = `<strong>Precinct ${precinctCode}</strong>`;

  // Add view-specific content
  switch (viewType) {
    case 'demographics':
      html += generateDemographicsTooltipContent(properties);
      break;
    case 'election':
      html += generateElectionTooltipContent(properties, { isFlipped });
      break;
    case 'turnout':
      html += generateTurnoutTooltipContent(properties, { turnout, countyAverage, isFlipped });
      break;
    default:
      html += generateDemographicsTooltipContent(properties);
  }

  return html;
}

/**
 * Generate demographics-specific tooltip content
 * @param {Object} properties - Feature properties
 * @returns {string} HTML string
 */
function generateDemographicsTooltipContent(properties) {
  const repPct = formatShare(properties.repShare);
  const demPct = formatShare(properties.demShare);
  const modPct = formatShare(properties.modShare);
  const winningParty = properties.winningParty || 'Unknown';
  const strength = properties.partyStrength || 1;

  return `
    <div class="tooltip-row">
      <span class="tooltip-label">Party Lean:</span>
      <span class="tooltip-value winner-highlight ${winningParty.toLowerCase()}">${winningParty}</span>
    </div>
    <div class="tooltip-mini-chart" aria-label="Party breakdown: Rep ${repPct}%, Mod ${modPct}%, Dem ${demPct}%">
      <div class="mini-bar rep" style="width: ${repPct}%"></div>
      <div class="mini-bar mod" style="width: ${modPct}%"></div>
      <div class="mini-bar dem" style="width: ${demPct}%"></div>
    </div>
    <div class="tooltip-row">
      <span class="tooltip-label">Strength:</span>
      <span class="tooltip-value">${strength}/3</span>
    </div>
  `.trim();
}

/**
 * Generate election-specific tooltip content
 * @param {Object} properties - Feature properties
 * @param {Object} options - Options including isFlipped
 * @returns {string} HTML string
 */
function generateElectionTooltipContent(properties, options = {}) {
  const { isFlipped = false } = options;
  const winner = properties.winningCandidate || properties.winningParty || 'Unknown';
  const winningParty = properties.winningParty || '';
  
  let html = `
    <div class="tooltip-row">
      <span class="tooltip-label">Winner:</span>
      <span class="tooltip-value winner-highlight ${winningParty.toLowerCase()}">${winner}</span>
    </div>
  `.trim();

  // Add flipped indicator if applicable
  if (isFlipped) {
    html += `<div class="flipped-indicator">⚡ Flipped</div>`;
  }

  return html;
}

/**
 * Generate turnout-specific tooltip content
 * @param {Object} properties - Feature properties
 * @param {Object} options - Options including turnout, countyAverage, isFlipped
 * @returns {string} HTML string
 */
function generateTurnoutTooltipContent(properties, options = {}) {
  const { turnout = null, countyAverage = null, isFlipped = false } = options;
  
  let html = '';

  if (turnout != null && !isNaN(turnout)) {
    const turnoutClass = getTurnoutClass(turnout);
    html += `
    <div class="tooltip-row">
      <span class="tooltip-label">Turnout:</span>
      <span class="tooltip-value turnout-badge ${turnoutClass}">${turnout.toFixed(1)}%</span>
    </div>
    `.trim();

    // Add comparison to county average if available
    if (countyAverage != null && !isNaN(countyAverage)) {
      const diff = turnout - countyAverage;
      const diffClass = diff >= 0 ? 'positive' : 'negative';
      const diffSign = diff >= 0 ? '+' : '';
      
      html += `
    <div class="tooltip-row">
      <span class="tooltip-label">vs County:</span>
      <span class="tooltip-value ${diffClass}">${diffSign}${diff.toFixed(1)}%</span>
    </div>
      `.trim();
    }
  } else {
    html += `
    <div class="tooltip-row">
      <span class="tooltip-label">Turnout:</span>
      <span class="tooltip-value">No Data</span>
    </div>
    `.trim();
  }

  // Add flipped indicator if applicable
  if (isFlipped) {
    html += `<div class="flipped-indicator">⚡ Flipped</div>`;
  }

  return html;
}

/**
 * Format share value as percentage
 * @param {number} share - Share value (0-1)
 * @returns {string} Formatted percentage without % sign
 */
function formatShare(share) {
  if (share == null || isNaN(share)) return '0';
  return (share * 100).toFixed(0);
}

/**
 * Calculate comparison data for tooltip
 * @param {number} value - Current value
 * @param {number} baseline - Baseline value to compare against
 * @returns {Object} { diff, diffClass, diffSign }
 */
function calculateComparison(value, baseline) {
  if (value == null || baseline == null || isNaN(value) || isNaN(baseline)) {
    return { diff: 0, diffClass: '', diffSign: '' };
  }
  
  const diff = value - baseline;
  const diffClass = diff >= 0 ? 'positive' : 'negative';
  const diffSign = diff >= 0 ? '+' : '';
  
  return { diff, diffClass, diffSign };
}

// ============================================================================
// TESTS FOR getTurnoutClass
// ============================================================================

describe('getTurnoutClass', () => {
  it('should return "low" for turnout below 40%', () => {
    expect(getTurnoutClass(0)).toBe('low');
    expect(getTurnoutClass(20)).toBe('low');
    expect(getTurnoutClass(39.9)).toBe('low');
  });

  it('should return "medium" for turnout between 40% and 60%', () => {
    expect(getTurnoutClass(40)).toBe('medium');
    expect(getTurnoutClass(50)).toBe('medium');
    expect(getTurnoutClass(59.9)).toBe('medium');
  });

  it('should return "high" for turnout 60% and above', () => {
    expect(getTurnoutClass(60)).toBe('high');
    expect(getTurnoutClass(75)).toBe('high');
    expect(getTurnoutClass(100)).toBe('high');
  });

  it('should return "low" for null/undefined/NaN', () => {
    expect(getTurnoutClass(null)).toBe('low');
    expect(getTurnoutClass(undefined)).toBe('low');
    expect(getTurnoutClass(NaN)).toBe('low');
  });
});

// ============================================================================
// TESTS FOR formatShare
// ============================================================================

describe('formatShare', () => {
  it('should convert share to percentage without decimals', () => {
    expect(formatShare(0.5)).toBe('50');
    expect(formatShare(0.333)).toBe('33');
    expect(formatShare(1)).toBe('100');
    expect(formatShare(0)).toBe('0');
  });

  it('should round to nearest integer', () => {
    expect(formatShare(0.456)).toBe('46');
    expect(formatShare(0.454)).toBe('45');
  });

  it('should return "0" for invalid values', () => {
    expect(formatShare(null)).toBe('0');
    expect(formatShare(undefined)).toBe('0');
    expect(formatShare(NaN)).toBe('0');
  });
});

// ============================================================================
// TESTS FOR calculateComparison
// ============================================================================

describe('calculateComparison', () => {
  it('should calculate positive difference correctly', () => {
    const result = calculateComparison(60, 50);
    expect(result.diff).toBe(10);
    expect(result.diffClass).toBe('positive');
    expect(result.diffSign).toBe('+');
  });

  it('should calculate negative difference correctly', () => {
    const result = calculateComparison(40, 50);
    expect(result.diff).toBe(-10);
    expect(result.diffClass).toBe('negative');
    expect(result.diffSign).toBe('');
  });

  it('should handle zero difference', () => {
    const result = calculateComparison(50, 50);
    expect(result.diff).toBe(0);
    expect(result.diffClass).toBe('positive');
    expect(result.diffSign).toBe('+');
  });

  it('should handle invalid inputs', () => {
    const result = calculateComparison(null, 50);
    expect(result.diff).toBe(0);
    expect(result.diffClass).toBe('');
    expect(result.diffSign).toBe('');
  });
});

// ============================================================================
// TESTS FOR generateEnhancedTooltip
// ============================================================================

describe('generateEnhancedTooltip', () => {
  const mockProperties = {
    PRECINCT: '1234',
    winningParty: 'Rep',
    partyStrength: 2,
    repShare: 0.55,
    demShare: 0.30,
    modShare: 0.15,
    winningCandidate: 'John Smith'
  };

  describe('input validation', () => {
    it('should return empty string for null properties', () => {
      expect(generateEnhancedTooltip(null)).toBe('');
    });

    it('should return empty string for undefined properties', () => {
      expect(generateEnhancedTooltip(undefined)).toBe('');
    });

    it('should return empty string for non-object properties', () => {
      expect(generateEnhancedTooltip('string')).toBe('');
      expect(generateEnhancedTooltip(123)).toBe('');
    });
  });

  describe('base content', () => {
    it('should include precinct code in strong tag', () => {
      const result = generateEnhancedTooltip(mockProperties);
      expect(result).toContain('<strong>Precinct 1234</strong>');
    });

    it('should handle missing precinct code', () => {
      const result = generateEnhancedTooltip({});
      expect(result).toContain('Precinct Unknown');
    });
  });

  describe('demographics view', () => {
    it('should show party lean and mini chart', () => {
      const result = generateEnhancedTooltip(mockProperties, { viewType: 'demographics' });
      
      expect(result).toContain('Party Lean:');
      expect(result).toContain('Rep');
      expect(result).toContain('tooltip-mini-chart');
      expect(result).toContain('mini-bar rep');
      expect(result).toContain('mini-bar dem');
      expect(result).toContain('mini-bar mod');
    });

    it('should show party strength', () => {
      const result = generateEnhancedTooltip(mockProperties, { viewType: 'demographics' });
      expect(result).toContain('Strength:');
      expect(result).toContain('2/3');
    });

    it('should include aria-label for mini chart accessibility', () => {
      const result = generateEnhancedTooltip(mockProperties, { viewType: 'demographics' });
      expect(result).toContain('aria-label="Party breakdown');
    });
  });

  describe('election view', () => {
    it('should show winner', () => {
      const result = generateEnhancedTooltip(mockProperties, { viewType: 'election' });
      expect(result).toContain('Winner:');
      expect(result).toContain('John Smith');
    });

    it('should show flipped indicator when isFlipped is true', () => {
      const result = generateEnhancedTooltip(mockProperties, { 
        viewType: 'election', 
        isFlipped: true 
      });
      expect(result).toContain('flipped-indicator');
      expect(result).toContain('Flipped');
    });

    it('should NOT show flipped indicator when isFlipped is false', () => {
      const result = generateEnhancedTooltip(mockProperties, { 
        viewType: 'election', 
        isFlipped: false 
      });
      expect(result).not.toContain('flipped-indicator');
    });
  });

  describe('turnout view', () => {
    it('should show turnout with badge', () => {
      const result = generateEnhancedTooltip(mockProperties, { 
        viewType: 'turnout',
        turnout: 65.5
      });
      expect(result).toContain('Turnout:');
      expect(result).toContain('65.5%');
      expect(result).toContain('turnout-badge');
      expect(result).toContain('high');
    });

    it('should show comparison to county average when provided', () => {
      const result = generateEnhancedTooltip(mockProperties, { 
        viewType: 'turnout',
        turnout: 65,
        countyAverage: 55
      });
      expect(result).toContain('vs County:');
      expect(result).toContain('+10.0%');
      expect(result).toContain('positive');
    });

    it('should show negative comparison correctly', () => {
      const result = generateEnhancedTooltip(mockProperties, { 
        viewType: 'turnout',
        turnout: 45,
        countyAverage: 55
      });
      expect(result).toContain('-10.0%');
      expect(result).toContain('negative');
    });

    it('should show "No Data" when turnout is not available', () => {
      const result = generateEnhancedTooltip(mockProperties, { 
        viewType: 'turnout',
        turnout: null
      });
      expect(result).toContain('No Data');
    });

    it('should show flipped indicator when isFlipped is true', () => {
      const result = generateEnhancedTooltip(mockProperties, { 
        viewType: 'turnout',
        turnout: 50,
        isFlipped: true 
      });
      expect(result).toContain('flipped-indicator');
    });
  });

  describe('default view behavior', () => {
    it('should default to demographics view when viewType not specified', () => {
      const result = generateEnhancedTooltip(mockProperties);
      expect(result).toContain('Party Lean:');
      expect(result).toContain('tooltip-mini-chart');
    });

    it('should default to demographics view for unknown viewType', () => {
      const result = generateEnhancedTooltip(mockProperties, { viewType: 'unknown' });
      expect(result).toContain('Party Lean:');
    });
  });
});

// ============================================================================
// TESTS FOR generateDemographicsTooltipContent
// ============================================================================

describe('generateDemographicsTooltipContent', () => {
  it('should generate valid demographics content', () => {
    const properties = {
      repShare: 0.40,
      demShare: 0.35,
      modShare: 0.25,
      winningParty: 'Rep',
      partyStrength: 1
    };
    
    const result = generateDemographicsTooltipContent(properties);
    
    expect(result).toContain('tooltip-mini-chart');
    expect(result).toContain('width: 40%');
    expect(result).toContain('width: 35%');
    expect(result).toContain('width: 25%');
  });

  it('should handle missing share values', () => {
    const properties = {};
    const result = generateDemographicsTooltipContent(properties);
    
    expect(result).toContain('width: 0%');
    expect(result).toContain('Unknown');
  });
});

// ============================================================================
// TESTS FOR generateElectionTooltipContent
// ============================================================================

describe('generateElectionTooltipContent', () => {
  it('should show winning candidate name', () => {
    const properties = {
      winningCandidate: 'Jane Doe',
      winningParty: 'Dem'
    };
    
    const result = generateElectionTooltipContent(properties);
    expect(result).toContain('Jane Doe');
    expect(result).toContain('dem');
  });

  it('should fall back to winning party when no candidate name', () => {
    const properties = {
      winningParty: 'Rep'
    };
    
    const result = generateElectionTooltipContent(properties);
    expect(result).toContain('Rep');
  });
});

// ============================================================================
// TESTS FOR generateTurnoutTooltipContent
// ============================================================================

describe('generateTurnoutTooltipContent', () => {
  const properties = { PRECINCT: '1234' };

  it('should classify low turnout correctly', () => {
    const result = generateTurnoutTooltipContent(properties, { turnout: 30 });
    expect(result).toContain('turnout-badge low');
  });

  it('should classify medium turnout correctly', () => {
    const result = generateTurnoutTooltipContent(properties, { turnout: 50 });
    expect(result).toContain('turnout-badge medium');
  });

  it('should classify high turnout correctly', () => {
    const result = generateTurnoutTooltipContent(properties, { turnout: 70 });
    expect(result).toContain('turnout-badge high');
  });

  it('should omit county comparison when not provided', () => {
    const result = generateTurnoutTooltipContent(properties, { turnout: 50 });
    expect(result).not.toContain('vs County:');
  });

  it('should include county comparison when provided', () => {
    const result = generateTurnoutTooltipContent(properties, { 
      turnout: 50,
      countyAverage: 45
    });
    expect(result).toContain('vs County:');
    expect(result).toContain('+5.0%');
  });
});
