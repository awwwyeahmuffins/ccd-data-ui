// skeletonLoader.js
// ===================
// Skeleton loading utilities for UI/UX improvement (Workstream 4)
// Provides reusable skeleton placeholders to prevent layout shifts during data loading

/**
 * Create a skeleton text placeholder
 * @param {Object} options - Configuration options
 * @param {string} options.width - Width of the skeleton (default: '100%')
 * @param {string} options.height - Height of the skeleton (default: '16px')
 * @returns {string} HTML string for skeleton text
 */
export function createSkeletonText(options = {}) {
  const { width = '100%', height = '16px' } = options;
  return `<div class="skeleton skeleton-text" style="width: ${width}; height: ${height};" aria-hidden="true"></div>`;
}

/**
 * Create a skeleton title placeholder (larger than text)
 * @param {Object} options - Configuration options
 * @param {string} options.width - Width of the skeleton (default: '60%')
 * @param {string} options.height - Height of the skeleton (default: '24px')
 * @returns {string} HTML string for skeleton title
 */
export function createSkeletonTitle(options = {}) {
  const { width = '60%', height = '24px' } = options;
  return `<div class="skeleton skeleton-title" style="width: ${width}; height: ${height};" aria-hidden="true"></div>`;
}

/**
 * Create a skeleton card placeholder
 * @param {Object} options - Configuration options
 * @param {string} options.height - Height of the card (default: '120px')
 * @returns {string} HTML string for skeleton card
 */
export function createSkeletonCard(options = {}) {
  const { height = '120px' } = options;
  return `<div class="skeleton skeleton-card" style="height: ${height};" role="status" aria-label="Loading content"></div>`;
}

/**
 * Create a skeleton stat grid (used in summary sections)
 * @param {number} count - Number of stat items (default: 4)
 * @returns {string} HTML string for skeleton stat grid
 */
export function createSkeletonStatGrid(count = 4) {
  let items = [];
  for (let i = 0; i < count; i++) {
    items.push(`
      <div class="skeleton-stat-item">
        <div class="skeleton skeleton-stat-value" aria-hidden="true"></div>
        <div class="skeleton skeleton-stat-label" aria-hidden="true"></div>
      </div>
    `);
  }
  return `<div class="skeleton-stat-grid">${items.join('')}</div>`;
}

/**
 * Create a skeleton list (used for leaderboards, results lists)
 * @param {number} count - Number of list items (default: 5)
 * @returns {string} HTML string for skeleton list
 */
export function createSkeletonList(count = 5) {
  let items = [];
  for (let i = 0; i < count; i++) {
    const delay = (i + 1) * 0.05;
    items.push(`
      <div class="skeleton-list-item stagger-item" style="animation-delay: ${delay}s;">
        <div class="skeleton skeleton-list-rank" aria-hidden="true"></div>
        <div class="skeleton skeleton-list-content" aria-hidden="true"></div>
        <div class="skeleton skeleton-list-value" aria-hidden="true"></div>
      </div>
    `);
  }
  return `<div class="skeleton-list">${items.join('')}</div>`;
}

/**
 * Create a loading spinner element
 * @param {Object} options - Configuration options
 * @param {string} options.label - Aria label (default: 'Loading...')
 * @param {string} options.size - Size variant: 'small' | 'default' | 'large'
 * @returns {string} HTML string for loading spinner
 */
export function createLoadingSpinner(options = {}) {
  const { label = 'Loading...', size = 'default' } = options;
  const sizeClass = size === 'default' ? '' : ` ${size}`;
  return `<div class="loading-spinner${sizeClass}" role="status" aria-label="${label}"></div>`;
}

/**
 * Skeleton variants for different views
 */
