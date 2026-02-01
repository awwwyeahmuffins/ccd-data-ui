/**
 * keyboardShortcuts.js
 * Keyboard shortcuts manager for Collin County Election Data app
 * 
 * Provides keyboard navigation shortcuts for power users:
 * - View switching (1, 2, 3)
 * - Search focus (/)
 * - Close/cancel (Escape)
 * - Help modal (?)
 */

// ============================================================================
// SHORTCUT DEFINITIONS
// ============================================================================

/**
 * Array of keyboard shortcuts with their keys, descriptions, and actions.
 * @type {Array<{key: string, description: string, action: Function}>}
 */
export const SHORTCUTS = [
  { 
    key: '/', 
    description: 'Focus search box', 
    action: () => {
      const searchInput = document.getElementById('election-search');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
  },
  { 
    key: 'Escape', 
    description: 'Close sidebar (mobile) / Cancel', 
    action: handleEscape 
  },
  { 
    key: '1', 
    description: 'Switch to Demographics view', 
    action: () => document.getElementById('view-dem-btn')?.click() 
  },
  { 
    key: '2', 
    description: 'Switch to Election Forecast view', 
    action: () => document.getElementById('view-elect-btn')?.click() 
  },
  { 
    key: '3', 
    description: 'Switch to Turnout Analysis view', 
    action: () => document.getElementById('view-turnout-btn')?.click() 
  },
  { 
    key: '?', 
    description: 'Show keyboard shortcuts help', 
    action: toggleShortcutsModal 
  },
];

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize keyboard shortcuts listener.
 * Should be called once when the app loads.
 */
export function initKeyboardShortcuts() {
  document.addEventListener('keydown', handleKeyDown);
  
  // Initialize modal close button
  const closeBtn = document.querySelector('#shortcuts-modal .modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('shortcuts-modal')?.classList.remove('visible');
    });
  }
  
  // Close modal when clicking overlay
  const modal = document.getElementById('shortcuts-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('visible');
      }
    });
  }
  
  // Populate shortcuts list
  const shortcutsList = document.getElementById('shortcuts-list');
  if (shortcutsList) {
    shortcutsList.innerHTML = generateShortcutsHTML();
  }
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle keydown events and trigger appropriate shortcuts.
 * @param {KeyboardEvent} e - The keyboard event
 */
function handleKeyDown(e) {
  // Ignore if typing in input, textarea, or select
  const tagName = e.target.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)) {
    // Allow Escape to work even in inputs
    if (e.key === 'Escape') {
      handleEscape();
    }
    return;
  }
  
  // Ignore if modifier keys are held (except Shift for ?)
  if (e.ctrlKey || e.altKey || e.metaKey) {
    return;
  }
  
  // Find matching shortcut
  const shortcut = SHORTCUTS.find(s => s.key === e.key);
  if (shortcut) {
    e.preventDefault();
    shortcut.action();
  }
}

/**
 * Handle Escape key - close modals and sidebar.
 */
function handleEscape() {
  // Close shortcuts modal
  const modal = document.getElementById('shortcuts-modal');
  if (modal?.classList.contains('visible')) {
    modal.classList.remove('visible');
    return;
  }
  
  // Close sidebar on mobile
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar?.classList.contains('open')) {
    sidebar.classList.remove('open');
    overlay?.classList.remove('visible');
    return;
  }
  
  // Cancel comparison mode if active
  // (This can be extended by other modules)
}

/**
 * Toggle the keyboard shortcuts help modal.
 */
function toggleShortcutsModal() {
  const modal = document.getElementById('shortcuts-modal');
  if (modal) {
    modal.classList.toggle('visible');
    
    // Update aria-hidden
    const isVisible = modal.classList.contains('visible');
    modal.setAttribute('aria-hidden', !isVisible);
    
    // Focus trap - focus close button when opening
    if (isVisible) {
      const closeBtn = modal.querySelector('.modal-close');
      closeBtn?.focus();
    }
  }
}

// ============================================================================
// HTML GENERATION
// ============================================================================

/**
 * Generate HTML for the shortcuts list.
 * @returns {string} HTML string with all shortcuts
 */
export function generateShortcutsHTML() {
  return SHORTCUTS.map(shortcut => `
    <div class="shortcut-item">
      <kbd>${escapeHtml(shortcut.key)}</kbd>
      <span>${escapeHtml(shortcut.description)}</span>
    </div>
  `).join('');
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  const escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(str).replace(/[&<>"']/g, char => escapeMap[char]);
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Programmatically show the shortcuts modal.
 */
export function showShortcutsModal() {
  const modal = document.getElementById('shortcuts-modal');
  if (modal) {
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
  }
}

/**
 * Programmatically hide the shortcuts modal.
 */
export function hideShortcutsModal() {
  const modal = document.getElementById('shortcuts-modal');
  if (modal) {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
  }
}
