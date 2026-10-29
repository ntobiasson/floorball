import type { PlayerDetail } from '@sahlykanta/shared';
import { filterPlayers } from './search.js';
import type { Locale } from './i18n/locale.js';

/**
 * The history page's filtering and ranking, run in the browser over the whole
 * archive.
 *
 * The archive arrives in one response (GET /api/history) for the same reason
 * the directory does: it is small — about 500 players over 25 years — and
 * doing the work here means a year chip or a sort button re-ranks the list
 * instantly, with no request and nothing to wait for.
 */

export type SortKey = 'total' | 'name';

/**
 * One collator per language, built once: ordering ~500 names on every render
 * is the one place in this app where constructing an `Intl` object in a loop
 * would show.
 *
 * Finnish is the default because it is the app's, and because the archive it
 * sorts is Finnish names either way — the language only decides where the
 * letters with dots go.
 */
const collators = new Map<string, Intl.Collator>();

function collatorFor(locale: Locale): Intl.Collator {
  const existing = collators.get(locale);
  if (existing !== undefined) return existing;
  const made = new Intl.Collator(locale, { sensitivity: 'base' });
  collators.set(locale, made);
  return made;
}

/** Every year anybody played, newest first: what the year chips offer. */
export function historyYears(players: PlayerDetail[]): string[] {
  const years = new Set<string>();
  for (const player of players) {
    for (const year of player.years) years.add(year.year);
  }
  return [...years].sort((a, b) => b.localeCompare(a));
}

/**
 * The number the list shows and ranks by: a single year's games when a year is
 * chosen, otherwise the lifetime total.
 */
export function countForYear(player: PlayerDetail, year: string | undefined): number {
  if (year === undefined) return player.total;
  return player.years.find((entry) => entry.year === year)?.count ?? 0;
}

export function rankHistory(
  players: PlayerDetail[],
  // `year?: string | undefined` rather than `year?: string`, so that under
  // exactOptionalPropertyTypes a caller may both omit it and pass undefined
  // for "Kaikki".
  {
    query,
    sort,
    year,
    locale = 'fi',
  }: { query: string; sort: SortKey; year?: string | undefined; locale?: Locale },
): PlayerDetail[] {
  const collator = collatorFor(locale);
  const matching = filterPlayers(players, query).filter(
    // A chosen year is a view of that year, so somebody who did not play it
    // is not in the list at all — a row of zeroes would say nothing.
    (player) => year === undefined || countForYear(player, year) > 0,
  );

  if (sort === 'name') {
    return matching.sort((a, b) => collator.compare(a.displayName, b.displayName));
  }
  // Ties broken by name so the list never reshuffles between renders.
  return matching.sort(
    (a, b) =>
      countForYear(b, year) - countForYear(a, year) ||
      collator.compare(a.displayName, b.displayName),
  );
}
