// sidebarTemplates.test.js
// Unit tests for sidebar template functions (Workstream 2)
// Run with: npm test -- sidebarTemplates.test.js

import { describe, it, expect } from '@jest/globals';
import {
  createCard,
  createCardWithSubtitle,
  createStatGrid,
  createDivider,
  precinctInfoCard,
  ICONS,
  // Empty state templates (Phase 2 - WS2)
  emptySearchResultsHTML,
  clickPrecinctPromptHTML,
  noDataAvailableHTML,
  errorStateHTML
} from './sidebarTemplates.js';

// ============================================================================
// TESTS FOR createCard
// ============================================================================

describe('createCard', () => {
  describe('basic rendering', () => {
    it('should render a card with title and content', () => {
      const result = createCard('Test Title', null, '<p>Test content</p>');
      
      expect(result).toContain('ui-card');
      expect(result).toContain('Test Title');
      expect(result).toContain('<p>Test content</p>');
    });

    it('should render a card with icon when provided', () => {
      const icon = '<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z"/></svg>';
      const result = createCard('With Icon', icon, '<p>Content</p>');
      
      expect(result).toContain('ui-card-icon');
      expect(result).toContain(icon);
    });

    it('should not render icon container when icon is null', () => {
      const result = createCard('No Icon', null, '<p>Content</p>');
      
      expect(result).not.toContain('ui-card-icon');
    });

    it('should include proper HTML structure', () => {
      const result = createCard('Structure Test', null, '<p>Body</p>');
      
      expect(result).toContain('ui-card-header');
      expect(result).toContain('ui-card-title');
      expect(result).toContain('ui-card-body');
    });
  });

  describe('options handling', () => {
    it('should apply custom color class to icon', () => {
      const icon = '<svg></svg>';
      const result = createCard('Colored', icon, 'Content', { colorClass: 'green' });
      
      expect(result).toContain('ui-card-icon green');
    });

    it('should default to blue color class', () => {
      const icon = '<svg></svg>';
      const result = createCard('Default Color', icon, 'Content');
      
      expect(result).toContain('ui-card-icon blue');
    });

    it('should apply collapsed class when collapsed option is true', () => {
      const result = createCard('Collapsed', null, 'Content', { collapsed: true });
      
      expect(result).toContain('ui-card collapsed');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for null title', () => {
      const result = createCard(null, null, 'Content');
      
      expect(result).toBe('');
    });

    it('should return empty string for undefined title', () => {
      const result = createCard(undefined, null, 'Content');
      
      expect(result).toBe('');
    });

    it('should return empty string for empty title', () => {
      const result = createCard('', null, 'Content');
      
      expect(result).toBe('');
    });

    it('should return empty string for non-string title', () => {
      const result = createCard(123, null, 'Content');
      
      expect(result).toBe('');
    });

    it('should handle empty content gracefully', () => {
      const result = createCard('Empty Content', null, '');
      
      expect(result).toContain('ui-card');
      expect(result).toContain('ui-card-body');
    });

    it('should handle null content gracefully', () => {
      const result = createCard('Null Content', null, null);
      
      expect(result).toContain('ui-card');
    });

    it('should handle undefined content gracefully', () => {
      const result = createCard('Undefined Content', null, undefined);
      
      expect(result).toContain('ui-card');
    });
  });

  describe('HTML escaping considerations', () => {
    it('should allow HTML content in body', () => {
      const htmlContent = '<ul><li>Item 1</li><li>Item 2</li></ul>';
      const result = createCard('HTML Body', null, htmlContent);
      
      expect(result).toContain(htmlContent);
    });
  });
});

// ============================================================================
// TESTS FOR createStatGrid
// ============================================================================

