// onboardingOverlay.js
// --------------------------------------------------------------------------------
// Getting Started overlay for first-time users.
// Shows 4 action cards: Demographics, Elections, Forecast, Precinct Lookup.

const STORAGE_KEY = 'cce_onboarding_seen';

/**
 * Check whether the onboarding overlay should be shown.
 * @returns {boolean} true if the user has never dismissed the overlay
 */
export function shouldShowOnboarding() {
  return !localStorage.getItem(STORAGE_KEY);
}

/**
 * Generate the HTML for the onboarding modal content.
 * @returns {string} HTML string with 4 action cards and a dismiss link
 */
export function generateOnboardingHTML() {
  return `
    <div class="onboarding-modal">
      <div class="onboarding-title">Welcome to Collin County Elections</div>
      <div class="onboarding-subtitle">Choose where to start exploring election data.</div>
      <div class="onboarding-cards">
        <div class="onboarding-card" data-action="demographics">
          <div class="onboarding-card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div class="onboarding-card-text">
            <h3>Explore Demographics</h3>
            <p>View party affiliation and racial demographics across precincts.</p>
          </div>
        </div>
        <div class="onboarding-card" data-action="election">
          <div class="onboarding-card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="1" y="3" width="15" height="13" rx="2"/>
              <path d="M16 8h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2"/>
              <polyline points="5 10 8 13 12 7"/>
            </svg>
          </div>
          <div class="onboarding-card-text">
            <h3>Browse Election Results</h3>
            <p>See precinct-level results for every race in the county.</p>
          </div>
        </div>
        <div class="onboarding-card" data-action="election-simulator">
          <div class="onboarding-card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <div class="onboarding-card-text">
            <h3>Forecast Scenarios</h3>
            <p>Simulate turnout changes and see how they shift election outcomes.</p>
          </div>
        </div>
        <div class="onboarding-card" data-action="precinct-lookup">
          <div class="onboarding-card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <div class="onboarding-card-text">
            <h3>Look Up a Precinct</h3>
            <p>Get a full profile for any precinct: census, party, election history.</p>
          </div>
        </div>
      </div>
      <button class="onboarding-dismiss" data-action="dismiss">Skip for now</button>
    </div>
  `;
}

/**
 * Mount and display the onboarding overlay.
 * @param {function} onAction - Callback receiving the action id when a card is clicked
 */
export function showOnboardingOverlay(onAction) {
  let backdrop = document.createElement('div');
  backdrop.className = 'onboarding-backdrop';
  backdrop.innerHTML = generateOnboardingHTML();
  document.body.appendChild(backdrop);

  // Fade in on next frame
  requestAnimationFrame(function startFade() {
    backdrop.classList.add('visible');
  });

  // Wire card clicks
  backdrop.querySelectorAll('.onboarding-card').forEach(function attachCard(card) {
    card.addEventListener('click', function onCardClick() {
      let action = card.dataset.action;
      dismissOnboarding(backdrop);
      if (onAction) onAction(action);
    });
  });

  // Wire dismiss
  let dismissBtn = backdrop.querySelector('.onboarding-dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', function onDismiss() {
      dismissOnboarding(backdrop);
    });
  }
}

/**
 * Dismiss the overlay: persist to localStorage, fade out, and remove.
 * @param {HTMLElement} [backdrop] - The backdrop element to remove. If omitted, looks for it in the DOM.
 */
export function dismissOnboarding(backdrop) {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch (e) {
    // localStorage unavailable (private browsing, quota) — still dismiss the overlay
  }
  let el = backdrop || document.querySelector('.onboarding-backdrop');
  if (!el) return;
  el.classList.remove('visible');
  el.addEventListener('transitionend', function onEnd() {
    el.remove();
  }, { once: true });
  // Fallback removal if transitionend doesn't fire
  setTimeout(function fallbackRemove() {
    if (el.parentNode) el.remove();
  }, 500);
}
