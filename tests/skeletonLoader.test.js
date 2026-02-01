// skeletonLoader.test.js
// Unit tests for Skeleton Loading utilities (Workstream 4)
// TDD - Red phase: Tests written before implementation
// Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createSkeletonText,
  createSkeletonTitle,
  createSkeletonCard,
  createSkeletonStatGrid,
  createSkeletonList,
  createSidebarSkeleton,
  createLoadingSpinner,
  fadeInContent,
  SKELETON_VARIANTS
} from './skeletonLoader.js';

// ============================================================================
// TESTS FOR createSkeletonText
// ============================================================================

describe('createSkeletonText', () => {
  it('should create a skeleton text element', () => {
    const result = createSkeletonText();
    expect(result).toContain('class="skeleton skeleton-text"');
    expect(result).toContain('<div');
  });

  it('should apply custom width when provided', () => {
    const result = createSkeletonText({ width: '80%' });
    expect(result).toContain('width: 80%');
  });

  it('should use default width when not provided', () => {
    const result = createSkeletonText();
    expect(result).toContain('width: 100%');
  });

  it('should apply custom height when provided', () => {
    const result = createSkeletonText({ height: '20px' });
    expect(result).toContain('height: 20px');
  });

  it('should include aria-hidden for accessibility', () => {
    const result = createSkeletonText();
    expect(result).toContain('aria-hidden="true"');
  });
});

// ============================================================================
// TESTS FOR createSkeletonTitle
// ============================================================================

describe('createSkeletonTitle', () => {
  it('should create a skeleton title element', () => {
    const result = createSkeletonTitle();
    expect(result).toContain('class="skeleton skeleton-title"');
  });

  it('should have larger default height than text', () => {
    const result = createSkeletonTitle();
    expect(result).toContain('height: 24px');
  });

  it('should apply custom width when provided', () => {
    const result = createSkeletonTitle({ width: '50%' });
    expect(result).toContain('width: 50%');
  });

  it('should default to 60% width', () => {
    const result = createSkeletonTitle();
    expect(result).toContain('width: 60%');
  });
});

// ============================================================================
// TESTS FOR createSkeletonCard
// ============================================================================

describe('createSkeletonCard', () => {
  it('should create a skeleton card container', () => {
    const result = createSkeletonCard();
    expect(result).toContain('class="skeleton skeleton-card"');
  });

  it('should include aria-label for screen readers', () => {
    const result = createSkeletonCard();
    expect(result).toContain('aria-label="Loading content"');
  });

  it('should have default height', () => {
    const result = createSkeletonCard();
    expect(result).toContain('height: 120px');
  });

  it('should apply custom height when provided', () => {
    const result = createSkeletonCard({ height: '200px' });
    expect(result).toContain('height: 200px');
  });

  it('should apply role="status" for accessibility', () => {
    const result = createSkeletonCard();
    expect(result).toContain('role="status"');
  });
});

// ============================================================================
// TESTS FOR createSkeletonStatGrid
// ============================================================================

describe('createSkeletonStatGrid', () => {
  it('should create a grid of skeleton stat items', () => {
    const result = createSkeletonStatGrid(4);
    expect(result).toContain('class="skeleton-stat-grid"');
  });

  it('should create the specified number of stat items', () => {
    const result = createSkeletonStatGrid(3);
    const itemCount = (result.match(/skeleton-stat-item/g) || []).length;
    expect(itemCount).toBe(3);
  });

  it('should default to 4 items when count not specified', () => {
    const result = createSkeletonStatGrid();
    const itemCount = (result.match(/skeleton-stat-item/g) || []).length;
    expect(itemCount).toBe(4);
  });

  it('should include skeleton elements for value and label in each item', () => {
    const result = createSkeletonStatGrid(1);
    expect(result).toContain('skeleton-stat-value');
    expect(result).toContain('skeleton-stat-label');
  });

  it('should apply aria-hidden to individual skeleton elements', () => {
    const result = createSkeletonStatGrid(1);
    expect(result).toContain('aria-hidden="true"');
  });
});

// ============================================================================
// TESTS FOR createSkeletonList
// ============================================================================

