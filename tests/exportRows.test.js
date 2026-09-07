// exportRows.test.js — a CSV that a spreadsheet reads as numbers, and that
// never invents a value for missing data.
import { describe, it, expect } from '@jest/globals';
import { toCsv, exportFilename } from '../js/domain/exportRows.js';

const COLS = [
  { key: 'precinct', label: 'Precinct' },
  { key: 'margin', label: 'Margin' },
  { key: 'winner', label: 'Winner' },
];

describe('toCsv', () => {
  it('writes a header row and RFC-4180 CRLF lines', () => {
    const csv = toCsv(COLS, [{ precinct: '1', margin: 0.0812, winner: 'Rep' }]);
    expect(csv).toBe('Precinct,Margin,Winner\r\n1,0.0812,Rep\r\n');
  });

  it('leaves missing values EMPTY — never a fabricated 0', () => {
    const csv = toCsv(COLS, [{ precinct: '201', margin: null, winner: undefined }]);
    expect(csv).toContain('201,,\r\n');
    expect(csv).not.toContain('201,0');
  });

  it('keeps full precision, so the sheet gets numbers not display strings', () => {
    // The display formatter would render this "62%" — unusable for arithmetic.
    const csv = toCsv([{ key: 'v', label: 'V' }], [{ v: 0.6234567 }]);
    expect(csv).toContain('0.6234567');
    expect(csv).not.toContain('%');
  });

  it('escapes commas, quotes and newlines in values', () => {
    const csv = toCsv([{ key: 'n', label: 'Name' }], [{ n: 'McClure, III' }, { n: 'a"b' }]);
    expect(csv).toContain('"McClure, III"');
    expect(csv).toContain('"a""b"');
  });

  it('strips binary-float noise without losing real precision', () => {
    // 0.43 - 0.35 - 0.22 in floating point is 0.020000000000000018; a
    // spreadsheet column of those is unreadable, and the digits are not real.
    const csv = toCsv([{ key: 'v', label: 'V' }], [{ v: 0.020000000000000018 }, { v: 0.6234567 }]);
    expect(csv).toContain('0.02\r\n');
    expect(csv).toContain('0.6234567');
  });

  it('NaN is missing, not the string NaN', () => {
    expect(toCsv([{ key: 'v', label: 'V' }], [{ v: NaN }])).toBe('V\r\n\r\n');
  });

  it('tolerates no rows and no columns', () => {
    expect(toCsv(COLS, [])).toBe('Precinct,Margin,Winner\r\n');
    expect(toCsv([], [{ a: 1 }])).toBe('\r\n\r\n');
  });
});

describe('exportFilename', () => {
  it('names the file off live state so a folder of exports stays readable', () => {
    expect(exportFilename('collin', ['tossups', 'cd-3'])).toBe('collin-tossups-cd-3.csv');
    expect(exportFilename('collin', [null, undefined, ''])).toBe('collin.csv');
  });
  it('strips characters that break a filename', () => {
    expect(exportFilename('collin', ['a/b c'])).toBe('collin-a-b-c.csv');
  });
});
