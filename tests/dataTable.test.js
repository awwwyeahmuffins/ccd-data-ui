// dataTable.test.js — ui/dataTable, the one column-model table renderer.
// jsdom: renders into real <tr>/<tbody> containers and asserts the DOM.
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

  it('fires onSort with the column id for sortable columns only', () => {
    const { head, body } = makeTable();
    const onSort = jest.fn();
    renderDataTable({ head, body, columns: COLUMNS, rows: ROWS, onSort });

    head.querySelector('th[data-col="votes"]').click();
    expect(onSort).toHaveBeenCalledWith('votes');
    head.querySelector('th[data-col="name"]').click(); // sortable: false
    expect(onSort).toHaveBeenCalledTimes(1);
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
