import type { GameSlot } from '@sahlykanta/shared';

/** Display helpers. The API always sends ISO dates; Finnish is presentation. */

const WEEKDAYS = [
  'sunnuntai',
  'maanantai',
  'tiistai',
  'keskiviikko',
  'torstai',
  'perjantai',
  'lauantai',
] as const;

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? '';
}

/** `2026-10-19` -> `19.10.2026`, the form everyone here reads dates in. */
export function finnishDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  if (year === undefined || month === undefined || day === undefined) return isoDate;
  return `${Number(day)}.${Number(month)}.${year}`;
}

/** `19.10.2026` with its weekday, for the not-a-game-day screen. */
export function finnishDateWithWeekday(isoDate: string, weekday: number): string {
  return `${weekdayName(weekday)} ${finnishDate(isoDate)}`;
}

export function pluralGames(count: number): string {
  return count === 1 ? '1 peli' : `${count} peliä`;
}

/** `'20:00'` → `'20'`, `'21:30'` → `'21.30'`. Returns input unchanged if it cannot parse it. */
export function finnishTime(hhmm: string): string {
  const [hour, minutes] = hhmm.split(':');
  if (hour === undefined || minutes === undefined) return hhmm;
  const hourNum = Number(hour);
  const minutesNum = Number(minutes);
  if (isNaN(hourNum) || isNaN(minutesNum)) return hhmm;
  if (minutesNum === 0) return `${hourNum}`;
  return `${hourNum}.${minutes}`;
}

/** A time range in Finnish format: `'klo 20–21.30'` with an en dash. */
export function finnishTimeRange(start: string, end?: string): string {
  if (end === undefined) {
    return `klo ${finnishTime(start)}`;
  }
  return `klo ${finnishTime(start)}–${finnishTime(end)}`;
}

/** The time range from a game slot, or `undefined` if the slot has no start time. */
export function slotTime(slot: GameSlot): string | undefined {
  if (slot.startTime === undefined) return undefined;
  return finnishTimeRange(slot.startTime, slot.endTime);
}
