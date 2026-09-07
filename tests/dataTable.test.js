// dataTable.test.js — ui/dataTable, the one column-model table renderer.
// jsdom: renders into real <tr>/<tbody> containers and asserts the DOM.
import { readFileSync } from 'node:fs';
import { describe, it, expect, jest } from '@jest/globals';
import {
  renderDataTable,
  headerCellHTML,
  bodyCellHTML,
  rowHTML,
} from '../js/ui/dataTable.js';

const COLUMNS = [
  { id: 'name', label: 'Name', headerClass: 'pcell-precinct', sortable: false },
  { id: 'votes', label: 'Votes', cellClass: 'num', format: (v) => (v == null ? '—' : String(v)) },
  { id: 'share', label: 'Share', accessor: (r) => r.share, format: (v) => `${Math.round(v * 100)}%` },
];
const ROWS = [
  { name: 'Alpha', votes: 120, share: 0.4 },
  { name: 'Beta', votes: null, share: 0.6 },
];

function makeTable() {
  document.body.innerHTML =
    '<table><thead><tr id="head"></tr></thead><tbody id="body"></tbody></table>';
  return { head: document.getElementById('head'), body: document.getElementById('body') };
}

describe('column model rendering', () => {
  it('renders <th scope="col"> headers with data-col and header classes', () => {
    const { head, body } = makeTable();
    renderDataTable({ head, body, columns: COLUMNS, rows: ROWS });

    const ths = head.querySelectorAll('th');
    expect(ths).toHaveLength(3);
    ths.forEach((th) => expect(th.getAttribute('scope')).toBe('col'));
    expect(ths[0].dataset.col).toBe('name');
    expect(ths[0].className).toBe('pcell-precinct');
    expect(ths[1].textContent).toBe('Votes');
  });

  it('applies headerAttrs to the <th>', () => {
    const html = headerCellHTML({ id: 'x', label: 'X', headerAttrs: { title: 'extra' } });
    expect(html).toContain('title="extra"');
  });

  it('renders one row per record with accessor/format cells', () => {
    const { head, body } = makeTable();
    renderDataTable({ head, body, columns: COLUMNS, rows: ROWS });

    const trs = body.querySelectorAll('tr');
    expect(trs).toHaveLength(2);
    const cells = trs[0].querySelectorAll('td');
    expect(cells[0].textContent).toBe('Alpha'); // default accessor row[id]
    expect(cells[1].textContent).toBe('120');
    expect(cells[1].className).toBe('num');
    expect(cells[2].textContent).toBe('40%'); // custom accessor + format
    expect(trs[1].querySelectorAll('td')[1].textContent).toBe('—'); // null through format
  });

  it('applies rowAttrs per row (conditional classes)', () => {
    const { head, body } = makeTable();
    renderDataTable({
      head,
      body,
      columns: COLUMNS,
      rows: ROWS,
      rowAttrs: (r) => ({ class: r.votes == null ? 'tiny-row' : '' }),
    });
    const trs = body.querySelectorAll('tr');
    expect(trs[0].className).toBe('');
    expect(trs[1].className).toBe('tiny-row');
  });
});

