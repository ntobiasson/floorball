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
