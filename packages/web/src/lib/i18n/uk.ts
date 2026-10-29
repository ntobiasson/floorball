import type { Messages } from './fi.js';

/**
 * Ukrainian.
 *
 * Drafted rather than translated by a speaker, which is worth knowing when
 * reading it: the person this language exists for is the right person to
 * correct it, and corrections belong in this file alone.
 *
 * `Peleille` stays as it is — it is the thing's name, and a name is not
 * translated.
 */
export const uk: Messages = {
  tabs: {
    pages: 'Сторінки',
    today: 'Сьогодні',
    history: 'Історія',
  },
  shell: {
    mark: 'Peleille',
    backToRegistration: 'Назад до реєстрації',
    loading: 'Завантаження…',
    noService: 'Не вдалося зʼєднатися із сервісом.',
    noHistory: 'Не вдалося завантажити історію.',
  },
  history: {
    /**
     * Ukrainian counts in three: одна гра, дві ігри, п'ять ігор. `Intl` knows
     * the rule, so this only has to supply the words.
     */
    games: (count) => {
      const form = new Intl.PluralRules('uk').select(count);
      const noun = form === 'one' ? 'гра' : form === 'few' ? 'ігри' : 'ігор';
      return `${count} ${noun}`;
    },
  },
  time: {
    at: (range) => `о ${range}`,
  },
  today: {
    pill: 'Ігровий день',
    closedTitle: 'Сьогодні не граємо',
    nextGameDay: 'Наступний ігровий день',
    opensOnTheMorning: 'Реєстрація відкривається вранці в день гри',
    slotsHeading: 'Ігрові години',
    noSlotsSet: 'Ігрові години не встановлені',
    registered: (count) => {
      const form = new Intl.PluralRules('uk').select(count);
      return form === 'one' ? 'зареєстрований' : 'зареєстровані';
    },
    nobodyYet: 'Ще ніхто не зареєструвався.',
    listLabel: 'Зареєстровані',
    remove: 'Видалити',
    removing: 'Видаляємо…',
    cancel: 'Скасувати',
    done: 'Готово',
    goalkeeperBox: 'Воротар (ВР)',
    goalkeeperMark: 'Воротар',
    confirmRemove: (name) => `Підтвердити: видалити ${name}`,
    cancelRemove: (name) => `Скасувати: ${name} залишається у списку`,
    removeNamed: (name) => `Видалити ${name}`,
    markFailed: (name) => `Не вдалося позначити ${name}.`,
    removeFailed: (name) => `Не вдалося видалити ${name}.`,
    registerFailed: 'Не вдалося зареєструватися.',
  },
  settings: {
    title: 'Налаштування',
    formHeading: 'Ігрова година',
    weekday: 'День тижня',
    startsAt: 'Початок',
    endsAt: 'Кінець',
    add: 'Додати ігрову годину',
    liveAtOnce: 'Зміна діє одразу й одразу видно на головній сторінці.',
    waitingForCheck: 'Очікуємо перевірку…',
    listHeading: 'Ігрові години',
    noneAtAll: 'Ігрових годин немає — зараз не граємо.',
    neverSet: (days) =>
      `Ігрові години ще не встановлені. Типово граємо: ${days} — перша збережена година замінить їх.`,
    removeQuestion: 'Видалити?',
    yes: 'Так',
    cancel: 'Скасувати',
    remove: 'Видалити',
    confirmRemove: (slot) => `Підтвердити: видалити ігрову годину ${slot}`,
    cancelRemove: (slot) => `Скасувати: ігрова година ${slot} залишається`,
    removeNamed: (slot) => `Видалити ігрову годину ${slot}`,
    loadFailed: 'Не вдалося завантажити ігрові години.',
    addFailed: 'Не вдалося додати ігрову годину.',
    removeFailed: 'Не вдалося видалити ігрову годину.',
  },
  notices: {
    heading: 'Оголошення',
    formHeading: 'Оголошення',
    placeholder: 'Наприклад: зал зайнятий 21.10. о 18–19.',
    shownFromLabel: 'Показувати з',
    shownUntilLabel: 'Показувати до',
    add: 'Додати оголошення',
    listHeading: 'Усі оголошення',
    loading: 'Завантаження…',
    none: 'Оголошень немає.',
    shownBetween: (from, to) => `Показується ${from} – ${to}`,
    shownFrom: (from) => `Показується з ${from}`,
    shownUntil: (to) => `Показується до ${to}`,
    removeQuestion: 'Видалити?',
    yes: 'Так',
    cancel: 'Скасувати',
    remove: 'Видалити',
    confirmRemove: (body) => `Підтвердити: видалити оголошення ${body}`,
    cancelRemove: (body) => `Скасувати: оголошення ${body} залишається`,
    removeNamed: (body) => `Видалити оголошення ${body}`,
    loadFailed: 'Не вдалося завантажити оголошення.',
    addFailed: 'Не вдалося додати оголошення.',
    removeFailed: 'Не вдалося видалити оголошення.',
  },
  historyPage: {
    title: 'Історія ігор',
    nothingYet: 'Ігор ще немає.',
    yearLabel: 'Рік',
    allYears: 'Усі',
    search: 'Пошук за іменем гравця',
    mostGames: 'Найбільше ігор',
    byName: 'Імʼя А–Я',
    playersLabel: 'Гравці',
    allGames: (span) => `Усі ігри ${span}`,
    gamesInYear: (year) => `Ігри у ${year} році`,
    noMatches: (query, year) =>
      year === undefined
        ? `Нічого не знайдено за запитом «${query}».`
        : `Нічого не знайдено за запитом «${query}» у ${year} році.`,
    byYearLabel: (name) => `${name} за роками`,
  },
  register: {
    name: 'Імʼя',
    namePlaceholder: 'Знайдіть або введіть імʼя',
    hint: 'Підказки з тих, хто вже грав · нове імʼя теж підходить',
    asGoalkeeper: 'Реєструюся воротарем',
    suggestions: 'Підказки',
    submit: 'Зареєструватися',
    submitting: 'Реєструємо…',
  },
  check: {
    failed: 'Не вдалося завантажити перевірку. Перевірте зʼєднання і спробуйте ще раз.',
    code: (code) => ` (код помилки ${code})`,
    retry: 'Спробувати перевірку ще раз',
  },
  glyph: {
    notAGameDay: 'Не ігровий день',
  },
  language: {
    choose: 'Мова',
    fi: 'Suomi',
    en: 'English',
    uk: 'Українська',
  },
};
