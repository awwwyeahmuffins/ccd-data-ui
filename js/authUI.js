// authUI.js
// --------------------------------------------------------------------------------
// Login / signup overlay and logout button UI.

import { signIn, signUp, confirmSignUp } from './auth.js';

// ---------------------------------------------------------------------------
// Overlay creation
// ---------------------------------------------------------------------------

function createAuthOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.className = 'auth-overlay';
  overlay.innerHTML = `
    <div class="auth-card">
      <h1 class="auth-title">Collin County Elections</h1>
      <p class="auth-subtitle">Sign in to access the election data viewer</p>

      <div class="auth-tabs">
        <button class="auth-tab active" data-tab="signin">Sign In</button>
        <button class="auth-tab" data-tab="signup">Sign Up</button>
      </div>

      <div class="auth-error" id="auth-error" style="display:none;"></div>

      <!-- Sign In Form -->
      <form class="auth-form" id="signin-form">
        <div class="auth-field">
          <label for="signin-email">Email</label>
          <input type="email" id="signin-email" required autocomplete="email" />
        </div>
        <div class="auth-field">
          <label for="signin-password">Password</label>
          <input type="password" id="signin-password" required autocomplete="current-password" />
        </div>
        <button type="submit" class="auth-submit" id="signin-btn">Sign In</button>
      </form>

      <!-- Sign Up Form -->
      <form class="auth-form" id="signup-form" style="display:none;">
        <div class="auth-field">
          <label for="signup-email">Email</label>
          <input type="email" id="signup-email" required autocomplete="email" />
        </div>
        <div class="auth-field">
          <label for="signup-password">Password</label>
          <input type="password" id="signup-password" required autocomplete="new-password" />
        </div>
        <div class="auth-field">
          <label for="signup-password-confirm">Confirm Password</label>
          <input type="password" id="signup-password-confirm" required autocomplete="new-password" />
        </div>
        <button type="submit" class="auth-submit" id="signup-btn">Create Account</button>
      </form>

      <!-- Verification Form -->
      <form class="auth-form" id="verify-form" style="display:none;">
        <p class="auth-verify-msg">A verification code was sent to your email.</p>
        <div class="auth-field">
          <label for="verify-code">Verification Code</label>
          <input type="text" id="verify-code" required autocomplete="one-time-code" inputmode="numeric" />
        </div>
        <button type="submit" class="auth-submit" id="verify-btn">Verify</button>
      </form>
    </div>
  `;
  return overlay;
}

// ---------------------------------------------------------------------------
// Wire up event listeners
// ---------------------------------------------------------------------------

function bindEvents(overlay) {
  const tabs = overlay.querySelectorAll('.auth-tab');
  const signinForm = overlay.querySelector('#signin-form');
  const signupForm = overlay.querySelector('#signup-form');
  const verifyForm = overlay.querySelector('#verify-form');
  const errorEl = overlay.querySelector('#auth-error');

  let pendingEmail = '';

  // Tab switching
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      hideError();
      if (tab.dataset.tab === 'signin') {
        signinForm.style.display = '';
        signupForm.style.display = 'none';
        verifyForm.style.display = 'none';
      } else {
        signinForm.style.display = 'none';
        signupForm.style.display = '';
        verifyForm.style.display = 'none';
      }
    });
  });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
  function hideError() {
    errorEl.style.display = 'none';
  }
  function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.textContent = loading ? 'Please wait...' : btn.dataset.originalText || btn.textContent;
  }

  // Store original button text
  overlay.querySelectorAll('.auth-submit').forEach((btn) => {
    btn.dataset.originalText = btn.textContent;
  });

  // Sign In
  signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const email = overlay.querySelector('#signin-email').value.trim();
    const password = overlay.querySelector('#signin-password').value;
    const btn = overlay.querySelector('#signin-btn');
    setLoading(btn, true);
    try {
      await signIn(email, password);
    } catch (err) {
      showError(err.message || 'Sign in failed');
    } finally {
      setLoading(btn, false);
    }
  });

  // Sign Up
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const email = overlay.querySelector('#signup-email').value.trim();
    const password = overlay.querySelector('#signup-password').value;
    const confirm = overlay.querySelector('#signup-password-confirm').value;

    if (password !== confirm) {
      showError('Passwords do not match');
      return;
    }

    const btn = overlay.querySelector('#signup-btn');
    setLoading(btn, true);
    try {
      await signUp(email, password);
      pendingEmail = email;
      signinForm.style.display = 'none';
      signupForm.style.display = 'none';
      verifyForm.style.display = '';
      tabs.forEach((t) => t.classList.remove('active'));
    } catch (err) {
      showError(err.message || 'Sign up failed');
    } finally {
      setLoading(btn, false);
    }
  });

  // Verify
  verifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const code = overlay.querySelector('#verify-code').value.trim();
    const btn = overlay.querySelector('#verify-btn');
    setLoading(btn, true);
    try {
      await confirmSignUp(pendingEmail, code);
      // Switch to sign-in form after successful verification
      verifyForm.style.display = 'none';
      signinForm.style.display = '';
      tabs.forEach((t) => t.classList.remove('active'));
      tabs[0].classList.add('active');
      showError(''); // clear
      errorEl.style.display = 'block';
      errorEl.style.color = 'var(--success, #22c55e)';
      errorEl.textContent = 'Account verified! Please sign in.';
    } catch (err) {
      showError(err.message || 'Verification failed');
    } finally {
      setLoading(btn, false);
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let overlayEl = null;

export function showAuthOverlay() {
  if (!overlayEl) {
    overlayEl = createAuthOverlay();
    bindEvents(overlayEl);
    document.body.appendChild(overlayEl);
  }
  overlayEl.style.display = 'flex';
}

export function hideAuthOverlay() {
  if (overlayEl) {
    overlayEl.style.display = 'none';
  }
}
