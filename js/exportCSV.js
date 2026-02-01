// exportCSV.js

/**
 * @param {Array<Object>} dataArray
 * @returns {string}  CSV string
 */
export function arrayToCSV(dataArray) {
  if (!dataArray.length) return "";

  const keys = Object.keys(dataArray[0]);
  const escapeCell = (cell) => {
    if (cell == null) return "";
    const cellStr = String(cell);
    if (/[",\r\n]/.test(cellStr)) {
      return `"${cellStr.replace(/"/g, '""')}"`;
    }
    return cellStr;
  };

  const header = keys.map(k => escapeCell(k)).join(",") + "\r\n";
  const body = dataArray
    .map(obj =>
      keys.map(k => escapeCell(obj[k])).join(",")
    )
    .join("\r\n");

  return header + body;
}

/**
 * @param {Array<Object>} dataArray
 * @param {string} filename
 */
export function downloadCSV(dataArray, filename) {
  const csvString = arrayToCSV(dataArray);
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}