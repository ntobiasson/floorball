import type { Messages } from './fi.js';

/**
 * English. The annotation is the point: drop a key and this file stops
 * compiling.
 *
 * A language name is written in that language — somebody looking for their
 * own is looking for the word they would recognise, not its Finnish name.
 */
export const en: Messages = {
  tabs: {
    pages: 'Pages',
    today: 'Today',
    history: 'History',
  },
  shell: {
    mark: 'Peleille',
    backToRegistration: 'Back to registration',
    loading: 'Loading…',
    noService: 'Could not reach the service.',
    noHistory: 'Could not load the history.',
  },
  history: {
    games: (count) => (count === 1 ? '1 game' : `${count} games`),
  },
  time: {
    at: (range) => `at ${range}`,
  },
  language: {
    choose: 'Language',
    fi: 'Suomi',
    en: 'English',
    uk: 'Українська',
  },
};