describe('createStatGrid', () => {
  describe('basic rendering', () => {
    it('should render a stat grid with multiple items', () => {
      const stats = [
        { label: 'Total Votes', value: '10,000' },
        { label: 'Turnout', value: '65%' }
      ];
      const result = createStatGrid(stats);
      
      expect(result).toContain('stat-grid');
      expect(result).toContain('stat-item');
      expect(result).toContain('Total Votes');
      expect(result).toContain('10,000');
      expect(result).toContain('Turnout');
      expect(result).toContain('65%');
    });

    it('should render proper structure for each stat item', () => {
      const stats = [{ label: 'Test', value: '100' }];
      const result = createStatGrid(stats);
      
      expect(result).toContain('stat-value');
      expect(result).toContain('stat-label');
    });

    it('should handle single stat item', () => {
      const stats = [{ label: 'Single', value: '42' }];
      const result = createStatGrid(stats);
      
      expect(result).toContain('stat-grid');
      expect(result).toContain('42');
    });
  });

  describe('styling options', () => {
    it('should apply color class to value when provided', () => {
      const stats = [
        { label: 'Winner', value: 'Republican', colorClass: 'winner-rep' }
      ];
      const result = createStatGrid(stats);
      
      expect(result).toContain('stat-value winner-rep');
    });

    it('should not add extra class when colorClass is not provided', () => {
      const stats = [{ label: 'Plain', value: '100' }];
      const result = createStatGrid(stats);
      
      expect(result).toContain('class="stat-value"');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for null input', () => {
      const result = createStatGrid(null);
      
      expect(result).toBe('');
    });

    it('should return empty string for undefined input', () => {
      const result = createStatGrid(undefined);
      
      expect(result).toBe('');
    });

    it('should return empty string for empty array', () => {
      const result = createStatGrid([]);
      
      expect(result).toBe('');
    });

    it('should return empty string for non-array input', () => {
      const result = createStatGrid({ label: 'Object', value: '100' });
      
      expect(result).toBe('');
    });

    it('should filter out invalid stat objects', () => {
      const stats = [
        { label: 'Valid', value: '100' },
        null,
        { label: 'Missing Value' },
        { value: 'Missing Label' },
        { label: 'Also Valid', value: '200' }
      ];
      const result = createStatGrid(stats);
      
      expect(result).toContain('Valid');
      expect(result).toContain('100');
      expect(result).toContain('Also Valid');
      expect(result).toContain('200');
      // Invalid items should be filtered
      expect(result).not.toContain('Missing Value');
      expect(result).not.toContain('Missing Label');
    });

    it('should handle value of 0 correctly', () => {
      const stats = [{ label: 'Zero', value: 0 }];
      const result = createStatGrid(stats);
      
      expect(result).toContain('stat-grid');
      expect(result).toContain('0');
    });

    it('should handle empty string value', () => {
      const stats = [{ label: 'Empty', value: '' }];
      const result = createStatGrid(stats);
      
      expect(result).toContain('stat-grid');
      expect(result).toContain('Empty');
    });
  });

  describe('numeric values', () => {
    it('should handle numeric values directly', () => {
      const stats = [
        { label: 'Count', value: 1500 },
        { label: 'Percentage', value: 75.5 }
      ];
      const result = createStatGrid(stats);
      
      expect(result).toContain('1500');
      expect(result).toContain('75.5');
    });
  });
});

// ============================================================================
// TESTS FOR createDivider
// ============================================================================

describe('createDivider', () => {
  it('should render a basic divider without label', () => {
    const result = createDivider();
    
    expect(result).toContain('ui-divider');
    expect(result).not.toContain('ui-divider-label');
  });

  it('should render a divider with label when provided', () => {
    const result = createDivider('Section Title');
    
    expect(result).toContain('ui-divider');
    expect(result).toContain('ui-divider-label');
    expect(result).toContain('Section Title');
  });

  it('should handle empty string as no label', () => {
    const result = createDivider('');
    
    expect(result).toContain('ui-divider');
    expect(result).not.toContain('ui-divider-label');
  });
});

// ============================================================================
// TESTS FOR createCardWithSubtitle
// ============================================================================

