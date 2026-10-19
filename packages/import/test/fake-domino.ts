import type { XspClient } from '../src/xsp-client.js';

/**
 * A stand-in for the Domino XPages view panel, reproducing the three
 * behaviours the walker has to survive:
 *
 *  - expanding a node inserts its children directly beneath it, so every row
 *    index below shifts while the page offset stays put;
 *  - the row index in a submit id is a running index across the whole view,
 *    not an index within the page;
 *  - expanding adds rows, so the number of pages grows as you go.
 *
 * `rowsPerPage` is small in tests so a handful of players exercises paging.
 */

export interface FakeYear {
  year: string;
  dates: Array<{ date: string; weekday: string }>;
}

export interface FakePlayer {
  name: string;
  years: FakeYear[];
}

interface Row {
  cells: [string, string, string, string];
  node?: { position: string; column: 1 | 2 };
}

export interface FakeDomino extends XspClient {
  pageTurns(): number;
  expansions(): number;
}

export interface FakeOptions {
  rowsPerPage?: number;
  /**
   * When false the pager renders only Prev/Next, with no numbered page links.
   * That is what a deep, fully expanded Domino view does, and a walker that
   * only follows numbered links stops early there.
   */
  groupLinks?: boolean;
}

export function createFakeDomino(
  players: FakePlayer[],
  options: number | FakeOptions = {},
): FakeDomino {
  const { rowsPerPage = 4, groupLinks = true } =
    typeof options === 'number' ? { rowsPerPage: options } : options;
  const expanded = new Set<string>();
  let offset = 0;
  let turns = 0;
  let expansions = 0;
  let opened = false;

  const flatten = (): Row[] => {
    const rows: Row[] = [];
    players.forEach((player, pIndex) => {
      const position = String(pIndex + 1);
      const total = player.years.reduce((acc, y) => acc + y.dates.length, 0);
      rows.push({ cells: [player.name, '', '', String(total)], node: { position, column: 1 } });
      if (!expanded.has(position)) return;

      player.years.forEach((year, yIndex) => {
        const yearPosition = `${position}.${yIndex + 1}`;
        rows.push({
          cells: ['', year.year, '', String(year.dates.length)],
          node: { position: yearPosition, column: 2 },
        });
        if (!expanded.has(yearPosition)) return;

        for (const d of year.dates) {
          const [y, m, day] = d.date.split('-');
          rows.push({ cells: ['', '', `${day}.${m}.${y} ${d.weekday}`, '1'] });
        }
      });
    });
    return rows;
  };

  const render = (): string => {
    const all = flatten();
    const pageCount = Math.max(1, Math.ceil(all.length / rowsPerPage));
    const current = Math.floor(offset / rowsPerPage) + 1;
    const visible = all.slice(offset, offset + rowsPerPage);

    const body = visible
      .map((row, i) => {
        const globalIndex = offset + i;
        const cellHtml = row.cells
          .map((value, column) => {
            if (row.node !== undefined && column === row.node.column - 1) {
              const state = expanded.has(row.node.position) ? 'shrink' : 'expand';
              const id = `view:_id1:_id2:callback2:viewPanel1:${globalIndex}:viewColumn${row.node.column}__${state}:${row.node.position}`;
              return `<td><button id="${id}button"></button><a id="${id}link">${escape(value)}</a></td>`;
            }
            return `<td>${escape(value)}</td>`;
          })
          .join('');
        return `<tr>${cellHtml}</tr>`;
      })
      .join('\n');

    let linkIndex = 0;
    const pagerLinks: string[] = [];
    if (groupLinks) {
      for (let page = 1; page <= pageCount; page += 1) {
        if (page === current) continue;
        linkIndex += 1;
        pagerLinks.push(
          `<a id="view:_id1:_id2:callback2:viewPanel1:pager1__Group__lnk__${linkIndex}" href="#" title="Go to page ${page}">${page}</a>`,
        );
      }
    }
    if (current < pageCount) {
      pagerLinks.push(
        '<span class="xspPagerNav xspNext" id="view:_id1:_id2:callback2:viewPanel1:pager1__Next">' +
          '<a id="view:_id1:_id2:callback2:viewPanel1:pager1__Next__lnk" href="#" title="Go to next page:">Next</a></span>',
      );
    }

    return [
      '<html><body>',
      '<form id="view:_id1" method="post" enctype="multipart/form-data">',
      '<input type="hidden" name="$$viewid" id="view:_id1__VUID" value="!fake000001!">',
      '<table><thead><tr><th>Nimi</th><th>Vuosi</th><th>Pvm</th><th>Kpl</th></tr></thead>',
      `<tbody>${body}</tbody></table>`,
      `<div class="xspPagerContainer">${pagerLinks.join('')}</div>`,
      '</form></body></html>',
    ].join('\n');
  };

  const escape = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const pageOf = (target: number): number => (target - 1) * rowsPerPage;

  return {
    async open() {
      opened = true;
      offset = 0;
      return render();
    },

    async submit(submitId: string) {
      if (!opened) throw new Error('call open() before submit()');

      if (/pager1__Next__lnk$/.test(submitId)) {
        const all = flatten();
        const pageCount = Math.max(1, Math.ceil(all.length / rowsPerPage));
        const current = Math.floor(offset / rowsPerPage) + 1;
        if (current >= pageCount) throw new Error('Next on the last page');
        offset = pageOf(current + 1);
        turns += 1;
        return render();
      }

      const pager = /pager1__Group__lnk__(\d+)$/.exec(submitId);
      if (pager !== null) {
        // Resolve the link index back to the page it pointed at, exactly as
        // the real pager markup does.
        const all = flatten();
        const pageCount = Math.max(1, Math.ceil(all.length / rowsPerPage));
        const current = Math.floor(offset / rowsPerPage) + 1;
        const others = [];
        for (let page = 1; page <= pageCount; page += 1) if (page !== current) others.push(page);
        const target = others[Number(pager[1]) - 1];
        if (target === undefined) throw new Error(`no such pager link: ${submitId}`);
        offset = pageOf(target);
        turns += 1;
        return render();
      }

      const node = /__(expand|shrink):([\d.]+)$/.exec(submitId);
      if (node === null) throw new Error(`unrecognised submit id: ${submitId}`);
      const position = node[2] as string;
      if (node[1] === 'expand') {
        expanded.add(position);
        expansions += 1;
      } else {
        expanded.delete(position);
      }
      return render();
    },

    viewId: () => '!fake000001!',
    requestCount: () => turns + expansions,
    pageTurns: () => turns,
    expansions: () => expansions,
  };
}
