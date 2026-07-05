// lib/download.js
// --------------------------------------------------------------------------------
// Trigger a browser download of generated content (Blob + temporary anchor).
// Pure DOM-global helper — no imports; Blob/URL/document are platform globals.
// Moved verbatim from precinctExport.js so any page can export files without
// importing another page's feature module.

export function downloadFile(content, filename, mimeType) {
  let blob = new Blob([content], { type: mimeType + ";charset=utf-8;" });
  let url = URL.createObjectURL(blob);
  let a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
