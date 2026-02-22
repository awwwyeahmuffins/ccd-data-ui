// mobileGestures.js
// ===================
// Mobile gesture handling for sidebar swipe-to-close (Phase 2 Workstream 4)
// Provides touch gesture support for improved mobile UX

/**
 * Configuration for swipe gestures
 */
export let SWIPE_CONFIG = {
  /** Percentage of sidebar width to trigger close (0-1) */
  threshold: 0.3,
  /** Minimum swipe distance in pixels to register as intentional */
  minSwipeDistance: 30,
  /** Velocity threshold for fast swipes (pixels per millisecond) */
  velocityThreshold: 0.5
};

/**
 * Calculate the distance of a swipe gesture
 * @param {number} startX - Starting X position
 * @param {number} endX - Ending X position
 * @returns {number} Distance (negative for left, positive for right)
 */
export function calculateSwipeDistance(startX, endX) {
  return endX - startX;
}

/**
 * Determine if the sidebar should close based on swipe distance and velocity
 * @param {number} distance - Swipe distance (negative = left)
 * @param {number} sidebarWidth - Width of the sidebar in pixels
 * @param {number} velocity - Optional velocity of the swipe (px/ms)
 * @returns {boolean} True if sidebar should close
 */
export function shouldCloseSidebar(distance, sidebarWidth, velocity = 0) {
  // Guard against invalid inputs
  if (!sidebarWidth || sidebarWidth <= 0) {
    return false;
  }
  
  // Only close on left swipes (negative distance)
  if (distance >= 0) {
    return false;
  }
  
  const absoluteDistance = Math.abs(distance);
  const thresholdDistance = sidebarWidth * SWIPE_CONFIG.threshold;
  
  // Fast swipe: close even with smaller distance
  if (velocity >= SWIPE_CONFIG.velocityThreshold && absoluteDistance >= SWIPE_CONFIG.minSwipeDistance) {
    return true;
  }
  
  // Normal swipe: check against threshold
  return absoluteDistance >= thresholdDistance;
}

/**
 * Get the direction of a swipe gesture
 * @param {number} distance - Swipe distance
 * @returns {'left' | 'right' | 'none'} Swipe direction
 */
export function getSwipeDirection(distance) {
  if (isNaN(distance) || distance === 0) {
    return 'none';
  }
  return distance < 0 ? 'left' : 'right';
}

/**
 * Initialize swipe-to-close gesture handling for the sidebar
 * @returns {Function} Cleanup function to remove event listeners
 */
export function initSidebarGestures() {
  let sidebar = document.getElementById('sidebar');
  let overlay = document.getElementById('sidebar-overlay');
  let mobileToggle = document.getElementById('sidebar-toggle');
  
  if (!sidebar) {
    return () => {}; // Return no-op cleanup function
  }
  
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let startTime = 0;
  let isDragging = false;
  let isVerticalScroll = false;
  
  let handleTouchStart = function handleTouchStart(e) {
    // Only track if sidebar is open
    if (!sidebar.classList.contains('open')) return;

    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = startX;
    startTime = Date.now();
    isDragging = true;
    isVerticalScroll = false;

    // Disable transition for smooth dragging
    sidebar.style.transition = 'none';
  };

  let handleTouchMove = function handleTouchMove(e) {
    if (!isDragging) return;

    const touchX = e.touches[0].clientX;
    const touchY = e.touches[0].clientY;
    const diffX = touchX - startX;
    const diffY = touchY - startY;

    // Detect if this is a vertical scroll (ignore horizontal swipe)
    if (!isVerticalScroll && Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 10) {
      isVerticalScroll = true;
      return;
    }

    if (isVerticalScroll) return;

    currentX = touchX;

    // Only allow swiping left (to close) - clamp to 0
    if (diffX < 0) {
      sidebar.style.transform = `translateX(${diffX}px)`;

      // Update overlay opacity based on swipe progress
      if (overlay) {
        const progress = Math.min(1, Math.abs(diffX) / sidebar.offsetWidth);
        overlay.style.opacity = String(1 - progress);
      }
    }
  };

  let handleTouchEnd = function handleTouchEnd() {
    if (!isDragging) return;

    isDragging = false;

    // Re-enable transition for snap animation
    sidebar.style.transition = '';

    const distance = calculateSwipeDistance(startX, currentX);
    const duration = Date.now() - startTime;
    const velocity = Math.abs(distance) / duration;

    if (shouldCloseSidebar(distance, sidebar.offsetWidth, velocity)) {
      // Close the sidebar
      closeSidebar(sidebar, overlay, mobileToggle);
    } else {
      // Snap back to open position
      sidebar.style.transform = '';
      if (overlay) {
        overlay.style.opacity = '';
      }
    }
  };
  
  // Attach event listeners
  sidebar.addEventListener('touchstart', handleTouchStart, { passive: true });
  sidebar.addEventListener('touchmove', handleTouchMove, { passive: true });
  sidebar.addEventListener('touchend', handleTouchEnd);
  
  // Return cleanup function
  return () => {
    sidebar.removeEventListener('touchstart', handleTouchStart);
    sidebar.removeEventListener('touchmove', handleTouchMove);
    sidebar.removeEventListener('touchend', handleTouchEnd);
  };
}

