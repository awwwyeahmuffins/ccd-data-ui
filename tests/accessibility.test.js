// accessibility.test.js
// TDD tests for Workstream 5: Accessibility & Responsive Improvements
// Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js accessibility.test.js

import { describe, it, expect, beforeAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';

/**
 * @fileoverview
 * Tests for accessibility improvements including:
 * - Skip link for keyboard navigation
 * - ARIA attributes on interactive regions
 * - Focus indicator requirements
 * - Mobile responsive sidebar behavior
 * 
 * These tests validate HTML structure and CSS presence.
 * For actual DOM testing with user interaction, use Playwright or Cypress.
 */

describe('Workstream 5: Accessibility & Responsive Improvements', () => {
  let htmlContent;
  let cssContent;

  beforeAll(() => {
    // Load actual HTML file
    const htmlPath = path.resolve(process.cwd(), 'index.html');
    htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    
    // Load actual CSS file
    const cssPath = path.resolve(process.cwd(), 'styles.css');
    cssContent = fs.readFileSync(cssPath, 'utf-8');
  });

  // ============================================================================
  // SKIP LINK TESTS
  // ============================================================================

  describe('Skip Link', () => {
    it('should have a skip link element in HTML', () => {
      // Skip link should exist with class or specific ID
      expect(htmlContent).toMatch(/class=["']skip-link["']/);
    });

    it('skip link should be an anchor targeting main content', () => {
      // Should be <a> tag with href="#main-container"
      expect(htmlContent).toMatch(/<a[^>]+href=["']#main-container["'][^>]*class=["']skip-link["']/);
    });

    it('skip link should contain accessible text', () => {
      // Extract skip link and check it has text content
      const skipLinkMatch = htmlContent.match(/<a[^>]+class=["']skip-link["'][^>]*>([^<]+)<\/a>/);
      expect(skipLinkMatch).not.toBeNull();
      expect(skipLinkMatch[1]).toMatch(/skip/i);
    });

    it('skip link should appear early in the document (before header)', () => {
      const skipLinkIndex = htmlContent.indexOf('skip-link');
      const headerIndex = htmlContent.indexOf('id="header-bar"');
      expect(skipLinkIndex).toBeLessThan(headerIndex);
    });

    it('skip link CSS should position off-screen by default', () => {
      // Verify CSS contains skip-link styles for off-screen positioning
      expect(cssContent).toMatch(/\.skip-link\s*\{[^}]*position:\s*absolute/);
    });

    it('skip link CSS should become visible on focus', () => {
      // Verify CSS contains :focus state that brings skip link on screen
      expect(cssContent).toMatch(/\.skip-link:focus\s*\{[^}]*top:\s*0/);
    });
  });

  // ============================================================================
  // ARIA ATTRIBUTES TESTS
  // ============================================================================

  describe('ARIA Attributes', () => {
    it('sidebar should have role="region"', () => {
      expect(htmlContent).toMatch(/id=["']sidebar["'][^>]*role=["']region["']/);
    });

    it('sidebar should have descriptive aria-label', () => {
      expect(htmlContent).toMatch(/id=["']sidebar["'][^>]*aria-label=["'][^"']+["']/);
    });

    it('map should have role="application" or role="region"', () => {
      expect(htmlContent).toMatch(/id=["']map["'][^>]*role=["'](application|region)["']/);
    });

    it('map should have descriptive aria-label', () => {
      expect(htmlContent).toMatch(/id=["']map["'][^>]*aria-label=["'][^"']+["']/);
    });

    it('view buttons should have aria-pressed attribute', () => {
      // All view-btn elements should have aria-pressed
      const viewBtnMatches = htmlContent.match(/class=["']view-btn[^"']*["'][^>]*/g) || [];
      expect(viewBtnMatches.length).toBeGreaterThan(0);
      viewBtnMatches.forEach(match => {
        expect(match).toMatch(/aria-pressed=["'](true|false)["']/);
      });
    });

    it('view buttons should have aria-label attributes', () => {
      const viewBtnMatches = htmlContent.match(/class=["']view-btn[^"']*["'][^>]*/g) || [];
      expect(viewBtnMatches.length).toBeGreaterThan(0);
      viewBtnMatches.forEach(match => {
        expect(match).toMatch(/aria-label=["'][^"']+["']/);
      });
    });

    it('toast container should have aria-live attribute', () => {
      expect(htmlContent).toMatch(/id=["']toast-container["'][^>]*aria-live=["']polite["']/);
    });

    it('main container should have role="main"', () => {
      expect(htmlContent).toMatch(/id=["']main-container["'][^>]*role=["']main["']/);
    });

    it('SVG icons should have aria-hidden="true"', () => {
      // All SVGs should have aria-hidden for decorative icons
      const svgMatches = htmlContent.match(/<svg[^>]*/g) || [];
      expect(svgMatches.length).toBeGreaterThan(0);
      svgMatches.forEach(match => {
        expect(match).toMatch(/aria-hidden=["']true["']/);
      });
    });
  });

  // ============================================================================
  // FOCUS INDICATOR TESTS
  // ============================================================================

  describe('Focus Indicators', () => {
    it('should have :focus-visible styles defined', () => {
      expect(cssContent).toMatch(/:focus-visible\s*\{/);
    });

    it('focus indicator should use high-visibility outline', () => {
      // Check for outline property in focus-visible styles
      expect(cssContent).toMatch(/:focus-visible\s*\{[^}]*outline:/);
    });

    it('focus indicator should have outline-offset', () => {
      // Should have outline-offset for better visibility
      expect(cssContent).toMatch(/:focus-visible\s*\{[^}]*outline-offset:/);
    });

    it('buttons should have focus-visible styles', () => {
      // Verify button-specific focus styles
      expect(cssContent).toMatch(/button:focus-visible/);
    });

    it('links should have focus-visible styles', () => {
      expect(cssContent).toMatch(/a:focus-visible/);
    });

    it('focus outline color should be high-visibility yellow', () => {
      // Yellow (#FFC800) for high visibility focus
      expect(cssContent).toMatch(/outline.*#FFC800/i);
    });
  });

  // ============================================================================
  // HIGH CONTRAST MODE TESTS
  // ============================================================================

  describe('High Contrast Mode Support', () => {
    it('should have prefers-contrast media query', () => {
      expect(cssContent).toMatch(/@media\s*\(\s*prefers-contrast:\s*high\s*\)/);
    });

    it('high contrast mode should enhance view button borders', () => {
      // Check that somewhere in the file, within a prefers-contrast: high block,
      // we have .view-btn styles with border-width
      // Match all high contrast blocks
      const allHighContrastBlocks = cssContent.match(
        /@media\s*\(\s*prefers-contrast:\s*high\s*\)\s*\{[\s\S]*?\n\}/g
      );
      expect(allHighContrastBlocks).not.toBeNull();
      
      // At least one block should contain view-btn border enhancement
      const hasViewBtnEnhancement = allHighContrastBlocks.some(block => 
        block.includes('.view-btn') && block.includes('border-width')
      );
      expect(hasViewBtnEnhancement).toBe(true);
    });

    it('high contrast mode should enhance legend swatches', () => {
      const allHighContrastBlocks = cssContent.match(
        /@media\s*\(\s*prefers-contrast:\s*high\s*\)\s*\{[\s\S]*?\n\}/g
      );
      expect(allHighContrastBlocks).not.toBeNull();
      
      // At least one block should contain legend-swatch enhancement
      const hasLegendSwatchEnhancement = allHighContrastBlocks.some(block => 
        block.includes('.legend-swatch')
      );
      expect(hasLegendSwatchEnhancement).toBe(true);
    });
  });

  // ============================================================================
  // MOBILE RESPONSIVE SIDEBAR TESTS
  // ============================================================================

  describe('Mobile Responsive Sidebar', () => {
    it('should have mobile breakpoint media query', () => {
      expect(cssContent).toMatch(/@media\s*\(\s*max-width:\s*800px\s*\)/);
    });

    it('mobile sidebar should use fixed positioning for slide-out', () => {
      // In mobile, sidebar should be fixed position
      const mobileStyles = extractMobileStyles(cssContent);
      expect(mobileStyles).toMatch(/#sidebar\s*\{[^}]*position:\s*fixed/);
    });

    it('mobile sidebar should have transform for slide animation', () => {
      const mobileStyles = extractMobileStyles(cssContent);
      expect(mobileStyles).toMatch(/#sidebar\s*\{[^}]*transform:\s*translateX/);
    });

    it('mobile sidebar should have transition for smooth animation', () => {
      const mobileStyles = extractMobileStyles(cssContent);
      expect(mobileStyles).toMatch(/#sidebar\s*\{[^}]*transition/);
    });

    it('should have sidebar overlay class defined', () => {
      expect(cssContent).toMatch(/\.sidebar-overlay\s*\{/);
    });

    it('sidebar overlay should have fixed position', () => {
      expect(cssContent).toMatch(/\.sidebar-overlay\s*\{[^}]*position:\s*fixed/);
    });

    it('sidebar overlay should cover full viewport with inset', () => {
      expect(cssContent).toMatch(/\.sidebar-overlay\s*\{[^}]*inset:\s*0/);
    });

    it('sidebar overlay should have semi-transparent dark background', () => {
      expect(cssContent).toMatch(/\.sidebar-overlay\s*\{[^}]*background:\s*rgba\(\s*0,\s*0,\s*0/);
    });

    it('open sidebar should have translateX(0)', () => {
      // Either in mobile block or general styles
      expect(cssContent).toMatch(/#sidebar\.open\s*\{[^}]*transform:\s*translateX\(\s*0\s*\)/);
    });

    it('sidebar should have proper z-index for layering', () => {
      const mobileStyles = extractMobileStyles(cssContent);
      expect(mobileStyles).toMatch(/#sidebar\s*\{[^}]*z-index:\s*\d+/);
    });
  });

  // ============================================================================
  // SCREEN READER UTILITIES
  // ============================================================================

  describe('Screen Reader Utilities', () => {
    it('should have sr-only class for visually hidden content', () => {
      expect(cssContent).toMatch(/\.sr-only\s*\{/);
    });

    it('sr-only should use standard accessible hiding technique', () => {
      const srOnlyBlock = cssContent.match(/\.sr-only\s*\{[^}]+\}/);
      expect(srOnlyBlock).not.toBeNull();
      
      const srOnlyCSS = srOnlyBlock[0];
      expect(srOnlyCSS).toMatch(/position:\s*absolute/);
      expect(srOnlyCSS).toMatch(/width:\s*1px/);
      expect(srOnlyCSS).toMatch(/height:\s*1px/);
      expect(srOnlyCSS).toMatch(/overflow:\s*hidden/);
      expect(srOnlyCSS).toMatch(/clip:\s*rect\(\s*0,\s*0,\s*0,\s*0\s*\)/);
    });
  });

  // ============================================================================
  // REDUCED MOTION TESTS
  // ============================================================================

  describe('Reduced Motion Support', () => {
    it('should have prefers-reduced-motion media query', () => {
      expect(cssContent).toMatch(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
    });

    it('reduced motion should disable or reduce animations', () => {
      const reducedMotionBlock = cssContent.match(
        /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\n\}/
      );
      expect(reducedMotionBlock).not.toBeNull();
      // Should reduce transitions or animations
      expect(reducedMotionBlock[0]).toMatch(/(transition|animation)/);
    });
  });
});

// Helper function to extract mobile media query styles
function extractMobileStyles(css) {
  // Find the 800px mobile media query block
  const mediaMatches = css.match(
    /@media\s*\(\s*max-width:\s*800px\s*\)\s*\{[\s\S]*?(?=@media|\n\/\*\s*=|$)/g
  );
  return mediaMatches ? mediaMatches.join('\n') : '';
}