describe('createCardWithSubtitle', () => {
  it('should render card with title and subtitle', () => {
    const result = createCardWithSubtitle(
      'Main Title',
      'This is a subtitle',
      null,
      '<p>Content</p>'
    );
    
    expect(result).toContain('Main Title');
    expect(result).toContain('This is a subtitle');
    expect(result).toContain('ui-card-subtitle');
  });

  it('should render card without subtitle when subtitle is null', () => {
    const result = createCardWithSubtitle('Title Only', null, null, '<p>Content</p>');
    
    expect(result).toContain('Title Only');
    expect(result).not.toContain('ui-card-subtitle');
  });

  it('should render card without subtitle when subtitle is empty', () => {
    const result = createCardWithSubtitle('Title Only', '', null, '<p>Content</p>');
    
    expect(result).toContain('Title Only');
    expect(result).not.toContain('ui-card-subtitle');
  });

  it('should include icon when provided', () => {
    const icon = '<svg></svg>';
    const result = createCardWithSubtitle('With Icon', 'Subtitle', icon, 'Content');
    
    expect(result).toContain('ui-card-icon');
    expect(result).toContain(icon);
  });

  it('should apply color class to icon', () => {
    const icon = '<svg></svg>';
    const result = createCardWithSubtitle(
      'Colored',
      'Subtitle',
      icon,
      'Content',
      { colorClass: 'purple' }
    );
    
    expect(result).toContain('ui-card-icon purple');
  });

  it('should return empty string for invalid title', () => {
    expect(createCardWithSubtitle(null, 'Sub', null, 'Content')).toBe('');
    expect(createCardWithSubtitle('', 'Sub', null, 'Content')).toBe('');
    expect(createCardWithSubtitle(123, 'Sub', null, 'Content')).toBe('');
  });
});

// ============================================================================
// INTEGRATION TESTS - Composing templates together
// ============================================================================

describe('template composition', () => {
  it('should allow nesting stat grid inside a card', () => {
    const stats = [
      { label: 'Votes', value: '5,000' },
      { label: 'Turnout', value: '72%' }
    ];
    const statGridHtml = createStatGrid(stats);
    const cardHtml = createCard('Precinct Stats', null, statGridHtml);
    
    expect(cardHtml).toContain('ui-card');
    expect(cardHtml).toContain('stat-grid');
    expect(cardHtml).toContain('Precinct Stats');
    expect(cardHtml).toContain('5,000');
  });

  it('should create a complete sidebar section with card and divider', () => {
    const card = createCard('Section 1', null, '<p>First section content</p>');
    const divider = createDivider('More Details');
    const card2 = createCard('Section 2', null, '<p>Second section</p>');
    
    const combined = card + divider + card2;
    
    expect(combined).toContain('Section 1');
    expect(combined).toContain('More Details');
    expect(combined).toContain('Section 2');
    // Count only the opening card containers (class="ui-card" not ui-card-header, ui-card-body, etc.)
    expect((combined.match(/<div class="ui-card">/g) || []).length).toBe(2);
  });
});

// ============================================================================
// TESTS FOR EMPTY STATE ILLUSTRATIONS (Phase 2 - Workstream 2)
// ============================================================================

describe('emptySearchResultsHTML', () => {
  it('should render empty search results illustration', () => {
    const result = emptySearchResultsHTML();
    
    expect(result).toContain('empty-illustration');
    expect(result).toContain('empty-icon');
    expect(result).toContain('<svg');
  });

  it('should display "No elections found" heading', () => {
    const result = emptySearchResultsHTML();
    
    expect(result).toContain('No elections found');
  });

  it('should include helpful suggestion text', () => {
    const result = emptySearchResultsHTML();
    
    expect(result).toContain('Try adjusting your search');
  });

  it('should include h4 heading element', () => {
    const result = emptySearchResultsHTML();
    
    expect(result).toContain('<h4>');
    expect(result).toContain('</h4>');
  });

  it('should include paragraph element', () => {
    const result = emptySearchResultsHTML();
    
    expect(result).toContain('<p>');
    expect(result).toContain('</p>');
  });
});

