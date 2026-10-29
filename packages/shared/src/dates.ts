/**
 * Every date in this application is an ISO `YYYY-MM-DD` string in the
 * Europe/Helsinki calendar. `Date` objects never cross a module boundary:
 * the whole point is that "which day is it" must not depend on the host's
 * timezone, and a `Date` carries no answer to that question.
 */

export const GAME_TIME_ZONE = 'Europe/Helsinki';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 'sv-SE' renders a date as `YYYY-MM-DD`, which is exactly the key format we
 * store, so no manual part assembly is needed.
 */
const helsinkiDateFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: GAME_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export class InvalidDateError extends Error {
  constructor(value: string) {
    super(`not an ISO YYYY-MM-DD date: ${JSON.stringify(value)}`);
    this.name = 'InvalidDateError';
  }
}

function assertIsoDate(iso: string): void {
  if (!ISO_DATE.test(iso)) throw new InvalidDateError(iso);
  // Rejects 2026-02-30 and friends: Date normalises them to another day.
  if (toUtcNoon(iso).toISOString().slice(0, 10) !== iso) throw new InvalidDateError(iso);
}

/**
 * Midday UTC, so that adding whole days can never be nudged across a date
 * boundary by a timezone offset.
 */
function toUtcNoon(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

/** The current date in Helsinki, regardless of where this code runs. */
export function todayInHelsinki(now: Date = new Date()): string {
  return helsinkiDateFormat.format(now);
}

/** Day of week, 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: string): number {
  assertIsoDate(iso);
  return toUtcNoon(iso).getUTCDay();
}

/** The year component, used as the `YEAR#` sort key in DynamoDB. */
export function yearOf(iso: string): string {
  assertIsoDate(iso);
  return iso.slice(0, 4);
}

/** Step whole days forward or backward without timezone nudging the date boundary. */
export function addDays(iso: string, days: number): string {
  assertIsoDate(iso);
  const date = toUtcNoon(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
