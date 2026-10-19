import {
  parseDateCell,
  parsePagerLinks,
  parseNodes,
  type ViewNode,
} from './parse.js';
import type { XspClient } from './xsp-client.js';

/**
 * One forward sweep over the fully expanded Peliaktiivisuus view.
 *
 * The naive approach — expand a player, read it, collapse it, move on — looks
 * tidier but does not work: expanding a player near the bottom of a page
 * pushes its own year rows onto the next page, so the reader has to follow
 * them anyway. And the view re-paginates as rows appear, so page boundaries
 * move under you.
 *
 * So instead: start at page one, and repeatedly expand the first still-closed
 * node visible on the page. XPages keeps the page offset across a partial
 * refresh and inserts children directly below their parent, so nothing above
 * the cursor ever changes. When a page has no closed nodes left, every row on
 * it is final — harvest it and turn the page. Each node is expanded exactly
 * once and each row is read exactly once.
 *
 * Checksums come free: Domino prints a total next to each player and a count
 * next to each year, and the walk must produce exactly that many date rows.
 * A mismatch fails the import rather than quietly losing games.
 */

export interface HarvestedPlayer {
  name: string;
  total: number;
  /** Domino position notation, recorded so an interrupted run can resume. */
  position: string;
  years: Array<{ year: string; count: number }>;
}

export interface HarvestedRegistration {
  name: string;
  date: string;
  weekday: string | undefined;
}

export interface WalkResult {
  players: HarvestedPlayer[];
  registrations: HarvestedRegistration[];
  pagesRead: number;
}

export interface WalkOptions {
  client: XspClient;
  /** Stop after this many players; for a dry run against the live server. */
  limit?: number;
  onPlayer?: (player: HarvestedPlayer, index: number) => void;
  onPage?: (page: number) => void;
  /**
   * Skip players at or before this level-1 position, leaving them collapsed.
   * A resumed run therefore pages past the finished players cheaply instead
   * of re-expanding thousands of nodes.
   */
  startAfterPosition?: number;
}

export class ChecksumError extends Error {
  constructor(message: string) {
    super(`import checksum failed: ${message}`);
    this.name = 'ChecksumError';
  }
}

/** A row as it appears in the flat table, classified by which cell is filled. */
interface Harvested {
  kind: 'player' | 'year' | 'date';
  cells: string[];
  node: ViewNode | undefined;
}

const ROW = /<tr>([\s\S]*?)<\/tr>/g;
const CELL = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
const NODE = /id="(view:[^"]*?viewPanel1:(\d+):viewColumn(\d+)__(expand|shrink):([\d.]+))button"/;

function decode(text: string): string {
  const named: Record<string, string> = {
    auml: 'ä',
    Auml: 'Ä',
    ouml: 'ö',
    Ouml: 'Ö',
    aring: 'å',
    Aring: 'Å',
  };
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => named[name] ?? match)
    .replace(/&amp;/g, '&');
}

/** Rows in document order, so a date row can be attributed to the player above it. */
function harvestRows(html: string): Harvested[] {
  const rows: Harvested[] = [];

  for (const rowMatch of html.matchAll(ROW)) {
    const fragment = rowMatch[1] ?? '';
    const cells = [...fragment.matchAll(CELL)].map((cell) =>
      decode((cell[1] ?? '').replace(/<[^>]+>/g, '')).trim(),
    );
    if (cells.length < 4 || cells[0] === 'Nimi') continue;

    const match = NODE.exec(fragment);
    const node: ViewNode | undefined =
      match === null
        ? undefined
        : {
            submitId: match[1] as string,
            rowIndex: Number(match[2]),
            level: Number(match[3]),
            expanded: match[4] === 'shrink',
            position: match[5] as string,
          };

    const kind: Harvested['kind'] =
      (cells[0] ?? '').length > 0 ? 'player' : (cells[1] ?? '').length > 0 ? 'year' : 'date';

    rows.push({ kind, cells, node });
  }

  return rows;
}

/** `3.1.2` belongs to the player at level-1 position `3`. */
function rootPosition(position: string): number {
  return Number(position.split('.')[0]);
}

export async function walkActivityView({
  client,
  limit,
  onPlayer,
  onPage,
  startAfterPosition = 0,
}: WalkOptions): Promise<WalkResult> {
  const players: HarvestedPlayer[] = [];
  const registrations: HarvestedRegistration[] = [];

  let html = await client.open();
  let page = 1;
  let pagesRead = 0;

  /** The player whose subtree the current rows belong to. */
  let current: HarvestedPlayer | undefined;
  let currentDates = 0;
  let currentYear: { year: string; count: number } | undefined;
  let currentYearDates = 0;
  let stopped = false;

  const closeYear = () => {
    if (currentYear === undefined) return;
    if (currentYearDates !== currentYear.count) {
      throw new ChecksumError(
        `${current?.name ?? 'unknown player'} / ${currentYear.year}: Domino reports ` +
          `${currentYear.count} games, harvested ${currentYearDates}`,
      );
    }
    currentYear = undefined;
    currentYearDates = 0;
  };

  const closePlayer = () => {
    if (current === undefined) return;
    closeYear();
    if (currentDates !== current.total) {
      throw new ChecksumError(
        `${current.name}: Domino reports ${current.total} games, harvested ${currentDates}`,
      );
    }
    const summed = current.years.reduce((acc, y) => acc + y.count, 0);
    if (summed !== current.total) {
      throw new ChecksumError(
        `${current.name}: year counts sum to ${summed} but the total is ${current.total}`,
      );
    }
    players.push(current);
    onPlayer?.(current, players.length - 1);
    current = undefined;
    currentDates = 0;
  };

  while (!stopped) {
    // Open everything visible before trusting a single row on this page.
    for (;;) {
      const closed = parseNodes(html).find(
        (node) => !node.expanded && rootPosition(node.position) > startAfterPosition,
      );
      if (closed === undefined) break;
      html = await client.submit(closed.submitId);
    }

    pagesRead += 1;
    onPage?.(page);

    for (const row of harvestRows(html)) {
      if (row.kind === 'player') {
        closePlayer();
        const position = row.node?.position ?? '';
        if (position.length > 0 && rootPosition(position) <= startAfterPosition) {
          // Already harvested by an earlier run; it is still collapsed, so no
          // rows of its own follow.
          continue;
        }
        if (limit !== undefined && players.length >= limit) {
          stopped = true;
          break;
        }
        current = {
          name: row.cells[0] as string,
          total: Number(row.cells[3]),
          position,
          years: [],
        };
        currentDates = 0;
        continue;
      }

      if (row.kind === 'year') {
        closeYear();
        currentYear = { year: row.cells[1] as string, count: Number(row.cells[3]) };
        currentYearDates = 0;
        current?.years.push(currentYear);
        continue;
      }

      const { date, weekday } = parseDateCell(row.cells[2] as string);
      if (current === undefined) {
        throw new ChecksumError(`date row ${date} appeared before any player row`);
      }
      registrations.push({ name: current.name, date, weekday });
      currentDates += 1;
      currentYearDates += 1;
    }

    if (stopped) break;

    const next = parsePagerLinks(html).find((link) => link.page === page + 1);
    if (next === undefined) break;
    html = await client.submit(next.submitId);
    page += 1;
  }

  if (!stopped) closePlayer();

  return { players, registrations, pagesRead };
}