describe('clickPrecinctPromptHTML', () => {
  it('should render precinct selection prompt', () => {
    const result = clickPrecinctPromptHTML();
    
    expect(result).toContain('empty-illustration');
    expect(result).toContain('empty-icon');
  });

  it('should display "Select a Precinct" heading', () => {
    const result = clickPrecinctPromptHTML();
    
    expect(result).toContain('Select a Precinct');
  });

  it('should include instructions for user interaction', () => {
    const result = clickPrecinctPromptHTML();
    
    expect(result).toContain('Click on any precinct');
  });

  it('should include an SVG map/location icon', () => {
    const result = clickPrecinctPromptHTML();
    
    expect(result).toContain('<svg');
    expect(result).toContain('viewBox');
  });
});

describe('noDataAvailableHTML', () => {
  it('should render no data available state with precinct code', () => {
    const result = noDataAvailableHTML('PCT-123');
    
    expect(result).toContain('empty-illustration');
    expect(result).toContain('PCT-123');
  });

  it('should display "No Data Available" heading', () => {
    const result = noDataAvailableHTML('123');
    
    expect(result).toContain('No Data Available');
  });

  it('should include message about non-participation', () => {
    const result = noDataAvailableHTML('456');
    
    expect(result).toContain('did not participate');
  });

  it('should handle numeric precinct codes', () => {
    const result = noDataAvailableHTML(789);
    
    expect(result).toContain('789');
  });

  it('should include document-style SVG icon', () => {
    const result = noDataAvailableHTML('TEST');
    
    expect(result).toContain('<svg');
    expect(result).toContain('</svg>');
  });
});

describe('errorStateHTML', () => {
  it('should render error state with custom message', () => {
    const result = errorStateHTML('Connection failed', 'retryLoad()');
    
    expect(result).toContain('empty-illustration');
    expect(result).toContain('error');
    expect(result).toContain('Connection failed');
  });

  it('should display "Something went wrong" heading', () => {
    const result = errorStateHTML('Test error', 'retry()');
    
    expect(result).toContain('Something went wrong');
  });

  it('should include retry button with action', () => {
    const result = errorStateHTML('Error message', 'handleRetry()');
    
    expect(result).toContain('retry-btn');
    expect(result).toContain('handleRetry()');
    expect(result).toContain('Try Again');
  });

  it('should have error class on illustration container', () => {
    const result = errorStateHTML('Error', 'retry()');
    
    expect(result).toContain('empty-illustration error');
  });

  it('should include alert/warning SVG icon', () => {
    const result = errorStateHTML('Error', 'retry()');
    
    expect(result).toContain('<svg');
    expect(result).toContain('circle');
  });

  it('should render custom error messages', () => {
    const customMessage = 'Unable to load election data. Server timeout.';
    const result = errorStateHTML(customMessage, 'reloadData()');
    
    expect(result).toContain(customMessage);
  });
});

describe('empty state integration', () => {
  it('should render all empty states with consistent structure', () => {
    const states = [
      emptySearchResultsHTML(),
      clickPrecinctPromptHTML(),
      noDataAvailableHTML('TEST'),
      errorStateHTML('Error', 'retry()')
    ];
    
    states.forEach(state => {
      expect(state).toContain('empty-illustration');
      expect(state).toContain('<h4>');
      expect(state).toContain('<p>');
      expect(state).toContain('<svg');
    });
  });

  it('should render empty states that can be placed inside cards', () => {
    const emptyState = clickPrecinctPromptHTML();
    const card = createCard('Select Precinct', null, emptyState);
    
    expect(card).toContain('ui-card');
    expect(card).toContain('empty-illustration');
    expect(card).toContain('Select a Precinct');
  });
});
