import { foldForSearch } from '@sahlykanta/shared';
import type { PlayerSummary } from '@sahlykanta/shared';

/**
 * Name matching for the registration form's suggestions, run in the browser
 * over the whole player directory.
 *
 * There are about 500 names and they change a few times a week, so the list
 * is fetched once and filtered locally: instant, free, and far more forgiving
 * than a server-side prefix query would be. The data needs that forgiveness —
 * 25 years of free-text entry produced `Pekka N` beside `Pekka Nurmi`,
 * `antti aalto` in lower case, and `Matti Virtanen (EHKÄ)`.
 *
 * Each query word must start one of the name's words, in any order. Order
 * independence makes "harju aatu" work as well as "matti virtanen". Matching at
 * word starts rather than anywhere is what makes a one-letter term useful:
 * "pekka n" finds `Pekka N` and `Pekka Nurmi` but not `Pekka Hämäläinen`, whose
 * k sits in the middle of a word. Punctuation is dropped when splitting, so
 * the goalkeeper marker in `Pekka Hämäläinen (mv)` is findable as "mv".
 */

/** Folded, punctuation dropped, split into the words a query can match. */
function wordsOf(name: string): string[] {
  return foldForSearch(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/**
 * Generic over the player shape so the history page can filter the richer
 * PlayerDetail — with its per-year breakdown — and get it back intact.
 */
export function filterPlayers<T extends PlayerSummary>(players: T[], query: string): T[] {
  const terms = wordsOf(query);
  if (terms.length === 0) return players;

  return players.filter((player) => {
    const words = wordsOf(player.displayName);
    return terms.every((term) => words.some((word) => word.startsWith(term)));
  });
}
