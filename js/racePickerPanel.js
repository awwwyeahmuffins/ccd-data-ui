// js/racePickerPanel.js
// ======================
// Race Picker Panel Component - Workstream D
// Modern panel UI replacing the dropdown with search, filters, and grouped list
// Enhanced with Workstream E: UX enhancements, accessibility, loading/error states

import { debounce } from "./utils.js";
import { highlightMatches, ELECTION_CATEGORIES } from "./electionFilters.js";
import { getRaceFamilyDisplayName } from "./raceGrouping.js";
import {
  managePanelFocus,
  announceToScreenReader,
  setupListKeyboardNavigation,
  prefersReducedMotion
} from "./accessibilityHelpers.js";
import { initPanelSwipeGesture, isTouchDevice } from "./mobileGestures.js";
// Import analytics (expose globally for panel callbacks)
import { RacePickerAnalytics } from "./analytics.js";
if (typeof window !== 'undefined') {
  window.RacePickerAnalytics = RacePickerAnalytics;
}

/**
 * Creates the Race Picker Panel component
 * @param {Object} options - Configuration options
 * @param {Function} options.onSelect - Callback when race is selected
 * @param {Function} options.onFilterChange - Callback when filters change
 * @param {Function} options.onSearch - Callback when search query changes
 * @param {Function} options.onClose - Callback when panel closes
 * @param {Array} options.groupedElections - Grouped elections array
 * @param {Array} options.recentlyViewed - Recently viewed races
 * @param {Object} options.filterCounts - Filter counts object
 * @param {string} options.currentRace - Currently selected race filename
 * @returns {HTMLElement} Panel DOM element
 */
