// js/accessibilityHelpers.js
// ============================
// Accessibility Helpers - Workstream E
// Focus management, screen reader announcements, keyboard navigation

/**
 * Creates an aria-live region for announcements
 * @param {string} id - Unique ID for the region
 * @param {string} politeness - 'polite' or 'assertive'
 * @returns {HTMLElement} The aria-live element
 */
export function createAriaLiveRegion(id = 'aria-live-announcer', politeness = 'polite') {
  let region = document.getElementById(id);
  if (!region) {
    region = document.createElement('div');
    region.id = id;
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', politeness);
    region.setAttribute('aria-atomic', 'true');
    region.className = 'sr-only';
    document.body.appendChild(region);
  }
  return region;
}

/**
 * Announces a message to screen readers
 * @param {string} message - Message to announce
 * @param {string} politeness - 'polite' or 'assertive'
 */
export function announceToScreenReader(message, politeness = 'polite') {
  const region = createAriaLiveRegion('aria-live-announcer', politeness);
  region.textContent = '';
  // Force a reflow to ensure the announcement is triggered
  setTimeout(() => {
    region.textContent = message;
  }, 100);
}

/**
 * Traps focus within an element
 * @param {HTMLElement} container - Container element to trap focus
 * @returns {Function} Cleanup function to remove trap
 */
export function trapFocus(container) {
  if (!container) return () => {};

  const focusableSelectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  const getFocusableElements = () => {
    return Array.from(container.querySelectorAll(focusableSelectors))
      .filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
  };

  const handleTab = (e) => {
    const focusable = getFocusableElements();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      // Shift + Tab
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  container.addEventListener('keydown', handleTab);
  
  // Focus first element
  const focusable = getFocusableElements();
  if (focusable.length > 0) {
    focusable[0].focus();
  }

  return () => {
    container.removeEventListener('keydown', handleTab);
  };
}

/**
 * Returns focus to a previously focused element
 * @param {HTMLElement} element - Element to return focus to
 */
export function returnFocus(element) {
  if (element && typeof element.focus === 'function') {
    // Use setTimeout to ensure the element is visible
    setTimeout(() => {
      element.focus();
    }, 100);
  }
}

/**
 * Manages focus for a modal/panel
 * @param {HTMLElement} panel - Panel element
 * @param {HTMLElement} trigger - Element that opened the panel
 * @returns {Function} Cleanup function
 */
export function managePanelFocus(panel, trigger) {
  const cleanup = trapFocus(panel);
  
  // Store trigger for cleanup
  panel._focusTrigger = trigger;
  
  return () => {
    cleanup();
    if (trigger) {
      returnFocus(trigger);
    }
  };
}

/**
 * Handles keyboard navigation for a list
 * @param {HTMLElement} container - Container with list items
 * @param {string} itemSelector - Selector for list items
 * @param {Function} onSelect - Callback when item is selected
 */
export function setupListKeyboardNavigation(container, itemSelector, onSelect) {
  if (!container) return;

  const handleKeyDown = (e) => {
    const items = Array.from(container.querySelectorAll(itemSelector));
    if (items.length === 0) return;

    const currentIndex = items.findIndex(item => item === document.activeElement);
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items[nextIndex].focus();
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        items[prevIndex].focus();
        break;
        
      case 'Home':
        e.preventDefault();
        items[0].focus();
        break;
        
      case 'End':
        e.preventDefault();
        items[items.length - 1].focus();
        break;
        
      case 'Enter':
      case ' ':
        if (currentIndex >= 0 && onSelect) {
          e.preventDefault();
          onSelect(items[currentIndex]);
        }
        break;
    }
  };

  container.addEventListener('keydown', handleKeyDown);
  
  return () => {
    container.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Checks if user prefers reduced motion
 * @returns {boolean} True if reduced motion is preferred
 */
export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Adds skip link functionality
 * @param {string} targetId - ID of target element
 * @param {string} label - Link label
 */
export function addSkipLink(targetId, label = 'Skip to main content') {
  let skipLink = document.getElementById('skip-link');
  if (!skipLink) {
    skipLink = document.createElement('a');
    skipLink.id = 'skip-link';
    skipLink.href = `#${targetId}`;
    skipLink.textContent = label;
    skipLink.className = 'skip-link';
    skipLink.setAttribute('aria-label', label);
    document.body.insertBefore(skipLink, document.body.firstChild);
  }
  return skipLink;
}
