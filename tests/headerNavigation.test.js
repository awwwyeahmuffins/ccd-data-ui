// headerNavigation.test.js
// Unit tests for Workstream 1: Header & Navigation Redesign
// TDD approach - These tests define the expected structure and styling
// Run with: npm test -- headerNavigation.test.js

import { describe, it, expect, beforeAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Load the actual HTML and CSS files
const htmlPath = path.resolve(process.cwd(), 'index.html');
const cssPath = path.resolve(process.cwd(), 'styles.css');

let htmlContent;
let cssContent;

beforeAll(() => {
  htmlContent = fs.readFileSync(htmlPath, 'utf8');
  cssContent = fs.readFileSync(cssPath, 'utf8');
});

// ============================================================================
// TESTS FOR HTML STRUCTURE - HEADER BRAND/LOGO
// ============================================================================

describe('HTML: Header Brand & Logo', () => {
  it('should have a header-brand container element', () => {
    expect(htmlContent).toMatch(/class="header-brand"/);
  });

  it('should have a header-logo element', () => {
    expect(htmlContent).toMatch(/class="header-logo"/);
  });

  it('should have a header-title element', () => {
    expect(htmlContent).toMatch(/class="header-title"/);
  });

  it('should have "CC" text in the logo element', () => {
    // Match the logo span with CC text
    expect(htmlContent).toMatch(/class="header-logo"[^>]*>CC</);
  });

  it('should have "Collin County Elections" in the title', () => {
    expect(htmlContent).toMatch(/class="header-title"[^>]*>Collin County Elections</);
  });

  it('should have header-brand before view-buttons in the header', () => {
    // The header-brand should appear before view-buttons
    const brandIndex = htmlContent.indexOf('header-brand');
    const viewBtnsIndex = htmlContent.indexOf('class="view-buttons"');
    expect(brandIndex).toBeLessThan(viewBtnsIndex);
    expect(brandIndex).toBeGreaterThan(-1);
  });
});

// ============================================================================
// TESTS FOR HTML STRUCTURE - VIEW BUTTONS
// ============================================================================

describe('HTML: View Toggle Buttons', () => {
  it('should have a view-buttons navigation container', () => {
    expect(htmlContent).toMatch(/class="view-buttons"/);
  });

  it('should have view-dem-btn button', () => {
    expect(htmlContent).toMatch(/id="view-dem-btn"/);
  });

  it('should have view-elect-btn button', () => {
    expect(htmlContent).toMatch(/id="view-elect-btn"/);
  });

  it('should have view-turnout-btn button', () => {
    expect(htmlContent).toMatch(/id="view-turnout-btn"/);
  });

  it('should have aria-pressed attributes on view buttons', () => {
    expect(htmlContent).toMatch(/view-dem-btn[\s\S]*?aria-pressed/);
    expect(htmlContent).toMatch(/view-elect-btn[\s\S]*?aria-pressed/);
    expect(htmlContent).toMatch(/view-turnout-btn[\s\S]*?aria-pressed/);
  });

  it('should have aria-label attributes on view buttons', () => {
    expect(htmlContent).toMatch(/view-dem-btn[\s\S]*?aria-label/);
    expect(htmlContent).toMatch(/view-elect-btn[\s\S]*?aria-label/);
    expect(htmlContent).toMatch(/view-turnout-btn[\s\S]*?aria-label/);
  });
});

// ============================================================================
// TESTS FOR HTML STRUCTURE - HEADER LAYOUT
// ============================================================================

describe('HTML: Header Structure', () => {
  it('should have a header-bar element with id', () => {
    expect(htmlContent).toMatch(/id="header-bar"/);
  });

  it('should have role="banner" for accessibility', () => {
    expect(htmlContent).toMatch(/header.*role="banner"/i);
  });

  it('should have a spacer element', () => {
    expect(htmlContent).toMatch(/class="spacer"/);
  });

  it('should have header-actions container', () => {
    expect(htmlContent).toMatch(/class="header-actions"/);
  });
});

// ============================================================================
// TESTS FOR HTML STRUCTURE - SHARE BUTTON
// ============================================================================

describe('HTML: Share Button', () => {
  it('should have a copy-link-btn element', () => {
    expect(htmlContent).toMatch(/id="copy-link-btn"/);
  });

  it('should have copy-link-btn class', () => {
    // Match class attribute containing copy-link-btn (may have other classes)
    expect(htmlContent).toMatch(/class="[^"]*copy-link-btn[^"]*"/);
  });

  it('should have an SVG icon in the button', () => {
    // Look for svg within the copy-link-btn context
    expect(htmlContent).toMatch(/copy-link-btn[\s\S]*?<svg/);
  });

  it('should have "Share" text label', () => {
    expect(htmlContent).toMatch(/copy-link-btn[\s\S]*?>Share</);
  });

  it('should have aria-label attribute', () => {
    expect(htmlContent).toMatch(/copy-link-btn[\s\S]*?aria-label/);
  });

  it('should have title attribute for tooltip', () => {
    expect(htmlContent).toMatch(/copy-link-btn[\s\S]*?title=/);
  });
});

// ============================================================================
// TESTS FOR CSS - HEADER GRADIENT & SHADOW
// ============================================================================

describe('CSS: Header Styling', () => {
  it('should have a gradient background for header-bar', () => {
    // Check for gradient in header-bar styles - accepts either hardcoded colors or CSS variables
    const headerBarSection = cssContent.match(/#header-bar\s*\{[\s\S]*?\}/);
    expect(headerBarSection).not.toBeNull();
    // Accept gradient with either hardcoded colors or var(--color-primary) syntax
    expect(headerBarSection[0]).toMatch(/linear-gradient\s*\(\s*135deg.*?(#004aad|var\(--color-primary\))/);
  });

  it('should have enhanced box-shadow (4px or more) for header-bar', () => {
    // Extract header-bar styles and check for deeper shadow (hardcoded or variable)
    const headerBarSection = cssContent.match(/#header-bar\s*\{[\s\S]*?\}/);
    expect(headerBarSection).not.toBeNull();
    // Accept either hardcoded 0 4px shadow or var(--shadow-md)
    expect(headerBarSection[0]).toMatch(/box-shadow:\s*(0\s*4px|var\(--shadow-md\))/);
  });
});

// ============================================================================
// TESTS FOR CSS - VIEW BUTTON IMPROVEMENTS
// ============================================================================

describe('CSS: View Button Styling', () => {
  it('should have border-radius: 20px for pill shape on view-btn', () => {
    const viewBtnMatch = cssContent.match(/\.view-btn\s*\{[\s\S]*?border-radius:\s*20px/);
    expect(viewBtnMatch).not.toBeNull();
  });

  it('should have cubic-bezier transition for smooth animation', () => {
    const viewBtnSection = cssContent.match(/\.view-btn\s*\{[\s\S]*?\}/);
    expect(viewBtnSection).not.toBeNull();
    expect(viewBtnSection[0]).toMatch(/cubic-bezier/);
  });

  it('should have appropriate padding on view-btn (8px or var(--space-sm))', () => {
    const viewBtnSection = cssContent.match(/\.view-btn\s*\{[\s\S]*?\}/);
    expect(viewBtnSection).not.toBeNull();
    // Accept either hardcoded 8px 18px or CSS variable var(--space-sm) 18px
    expect(viewBtnSection[0]).toMatch(/padding:\s*(8px|var\(--space-sm\))\s*18px/);
  });

  it('should have view-btn.active with box-shadow', () => {
    expect(cssContent).toMatch(/\.view-btn\.active\s*\{[\s\S]*?box-shadow:/);
  });

  it('should have view-btn.active with transform translateY', () => {
    expect(cssContent).toMatch(/\.view-btn\.active\s*\{[\s\S]*?transform:\s*translateY/);
  });
});

// ============================================================================
// TESTS FOR CSS - HEADER BRAND STYLING
// ============================================================================

describe('CSS: Header Brand Styling', () => {
  it('should have header-brand with display: flex', () => {
    expect(cssContent).toMatch(/\.header-brand\s*\{[\s\S]*?display:\s*flex/);
  });

  it('should have header-brand with align-items: center', () => {
    expect(cssContent).toMatch(/\.header-brand\s*\{[\s\S]*?align-items:\s*center/);
  });

  it('should have header-brand with gap for spacing', () => {
    expect(cssContent).toMatch(/\.header-brand\s*\{[\s\S]*?gap:/);
  });

  it('should have header-logo styling defined', () => {
    expect(cssContent).toMatch(/\.header-logo\s*\{/);
  });

  it('should have header-title styling defined', () => {
    expect(cssContent).toMatch(/\.header-title\s*\{/);
  });

  it('should have header-logo with background color', () => {
    expect(cssContent).toMatch(/\.header-logo\s*\{[\s\S]*?background/);
  });

  it('should have header-logo with border-radius for rounded shape', () => {
    expect(cssContent).toMatch(/\.header-logo\s*\{[\s\S]*?border-radius/);
  });
});

// ============================================================================
// TESTS FOR CSS - SHARE BUTTON STYLING
// ============================================================================

describe('CSS: Share Button Styling', () => {
  it('should have copy-link-btn styling defined', () => {
    expect(cssContent).toMatch(/\.copy-link-btn\s*\{/);
  });

  it('should have copy-link-btn with display inline-flex', () => {
    expect(cssContent).toMatch(/\.copy-link-btn\s*\{[\s\S]*?display:\s*inline-flex/);
  });

  it('should have copy-link-btn hover state', () => {
    expect(cssContent).toMatch(/\.copy-link-btn:hover\s*\{/);
  });

  it('should have copy-link-btn transition for smooth effects', () => {
    expect(cssContent).toMatch(/\.copy-link-btn\s*\{[\s\S]*?transition/);
  });
});
