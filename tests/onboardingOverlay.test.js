// onboardingOverlay.test.js
// Unit tests for the Getting Started overlay (A1)

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  shouldShowOnboarding,
  generateOnboardingHTML,
  dismissOnboarding
} from './onboardingOverlay.js';

describe('shouldShowOnboarding', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns true when storage key is absent', () => {
    expect(shouldShowOnboarding()).toBe(true);
  });

  it('returns false when storage key is set', () => {
    localStorage.setItem('cce_onboarding_seen', 'true');
    expect(shouldShowOnboarding()).toBe(false);
  });
});

describe('generateOnboardingHTML', () => {
  it('returns HTML containing 4 action cards', () => {
    let html = generateOnboardingHTML();
    let matches = html.match(/data-action="/g);
    // 4 cards + 1 dismiss = 5 total data-action attributes
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(5);
  });

  it('contains demographics action', () => {
    let html = generateOnboardingHTML();
    expect(html).toContain('data-action="demographics"');
  });

  it('contains election action', () => {
    let html = generateOnboardingHTML();
    expect(html).toContain('data-action="election"');
  });

  it('contains election-simulator action', () => {
    let html = generateOnboardingHTML();
    expect(html).toContain('data-action="election-simulator"');
  });

  it('contains precinct-lookup action', () => {
    let html = generateOnboardingHTML();
    expect(html).toContain('data-action="precinct-lookup"');
  });

  it('contains dismiss action', () => {
    let html = generateOnboardingHTML();
    expect(html).toContain('data-action="dismiss"');
  });
});

describe('dismissOnboarding', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sets the storage key', () => {
    // Create a minimal backdrop element for dismissOnboarding to work with
    let backdrop = document.createElement('div');
    backdrop.className = 'onboarding-backdrop';
    document.body.appendChild(backdrop);

    dismissOnboarding(backdrop);
    expect(localStorage.getItem('cce_onboarding_seen')).toBe('true');

    // Clean up
    if (backdrop.parentNode) backdrop.remove();
  });

  it('shouldShowOnboarding returns false after dismissal', () => {
    let backdrop = document.createElement('div');
    backdrop.className = 'onboarding-backdrop';
    document.body.appendChild(backdrop);

    dismissOnboarding(backdrop);
    expect(shouldShowOnboarding()).toBe(false);

    if (backdrop.parentNode) backdrop.remove();
  });
});
