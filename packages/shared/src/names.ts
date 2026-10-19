/**
 * Names in this data set were typed freely by ~500 people over 25 years:
 * `Pekka N` next to `Pekka Nurmi`, `antti aalto` in lower case,
 * `Matti Virtanen (EHKÄ)` and `Pekka Hämäläinen (mv)` carrying status in the name
 * field. Two rules keep that honest:
 *
 *   - `cleanDisplayName` only tidies whitespace. What people typed is what
 *     gets shown.
 *   - `normalizeName` produces the match/uniqueness key. It folds case,
 *     whitespace and diacritics — so one person spelling their own name two
 *     ways stays one player — but it never strips a suffix, because that
 *     would merge distinct rows and change the per-player totals that the
 *     import checksum verifies against Domino.
 *
 * Tidying genuine duplicates is a deliberate, reversible merge, not a side
 * effect of normalisation.
 */

export const MAX_NAME_LENGTH = 60;

export class EmptyNameError extends Error {
  constructor() {
    super('name is empty after trimming');
    this.name = 'EmptyNameError';
  }
}

const COMBINING_MARKS = /\p{Mn}/gu;

function collapseWhitespace(raw: string): string {
  return raw.replace(/\s+/gu, ' ').trim();
}

/** What gets stored and shown: the person's own spelling, whitespace tidied. */
export function cleanDisplayName(raw: string): string {
  const cleaned = collapseWhitespace(raw);
  if (cleaned.length === 0) throw new EmptyNameError();
  return cleaned;
}

/** The match key. Never used for display. */
export function normalizeName(raw: string): string {
  const cleaned = collapseWhitespace(raw);
  if (cleaned.length === 0) throw new EmptyNameError();
  return cleaned.normalize('NFD').replace(COMBINING_MARKS, '').normalize('NFC').toLowerCase();
}
