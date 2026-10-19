import {
  harvestRows,
  parseDateCell,
  parseNextPageLink,
  parseNodes,
  parsePagerLinks,
  parsePlayers,
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
 *
 * Those checksums are per-player, though, which leaves one hole they cannot
 * see: a player the walk never reaches is never checked. `collectPlayerIndex`
 * closes it by reading the authoritative player list from the collapsed view
 * first, so the sweep can be held to it.
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

export interface PlayerIndexEntry {
  position: string;
  name: string;
  total: number;
}

export interface WalkOptions {
  client: XspClient;
  /** Stop after this many players; for a dry run against the live server. */
  limit?: number;
  /**
   * Called as each player completes, with that player's own registrations.
   * The scraper writes both to disk from here: a 2.5-hour walk that only
   * yielded its registrations at the end would lose all of them on any
   * interruption, and leave the resume with nothing to build on.
   */
  onPlayer?: (
    player: HarvestedPlayer,
    registrations: HarvestedRegistration[],
    index: number,
  ) => void;
  onPage?: (page: number) => void;
  /** Data quirks worth an operator's attention, but not worth stopping for. */
  onWarning?: (message: string) => void;
  /**
   * The authoritative player list from `collectPlayerIndex`. When given, the
   * walk fails unless it reached every one of them.
   */
  expected?: PlayerIndexEntry[];
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

export class WalkStalledError extends Error {
  constructor(message: string) {
    super(`import walk stalled: ${message}`);
    this.name = 'WalkStalledError';
  }
}

/** How many times the same node may be resubmitted before giving up. */
const EXPAND_RETRIES = 3;

/**
 * What a categorized Domino view calls the bucket for documents whose
 * category field is empty. It is not a player, but its rows are real
 * registrations: the live view has exactly one. Keeping it means the archive
 * still reconciles with Domino; the warning means nobody mistakes it for a
 * person.
 */
const UNCATEGORIZED = 'Not Categorized';

/** `3.1.2` belongs to the player at level-1 position `3`. */
function rootPosition(position: string): number {
  return Number(position.split('.')[0]);
}

/**
 * The submit id that advances one page: the numbered link when the pager
 * offers it, otherwise the Next control. Numbered links disappear on a deep
 * view, so Next is the one that must always work.
 */
function nextPageSubmitId(html: string, currentPage: number): string | undefined {
  const numbered = parsePagerLinks(html).find((link) => link.page === currentPage + 1);
  return numbered?.submitId ?? parseNextPageLink(html);
}

/**
 * The player list as the collapsed view reports it: one row per player, no
 * expansion, so it is cheap (16 pages) and exact. This is the yardstick the
 * expanded sweep is held to.
 */
export async function collectPlayerIndex({
  client,
}: {
  client: XspClient;
}): Promise<PlayerIndexEntry[]> {
  const entries: PlayerIndexEntry[] = [];
  const seen = new Set<string>();

  let html = await client.open();
  let page = 1;

  for (;;) {
    for (const player of parsePlayers(html)) {
      if (player.position.length === 0 || seen.has(player.position)) continue;
      seen.add(player.position);
      entries.push({ position: player.position, name: player.name, total: player.total });
    }

    const next = nextPageSubmitId(html, page);
    if (next === undefined) break;
    html = await client.submit(next);
    page += 1;
  }

  return entries;
}

export async function walkActivityView({
  client,
  limit,
  onPlayer,
  onPage,
  onWarning,
  startAfterPosition = 0,
  expected,
}: WalkOptions): Promise<WalkResult> {
  const players: HarvestedPlayer[] = [];
  const registrations: HarvestedRegistration[] = [];

  let html = await client.open();
  let page = 1;
  let pagesRead = 0;

  /** The player whose subtree the current rows belong to. */
  let current: HarvestedPlayer | undefined;
  let currentRegistrations: HarvestedRegistration[] = [];
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
    onPlayer?.(current, currentRegistrations, players.length - 1);
    current = undefined;
    currentRegistrations = [];
    currentDates = 0;
  };

  while (!stopped) {
    // Open everything visible before trusting a single row on this page.
    // Bounded on purpose: if Domino answers 200 with the node still closed —
    // a stale view token, a row index that has moved, a POST it decided to
    // ignore — an unbounded loop would resubmit the same id every 400ms
    // against someone else's production server for as long as the process
    // lives.
    let lastSubmitted: string | undefined;
    let attemptsOnSame = 0;
    for (;;) {
      const closed = parseNodes(html).find(
        (node) => !node.expanded && rootPosition(node.position) > startAfterPosition,
      );
      if (closed === undefined) break;

      if (closed.submitId === lastSubmitted) {
        attemptsOnSame += 1;
        if (attemptsOnSame >= EXPAND_RETRIES) {
          throw new WalkStalledError(
            `no progress expanding ${closed.position} after ${EXPAND_RETRIES} attempts; ` +
              'the view state is probably stale — rerun with --resume',
          );
        }
      } else {
        lastSubmitted = closed.submitId;
        attemptsOnSame = 0;
      }

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
        const name = row.cells[0] as string;
        if (name === UNCATEGORIZED) {
          onWarning?.(
            `"${UNCATEGORIZED}" is Domino's bucket for registrations with no name in ` +
              'the category field; its rows are kept so the counts reconcile, but it is ' +
              'not a player',
          );
        }

        current = {
          name,
          total: Number(row.cells[3]),
          position,
          years: [],
        };
        currentRegistrations = [];
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
      const registration = { name: current.name, date, weekday };
      registrations.push(registration);
      currentRegistrations.push(registration);
      currentDates += 1;
      currentYearDates += 1;
    }

    if (stopped) break;

    const next = nextPageSubmitId(html, page);
    if (next === undefined) break;
    html = await client.submit(next);
    page += 1;
  }

  if (!stopped) closePlayer();

  // The one check the per-player checksums cannot make: did the sweep reach
  // every player the collapsed view lists? Skipped when the caller
  // deliberately walked only part of the view.
  //
  // Matched on name rather than position. The old application stays in use
  // while this runs, and a new name is inserted in sort order, shifting the
  // position of every player after it. Positions are stable within one
  // response, not across a 2.5-hour walk; names are.
  if (expected !== undefined && limit === undefined && startAfterPosition === 0) {
    const harvested = new Set(players.map((player) => player.name));
    const missing = expected.filter((entry) => !harvested.has(entry.name));
    if (missing.length > 0) {
      const sample = missing
        .slice(0, 5)
        .map((entry) => `${entry.position} ${entry.name}`)
        .join(', ');
      throw new ChecksumError(
        `expected ${expected.length} players, harvested ${players.length}; ` +
          `did not reach ${missing.length} (${sample}${missing.length > 5 ? ', …' : ''})`,
      );
    }
  }

  return { players, registrations, pagesRead };
}
