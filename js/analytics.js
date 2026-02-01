// js/analytics.js
// ================
// Analytics & Performance Monitoring - Workstream H
// Event tracking and performance metrics

/**
 * Analytics configuration
 */
let analyticsConfig = {
  enabled: false,
  provider: null, // 'ga', 'mixpanel', 'custom', etc.
  customHandler: null
};

/**
 * Initialize analytics
 * @param {Object} config - Configuration object
 * @param {boolean} config.enabled - Enable/disable analytics
 * @param {string} config.provider - Analytics provider ('ga', 'mixpanel', 'custom')
 * @param {Function} config.customHandler - Custom event handler function
 */
export function initAnalytics(config = {}) {
  analyticsConfig = {
    enabled: config.enabled !== false,
    provider: config.provider || null,
    customHandler: config.customHandler || null
  };

  // Initialize provider-specific code if needed
  if (analyticsConfig.enabled && analyticsConfig.provider === 'ga' && window.gtag) {
    // Google Analytics already initialized
  } else if (analyticsConfig.enabled && analyticsConfig.provider === 'mixpanel' && window.mixpanel) {
    // Mixpanel already initialized
  }
}

/**
 * Track an event
 * @param {string} eventName - Event name
 * @param {Object} properties - Event properties
 */
export function trackEvent(eventName, properties = {}) {
  if (!analyticsConfig.enabled) {
    return;
  }

  const eventData = {
    event: eventName,
    timestamp: Date.now(),
    ...properties
  };

  // Custom handler takes precedence
  if (analyticsConfig.customHandler && typeof analyticsConfig.customHandler === 'function') {
    try {
      analyticsConfig.customHandler(eventName, eventData);
    } catch (error) {
      console.error('Error in custom analytics handler:', error);
    }
    return;
  }

  // Provider-specific tracking
  switch (analyticsConfig.provider) {
    case 'ga':
      if (window.gtag) {
        window.gtag('event', eventName, properties);
      }
      break;

    case 'mixpanel':
      if (window.mixpanel) {
        window.mixpanel.track(eventName, properties);
      }
      break;

    default:
      // No-op or console log for debugging
      if (process.env.NODE_ENV === 'development') {
        console.log('[Analytics]', eventName, properties);
      }
  }
}

/**
 * Track performance metric
 * @param {string} metricName - Metric name
 * @param {number} value - Metric value (milliseconds)
 * @param {Object} properties - Additional properties
 */
export function trackPerformance(metricName, value, properties = {}) {
  trackEvent('performance_metric', {
    metric: metricName,
    value: value,
    ...properties
  });
}

/**
 * Measure and track function execution time
 * @param {string} eventName - Event name
 * @param {Function} fn - Function to measure
 * @returns {Promise} Result of function execution
 */
export async function measurePerformance(eventName, fn) {
  const startTime = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - startTime;
    trackPerformance(eventName, duration);
    return result;
  } catch (error) {
    const duration = performance.now() - startTime;
    trackPerformance(eventName, duration, { error: true });
    throw error;
  }
}

/**
 * Track race picker panel events (Workstream H)
 */
export const RacePickerAnalytics = {
  opened: () => trackEvent('race_picker_opened'),
  closed: () => trackEvent('race_picker_closed'),
  selected: (race, source = 'unknown') => trackEvent('race_selected', { race, source }),
  filterApplied: (filterType, value) => trackEvent('filter_applied', { filterType, value }),
  searchPerformed: (query) => trackEvent('search_performed', { query }),
  recentlyViewedClicked: (race) => trackEvent('recently_viewed_clicked', { race }),
  dismissedGesture: () => trackEvent('panel_dismissed_gesture')
};

/**
 * Expose trackEvent globally for easy access
 */
if (typeof window !== 'undefined') {
  window.trackEvent = trackEvent;
  window.initAnalytics = initAnalytics;
}