export function createRacePickerPanel(options = {}) {
  const {
    onSelect,
    onFilterChange,
    onSearch,
    onClose,
    groupedElections = [],
    recentlyViewed = [],
    filterCounts = { years: {}, categories: {}, total: 0 },
    currentRace = null
  } = options;

  // Create panel container
  const panel = document.createElement('div');
  panel.className = 'race-picker-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Select election race');
  panel.setAttribute('aria-modal', 'true');

  // Create backdrop overlay
  const backdrop = document.createElement('div');
  backdrop.className = 'race-picker-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.addEventListener('click', () => {
    panel._close();
    if (onClose) onClose();
  });

  // Panel content wrapper
  const content = document.createElement('div');
  content.className = 'race-picker-content';

  // Header with close button
  const header = document.createElement('div');
  header.className = 'race-picker-header';
  header.innerHTML = `
    <h2 class="race-picker-title">Select Race</h2>
    <button 
      class="race-picker-close" 
      aria-label="Close panel"
      type="button"
    >×</button>
  `;
  const closeBtn = header.querySelector('.race-picker-close');
  closeBtn.addEventListener('click', () => {
    panel._close();
    if (onClose) onClose();
  });

  // Search input
  const searchContainer = document.createElement('div');
  searchContainer.className = 'race-picker-search';
  searchContainer.innerHTML = `
    <input 
      type="text" 
      class="race-picker-search-input"
      placeholder="Search races... (Cmd/Ctrl+K)"
      aria-label="Search races"
      autocomplete="off"
    >
    <button 
      class="race-picker-search-clear hidden"
      aria-label="Clear search"
      type="button"
    >×</button>
  `;
  const searchInput = searchContainer.querySelector('.race-picker-search-input');
  const clearBtn = searchContainer.querySelector('.race-picker-search-clear');

  // Debounced search handler
  const debouncedSearch = debounce((query) => {
    if (onSearch) onSearch(query);
  }, 300);

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value;
    clearBtn.classList.toggle('hidden', !query);
    debouncedSearch(query);
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.add('hidden');
    if (onSearch) onSearch('');
    searchInput.focus();
  });

  // Filter chips container
  const filtersContainer = document.createElement('div');
  filtersContainer.className = 'race-picker-filters';
  filtersContainer.setAttribute('role', 'group');
  filtersContainer.setAttribute('aria-label', 'Filter options');

  // Year filter chips
  const yearFilters = document.createElement('div');
  yearFilters.className = 'race-picker-filter-group';
  yearFilters.setAttribute('role', 'radiogroup');
  yearFilters.setAttribute('aria-label', 'Filter by year');

  // Category filter chips
  const categoryFilters = document.createElement('div');
  categoryFilters.className = 'race-picker-filter-group';
  categoryFilters.setAttribute('role', 'radiogroup');
  categoryFilters.setAttribute('aria-label', 'Filter by category');

  filtersContainer.appendChild(yearFilters);
  filtersContainer.appendChild(categoryFilters);

  // Recently viewed section
  let recentSection = createRecentlyViewedSection(recentlyViewed, onSelect, currentRace, '');

  // Results list container
  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'race-picker-results';
  resultsContainer.setAttribute('role', 'listbox');
  resultsContainer.setAttribute('aria-label', 'Race list');

  // Empty state
  const emptyState = document.createElement('div');
  emptyState.className = 'race-picker-empty hidden';
  emptyState.innerHTML = `
    <div class="race-picker-empty-icon">🔍</div>
    <h3 class="race-picker-empty-title">No races found</h3>
    <p class="race-picker-empty-message">Try adjusting your filters or search query</p>
  `;

  // Assemble panel
  content.appendChild(header);
  content.appendChild(searchContainer);
  content.appendChild(filtersContainer);
  if (recentlyViewed.length > 0) {
    content.appendChild(recentSection);
  }
  content.appendChild(resultsContainer);
  content.appendChild(emptyState);

  panel.appendChild(backdrop);
  panel.appendChild(content);

  // Focus management and gestures
  let focusCleanup = null;
  let swipeCleanup = null;
  
  panel._open = (triggerElement) => {
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    backdrop.setAttribute('aria-hidden', 'false');
    
    // Focus management
    focusCleanup = managePanelFocus(content, triggerElement);
    
    // Mobile swipe gesture
    if (isTouchDevice()) {
      swipeCleanup = initPanelSwipeGesture(panel, content, () => {
        panel._close();
      });
    }
    
    // Focus search input
    setTimeout(() => {
      searchInput.focus();
    }, 100);
    
    // Announce to screen readers
    announceToScreenReader('Race picker panel opened. Use search or filters to find a race.');
  };

  panel._close = () => {
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
    backdrop.setAttribute('aria-hidden', 'true');
    
    // Cleanup focus trap
    if (focusCleanup) {
      focusCleanup();
      focusCleanup = null;
    }
    
    // Cleanup swipe gesture
    if (swipeCleanup) {
      swipeCleanup();
      swipeCleanup = null;
    }
    
    // Reset transform
    content.style.transform = '';
    
    // Announce to screen readers
    announceToScreenReader('Race picker panel closed.');
    
    // Call onClose callback
    if (onClose) onClose();
  };

  // Backdrop click handler
  backdrop.addEventListener('click', () => {
    panel._close();
  });

  // Loading state
  panel._showLoading = () => {
    resultsContainer.innerHTML = createLoadingSkeleton();
    emptyState.classList.add('hidden');
  };

  // Error state
  panel._showError = (message) => {
    resultsContainer.innerHTML = createErrorState(message);
    emptyState.classList.add('hidden');
  };

  // Store references for updates
  // Store current filter state
  let currentYear = null;
  let currentCategory = ELECTION_CATEGORIES.ALL;
  
  panel._updateFilters = (counts, selectedYear, selectedCategory) => {
    currentYear = selectedYear;
    currentCategory = selectedCategory || ELECTION_CATEGORIES.ALL;
    updateFilterChips(yearFilters, 'year', counts.years, selectedYear, (year) => {
      if (onFilterChange) onFilterChange({ year, category: currentCategory });
    });
    updateFilterChips(categoryFilters, 'category', counts.categories, selectedCategory, (category) => {
      if (onFilterChange) onFilterChange({ year: currentYear, category });
    });
  };

  panel._updateResults = (grouped, searchQuery) => {
    updateResultsList(resultsContainer, grouped, searchQuery, onSelect, currentRace);
    const hasResults = grouped && grouped.length > 0;
    emptyState.classList.toggle('hidden', hasResults);
    resultsContainer.classList.toggle('hidden', !hasResults);
    
    // Setup keyboard navigation for results
    if (hasResults) {
      setupListKeyboardNavigation(
        resultsContainer,
        '.race-picker-race-item',
        (item) => {
          item.click();
        }
      );
    }
  };

  panel._updateRecentlyViewed = (recent, searchQuery = '') => {
    if (recent.length > 0) {
      const updated = createRecentlyViewedSection(recent, onSelect, currentRace, searchQuery);
      if (recentSection.parentNode) {
        recentSection.parentNode.replaceChild(updated, recentSection);
      }
    } else if (recentSection.parentNode) {
      recentSection.parentNode.removeChild(recentSection);
    }
  };

  panel._focusSearch = () => {
    searchInput.focus();
  };

  // Initialize as hidden
  panel.classList.add('hidden');
  panel.setAttribute('aria-hidden', 'true');

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
    }
  });

  return panel;
}

/**
 * Creates the recently viewed section
 */
function createRecentlyViewedSection(recentlyViewed, onSelect, currentRace, searchQuery = '') {
  const section = document.createElement('div');
  section.className = 'race-picker-recent';
  
  const header = document.createElement('div');
  header.className = 'race-picker-recent-header';
  header.innerHTML = `
    <h3 class="race-picker-recent-title">Recently Viewed</h3>
    <button 
      class="race-picker-recent-clear"
      aria-label="Clear recently viewed"
      type="button"
    >Clear</button>
  `;

  const list = document.createElement('div');
  list.className = 'race-picker-recent-list';
  list.setAttribute('role', 'list');

  recentlyViewed.forEach(entry => {
    const item = createRaceItem(entry, onSelect, currentRace, 'recent', searchQuery);
    item.setAttribute('role', 'listitem');
    list.appendChild(item);
  });

  header.querySelector('.race-picker-recent-clear').addEventListener('click', () => {
    if (window.clearRecentlyViewed) {
      window.clearRecentlyViewed();
      list.innerHTML = '';
      section.style.display = 'none';
    }
  });

  section.appendChild(header);
  section.appendChild(list);
  return section;
}

