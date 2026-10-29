import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { en } from './en.js';
import { fi, type Messages } from './fi.js';
import { uk } from './uk.js';
import { initialLocale, storeLocale, type Locale } from './locale.js';

export { LOCALES, DEFAULT_LOCALE, type Locale } from './locale.js';
export type { Messages } from './fi.js';

const CATALOGUES: Record<Locale, Messages> = { fi, en, uk };

interface LocaleState {
  locale: Locale;
  /** The catalogue for the chosen language. */
  t: Messages;
  choose: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleState | undefined>(undefined);

/**
 * The chosen language, for everything inside it.
 *
 * Deliberately mounted inside `App` rather than beside it in `main.tsx`: the
 * tests render `App` directly, and a provider they had to remember to wrap
 * would be a provider somebody forgets, in a test that then renders the
 * wrong language and says nothing about it.
 */
export function LocaleProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [locale, setLocale] = useState<Locale>(() => initialLocale());

  useEffect(() => {
    // The document's own language, so a screen reader reads Ukrainian in a
    // Ukrainian voice and a browser offers to translate the right thing.
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleState>(
    () => ({
      locale,
      t: CATALOGUES[locale],
      choose: (next) => {
        storeLocale(next);
        setLocale(next);
      },
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleState(): LocaleState {
  const state = useContext(LocaleContext);
  if (state === undefined) {
    // Throwing beats falling back to Finnish: a component rendered outside
    // the provider would otherwise be permanently Finnish in a way nothing
    // reveals until somebody reads it in the wrong language.
    throw new Error('useT must be used inside a LocaleProvider');
  }
  return state;
}

/** The copy for the chosen language. */
export function useT(): Messages {
  return useLocaleState().t;
}

/** The chosen language and the means to change it: what the switcher needs. */
export function useLocale(): { locale: Locale; choose: (locale: Locale) => void } {
  const { locale, choose } = useLocaleState();
  return { locale, choose };
}
