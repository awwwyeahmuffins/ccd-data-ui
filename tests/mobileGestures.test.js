// mobileGestures.test.js
// Unit tests for Mobile Gesture handling (Phase 2 Workstream 4)
// TDD - Red phase: Tests written before implementation
// Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  initSidebarGestures,
  calculateSwipeDistance,
  shouldCloseSidebar,
  getSwipeDirection,
  SWIPE_CONFIG
} from './mobileGestures.js';

// ============================================================================
// TESTS FOR SWIPE_CONFIG
// ============================================================================

describe('SWIPE_CONFIG', () => {
  it('should export SWIPE_CONFIG constant', () => {
    expect(SWIPE_CONFIG).toBeDefined();
  });

  it('should have threshold property', () => {
    expect(SWIPE_CONFIG.threshold).toBeDefined();
    expect(typeof SWIPE_CONFIG.threshold).toBe('number');
  });

  it('should have threshold as percentage (0-1)', () => {
    expect(SWIPE_CONFIG.threshold).toBeGreaterThan(0);
    expect(SWIPE_CONFIG.threshold).toBeLessThanOrEqual(1);
  });

  it('should have minSwipeDistance property', () => {
    expect(SWIPE_CONFIG.minSwipeDistance).toBeDefined();
    expect(typeof SWIPE_CONFIG.minSwipeDistance).toBe('number');
  });

  it('should have velocityThreshold property', () => {
    expect(SWIPE_CONFIG.velocityThreshold).toBeDefined();
    expect(typeof SWIPE_CONFIG.velocityThreshold).toBe('number');
  });
});

// ============================================================================
// TESTS FOR calculateSwipeDistance
// ============================================================================

describe('calculateSwipeDistance', () => {
  it('should calculate correct distance for left swipe', () => {
    const result = calculateSwipeDistance(300, 100);
    expect(result).toBe(-200);
  });

  it('should calculate correct distance for right swipe', () => {
    const result = calculateSwipeDistance(100, 300);
    expect(result).toBe(200);
  });

  it('should return 0 for no movement', () => {
    const result = calculateSwipeDistance(150, 150);
    expect(result).toBe(0);
  });

  it('should handle decimal values', () => {
    const result = calculateSwipeDistance(100.5, 200.5);
    expect(result).toBe(100);
  });

  it('should handle negative starting position', () => {
    const result = calculateSwipeDistance(-50, 50);
    expect(result).toBe(100);
  });
});

// ============================================================================
// TESTS FOR shouldCloseSidebar
// ============================================================================

describe('shouldCloseSidebar', () => {
  const sidebarWidth = 320; // Typical sidebar width

  it('should return true when swipe exceeds threshold', () => {
    // Swipe more than 30% of sidebar width to the left
    const swipeDistance = -120; // More than 96px (30% of 320)
    const result = shouldCloseSidebar(swipeDistance, sidebarWidth);
    expect(result).toBe(true);
  });

  it('should return false when swipe is below threshold', () => {
    // Swipe less than 30% of sidebar width
    const swipeDistance = -50;
    const result = shouldCloseSidebar(swipeDistance, sidebarWidth);
    expect(result).toBe(false);
  });

  it('should return false for right swipe (positive distance)', () => {
    const swipeDistance = 150;
    const result = shouldCloseSidebar(swipeDistance, sidebarWidth);
    expect(result).toBe(false);
  });

  it('should return false when sidebar width is 0', () => {
    const swipeDistance = -100;
    const result = shouldCloseSidebar(swipeDistance, 0);
    expect(result).toBe(false);
  });

  it('should consider velocity for fast swipes', () => {
    // Fast swipe should close even with smaller distance
    const swipeDistance = -40;
    const velocity = 1.5; // Fast
    const result = shouldCloseSidebar(swipeDistance, sidebarWidth, velocity);
    expect(result).toBe(true);
  });

  it('should not close on slow small swipes', () => {
    const swipeDistance = -40;
    const velocity = 0.1; // Slow
    const result = shouldCloseSidebar(swipeDistance, sidebarWidth, velocity);
    expect(result).toBe(false);
  });
});

// ============================================================================
// TESTS FOR getSwipeDirection
// ============================================================================