/**
 * Updates filter chips
 */
function updateFilterChips(container, type, counts, selected, onChange) {
  container.innerHTML = '';

  if (type === 'year') {
    // Add "All" option
    const allChip = createFilterChip('All', counts[null] || 0, selected === null, () => {
      onChange(null);
    });
    container.appendChild(allChip);

    // Add year chips
    Object.keys(counts)
      .filter(key => key !== 'null' && key !== null)
      .sort((a, b) => parseInt(b) - parseInt(a))
      .forEach(year => {
        const chip = createFilterChip(year, counts[year], selected === parseInt(year), () => {
          onChange(parseInt(year));
        });
        container.appendChild(chip);
      });
  } else if (type === 'category') {
    const categories = ['All', 'Federal', 'State', 'County', 'City', 'ISD', 'MUD'];
    categories.forEach(category => {
      const count = counts[category] || 0;
      const isSelected = (category === 'All' && selected === 'All') || category === selected;
      const chip = createFilterChip(category, count, isSelected, () => {
        onChange(category === 'All' ? 'All' : category);
      });
      container.appendChild(chip);
    });
  }
}

/**
 * Creates a filter chip button
 */
function createFilterChip(label, count, isSelected, onClick) {
  const chip = document.createElement('button');
  chip.className = `race-picker-filter-chip ${isSelected ? 'active' : ''}`;
  chip.setAttribute('role', 'radio');
  chip.setAttribute('aria-checked', isSelected);
  chip.innerHTML = `
    <span class="race-picker-filter-label">${label}</span>
    <span class="race-picker-filter-count">${count}</span>
  `;
  chip.addEventListener('click', onClick);
  return chip;
}

/**
 * Updates the results list with grouped elections
 */
function updateResultsList(container, grouped, searchQuery, onSelect, currentRace) {
  container.innerHTML = '';

  if (!grouped || grouped.length === 0) {
    return;
  }

  // Group by category for collapsible sections
  const byCategory = {};
  grouped.forEach(family => {
    const cat = family.category || 'County';
    if (!byCategory[cat]) {
      byCategory[cat] = [];
    }
    byCategory[cat].push(family);
  });

  const categories = ['Federal', 'State', 'County', 'City', 'ISD', 'MUD'];
  categories.forEach(category => {
    if (!byCategory[category] || byCategory[category].length === 0) {
      return;
    }

    const section = document.createElement('div');
    section.className = 'race-picker-group';
    
    const header = document.createElement('button');
    header.className = 'race-picker-group-header';
    header.innerHTML = `
      <span class="race-picker-group-title">${category}</span>
      <span class="race-picker-group-count">${byCategory[category].length}</span>
      <span class="race-picker-group-toggle">▼</span>
    `;
    header.setAttribute('aria-expanded', 'true');
    
    const list = document.createElement('div');
    list.className = 'race-picker-group-list';
    list.setAttribute('role', 'group');

    byCategory[category].forEach(family => {
      const item = createFamilyItem(family, searchQuery, onSelect, currentRace);
      list.appendChild(item);
    });

    header.addEventListener('click', () => {
      const isExpanded = header.getAttribute('aria-expanded') === 'true';
      header.setAttribute('aria-expanded', !isExpanded);
      list.classList.toggle('collapsed', isExpanded);
      header.querySelector('.race-picker-group-toggle').textContent = isExpanded ? '▶' : '▼';
    });

    section.appendChild(header);
    section.appendChild(list);
    container.appendChild(section);
  });
}

/**
 * Creates a race family item
 */
function createFamilyItem(family, searchQuery, onSelect, currentRace) {
  const item = document.createElement('div');
  item.className = 'race-picker-family';
  
  const title = document.createElement('div');
  title.className = 'race-picker-family-title';
  const titleText = getRaceFamilyDisplayName(family.familyKey);
  title.innerHTML = highlightMatches(titleText, searchQuery || '');
  
  const entries = document.createElement('div');
  entries.className = 'race-picker-family-entries';
  
  family.entries.forEach(entry => {
    const entryEl = createRaceItem(entry, onSelect, currentRace, 'result', searchQuery);
    entries.appendChild(entryEl);
  });

  item.appendChild(title);
  item.appendChild(entries);
  return item;
}

/**
 * Creates a race item (entry)
 */
function createRaceItem(entry, onSelect, currentRace, type = 'result') {
  const item = document.createElement('button');
  item.className = `race-picker-race-item ${type}`;
  if (entry.filename === currentRace) {
    item.classList.add('selected');
  }
  
  const displayName = entry.displayName || entry.filename.replace(/\.csv$/, '').replace(/_/g, ' ');
  const highlighted = highlightMatches(displayName, '');
  
  item.innerHTML = `
    <span class="race-picker-race-name">${highlighted}</span>
    ${entry.year ? `<span class="race-picker-race-year">${entry.year}</span>` : ''}
  `;
  
  item.addEventListener('click', () => {
    if (onSelect) onSelect(entry);
  });

  return item;
}
