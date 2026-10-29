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
  language: {
    choose: 'Мова',
    fi: 'Suomi',
    en: 'English',
    uk: 'Українська',
  },
};