export let SKELETON_VARIANTS = {
  /**
   * Demographics view skeleton
   */
  demographics: () => `
    <div class="sidebar-skeleton" role="status" aria-live="polite">
      <span class="sr-only">Loading demographics data...</span>
      ${createSkeletonTitle({ width: '70%' })}
      <div style="margin: 16px 0;">
        ${createSkeletonText({ width: '40%', height: '36px' })}
      </div>
      ${createSkeletonText({ width: '85%' })}
      ${createSkeletonText({ width: '90%' })}
      <div style="margin-top: 24px;">
        ${createSkeletonCard({ height: '150px' })}
      </div>
    </div>
  `,

  /**
   * Election view skeleton
   */
  election: () => `
    <div class="sidebar-skeleton" role="status" aria-live="polite">
      <span class="sr-only">Loading election data...</span>
      ${createSkeletonTitle({ width: '65%' })}
      <div style="margin: 16px 0;">
        ${createSkeletonText({ width: '100%', height: '40px' })}
      </div>
      <div style="margin: 16px 0;">
        ${createSkeletonText({ width: '100%', height: '36px' })}
      </div>
      ${createSkeletonText({ width: '80%' })}
      <div style="margin-top: 24px;">
        <div class="skeleton-section-title" style="margin-bottom: 12px;">
          ${createSkeletonText({ width: '50%' })}
        </div>
        ${createSkeletonStatGrid(3)}
      </div>
      <div style="margin-top: 24px;">
        ${createSkeletonCard({ height: '100px' })}
      </div>
    </div>
  `,

  /**
   * Turnout view skeleton
   */
  turnout: () => `
    <div class="sidebar-skeleton" role="status" aria-live="polite">
      <span class="sr-only">Loading turnout data...</span>
      ${createSkeletonTitle({ width: '60%' })}
      <div style="margin: 16px 0;">
        ${createSkeletonText({ width: '100%', height: '36px' })}
      </div>
      <div style="margin-top: 24px;">
        ${createSkeletonStatGrid(4)}
      </div>
      <div style="margin-top: 24px;">
        <div class="skeleton-section-title" style="margin-bottom: 12px;">
          ${createSkeletonText({ width: '45%' })}
        </div>
        ${createSkeletonList(5)}
      </div>
    </div>
  `,

  /**
   * Precinct details skeleton
   */
  precinctDetails: () => `
    <div class="sidebar-skeleton precinct-skeleton" role="status" aria-live="polite">
      <span class="sr-only">Loading precinct details...</span>
      <hr>
      ${createSkeletonTitle({ width: '50%' })}
      <div style="margin: 12px 0;">
        ${createSkeletonText({ width: '70%' })}
        ${createSkeletonText({ width: '60%' })}
        ${createSkeletonText({ width: '65%' })}
      </div>
      <div style="margin-top: 16px;">
        ${createSkeletonStatGrid(3)}
      </div>
    </div>
  `
};

/**
 * Create a complete sidebar skeleton based on view type
 * @param {string} viewType - Type of view ('demographics' | 'election' | 'turnout')
 * @returns {string} HTML string for sidebar skeleton
 */
export function createSidebarSkeleton(viewType) {
  let variant = SKELETON_VARIANTS[viewType];
  if (variant) {
    return variant();
  }
  // Default fallback skeleton
  return `
    <div class="sidebar-skeleton" role="status" aria-live="polite">
      <span class="sr-only">Loading content...</span>
      ${createSkeletonTitle()}
      ${createSkeletonText()}
      ${createSkeletonText({ width: '85%' })}
      <div style="margin-top: 16px;">
        ${createSkeletonCard()}
      </div>
    </div>
  `;
}

/**
 * Fade in content after loading completes
 * Replaces skeleton with actual content using fade animation
 * @param {HTMLElement} container - The container element
 * @param {string} content - The HTML content to display
 */
export function fadeInContent(container, content) {
  if (!container) return;
  
  // Remove skeleton loading class
  container.classList.remove('skeleton-loading');
  
  // Set the new content
  container.innerHTML = content;
  
  // Add fade-in animation class
  container.classList.add('fade-in');
}

/**
 * Show skeleton loading state in a container
 * @param {HTMLElement} container - The container element
 * @param {string} viewType - Type of view for appropriate skeleton
 */
export function showSkeletonLoading(container, viewType) {
  if (!container) return;
  
  container.classList.add('skeleton-loading');
  container.innerHTML = createSidebarSkeleton(viewType);
}

/**
 * Create a precinct details skeleton for the sidebar
 * @returns {string} HTML string for precinct details skeleton
 */
export function createPrecinctDetailsSkeleton() {
  return SKELETON_VARIANTS.precinctDetails();
}

/**
 * Create an inline loading spinner with text
 * @param {string} message - Loading message
 * @returns {string} HTML string for loading state
 */
export function createLoadingState(message = 'Loading...') {
  return `
    <div class="loading-state" role="status" aria-live="polite">
      ${createLoadingSpinner()}
      <p>${message}</p>
    </div>
  `;
}

/**
 * Create an error state display
 * @param {string} title - Error title
 * @param {string} message - Error message
 * @param {boolean} showRetry - Whether to show retry button
 * @returns {string} HTML string for error state
 */
export function createErrorState(title = 'Unable to load data', message = 'Please check your connection and try again.', showRetry = true) {
  const retryButton = showRetry 
    ? '<button onclick="location.reload()" class="retry-btn">Retry</button>'
    : '';
  
  return `
    <div class="error-state" role="alert">
      <h3>${title}</h3>
      <p>${message}</p>
      ${retryButton}
    </div>
  `;
}

/**
 * Create an empty state display
 * @param {string} message - Empty state message
 * @param {string} icon - Optional SVG icon
 * @returns {string} HTML string for empty state
 */
export function createEmptyState(message = 'No data available', icon = '') {
  return `
    <div class="empty-state" role="status">
      ${icon}
      <p>${message}</p>
    </div>
  `;
}
