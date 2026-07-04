// persona.test.js — the persona (view mode) state module: resolution
// precedence (URL > stored > default), entry-param persistence, the dev-tools
// gate, and private-mode (storage throwing) fallbacks.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  PERSONAS,
  DEFAULT_PERSONA,
  resolvePersona,
  initActivePersona,
  setActivePersona,
  devToolsEnabled,
} from './persona.js';

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
});

describe('resolvePersona (pure)', () => {
  it('defaults to public with no inputs', () => {
    expect(resolvePersona()).toBe('public');
    expect(resolvePersona({})).toBe(DEFAULT_PERSONA);
  });

  it('URL value wins over stored value', () => {
    expect(resolvePersona({ urlValue: 'campaign', storedValue: 'chair' })).toBe('campaign');
  });

  it('stored value wins over the default', () => {
    expect(resolvePersona({ storedValue: 'chair' })).toBe('chair');
  });

  it('invalid URL value falls through to a valid stored value', () => {
    expect(resolvePersona({ urlValue: 'bogus', storedValue: 'campaign' })).toBe('campaign');
  });

  it('invalid everything falls back to public', () => {
    expect(resolvePersona({ urlValue: 'admin', storedValue: 'PUBLIC' })).toBe('public');
  });

  it('the persona list is frozen and public-first', () => {
    expect(PERSONAS).toEqual(['public', 'chair', 'campaign']);
    expect(Object.isFrozen(PERSONAS)).toBe(true);
  });
});

describe('initActivePersona', () => {
  it('returns public on a clean load and stores nothing', () => {
    expect(initActivePersona()).toBe('public');
    expect(localStorage.getItem('ccd_persona')).toBeNull();
  });

  it('reads the stored persona', () => {
    localStorage.setItem('ccd_persona', 'chair');
    expect(initActivePersona()).toBe('chair');
  });

  it('a valid #persona= overrides the stored choice AND persists it', () => {
    localStorage.setItem('ccd_persona', 'chair');
    window.location.hash = '#persona=campaign';
    expect(initActivePersona()).toBe('campaign');
    expect(localStorage.getItem('ccd_persona')).toBe('campaign');
  });

  it('an invalid #persona= is ignored, not persisted', () => {
    localStorage.setItem('ccd_persona', 'chair');
    window.location.hash = '#persona=bogus';
    expect(initActivePersona()).toBe('chair');
    expect(localStorage.getItem('ccd_persona')).toBe('chair');
  });

  it('reads persona= among other params', () => {
    window.location.hash = '#race=x&persona=chair&view=list';
    expect(initActivePersona()).toBe('chair');
  });
});

describe('setActivePersona', () => {
  it('persists a valid choice and returns it', () => {
    expect(setActivePersona('campaign')).toBe('campaign');
    expect(localStorage.getItem('ccd_persona')).toBe('campaign');
  });

  it('resolves garbage to public instead of throwing', () => {
    localStorage.setItem('ccd_persona', 'chair');
    expect(setActivePersona('superadmin')).toBe('public');
    expect(localStorage.getItem('ccd_persona')).toBe('public');
  });
});

describe('devToolsEnabled', () => {
  it('is off by default', () => {
    expect(devToolsEnabled()).toBe(false);
  });

  it('#dev=1 enables it and persists (survives the hash-dropping nav click)', () => {
    window.location.hash = '#dev=1';
    expect(devToolsEnabled()).toBe(true);
    expect(localStorage.getItem('ccd_dev_tools')).toBe('1');

    window.location.hash = '';
    expect(devToolsEnabled()).toBe(true); // stored flag carries it
  });

  it('#dev=0 disables it and clears the flag', () => {
    localStorage.setItem('ccd_dev_tools', '1');
    window.location.hash = '#dev=0';
    expect(devToolsEnabled()).toBe(false);
    expect(localStorage.getItem('ccd_dev_tools')).toBeNull();
  });

  it('other dev values do not arm it', () => {
    window.location.hash = '#dev=yes';
    expect(devToolsEnabled()).toBe(false);
  });
});

describe('private mode (storage throws)', () => {
  let getItem, setItem, removeItem;

  beforeEach(() => {
    getItem = jest.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    setItem = jest.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    removeItem = jest.spyOn(window.Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
  });

  afterEach(() => {
    getItem.mockRestore();
    setItem.mockRestore();
    removeItem.mockRestore();
  });

  it('initActivePersona still honors a URL override for this view', () => {
    window.location.hash = '#persona=chair';
    expect(initActivePersona()).toBe('chair');
  });

  it('initActivePersona falls back to public with no URL value', () => {
    expect(initActivePersona()).toBe('public');
  });

  it('setActivePersona still returns the resolved id', () => {
    expect(setActivePersona('campaign')).toBe('campaign');
  });

  it('devToolsEnabled: #dev=1 works for this view, plain load is off', () => {
    window.location.hash = '#dev=1';
    expect(devToolsEnabled()).toBe(true);
    window.location.hash = '';
    expect(devToolsEnabled()).toBe(false);
    window.location.hash = '#dev=0';
    expect(devToolsEnabled()).toBe(false);
  });
});
