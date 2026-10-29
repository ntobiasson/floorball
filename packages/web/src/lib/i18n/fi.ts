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
  today: {
    pill: 'Pelipäivä',
    closedTitle: 'Tänään ei pelata',
    nextGameDay: 'Seuraava pelipäivä',
    opensOnTheMorning: 'Ilmoittautuminen avautuu pelipäivän aamuna',
    slotsHeading: 'Pelivuorot',
    noSlotsSet: 'Pelivuoroja ei ole asetettu',
    /**
     * `7 ilmoittautunutta` — the partitive again, from two on.
     *
     * The `: string` is load-bearing. Without it TypeScript infers the
     * return as the union of these two Finnish words, `Messages` demands
     * exactly them, and no other language can satisfy the contract. Any
     * message here whose branches are all plain literals needs it; one built
     * from a template string widens on its own.
     */
    registered: (count: number): string => (count === 1 ? 'ilmoittautunut' : 'ilmoittautunutta'),
    nobodyYet: 'Kukaan ei ole vielä ilmoittautunut.',
    listLabel: 'Ilmoittautuneet',
    remove: 'Poista',
    removing: 'Poistetaan…',
    cancel: 'Peru',
    done: 'Valmis',
    goalkeeperBox: 'Maalivahti (MV)',
    goalkeeperMark: 'Maalivahti',
    /** The verb leads in Finnish and trails the name in English; hence three
        separate sentences rather than one template with a hole in it. */
    confirmRemove: (name: string) => `Vahvista: poista ${name}`,
    cancelRemove: (name: string) => `Peruuta: ${name} jää listalle`,
    removeNamed: (name: string) => `Poista ${name}`,
    markFailed: (name: string) => `${name} merkitseminen ei onnistunut.`,
    removeFailed: (name: string) => `${name} poistaminen ei onnistunut.`,
    registerFailed: 'Ilmoittautuminen ei onnistunut.',
  },
  settings: {
    title: 'Asetukset',
    formHeading: 'Pelivuoro',
    weekday: 'Viikonpäivä',
    startsAt: 'Alkaa',
    endsAt: 'Päättyy',
    add: 'Lisää pelivuoro',
    liveAtOnce: 'Muutos on voimassa heti, ja näkyy heti etusivulla.',
    waitingForCheck: 'Odotetaan varmistusta…',
    listHeading: 'Pelivuorot',
    noneAtAll: 'Yhtään pelivuoroa ei ole — tällä hetkellä ei pelata.',
    /** The list of days arrives already joined; only the sentence is here. */
    neverSet: (days: string): string =>
      `Pelivuoroja ei ole vielä asetettu. Käytössä oletuksena: ${days} — ensimmäinen tallennettu pelivuoro korvaa ne.`,
    removeQuestion: 'Poistetaanko?',
    yes: 'Kyllä',
    cancel: 'Peru',
    remove: 'Poista',
    confirmRemove: (slot: string): string => `Vahvista: poista pelivuoro ${slot}`,
    cancelRemove: (slot: string): string => `Peruuta: pelivuoro ${slot} jää`,
    removeNamed: (slot: string): string => `Poista pelivuoro ${slot}`,
    loadFailed: 'Pelivuorojen haku ei onnistunut.',
    addFailed: 'Pelivuoron lisäys ei onnistunut.',
    removeFailed: 'Pelivuoron poisto ei onnistunut.',
  },
  notices: {
    heading: 'Tiedotteet',
    formHeading: 'Tiedote',
    placeholder: 'Esim. Kenttä varattu 21.10. klo 18–19.',
    shownFromLabel: 'Näytetään alkaen',
    shownUntilLabel: 'Näytetään asti',
    add: 'Lisää tiedote',
    listHeading: 'Kaikki tiedotteet',
    loading: 'Haetaan…',
    none: 'Ei tiedotteita.',
    /**
     * Three sentences, not one template: Finnish puts `alkaen` in front of
     * the date and `asti` after it, so the particle changes sides between
     * the branches and no single shape covers both.
     */
    shownBetween: (from: string, to: string): string => `Näytetään ${from} – ${to}`,
    shownFrom: (from: string): string => `Näytetään alkaen ${from}`,
    shownUntil: (to: string): string => `Näytetään ${to} asti`,
    removeQuestion: 'Poistetaanko?',
    yes: 'Kyllä',
    cancel: 'Peru',
    remove: 'Poista',
    confirmRemove: (body: string): string => `Vahvista: poista tiedote ${body}`,
    cancelRemove: (body: string): string => `Peruuta: tiedote ${body} jää`,
    removeNamed: (body: string): string => `Poista tiedote ${body}`,
    loadFailed: 'Tiedotteiden haku ei onnistunut.',
    addFailed: 'Tiedotteen lisäys ei onnistunut.',
    removeFailed: 'Tiedotteen poisto ei onnistunut.',
  },
  historyPage: {
    title: 'Peliaktiivisuus',
    nothingYet: 'Ei vielä pelikertoja.',
    yearLabel: 'Vuosi',
    allYears: 'Kaikki',
    search: 'Hae pelaajan nimellä',
    mostGames: 'Eniten pelejä',
    byName: 'Nimi A–Ö',
    playersLabel: 'Pelaajat',
    /** `Kaikki pelikerrat 2001–2026`, or one year when that is all there is. */
    allGames: (span: string): string => `Kaikki pelikerrat ${span}`,
    gamesInYear: (year: string): string => `Pelikerrat vuonna ${year}`,
    /** The year clause is optional and sits inside the sentence, not after it. */
    noMatches: (query: string, year: string | undefined): string =>
      year === undefined
        ? `Ei osumia haulla “${query}”.`
        : `Ei osumia haulla “${query}” vuonna ${year}.`,
    byYearLabel: (name: string): string => `${name} vuosittain`,
  },
  register: {
    name: 'Nimi',
    namePlaceholder: 'Hae tai kirjoita nimi',
    hint: 'Ehdotetaan aiemmin pelanneista · uusi nimi käy myös',
    asGoalkeeper: 'Ilmoittaudun maalivahdiksi',
    suggestions: 'Ehdotukset',
    submit: 'Ilmoittaudu',
    submitting: 'Ilmoittaudutaan…',
  },
  check: {
    failed: 'Varmistusta ei saatu ladattua. Tarkista verkkoyhteys ja yritä uudelleen.',
    code: (code: string): string => ` (virhekoodi ${code})`,
    retry: 'Yritä varmistusta uudelleen',
  },
  glyph: {
    notAGameDay: 'Ei pelipäivä',
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
