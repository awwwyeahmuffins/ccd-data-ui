// hooks.js — TEMPORARY transition registry for the inline-script extraction.
// Extracted modules can't import functions that still live in index.html's
// inline script, so the inline script assigns them here and modules call
// `hooks.fn?.(...)`. Every entry is replaced by a direct import within two
// extraction steps; this file is deleted when the last one goes.
export const hooks = {};