describe('createSkeletonList', () => {
  it('should create a skeleton list container', () => {
    const result = createSkeletonList(5);
    expect(result).toContain('class="skeleton-list"');
  });

  it('should create the specified number of list items', () => {
    const result = createSkeletonList(5);
    const itemCount = (result.match(/skeleton-list-item/g) || []).length;
    expect(itemCount).toBe(5);
  });

  it('should default to 5 items when count not specified', () => {
    const result = createSkeletonList();
    const itemCount = (result.match(/skeleton-list-item/g) || []).length;
    expect(itemCount).toBe(5);
  });

  it('should include stagger animation classes for each item', () => {
    const result = createSkeletonList(3);
    expect(result).toContain('stagger-item');
  });

  it('should add animation delay styles for staggered loading', () => {
    const result = createSkeletonList(3);
    // First item should have delay 0.05s, second 0.1s, etc.
    expect(result).toContain('animation-delay');
  });
});

// ============================================================================
// TESTS FOR createSidebarSkeleton
// ============================================================================

describe('createSidebarSkeleton', () => {
  it('should create a complete sidebar skeleton structure', () => {
    const result = createSidebarSkeleton('demographics');
    expect(result).toContain('class="sidebar-skeleton"');
  });

  it('should include title skeleton', () => {
    const result = createSidebarSkeleton('demographics');
    expect(result).toContain('skeleton-title');
  });

  it('should include aria-live="polite" for accessibility', () => {
    const result = createSidebarSkeleton('demographics');
    expect(result).toContain('aria-live="polite"');
  });

  it('should include loading message for screen readers', () => {
    const result = createSidebarSkeleton('demographics');
    expect(result).toContain('Loading');
  });

  it('should create appropriate skeleton for demographics view', () => {
    const result = createSidebarSkeleton('demographics');
    expect(result).toContain('skeleton-card');
  });

  it('should create appropriate skeleton for election view', () => {
    const result = createSidebarSkeleton('election');
    expect(result).toContain('skeleton-stat-grid');
  });

  it('should create appropriate skeleton for turnout view', () => {
    const result = createSidebarSkeleton('turnout');
    expect(result).toContain('skeleton-stat-grid');
    expect(result).toContain('skeleton-list');
  });

  it('should include generic skeleton for unknown view types', () => {
    const result = createSidebarSkeleton('unknown');
    expect(result).toContain('skeleton-card');
  });
});

// ============================================================================
// TESTS FOR createLoadingSpinner
// ============================================================================

describe('createLoadingSpinner', () => {
  it('should create a loading spinner element', () => {
    const result = createLoadingSpinner();
    expect(result).toContain('class="loading-spinner');
  });

  it('should include aria-label for accessibility', () => {
    const result = createLoadingSpinner();
    expect(result).toContain('aria-label');
  });

  it('should accept custom aria-label', () => {
    const result = createLoadingSpinner({ label: 'Loading data' });
    expect(result).toContain('aria-label="Loading data"');
  });

  it('should support small variant', () => {
    const result = createLoadingSpinner({ size: 'small' });
    expect(result).toContain('loading-spinner small');
  });

  it('should support large variant', () => {
    const result = createLoadingSpinner({ size: 'large' });
    expect(result).toContain('loading-spinner large');
  });

  it('should include role="status" for accessibility', () => {
    const result = createLoadingSpinner();
    expect(result).toContain('role="status"');
  });
});

// ============================================================================
// TESTS FOR SKELETON_VARIANTS
// ============================================================================

describe('SKELETON_VARIANTS', () => {
  it('should export SKELETON_VARIANTS constant', () => {
    expect(SKELETON_VARIANTS).toBeDefined();
  });

  it('should have demographics variant', () => {
    expect(SKELETON_VARIANTS.demographics).toBeDefined();
  });

  it('should have election variant', () => {
    expect(SKELETON_VARIANTS.election).toBeDefined();
  });

  it('should have turnout variant', () => {
    expect(SKELETON_VARIANTS.turnout).toBeDefined();
  });

  it('should have precinctDetails variant', () => {
    expect(SKELETON_VARIANTS.precinctDetails).toBeDefined();
  });

  it('each variant should be a function', () => {
    expect(typeof SKELETON_VARIANTS.demographics).toBe('function');
    expect(typeof SKELETON_VARIANTS.election).toBe('function');
    expect(typeof SKELETON_VARIANTS.turnout).toBe('function');
    expect(typeof SKELETON_VARIANTS.precinctDetails).toBe('function');
  });

  it('each variant should return HTML string', () => {
    expect(typeof SKELETON_VARIANTS.demographics()).toBe('string');
    expect(typeof SKELETON_VARIANTS.election()).toBe('string');
    expect(typeof SKELETON_VARIANTS.turnout()).toBe('string');
    expect(typeof SKELETON_VARIANTS.precinctDetails()).toBe('string');
  });
});

