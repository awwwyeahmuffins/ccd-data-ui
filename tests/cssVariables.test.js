// cssVariables.test.js
// Unit tests for Workstream 1 (Phase 2): CSS Custom Properties
// TDD approach - These tests verify the design token system
// Run with: npm test -- cssVariables.test.js

import { describe, it, expect, beforeAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Load the CSS file
const cssPath = path.resolve(process.cwd(), 'styles.css');

let cssContent;

beforeAll(() => {
  cssContent = fs.readFileSync(cssPath, 'utf8');
});

// ============================================================================
// TESTS FOR :root CSS CUSTOM PROPERTIES SECTION
// ============================================================================

describe('CSS Variables: Root Section Exists', () => {
  it('should have a :root section defined', () => {
    expect(cssContent).toMatch(/:root\s*\{/);
  });

  it('should have CSS Custom Properties section comment', () => {
    expect(cssContent).toMatch(/CSS CUSTOM PROPERTIES|Design Tokens/i);
  });

  it('should define :root before reset section', () => {
    const rootIndex = cssContent.indexOf(':root');
    const resetIndex = cssContent.indexOf('RESET');
    expect(rootIndex).toBeLessThan(resetIndex);
    expect(rootIndex).toBeGreaterThan(-1);
  });
});

// ============================================================================
// TESTS FOR BRAND COLORS
// ============================================================================

describe('CSS Variables: Brand Colors', () => {
  it('should define --color-primary', () => {
    expect(cssContent).toMatch(/--color-primary:\s*#0B4DA2/i);
  });

  it('should define --color-primary-dark', () => {
    expect(cssContent).toMatch(/--color-primary-dark:\s*#093E83/i);
  });

  it('should define --color-primary-light', () => {
    expect(cssContent).toMatch(/--color-primary-light:/);
  });
});

// ============================================================================
// TESTS FOR PARTY COLORS
// ============================================================================

describe('CSS Variables: Party Colors', () => {
  it('should define --color-rep (Republican red)', () => {
    expect(cssContent).toMatch(/--color-rep:\s*#E81B23/i);
  });

  it('should define --color-dem (Democrat blue)', () => {
    expect(cssContent).toMatch(/--color-dem:\s*#00AEF3/i);
  });

  it('should define --color-mod (Moderate purple)', () => {
    expect(cssContent).toMatch(/--color-mod:\s*#800080/i);
  });

  it('should define light and dark variants for party colors', () => {
    expect(cssContent).toMatch(/--color-rep-light:/);
    expect(cssContent).toMatch(/--color-rep-dark:/);
    expect(cssContent).toMatch(/--color-dem-light:/);
    expect(cssContent).toMatch(/--color-dem-dark:/);
    expect(cssContent).toMatch(/--color-mod-light:/);
    expect(cssContent).toMatch(/--color-mod-dark:/);
  });
});

// ============================================================================
// TESTS FOR SEMANTIC COLORS
// ============================================================================

describe('CSS Variables: Semantic Colors', () => {
  it('should define --color-success', () => {
    expect(cssContent).toMatch(/--color-success:\s*#28a745/i);
  });

  it('should define --color-warning', () => {
    expect(cssContent).toMatch(/--color-warning:\s*#FFC800/i);
  });

  it('should define --color-error', () => {
    expect(cssContent).toMatch(/--color-error:\s*#dc3545/i);
  });

  it('should define --color-info', () => {
    expect(cssContent).toMatch(/--color-info:/);
  });
});

// ============================================================================
// TESTS FOR NEUTRAL COLORS
// ============================================================================

describe('CSS Variables: Neutral Colors', () => {
  it('should define text colors', () => {
    expect(cssContent).toMatch(/--color-text-primary:/);
    expect(cssContent).toMatch(/--color-text-secondary:/);
    expect(cssContent).toMatch(/--color-text-muted:/);
  });

  it('should define background colors', () => {
    expect(cssContent).toMatch(/--color-bg-primary:\s*#FFFDF9/i);
    expect(cssContent).toMatch(/--color-bg-secondary:/);
    expect(cssContent).toMatch(/--color-bg-tertiary:/);
  });

  it('should define border colors', () => {
    expect(cssContent).toMatch(/--color-border:/);
    expect(cssContent).toMatch(/--color-border-light:/);
  });
});

// ============================================================================
// TESTS FOR SPACING SCALE
// ============================================================================

describe('CSS Variables: Spacing Scale', () => {
  it('should define spacing scale from xs to 2xl', () => {
    expect(cssContent).toMatch(/--space-xs:\s*4px/);
    expect(cssContent).toMatch(/--space-sm:\s*8px/);
    expect(cssContent).toMatch(/--space-md:\s*12px/);
    expect(cssContent).toMatch(/--space-lg:\s*16px/);
    expect(cssContent).toMatch(/--space-xl:\s*24px/);
    expect(cssContent).toMatch(/--space-2xl:\s*32px/);
  });
});

// ============================================================================
// TESTS FOR BORDER RADII
// ============================================================================

describe('CSS Variables: Border Radii', () => {
  it('should define radius scale', () => {
    expect(cssContent).toMatch(/--radius-sm:\s*4px/);
    expect(cssContent).toMatch(/--radius-md:\s*8px/);
    expect(cssContent).toMatch(/--radius-lg:\s*12px/);
    expect(cssContent).toMatch(/--radius-xl:\s*20px/);
  });

  it('should define --radius-full for circles', () => {
    expect(cssContent).toMatch(/--radius-full:\s*9999px/);
  });
});

// ============================================================================
// TESTS FOR SHADOWS
// ============================================================================

describe('CSS Variables: Shadows', () => {
  it('should define shadow scale', () => {
    expect(cssContent).toMatch(/--shadow-sm:/);
    expect(cssContent).toMatch(/--shadow-md:/);
    expect(cssContent).toMatch(/--shadow-lg:/);
  });
});

// ============================================================================
// TESTS FOR TRANSITIONS
// ============================================================================

describe('CSS Variables: Transitions', () => {
  it('should define transition speeds', () => {
    expect(cssContent).toMatch(/--transition-fast:\s*0\.15s/);
    expect(cssContent).toMatch(/--transition-normal:\s*0\.25s/);
    expect(cssContent).toMatch(/--transition-slow:\s*0\.4s/);
  });
});

// ============================================================================
// TESTS FOR Z-INDEX SCALE
// ============================================================================

describe('CSS Variables: Z-Index Scale', () => {
  it('should define z-index scale', () => {
    expect(cssContent).toMatch(/--z-dropdown:\s*100/);
    expect(cssContent).toMatch(/--z-sidebar:\s*500/);
    expect(cssContent).toMatch(/--z-header:\s*1000/);
    expect(cssContent).toMatch(/--z-toast:\s*9999/);
  });

  it('should define overlay z-index', () => {
    expect(cssContent).toMatch(/--z-overlay:/);
  });
});

// ============================================================================
// TESTS FOR USAGE OF CSS VARIABLES
// ============================================================================

describe('CSS Variables: Usage in Styles', () => {
  it('should use var(--color-primary) somewhere in styles', () => {
    expect(cssContent).toMatch(/var\(--color-primary\)/);
  });

  it('should use var(--shadow-md) or similar shadow variable', () => {
    expect(cssContent).toMatch(/var\(--shadow-/);
  });

  it('should use var(--radius-) for border-radius values', () => {
    expect(cssContent).toMatch(/var\(--radius-/);
  });

  it('should use var(--space-) for spacing values', () => {
    expect(cssContent).toMatch(/var\(--space-/);
  });

  it('should use var(--transition-) for transitions', () => {
    expect(cssContent).toMatch(/var\(--transition-/);
  });

  it('should use var(--z-) for z-index values', () => {
    expect(cssContent).toMatch(/var\(--z-/);
  });
});