describe('escaping', () => {
  it('escapes header labels and default-path cell values', () => {
    const { head, body } = makeTable();
    const cols = [{ id: 'evil', label: '<img src=x onerror=alert(1)>' }];
    renderDataTable({ head, body, columns: cols, rows: [{ evil: '<script>alert(2)</script>' }] });

    expect(head.querySelector('img')).toBeNull();
    expect(head.querySelector('th').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('td').textContent).toBe('<script>alert(2)</script>');
  });

  it('escapes data-col, cellClass, and rowAttrs values', () => {
    const html = rowHTML(
      [{ id: 'a', cellClass: '"><script>' }],
      { a: 1 },
      () => ({ class: '">x' })
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;');
    expect(headerCellHTML({ id: '"><b>', label: 'ok' })).not.toContain('<b>');
  });

  it('cellHTML columns are the trusted escape hatch (caller-owned markup)', () => {
    const html = bodyCellHTML(
      { id: 'link', cellHTML: (r) => `<td><a href="#${r.code}">go</a></td>` },
      { code: '12' }
    );
    expect(html).toBe('<td><a href="#12">go</a></td>');
  });
});

describe('sort indicator + click-to-sort', () => {
  it('marks the active column with sorted class, arrow, and aria-sort', () => {
    const { head, body } = makeTable();
    renderDataTable({ head, body, columns: COLUMNS, rows: ROWS, sort: { key: 'votes', dir: 'desc' } });

    const th = head.querySelector('th[data-col="votes"]');
    expect(th.className).toContain('sorted');
    expect(th.textContent).toBe('Votes ↓');
    expect(th.getAttribute('aria-sort')).toBe('descending');
    expect(head.querySelector('th[data-col="share"]').className).not.toContain('sorted');
    expect(head.querySelector('th[data-col="share"]').textContent).toBe('Share');
  });

  it('shows ↑ / aria-sort ascending for asc', () => {
    const html = headerCellHTML({ id: 'v', label: 'V' }, { key: 'v', dir: 'asc' });
    expect(html).toContain('V ↑');
    expect(html).toContain('aria-sort="ascending"');
  });

  it('fires onSort with the column id + click event for sortable columns only', () => {
    const { head, body } = makeTable();
    const onSort = jest.fn();
    renderDataTable({ head, body, columns: COLUMNS, rows: ROWS, onSort });

    head.querySelector('th[data-col="votes"]').click();
    expect(onSort).toHaveBeenCalledWith('votes', expect.any(Object));
    head.querySelector('th[data-col="name"]').click(); // sortable: false
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it('makes sortable headers keyboard-operable, and adds no dead focus stop', () => {
    // WCAG 2.1.1: a <th> with a click listener takes no focus and exposes no
    // role, so the sort was mouse-only — and invisible to axe for the same
    // reason. The listener stays on the <th>; the button's click bubbles.
    const { head, body } = makeTable();
    const onSort = jest.fn();
    renderDataTable({ head, body, columns: COLUMNS, rows: ROWS, onSort });

    const sortable = head.querySelector('th[data-col="votes"] button.th-sort');
    expect(sortable).not.toBeNull();
    expect(head.querySelector('th[data-col="name"] button.th-sort')).toBeNull();

    sortable.click(); // what Enter/Space fire on a native button
    expect(onSort).toHaveBeenCalledWith('votes', expect.any(Object));
  });

  it('keeps the shift modifier reaching onSort through the button', () => {
    // The secondary-sort gesture rides the same event; a keyboard user gets it
    // via Shift+Enter only if shiftKey survives the bubble from the button.
    const { head, body } = makeTable();
    const onSort = jest.fn();
    renderDataTable({ head, body, columns: COLUMNS, rows: ROWS, onSort });

    head.querySelector('th[data-col="votes"] button.th-sort')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(onSort).toHaveBeenCalledWith('votes', expect.objectContaining({ shiftKey: true }));
  });

  it('sizes the sort button against the padding box, so headers stay over their column', () => {
    // The app sets `* { box-sizing: border-box }`. Under it, `width: 100%` on
    // this button is the th's CONTENT width, and the negative margins then
    // leave every right-aligned header label 28px left of its own numbers
    // (measured on explore/campaign/trends). content-box is load-bearing.
    const css = readFileSync(new URL('../js/civic.css', import.meta.url), 'utf8');
    const start = css.indexOf('.th-sort {');
    const rule = css.slice(start, css.indexOf('\n}', start));
    expect(rule).toContain('box-sizing: content-box');
    expect(rule).toContain('width: 100%');
  });

  it('keeps aria-sort on the th, not the button (it is invalid on a button)', () => {
    const html = headerCellHTML({ id: 'v', label: 'V' }, { key: 'v', dir: 'asc' });
    expect(html).toMatch(/<th[^>]*aria-sort="ascending"/);
    expect(html).toContain('<button type="button" class="th-sort">');
  });
});

describe('multi-column sort (array sort model)', () => {
  it('a one-element array renders identically to the single-sort object', () => {
    const obj = headerCellHTML({ id: 'v', label: 'V' }, { key: 'v', dir: 'desc' });
    const arr = headerCellHTML({ id: 'v', label: 'V' }, [{ key: 'v', dir: 'desc' }]);
    expect(arr).toBe(obj);
  });

  it('marks the primary with aria-sort and secondaries with rank + sorted-secondary', () => {
    const { head, body } = makeTable();
    renderDataTable({
      head,
      body,
      columns: COLUMNS,
      rows: ROWS,
      sort: [
        { key: 'votes', dir: 'desc' },
        { key: 'share', dir: 'asc' },
      ],
    });

    const primary = head.querySelector('th[data-col="votes"]');
    expect(primary.textContent).toBe('Votes ↓');
    expect(primary.getAttribute('aria-sort')).toBe('descending');
    expect(primary.className).not.toContain('sorted-secondary');

    const secondary = head.querySelector('th[data-col="share"]');
    expect(secondary.textContent).toBe('Share ↑²');
    expect(secondary.className).toContain('sorted');
    expect(secondary.className).toContain('sorted-secondary');
    expect(secondary.getAttribute('aria-sort')).toBeNull(); // primary only
  });
});

describe('pinned columns', () => {
  const PINNED = [
    { id: 'name', label: 'Name', pinned: true, headerClass: 'pcell-precinct' },
    { id: 'votes', label: 'Votes', pinned: true, cellClass: 'num' },
    { id: 'share', label: 'Share' },
  ];

  it('adds pin-col pin-col-<i> to pinned <th>s and default-path <td>s', () => {
    const { head, body } = makeTable();
    renderDataTable({ head, body, columns: PINNED, rows: ROWS });

    expect(head.querySelector('th[data-col="name"]').className).toBe('pcell-precinct pin-col pin-col-0');
    expect(head.querySelector('th[data-col="votes"]').className).toBe('pin-col pin-col-1');
    expect(head.querySelector('th[data-col="share"]').className).toBe('');

    const cells = body.querySelector('tr').querySelectorAll('td');
    expect(cells[0].className).toBe('pin-col pin-col-0');
    expect(cells[1].className).toBe('num pin-col pin-col-1');
    expect(cells[2].className).toBe('');
  });

  it('does not touch cellHTML column markup (caller owns pin classes there)', () => {
    const { head, body } = makeTable();
    const cols = [
      { id: 'link', label: 'Link', pinned: true, cellHTML: (r) => `<td class="mine">${r.name}</td>` },
    ];
    renderDataTable({ head, body, columns: cols, rows: ROWS });
    expect(head.querySelector('th').className).toBe('pin-col pin-col-0'); // header still pinned
    expect(body.querySelector('td').className).toBe('mine'); // cell untouched
  });
});

describe('empty state', () => {
  it('renders a single empty-note row spanning all columns', () => {
    const { head, body } = makeTable();
    renderDataTable({ head, body, columns: COLUMNS, rows: [], emptyMessage: 'No precincts match these filters.' });

    const td = body.querySelector('td.empty-note');
    expect(body.querySelectorAll('tr')).toHaveLength(1);
    expect(td.getAttribute('colspan')).toBe('3');
    expect(td.textContent).toBe('No precincts match these filters.');
  });

  it('escapes the empty-state message', () => {
    const { head, body } = makeTable();
    renderDataTable({ head, body, columns: COLUMNS, rows: [], emptyMessage: '<b>none</b>' });
    expect(body.querySelector('b')).toBeNull();
  });
});

describe('chunked rendering (listView pattern)', () => {
  it('renders in animation-frame batches and can be cancelled', () => {
    const { head, body } = makeTable();
    const frames = [];
    globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };

    const rows = Array.from({ length: 5 }, (_, i) => ({ name: `P${i}`, votes: i, share: 0 }));
    const cancel = renderDataTable({ head, body, columns: COLUMNS, rows, batch: 2 });

    expect(body.querySelectorAll('tr')).toHaveLength(2); // first batch is synchronous
    frames.shift()(); // second frame
    expect(body.querySelectorAll('tr')).toHaveLength(4);
    cancel();
    frames.shift()(); // cancelled — no further rows
    expect(body.querySelectorAll('tr')).toHaveLength(4);
  });

  it('renders synchronously when rows fit in one batch', () => {
    const { head, body } = makeTable();
    renderDataTable({ head, body, columns: COLUMNS, rows: ROWS, batch: 50 });
    expect(body.querySelectorAll('tr')).toHaveLength(2);
  });
});
