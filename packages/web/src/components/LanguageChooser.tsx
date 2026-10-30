import { LOCALES, useLocale, useT, type Locale } from '../lib/i18n/index.js';

/**
 * The language switcher, in the masthead on every page the app renders.
 *
 * A plain `<select>`: it is reachable by keyboard and named to a screen
 * reader without a line of code, and at phone width there is no room for a
 * styled popover that would do the same job worse.
 *
 * Each language is listed under its own name — Suomi, English, Українська —
 * never translated into the language currently showing. Somebody hunting for
 * theirs is looking for the word they recognise, and asking them to read
 * Finnish first is the problem this whole thing exists to fix.
 */
export function LanguageChooser(): React.ReactElement {
  const t = useT();
  const { locale, choose } = useLocale();

  return (
    <select
      className="masthead__language"
      aria-label={t.language.choose}
      value={locale}
      onChange={(event) => choose(event.target.value as Locale)}
    >
      {LOCALES.map((option) => (
        <option key={option} value={option}>
          {t.language[option]}
        </option>
      ))}
    </select>
  );
}
