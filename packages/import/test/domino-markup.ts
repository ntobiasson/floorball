/**
 * Synthetic Domino XPages view-panel markup for the parser tests.
 *
 * The parser used to be tested against four responses captured from the live
 * server. Those captures carried real players' names, so they are not in this
 * repository; this builder reproduces their structure instead, from the shapes
 * the parser actually depends on:
 *
 *  - a flat `<table>` of four-cell rows, the level implied by which cell is
 *    filled (name / year / date);
 *  - expand-collapse controls whose id embeds BOTH a running row index and
 *    Domino position notation, as
 *    `view:_id1:_id2:callback2:viewPanel1:<rowIndex>:viewColumn<n>__expand:<position>`,
 *    rendered three times per node with the `button`, `img` and `link`
 *    suffixes;
 *  - `__shrink:` in place of `__expand:` once a node is open;
 *  - a pager whose numbered links carry the page number as their anchor text,
 *    plus a `pager1__Next__lnk` control that exists even when the numbered
 *    group does not reach the next page;
 *  - the `$$viewid` state token;
 *  - Finnish letters as HTML entities (`&auml;`), which is how Domino emits
 *    them.
 *
 * **This is a reconstruction, not a recording.** It cannot notice if the real
 * server starts emitting something different. The protection against that is
 * the dry run in the runbook: walk five players against the live view and
 * check the counts before trusting a full import.
 */

const ENTITIES: Record<string, string> = {
  ä: '&auml;',
  Ä: '&Auml;',
  ö: '&ouml;',
  Ö: '&Ouml;',
  å: '&aring;',
};

/** Domino emits non-ASCII letters as named entities. */
function encode(text: string): string {
  return [...text].map((character) => ENTITIES[character] ?? character).join('');
}

export interface MarkupNode {
  /** Domino position notation: `3`, `3.1`. */
  position: string;
  /** 1 for a player row, 2 for a year row. */
  column: 1 | 2;
  expanded: boolean;
}

export interface MarkupRow {
  cells: [string, string, string, string];
  node?: MarkupNode;
}

export interface ViewPage {
  rows: MarkupRow[];
  /** Index of the first row within the whole view; row ids run across pages. */
  firstRowIndex?: number;
  /** Total pages the pager advertises. */
  pageCount?: number;
  currentPage?: number;
  /** Render the numbered group links. A deep view renders only Prev/Next. */
  groupLinks?: boolean;
  viewId?: string;
}

const PREFIX = 'view:_id1:_id2:callback2:viewPanel1';

function controlCell(value: string, node: MarkupNode, rowIndex: number): string {
  const state = node.expanded ? 'shrink' : 'expand';
  const id = `${PREFIX}:${rowIndex}:viewColumn${node.column}__${state}:${node.position}`;
  const wrapper = node.column === 1 ? 'xspColumnViewStart' : 'xspColumnViewMiddle';
  return (
    `<td class="${wrapper}"><div class="${wrapper}">` +
    `<button id="${id}button" type="button" title="${node.expanded ? 'expanded' : 'collapsed'}" ` +
    'style="border:none;background-color:transparent;cursor:pointer;width:20px;">' +
    `<img id="${id}img" alt="${node.expanded ? 'expanded' : 'collapsed'}" ` +
    `src="/domjava/xsp/theme/common/images/${node.expanded ? 'collapse' : 'expand'}.gif"></button>` +
    `<a id="${id}link" style="cursor:pointer;" class="${wrapper}">${encode(value)}</a>` +
    '</div></td>'
  );
}

function renderRow(row: MarkupRow, rowIndex: number): string {
  const cells = row.cells.map((value, column) => {
    if (row.node !== undefined && column === row.node.column - 1) {
      return controlCell(value, row.node, rowIndex);
    }
    const klass = column === 3 ? 'xspColumnViewEnd' : 'xspColumnViewMiddle';
    const inner =
      column === 3
        ? `<span id="${PREFIX}:${rowIndex}:viewColumn5:_internalViewText" class="xspTextViewColumn">${encode(value)}</span>`
        : encode(value);
    return `<td class="${klass}">${value.length > 0 ? inner : ''}</td>`;
  });
  return `<tr>${cells.join('')}</tr>`;
}

function renderPager(pageCount: number, currentPage: number, groupLinks: boolean): string {
  const parts: string[] = [];
  if (groupLinks) {
    let linkIndex = 0;
    for (let page = 1; page <= pageCount; page += 1) {
      if (page === currentPage) {
        parts.push(`<span class="xspFirstItem xspCurrentItem">${page}</span>`);
        continue;
      }
      linkIndex += 1;
      parts.push(
        `<span><a id="${PREFIX}:pager1__Group__lnk__${linkIndex}" href="#" ` +
          `title="Go to page ${page}">${page}</a></span>`,
      );
    }
  }
  const next =
    currentPage < pageCount
      ? `<span class="xspPagerNav xspNext" id="${PREFIX}:pager1__Next">` +
        `<a id="${PREFIX}:pager1__Next__lnk" href="#" title="Go to next page:">Next</a></span>`
      : `<span class="xspPagerNav xspNext" id="${PREFIX}:pager1__Next">Next</span>`;

  return (
    '<div class="xspPagerContainer"><div class="xspPagerRight" ' +
    `id="${PREFIX}:pager1">` +
    `<span class="xspPagerNav xspPrevious" id="${PREFIX}:pager1__Previous">Previous</span>` +
    `<span class="xspPagerNav xspGroup" id="${PREFIX}:pager1__Group"><span>${parts.join('')}</span></span>` +
    `${next}</div></div>`
  );
}

/** One rendered response from the view panel. */
export function renderView({
  rows,
  firstRowIndex = 0,
  pageCount = 1,
  currentPage = 1,
  groupLinks = true,
  viewId = '!hncocv0yab!',
}: ViewPage): string {
  const body = rows.map((row, i) => renderRow(row, firstRowIndex + i)).join('\n');
  return [
    '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">',
    '<html lang="fi"><body class="xspView tundra">',
    '<form id="view:_id1" method="post" action="/sofor/fun/sahlykanta.nsf/peliaktiivisuus.xsp"',
    ' class="xspForm" enctype="multipart/form-data">',
    `<input type="hidden" name="$$viewid" id="view:_id1__VUID" value="${viewId}">`,
    '<input type="hidden" name="$$xspsubmitid"><input type="hidden" name="$$xspexecid">',
    renderPager(pageCount, currentPage, groupLinks),
    `<table id="${PREFIX}_OUTER_TABLE"><thead><tr>`,
    '<th scope="col"><div class="xspPanelViewColumnHeader"><span>Nimi</span></div></th>',
    '<th scope="col"><div class="xspPanelViewColumnHeader"><span>Vuosi</span></div></th>',
    '<th scope="col"><div class="xspPanelViewColumnHeader"><span>Pvm</span></div></th>',
    '<th scope="col"><div class="xspPanelViewColumnHeader"><span>Kpl</span></div></th>',
    '</tr></thead><tbody>',
    body,
    '</tbody></table></form></body></html>',
  ].join('\n');
}

export const player = (name: string, total: number, position: string, expanded = false): MarkupRow => ({
  cells: [name, '', '', String(total)],
  node: { position, column: 1, expanded },
});

export const year = (value: string, count: number, position: string, expanded = false): MarkupRow => ({
  cells: ['', value, '', String(count)],
  node: { position, column: 2, expanded },
});

export const game = (cell: string): MarkupRow => ({ cells: ['', '', cell, '1'] });
