/**
 * Which language the app is speaking.
 *
 * Finnish is the default and the fallback: this is one Finnish team's
 * registration page, and English and Ukrainian exist so that a teammate who
 * does not read Finnish can use it. Anything the app cannot offer falls back
 * to Finnish rather than to English.
 */
export const LOCALES = ['fi', 'en', 'uk'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'fi';

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * The first language the browser asks for that this app actually has.
 *
 * Matched on the primary subtag, so `en-GB`, `en-US` and `en` are one
 * language as far as this app is concerned — it has no regional variants to
 * tell apart.
 */
export function detectLocale(requested: readonly string[]): Locale {
  for (const tag of requested) {
    const primary = tag.toLowerCase().split('-')[0];
    if (primary !== undefined && isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

export const LOCALE_STORAGE_KEY = 'peleille.locale';

/**
 * A chosen language has to outlive the tab, or somebody whose browser asks
 * for Finnish has to switch again on every visit.
 *
 * This is the first thing the application has ever stored per visitor, and
 * storage is not always there to store it in: a private window, or a browser
 * with site data blocked, throws on the attempt. Both ways round that is a
 * missing preference, not a broken page — the app simply falls back to what
 * the browser asked for.
 */
export function readStoredLocale(): Locale | undefined {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored !== null && isLocale(stored)) return stored;
  } catch {
    // Storage refused. The browser's own languages are the answer instead.
  }
  return undefined;
}

export function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Refused. The choice holds for this tab and is forgotten on the next
    // visit, which is better than failing the click that made it.
  }
}

/**
 * What the app should open in: the visitor's own choice if they have made
 * one, otherwise whatever their browser asks for.
 */
export function initialLocale(requested: readonly string[] = navigator.languages ?? []): Locale {
  return readStoredLocale() ?? detectLocale(requested);
}
