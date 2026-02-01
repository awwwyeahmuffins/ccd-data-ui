// keyboardShortcuts.test.js
// TDD tests for Phase 2 Workstream 5: Keyboard Shortcuts & Help Modal
// Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js keyboardShortcuts.test.js

import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

/**
 * @fileoverview
 * Tests for keyboard shortcuts feature including:
 * - Keyboard shortcut module exports
 * - Shortcut definitions
 * - Modal HTML markup
 * - Modal CSS styles
 */

describe('Phase 2 WS5: Keyboard Shortcuts & Help Modal', () => {
  let htmlContent;
  let cssContent;

  beforeAll(() => {
    // Load HTML file
    const htmlPath = path.resolve(process.cwd(), 'index.html');
    htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    
    // Load CSS file
    const cssPath = path.resolve(process.cwd(), 'styles.css');
    cssContent = fs.readFileSync(cssPath, 'utf-8');
  });

  // ============================================================================
  // KEYBOARD SHORTCUTS MODULE TESTS
  // ============================================================================

  describe('Keyboard Shortcuts Module', () => {
    it('keyboardShortcuts.js file should exist', () => {
      const modulePath = path.resolve(process.cwd(), 'js/keyboardShortcuts.js');
      expect(fs.existsSync(modulePath)).toBe(true);
    });

    it('module should export initKeyboardShortcuts function', async () => {
      const module = await import('./keyboardShortcuts.js');
      expect(typeof module.initKeyboardShortcuts).toBe('function');
    });

    it('module should export generateShortcutsHTML function', async () => {
      const module = await import('./keyboardShortcuts.js');
      expect(typeof module.generateShortcutsHTML).toBe('function');
    });

    it('module should export SHORTCUTS array', async () => {
      const module = await import('./keyboardShortcuts.js');
      expect(Array.isArray(module.SHORTCUTS)).toBe(true);
      expect(module.SHORTCUTS.length).toBeGreaterThan(0);
    });

    it('each shortcut should have key, description, and action', async () => {
      const module = await import('./keyboardShortcuts.js');
      module.SHORTCUTS.forEach(shortcut => {
        expect(shortcut).toHaveProperty('key');
        expect(shortcut).toHaveProperty('description');
        expect(shortcut).toHaveProperty('action');
        expect(typeof shortcut.key).toBe('string');
        expect(typeof shortcut.description).toBe('string');
        expect(typeof shortcut.action).toBe('function');
      });
    });
  });

  // ============================================================================
  // SHORTCUT DEFINITIONS TESTS
  // ============================================================================

  describe('Shortcut Definitions', () => {
    it('should have / shortcut for search focus', async () => {
      const module = await import('./keyboardShortcuts.js');
      const searchShortcut = module.SHORTCUTS.find(s => s.key === '/');
      expect(searchShortcut).toBeDefined();
      expect(searchShortcut.description).toMatch(/search|focus/i);
    });

    it('should have Escape shortcut for closing', async () => {
      const module = await import('./keyboardShortcuts.js');
      const escapeShortcut = module.SHORTCUTS.find(s => s.key === 'Escape');
      expect(escapeShortcut).toBeDefined();
      expect(escapeShortcut.description).toMatch(/close|cancel/i);
    });

    it('should have number shortcuts for view switching', async () => {
      const module = await import('./keyboardShortcuts.js');
      const view1 = module.SHORTCUTS.find(s => s.key === '1');
      const view2 = module.SHORTCUTS.find(s => s.key === '2');
      const view3 = module.SHORTCUTS.find(s => s.key === '3');
      
      expect(view1).toBeDefined();
      expect(view2).toBeDefined();
      expect(view3).toBeDefined();
      
      expect(view1.description).toMatch(/demographics/i);
      expect(view2.description).toMatch(/election|forecast/i);
      expect(view3.description).toMatch(/turnout/i);
    });

    it('should have ? shortcut for help', async () => {
      const module = await import('./keyboardShortcuts.js');
      const helpShortcut = module.SHORTCUTS.find(s => s.key === '?');
      expect(helpShortcut).toBeDefined();
      expect(helpShortcut.description).toMatch(/shortcut|help/i);
    });
  });

  // ============================================================================
  // GENERATE SHORTCUTS HTML TESTS
  // ============================================================================

  describe('generateShortcutsHTML Function', () => {
    it('should return HTML string', async () => {
      const module = await import('./keyboardShortcuts.js');
      const html = module.generateShortcutsHTML();
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
    });

    it('should include kbd elements for keys', async () => {
      const module = await import('./keyboardShortcuts.js');
      const html = module.generateShortcutsHTML();
      expect(html).toMatch(/<kbd>/);
    });

    it('should include shortcut-item class', async () => {
      const module = await import('./keyboardShortcuts.js');
      const html = module.generateShortcutsHTML();
      expect(html).toMatch(/class="shortcut-item"/);
    });

    it('should include all shortcuts', async () => {
      const module = await import('./keyboardShortcuts.js');
      const html = module.generateShortcutsHTML();
      
      // Each shortcut key should appear in the HTML
      module.SHORTCUTS.forEach(shortcut => {
        expect(html).toContain(shortcut.key);
        expect(html).toContain(shortcut.description);
      });
    });
  });

  // ============================================================================
  // MODAL HTML MARKUP TESTS
  // ============================================================================

  describe('Modal HTML Markup', () => {
    it('should have shortcuts-modal element', () => {
      expect(htmlContent).toMatch(/id=["']shortcuts-modal["']/);
    });

    it('modal should have role="dialog"', () => {
      expect(htmlContent).toMatch(/shortcuts-modal[^>]*role=["']dialog["']/);
    });

    it('modal should have aria-labelledby attribute', () => {
      expect(htmlContent).toMatch(/shortcuts-modal[^>]*aria-labelledby/);
    });

    it('modal should have aria-hidden attribute', () => {
      expect(htmlContent).toMatch(/shortcuts-modal[^>]*aria-hidden/);
    });

    it('modal should have close button', () => {
      // Look for close button within modal context
      expect(htmlContent).toMatch(/shortcuts-modal[\s\S]*?modal-close/);
    });

    it('modal close button should have aria-label', () => {
      expect(htmlContent).toMatch(/modal-close[^>]*aria-label/);
    });

    it('modal should have shortcuts-list container', () => {
      expect(htmlContent).toMatch(/id=["']shortcuts-list["']/);
    });

    it('modal should have modal-overlay class', () => {
      expect(htmlContent).toMatch(/class=["'][^"']*modal-overlay[^"']*["']/);
    });

    it('modal should have title element', () => {
      expect(htmlContent).toMatch(/id=["']shortcuts-title["']/);
    });
  });

  // ============================================================================
  // MODAL CSS STYLES TESTS
  // ============================================================================

  describe('Modal CSS Styles', () => {
    it('should have modal-overlay styles', () => {
      expect(cssContent).toMatch(/\.modal-overlay\s*\{/);
    });

    it('modal overlay should have fixed position', () => {
      expect(cssContent).toMatch(/\.modal-overlay\s*\{[^}]*position:\s*fixed/);
    });

    it('modal overlay should cover viewport with inset', () => {
      expect(cssContent).toMatch(/\.modal-overlay\s*\{[^}]*inset:\s*0/);
    });

    it('modal overlay should have high z-index', () => {
      const zIndexMatch = cssContent.match(/\.modal-overlay\s*\{[^}]*z-index:\s*(\d+)/);
      expect(zIndexMatch).not.toBeNull();
      expect(parseInt(zIndexMatch[1])).toBeGreaterThanOrEqual(10000);
    });

    it('modal overlay should start hidden', () => {
      expect(cssContent).toMatch(/\.modal-overlay\s*\{[^}]*opacity:\s*0/);
      expect(cssContent).toMatch(/\.modal-overlay\s*\{[^}]*visibility:\s*hidden/);
    });

    it('modal should become visible when .visible class applied', () => {
      expect(cssContent).toMatch(/\.modal-overlay\.visible\s*\{[^}]*opacity:\s*1/);
      expect(cssContent).toMatch(/\.modal-overlay\.visible\s*\{[^}]*visibility:\s*visible/);
    });

    it('should have modal-content styles', () => {
      expect(cssContent).toMatch(/\.modal-content\s*\{/);
    });

    it('modal content should have max-width', () => {
      expect(cssContent).toMatch(/\.modal-content\s*\{[^}]*max-width/);
    });

    it('should have modal-header styles', () => {
      expect(cssContent).toMatch(/\.modal-header\s*\{/);
    });

    it('should have modal-body styles', () => {
      expect(cssContent).toMatch(/\.modal-body\s*\{/);
    });

    it('should have modal-close button styles', () => {
      expect(cssContent).toMatch(/\.modal-close\s*\{/);
    });
  });

  // ============================================================================
  // KBD ELEMENT STYLES TESTS
  // ============================================================================

  describe('KBD Element Styles', () => {
    it('should have kbd element styles', () => {
      expect(cssContent).toMatch(/\bkbd\s*\{/);
    });

    it('kbd should have background color', () => {
      expect(cssContent).toMatch(/\bkbd\s*\{[^}]*background/);
    });

    it('kbd should have border', () => {
      expect(cssContent).toMatch(/\bkbd\s*\{[^}]*border/);
    });

    it('kbd should have border-radius', () => {
      expect(cssContent).toMatch(/\bkbd\s*\{[^}]*border-radius/);
    });

    it('kbd should have monospace font', () => {
      expect(cssContent).toMatch(/\bkbd\s*\{[^}]*font-family:\s*monospace/);
    });
  });

  // ============================================================================
  // SHORTCUT ITEM STYLES TESTS
  // ============================================================================

  describe('Shortcut Item Styles', () => {
    it('should have shortcut-item styles', () => {
      expect(cssContent).toMatch(/\.shortcut-item\s*\{/);
    });

    it('shortcut-item should use flexbox', () => {
      expect(cssContent).toMatch(/\.shortcut-item\s*\{[^}]*display:\s*flex/);
    });

    it('shortcut-item should have gap', () => {
      expect(cssContent).toMatch(/\.shortcut-item\s*\{[^}]*gap/);
    });
  });

  // ============================================================================
  // MODAL FOOTER STYLES TESTS
  // ============================================================================

  describe('Modal Footer Styles', () => {
    it('should have modal-footer styles', () => {
      expect(cssContent).toMatch(/\.modal-footer\s*\{/);
    });

    it('should have modal-hint styles or modal-footer text styles', () => {
      // Either .modal-hint or styling inside .modal-footer
      const hasModalHint = cssContent.match(/\.modal-hint\s*\{/);
      const hasModalFooterText = cssContent.match(/\.modal-footer\s*\{[^}]*font-size/);
      expect(hasModalHint || hasModalFooterText).toBeTruthy();
    });
  });
});
