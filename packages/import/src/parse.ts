/**
 * Parsing the Domino XPages view panel on
 * `.../sahlykanta.nsf/peliaktiivisuus.xsp`.
 *
 * The view is a three-level category tree — Nimi > Vuosi > Pvm — rendered as
 * one flat HTML table where a row's level is implied by which cell carries
 * the value:
 *
 *   ['Matti Virtanen', '',     '',                     '278']   a player
 *   ['',           '2026', '',                     '25' ]   one of their years
 *   ['',           '',     '12.01.2026 Maanantai', '1'  ]   one game
 *
 * Expand and collapse are form POSTs identified by `$$xspsubmitid`. The id
 * embeds two numbers that must not be confused:
 *
 *   view:...:viewPanel1:<rowIndex>:viewColumn<n>__expand:<position>
 *
 * `position` is Domino's stable position notation (`3`, `3.1`, `3.1.2`).
 * `rowIndex` is where the row currently sits in the rendered table, and it
 * shifts whenever anything above it expands. So submit ids are always re-read
 * from the latest response, never reconstructed.
 *
 * Regex rather than a DOM library on purpose: the markup is machine-generated
 * and unchanging, the shapes we need are narrow, and this keeps the one-off
 * tool dependency-free.
 */

export interface PlayerRow {
  name: string;
  total: number;
  /** Domino position notation, e.g. `3`. */
  position: string;
}

export interface YearRow {
  year: string;
  count: number;
  /** Domino position notation, e.g. `3.1`. */
  position: string;
}

export interface DateRow {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  /** The Finnish weekday name Domino printed, kept for cross-checking. */
  weekday: string | undefined;
  count: number;
}

export interface ViewNode {
  position: string;
  /** 1 for a player, 2 for a year. */
  level: number;
  rowIndex: number;
  expanded: boolean;
  /** The exact value to send as `$$xspsubmitid`. */
  submitId: string;
}

const ROW = /<tr>([\s\S]*?)<\/tr>/g;
const CELL = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
const NODE = /id="(view:[^"]*?viewPanel1:(\d+):viewColumn(\d+)__(expand|shrink):([\d.]+))button"/;
const VIEW_ID = /name="\$\$viewid"[^>]*value="([^"]+)"/;
const PAGER_LINK = /id="[^"]*pager1__Group__lnk__(\d+)"/g;
/** The anchor's own text is the page number, which no locale can change. */
const PAGER_ANCHOR = /<a\s+id="([^"]*pager1__Group__lnk__\d+)"[^>]*>(\d+)<\/a>/g;
const DATE_CELL = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\S+))?$/;

function stripTags(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, '')).trim();
}

function decodeEntities(text: string): string {
  return (
    text
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match)
      // Last, always: decoding &amp; first would turn the literal text
      // "&auml;" (written "&amp;auml;") into the letter ä.
      .replace(/&amp;/g, '&')
  );
}

/**
 * The named entities a Finnish name can plausibly contain. A name that
 * decodes to something not in this table is left as its literal source text,
 * which is visible in the output rather than silently mangled.
 */
const NAMED_ENTITIES: Record<string, string> = {
  auml: 'ä',
  Auml: 'Ä',
  ouml: 'ö',
  Ouml: 'Ö',
  aring: 'å',
  Aring: 'Å',
  eacute: 'é',
  Eacute: 'É',
  egrave: 'è',
  uuml: 'ü',
  Uuml: 'Ü',
  oslash: 'ø',
  Oslash: 'Ø',
  szlig: 'ß',
  ccedil: 'ç',
  Ccedil: 'Ç',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
};

/**
 * Which level a row belongs to is implied by the cell carrying the value:
 * a name in the first cell is a player, a year in the second is one of their
 * years, a date in the third is a single game.
 */
export type RowKind = 'player' | 'year' | 'date';

export interface ParsedRow {
  kind: RowKind;
  cells: string[];
  node: ViewNode | undefined;
}

/**
 * Every row of the rendered view, in document order, classified by level.
 * This is the single HTML-decoding path in the importer: walk.ts consumes it
 * rather than keeping its own copy, so there is one place where an entity can
 * be mis-decoded.
 */
export function harvestRows(html: string): ParsedRow[] {
  return parseRows(html);
}

