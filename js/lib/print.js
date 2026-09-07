// lib/print.js — print a self-contained HTML document.
//
// Extracted because three call sites had drifted: fieldOnePager and chairPrint
// each carried a byte-identical window-or-iframe fallback, while
// precinctLookup's "Print door script" did `if (!w) return;` — so on an iPad
// with Safari's default "Block Pop-ups" it did nothing at all: no sheet, no
// message, while the "Print one-pager" button two inches away worked fine.
//
// The iframe path is the one that matters in the field. Pop-up blocking is ON
// by default on the iPads this app targets.

/**
 * Print a complete HTML document string.
 * Opens a window when allowed; falls back to a hidden same-document iframe when
 * the pop-up is blocked, so the action is never a silent no-op.
 *
 * @param {string} doc - a full <!DOCTYPE html> document
 * @param {Window|null} [preOpened] - a window opened during the user gesture
 *   (browsers only honour window.open synchronously inside the click), or null
 *   to let this function try.
 */
export function printDocument(doc, preOpened) {
  const win = preOpened !== undefined ? preOpened : safeOpen();

  if (win) {
    win.document.write(doc);
    win.document.close();
    win.addEventListener("load", function onLoad() {
      win.print();
    });
    return;
  }

  // Pop-up blocked: print via a hidden iframe instead (never a silent nothing).
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  frame.srcdoc = doc;
  frame.addEventListener("load", function onFrameLoad() {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } finally {
      // Leave time for the print dialog to grab the document before cleanup.
      setTimeout(() => frame.remove(), 60000);
    }
  });
}

function safeOpen() {
  try {
    return window.open("", "_blank");
  } catch {
    return null;
  }
}