describe('getSwipeDirection', () => {
  it('should return "left" for negative distance', () => {
    const result = getSwipeDirection(-100);
    expect(result).toBe('left');
  });

  it('should return "right" for positive distance', () => {
    const result = getSwipeDirection(100);
    expect(result).toBe('right');
  });

  it('should return "none" for zero distance', () => {
    const result = getSwipeDirection(0);
    expect(result).toBe('none');
  });

  it('should return "left" for small negative distance', () => {
    const result = getSwipeDirection(-5);
    expect(result).toBe('left');
  });

  it('should return "right" for small positive distance', () => {
    const result = getSwipeDirection(5);
    expect(result).toBe('right');
  });
});

// ============================================================================
// TESTS FOR initSidebarGestures (integration-style)
// ============================================================================

describe('initSidebarGestures', () => {
  let sidebar;
  let overlay;
  let sidebarToggle;

  beforeEach(() => {
    // Create real DOM elements using jsdom
    sidebar = document.createElement('div');
    sidebar.id = 'sidebar';
    sidebar.classList.add('open');
    sidebar.style.width = '320px';
    document.body.appendChild(sidebar);

    overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.classList.add('visible');
    document.body.appendChild(overlay);

    sidebarToggle = document.createElement('button');
    sidebarToggle.id = 'sidebar-toggle';
    document.body.appendChild(sidebarToggle);

    // Spy on addEventListener
    jest.spyOn(sidebar, 'addEventListener');
    jest.spyOn(sidebar, 'removeEventListener');
  });

  afterEach(() => {
    // Clean up DOM
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('should attach touchstart event listener to sidebar', () => {
    initSidebarGestures();
    expect(sidebar.addEventListener).toHaveBeenCalledWith(
      'touchstart',
      expect.any(Function),
      expect.objectContaining({ passive: true })
    );
  });

  it('should attach touchmove event listener to sidebar', () => {
    initSidebarGestures();
    expect(sidebar.addEventListener).toHaveBeenCalledWith(
      'touchmove',
      expect.any(Function),
      expect.objectContaining({ passive: true })
    );
  });

  it('should attach touchend event listener to sidebar', () => {
    initSidebarGestures();
    expect(sidebar.addEventListener).toHaveBeenCalledWith(
      'touchend',
      expect.any(Function)
    );
  });

  it('should not throw if sidebar element is missing', () => {
    document.body.innerHTML = ''; // Remove all elements
    expect(() => initSidebarGestures()).not.toThrow();
  });

  it('should return cleanup function', () => {
    const cleanup = initSidebarGestures();
    expect(typeof cleanup).toBe('function');
  });
});

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge cases and error handling', () => {
  it('calculateSwipeDistance should handle undefined values', () => {
    expect(() => calculateSwipeDistance(undefined, 100)).not.toThrow();
    expect(calculateSwipeDistance(undefined, 100)).toBe(NaN);
  });

  it('shouldCloseSidebar should handle null sidebar width', () => {
    expect(() => shouldCloseSidebar(-100, null)).not.toThrow();
    expect(shouldCloseSidebar(-100, null)).toBe(false);
  });

  it('getSwipeDirection should handle NaN', () => {
    expect(getSwipeDirection(NaN)).toBe('none');
  });

  it('getSwipeDirection should handle Infinity', () => {
    expect(getSwipeDirection(Infinity)).toBe('right');
    expect(getSwipeDirection(-Infinity)).toBe('left');
  });
});

// ============================================================================
// INTEGRATION TEST - Simulated swipe gesture
// ============================================================================

describe('Integration: Simulated swipe gesture flow', () => {
  it('should calculate proper close decision for typical swipe', () => {
    const startX = 280;
    const endX = 100;
    const sidebarWidth = 320;
    
    const distance = calculateSwipeDistance(startX, endX);
    const direction = getSwipeDirection(distance);
    const shouldClose = shouldCloseSidebar(distance, sidebarWidth);
    
    expect(direction).toBe('left');
    expect(shouldClose).toBe(true);
  });

  it('should not close for small accidental swipe', () => {
    const startX = 280;
    const endX = 260; // Only 20px movement
    const sidebarWidth = 320;
    
    const distance = calculateSwipeDistance(startX, endX);
    const shouldClose = shouldCloseSidebar(distance, sidebarWidth);
    
    expect(shouldClose).toBe(false);
  });

  it('should handle rapid swipe with velocity', () => {
    const startX = 280;
    const endX = 220;
    const sidebarWidth = 320;
    const velocity = 2.0; // Very fast
    
    const distance = calculateSwipeDistance(startX, endX);
    const shouldClose = shouldCloseSidebar(distance, sidebarWidth, velocity);
    
    // Even though distance is small, velocity is high
    expect(shouldClose).toBe(true);
  });
});