/**
 * Close the sidebar with proper state cleanup
 * @param {HTMLElement} sidebar - Sidebar element
 * @param {HTMLElement} overlay - Overlay element
 * @param {HTMLElement} mobileToggle - Mobile toggle button element
 */
function closeSidebar(sidebar, overlay, mobileToggle) {
  sidebar.classList.remove('open');
  sidebar.style.transform = '';
  
  if (overlay) {
    overlay.classList.remove('visible');
    overlay.style.opacity = '';
  }
  
  if (mobileToggle) {
    mobileToggle.setAttribute('aria-expanded', 'false');
  }
}

/**
 * Open the sidebar with proper state
 * @param {HTMLElement} sidebar - Sidebar element
 * @param {HTMLElement} overlay - Overlay element
 * @param {HTMLElement} mobileToggle - Mobile toggle button element
 */
export function openSidebar(sidebar, overlay, mobileToggle) {
  sidebar.classList.add('open');
  
  if (overlay) {
    overlay.classList.add('visible');
  }
  
  if (mobileToggle) {
    mobileToggle.setAttribute('aria-expanded', 'true');
  }
}

/**
 * Add map loading class to show loading indicator
 * @param {HTMLElement} mapElement - The map container element
 */
export function showMapLoading(mapElement) {
  if (mapElement) {
    mapElement.classList.add('loading');
  }
}

/**
 * Remove map loading class to hide loading indicator
 * @param {HTMLElement} mapElement - The map container element
 */
export function hideMapLoading(mapElement) {
  if (mapElement) {
    mapElement.classList.remove('loading');
  }
}

/**
 * Check if device supports touch events
 * @returns {boolean} True if touch is supported
 */
export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Check if viewport is mobile-sized
 * @param {number} breakpoint - Max width to consider mobile (default: 800)
 * @returns {boolean} True if viewport is mobile-sized
 */
export function isMobileViewport(breakpoint = 800) {
  return window.innerWidth <= breakpoint;
}

/**
 * Initialize swipe-to-dismiss gesture for race picker panel (Workstream F)
 * @param {HTMLElement} panel - Panel element
 * @param {HTMLElement} content - Panel content element
 * @param {Function} onDismiss - Callback when panel should be dismissed
 * @returns {Function} Cleanup function
 */
export function initPanelSwipeGesture(panel, content, onDismiss) {
  if (!panel || !content || !isTouchDevice()) {
    return () => {};
  }

  let startY = 0;
  let currentY = 0;
  let startTime = 0;
  let isDragging = false;
  let isHorizontalScroll = false;

  let handleTouchStart = function handleTouchStart(e) {
    // Only track if panel is visible
    if (panel.classList.contains('hidden') || panel.getAttribute('aria-hidden') === 'true') {
      return;
    }

    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    currentY = startY;
    startTime = Date.now();
    isDragging = true;
    isHorizontalScroll = false;

    // Disable transition for smooth dragging
    content.style.transition = 'none';
  };

  let startX = 0;

  let handleTouchMove = function handleTouchMove(e) {
    if (!isDragging) return;

    const touchY = e.touches[0].clientY;
    const touchX = e.touches[0].clientX;
    const diffY = touchY - startY;
    const diffX = Math.abs(touchX - startX);

    // Detect if this is a horizontal scroll (ignore vertical swipe)
    if (!isHorizontalScroll && Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
      isHorizontalScroll = true;
      return;
    }

    if (isHorizontalScroll) return;

    // Only allow swiping down (to dismiss)
    if (diffY > 0) {
      currentY = touchY;
      content.style.transform = `translateY(${diffY}px)`;

      // Update backdrop opacity based on swipe progress
      let backdrop = panel.querySelector('.race-picker-backdrop');
      if (backdrop) {
        const progress = Math.min(1, diffY / window.innerHeight);
        backdrop.style.opacity = String(1 - progress);
      }
    }
  };

  let handleTouchEnd = function handleTouchEnd() {
    if (!isDragging) return;

    isDragging = false;

    // Re-enable transition for snap animation
    content.style.transition = '';

    const distance = currentY - startY;
    const duration = Date.now() - startTime;
    const velocity = duration > 0 ? distance / duration : 0;
    const threshold = 100; // Minimum swipe distance in pixels

    // Dismiss if swiped down enough or fast swipe
    if (distance > threshold || (velocity > 0.5 && distance > 50)) {
      if (onDismiss) {
        onDismiss();
      }
    } else {
      // Snap back to open position
      content.style.transform = '';
      let backdrop = panel.querySelector('.race-picker-backdrop');
      if (backdrop) {
        backdrop.style.opacity = '';
      }
    }
  };

  // Attach event listeners
  content.addEventListener('touchstart', handleTouchStart, { passive: true });
  content.addEventListener('touchmove', handleTouchMove, { passive: true });
  content.addEventListener('touchend', handleTouchEnd);

  // Return cleanup function
  return () => {
    content.removeEventListener('touchstart', handleTouchStart);
    content.removeEventListener('touchmove', handleTouchMove);
    content.removeEventListener('touchend', handleTouchEnd);
  };
}