// ============================================================================
// TESTS FOR fadeInContent
// ============================================================================

describe('fadeInContent', () => {
  let container;

  beforeEach(() => {
    // Create a mock DOM element
    container = {
      classList: {
        classes: [],
        add(cls) { this.classes.push(cls); },
        remove(cls) { this.classes = this.classes.filter(c => c !== cls); },
        contains(cls) { return this.classes.includes(cls); }
      },
      innerHTML: ''
    };
  });

  it('should add fade-in class to container', () => {
    fadeInContent(container, '<p>Content</p>');
    expect(container.classList.classes).toContain('fade-in');
  });

  it('should set innerHTML to provided content', () => {
    fadeInContent(container, '<p>New Content</p>');
    expect(container.innerHTML).toBe('<p>New Content</p>');
  });

  it('should remove skeleton class from container', () => {
    container.classList.add('skeleton-loading');
    fadeInContent(container, '<p>Content</p>');
    expect(container.classList.contains('skeleton-loading')).toBe(false);
  });

  it('should handle null container gracefully', () => {
    expect(() => fadeInContent(null, '<p>Content</p>')).not.toThrow();
  });

  it('should handle undefined container gracefully', () => {
    expect(() => fadeInContent(undefined, '<p>Content</p>')).not.toThrow();
  });
});

// ============================================================================
// INTEGRATION TEST - Skeleton to Content Transition
// ============================================================================

describe('Integration: Skeleton to content transition flow', () => {
  it('should generate valid skeleton HTML for all view types', () => {
    const views = ['demographics', 'election', 'turnout'];
    
    views.forEach(view => {
      const skeleton = createSidebarSkeleton(view);
      expect(skeleton).toBeTruthy();
      expect(typeof skeleton).toBe('string');
      expect(skeleton.length).toBeGreaterThan(0);
      // Should not contain undefined or null in the string
      expect(skeleton).not.toContain('undefined');
      expect(skeleton).not.toContain('null');
    });
  });

  it('should generate accessible skeleton markup', () => {
    const skeleton = createSidebarSkeleton('election');
    
    // Check for ARIA attributes
    expect(skeleton).toContain('aria-');
    expect(skeleton).toContain('role=');
  });

  it('should generate skeleton with animation support', () => {
    const skeleton = createSidebarSkeleton('turnout');
    
    // Check for animation-related classes
    expect(skeleton).toMatch(/skeleton|stagger/);
  });
});

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge cases and error handling', () => {
  it('createSkeletonStatGrid should handle 0 items', () => {
    const result = createSkeletonStatGrid(0);
    expect(result).toContain('skeleton-stat-grid');
    const itemCount = (result.match(/skeleton-stat-item/g) || []).length;
    expect(itemCount).toBe(0);
  });

  it('createSkeletonList should handle 0 items', () => {
    const result = createSkeletonList(0);
    expect(result).toContain('skeleton-list');
    const itemCount = (result.match(/skeleton-list-item/g) || []).length;
    expect(itemCount).toBe(0);
  });

  it('createSkeletonStatGrid should handle large numbers', () => {
    const result = createSkeletonStatGrid(100);
    const itemCount = (result.match(/skeleton-stat-item/g) || []).length;
    expect(itemCount).toBe(100);
  });

  it('createSkeletonText should handle empty options object', () => {
    const result = createSkeletonText({});
    expect(result).toContain('skeleton-text');
  });

  it('createLoadingSpinner should handle empty options object', () => {
    const result = createLoadingSpinner({});
    expect(result).toContain('loading-spinner');
  });
});
