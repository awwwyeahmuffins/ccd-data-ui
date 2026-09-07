// print.test.js — printing must never be a silent no-op.
// On the iPads this app targets, Safari blocks pop-ups by DEFAULT, so the
// iframe fallback is the normal path, not the exotic one.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { printDocument } from '../js/lib/print.js';

const DOC = '<!DOCTYPE html><html><body>hi</body></html>';

describe('printDocument', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('writes to the window it was handed', () => {
    const win = { document: { write: jest.fn(), close: jest.fn() }, addEventListener: jest.fn(), print: jest.fn() };
    printDocument(DOC, win);
    expect(win.document.write).toHaveBeenCalledWith(DOC);
    expect(win.document.close).toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('falls back to a hidden iframe when the pop-up was blocked', () => {
    // window.open returning null is what a blocked pop-up looks like.
    printDocument(DOC, null);
    const frame = document.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame.srcdoc).toBe(DOC);
  });

  it('does nothing silently — a blocked pop-up still produces a print surface', () => {
    printDocument(DOC, null);
    expect(document.querySelectorAll('iframe').length).toBe(1);
  });
});
