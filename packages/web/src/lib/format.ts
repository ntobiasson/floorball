import type { GameSlot } from '@sahlykanta/shared';
import type { Locale } from './i18n/locale.js';

/**
 * Dates and times, in whichever language the app is speaking.
 *
 * This module holds the mechanical half of saying when something happens:
 * which order the parts go in, which separator sits between them. The words
 * themselves — Finnish's "klo", English's "at" — belong to a language and
 * live in its catalogue, so nothing here ever has to be read aloud.
 *
 * The API always sends an ISO date and an `HH:MM` time; this is presentation
 * and nothing else. Nothing here is used to decide what day it is.
 */

/**
 * The tag each language formats with.
 *
 * English is `en-GB`, not `en`: Intl reads a bare `en` as American and would
 * write 19.10.2026 as `10/19/2026`, which is the wrong day to everybody who
 * plays here.
 */
const FORMATTING_TAG: Record<Locale, string> = {
  fi: 'fi',
  en: 'en-GB',
  uk: 'uk',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^(\d{1,2}):(\d{2})$/;

/**
 * Midday UTC, so that naming the weekday of a date cannot be nudged into the
 * day before by an offset — the same reason `dates.ts` picks noon.
 */
function atNoon(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00Z`);
}

/** Day of week, 0 = Sunday … 6 = Saturday, as `weekdayOf` returns. */
export function weekdayName(locale: Locale, weekday: number): string {
  // 4.1.2026 was a Sunday, so adding the weekday number lands on that day.
  const day = 4 + (((weekday % 7) + 7) % 7);
  const reference = atNoon(`2026-01-${String(day).padStart(2, '0')}`);
  return new Intl.DateTimeFormat(FORMATTING_TAG[locale], {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(reference);
}

export function formatDate(locale: Locale, isoDate: string): string {
  if (!ISO_DATE.test(isoDate)) return isoDate;
  return new Intl.DateTimeFormat(FORMATTING_TAG[locale], {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(atNoon(isoDate));
}

export function formatDateWithWeekday(locale: Locale, isoDate: string, weekday: number): string {
  return `${weekdayName(locale, weekday)} ${formatDate(locale, isoDate)}`;
}

/**
 * One time of day.
 *
 * Finnish prose writes half past nine as `9.30` and nine o'clock as plain
 * `9` — a period rather than a colon, and no minutes on a whole hour. The
 * other two keep the 24-hour clock as it is written, because a bare `20`
 * reads as a quantity rather than a time in either of them.
 */
export function formatTime(locale: Locale, hhmm: string): string {
  const match = HH_MM.exec(hhmm);
  if (match === null) return hhmm;

  const [, hours, minutes] = match as unknown as [string, string, string];
  if (locale !== 'fi') return `${hours.padStart(2, '0')}:${minutes}`;
  return minutes === '00' ? String(Number(hours)) : `${Number(hours)}.${minutes}`;
}

/** The en dash is U+2013, as a range takes in all three languages. */
export function formatTimeRange(locale: Locale, start: string, end?: string): string {
  if (end === undefined) return formatTime(locale, start);
  return `${formatTime(locale, start)}–${formatTime(locale, end)}`;
}

/** A slot's time, or nothing at all when it carries none. */
export function slotTime(locale: Locale, slot: GameSlot): string | undefined {
  if (slot.startTime === undefined) return undefined;
  return formatTimeRange(locale, slot.startTime, slot.endTime);
}
