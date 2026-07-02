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
          <input type="password" id="signup-password" required autocomplete="new-password" aria-describedby="password-rules" />
          <p class="auth-hint" id="password-rules">At least 8 characters, with an uppercase letter, a lowercase letter, and a number.</p>
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

  // Translate raw Cognito error messages into plain sentences.
  function friendlyError(err, fallback) {
    const raw = err?.message || '';
    const code = err?.code || err?.name || '';
    if (code === 'NotAuthorizedException' || /incorrect username or password/i.test(raw)) {
      return "That email and password don't match. Please check both and try again.";
    }
    if (code === 'UserNotFoundException') {
      return "We couldn't find an account with that email. Check the spelling, or use Sign Up to create one.";
    }
    if (code === 'UsernameExistsException') {
      return 'An account with that email already exists. Use the Sign In tab instead.';
    }
    if (code === 'InvalidPasswordException' || /password did not conform|password policy/i.test(raw)) {
      return "That password doesn't meet the requirements: at least 8 characters, with an uppercase letter, a lowercase letter, and a number.";
    }
    if (code === 'LimitExceededException' || code === 'TooManyRequestsException') {
      return 'Too many attempts — please wait a few minutes and try again.';
    }
    if (code === 'CodeMismatchException') {
      return "That code doesn't match the one we emailed you. Please check and re-enter it.";
    }
    if (code === 'ExpiredCodeException') {
      return 'That code has expired. Sign up again to get a fresh one.';
    }
    if (/network/i.test(raw)) {
      return "We couldn't reach the sign-in service. Check your internet connection and try again.";
    }
    return raw || fallback;
  }

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
      showError(friendlyError(err, 'Sign in failed. Please try again.'));
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
      const result = await signUp(email, password);
      if (result && result.userConfirmed) {
        // Verification is disabled (Pre-Sign-up trigger auto-confirms): sign
        // the new account straight in, no code step.
        await signIn(email, password);
      } else {
        // Fallback: verification still required — show the code form.
        pendingEmail = email;
        signinForm.style.display = 'none';
        signupForm.style.display = 'none';
        verifyForm.style.display = '';
        tabs.forEach((t) => t.classList.remove('active'));
      }
    } catch (err) {
      showError(friendlyError(err, 'Sign up failed. Please try again.'));
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
      showError(friendlyError(err, 'Verification failed. Please try again.'));
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
