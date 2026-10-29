/**
 * Finnish, and the shape every other language has to match.
 *
 * `Messages` is `typeof fi`, so this file is both the Finnish copy and the
 * contract: a key missing from `en.ts` or `uk.ts`, a spare one, or a message
 * taking the wrong arguments is a compile error rather than `undefined`
 * rendered at somebody.
 *
 * Messages that take arguments are functions, not templates with holes in
 * them. A language gets to put the pieces in its own order that way —
 * Finnish says "Näytetään alkaen 1.12." and "Näytetään 1.12. asti" with the
 * particle on opposite sides of the date, and no single template covers both.
 */
export const fi = {
  tabs: {
    pages: 'Sivut',
    today: 'Tänään',
    history: 'Historia',
  },
  shell: {
    mark: 'Peleille',
    backToRegistration: 'Takaisin ilmoittautumiseen',
    loading: 'Haetaan…',
    noService: 'Palvelua ei saatu yhteyttä.',
    noHistory: 'Historiaa ei saatu haettua.',
  },
  history: {
    /** `1 peli` / `12 peliä` — the partitive, which Finnish takes from two on. */
    games: (count: number) => (count === 1 ? '1 peli' : `${count} peliä`),
  },
  time: {
    /**
     * Finnish puts the word before the clock: `klo 20–21.30`. It is a word,
     * not a format, which is why it lives here and not in format.ts.
     */
    at: (range: string) => `klo ${range}`,
  },
  language: {
    /** The switcher's own label, read by a screen reader. */
    choose: 'Kieli',
    fi: 'Suomi',
    en: 'English',
    uk: 'Українська',
  },
};

export type Messages = typeof fi;
