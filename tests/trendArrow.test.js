// trendArrow.test.js
// Unit tests for trend arrow rendering (A2) and computePrecinctTrend logic

import { describe, it, expect } from '@jest/globals';
import { renderTrendArrow } from './precinctProfile.js';

describe('renderTrendArrow', () => {
  it('returns empty string for null trendData', () => {
    expect(renderTrendArrow(null)).toBe('');
  });

  it('returns empty string for undefined trendData', () => {
    expect(renderTrendArrow(undefined)).toBe('');
  });

  it('renders dem direction with up arrow and blue class', () => {
    let html = renderTrendArrow({
      direction: 'dem',
      delta: 3.2,
      raceName: 'President',
      year1: 2020,
      year2: 2024
    });
    expect(html).toContain('trend-arrow-badge dem');
    expect(html).toContain('\u2191'); // up arrow
    expect(html).toContain('+3.2%');
    expect(html).toContain('toward Dem');
    expect(html).toContain('President');
    expect(html).toContain('2020');
    expect(html).toContain('2024');
  });

  it('renders rep direction with down arrow and red class', () => {
    let html = renderTrendArrow({
      direction: 'rep',
      delta: -2.1,
      raceName: 'President',
      year1: 2020,
      year2: 2024
    });
    expect(html).toContain('trend-arrow-badge rep');
    expect(html).toContain('\u2193'); // down arrow
    expect(html).toContain('-2.1%');
    expect(html).toContain('toward Rep');
  });

  it('renders stable direction with dash and stable class', () => {
    let html = renderTrendArrow({
      direction: 'stable',
      delta: 0.1,
      raceName: 'President',
      year1: 2020,
      year2: 2024
    });
    expect(html).toContain('trend-arrow-badge stable');
    expect(html).toContain('\u2014'); // em dash
    expect(html).toContain('Stable');
  });

  it('handles missing year1 and year2 gracefully', () => {
    let html = renderTrendArrow({
      direction: 'dem',
      delta: 1.5,
      raceName: 'President',
      year1: null,
      year2: null
    });
    // Should still render without crashing
    expect(html).toContain('trend-arrow-badge dem');
  });
});