function parseRows(html: string): ParsedRow[] {
  const rows: ParsedRow[] = [];

  for (const rowMatch of html.matchAll(ROW)) {
    const fragment = rowMatch[1] ?? '';
    const cells = [...fragment.matchAll(CELL)].map((cell) => stripTags(cell[1] ?? ''));
    if (cells.length < 4) continue;
    // The header row carries the column titles, not data.
    if (cells[0] === 'Nimi') continue;

    const nodeMatch = NODE.exec(fragment);
    const node: ViewNode | undefined =
      nodeMatch === null
        ? undefined
        : {
            submitId: nodeMatch[1] as string,
            rowIndex: Number(nodeMatch[2]),
            level: Number(nodeMatch[3]),
            expanded: nodeMatch[4] === 'shrink',
            position: nodeMatch[5] as string,
          };

    const kind: RowKind =
      (cells[0] ?? '').length > 0 ? 'player' : (cells[1] ?? '').length > 0 ? 'year' : 'date';

    rows.push({ kind, cells, node });
  }

  return rows;
}

export function parseViewId(html: string): string {
  const match = VIEW_ID.exec(html);
  if (match?.[1] === undefined) {
    throw new Error('no $$viewid in the response; refusing to POST without view state');
  }
  return match[1];
}

/**
 * Page count including the current page. The pager renders a link per other
 * page, and ids appear twice per link (button and anchor), so the distinct
 * link numbers are what matter.
 */
export function parsePageCount(html: string): number {
  const numbers = new Set([...html.matchAll(PAGER_LINK)].map((m) => m[1]));
  return numbers.size + 1;
}

export interface PagerLink {
  page: number;
  /** The value to send as `$$xspsubmitid` to jump to that page. */
  submitId: string;
}

/** Every page the pager links to; the current page is not one of them. */
export function parsePagerLinks(html: string): PagerLink[] {
  return [...html.matchAll(PAGER_ANCHOR)].map((match) => ({
    page: Number(match[2]),
    submitId: match[1] as string,
  }));
}

const PAGER_NEXT = /id="([^"]*pager1__Next__lnk)"/;

/**
 * The submit id of the Next control, or undefined when there is no next page.
 *
 * This matters more than it looks: a deep, fully expanded view renders only
 * Prev/Next, with no numbered group links at all. Following only the numbered
 * links there walks off the end of the data and returns cleanly, and the
 * per-player checksum cannot catch it — a player never reached is never
 * checked. Domino renders `pager1__Next` without its inner anchor on the last
 * page, which is how "no next page" is distinguished from "no pager".
 */
export function parseNextPageLink(html: string): string | undefined {
  return PAGER_NEXT.exec(html)?.[1];
}

export function parsePlayers(html: string): PlayerRow[] {
  const players: PlayerRow[] = [];
  for (const { cells, node } of parseRows(html)) {
    const name = cells[0] ?? '';
    if (name.length === 0) continue;
    players.push({
      name,
      total: Number(cells[3] ?? '0'),
      position: node?.position ?? '',
    });
  }
  return players;
}

export function parseYears(html: string): YearRow[] {
  const years: YearRow[] = [];
  for (const { cells, node } of parseRows(html)) {
    const year = cells[1] ?? '';
    if (year.length === 0) continue;
    years.push({
      year,
      count: Number(cells[3] ?? '0'),
      position: node?.position ?? '',
    });
  }
  return years;
}

/** `12.01.2026 Maanantai` -> `{ date: '2026-01-12', weekday: 'Maanantai' }`. */
export function parseDateCell(cell: string): { date: string; weekday: string | undefined } {
  const match = DATE_CELL.exec(cell.trim());
  if (match === null) {
    throw new Error(`unrecognised date cell: ${JSON.stringify(cell)}`);
  }
  const [, day, month, year, weekday] = match;
  return { date: `${year}-${month}-${day}`, weekday };
}

export function parseDates(html: string): DateRow[] {
  const dates: DateRow[] = [];
  for (const { cells } of parseRows(html)) {
    const cell = cells[2] ?? '';
    if (cell.length === 0) continue;
    const { date, weekday } = parseDateCell(cell);
    dates.push({ date, weekday, count: Number(cells[3] ?? '0') });
  }
  return dates;
}

export function parseNodes(html: string): ViewNode[] {
  return parseRows(html)
    .map((row) => row.node)
    .filter((node): node is ViewNode => node !== undefined);
}
