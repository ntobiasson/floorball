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
  today: {
    pill: 'Game day',
    closedTitle: 'No game today',
    nextGameDay: 'Next game day',
    opensOnTheMorning: 'Sign-up opens on the morning of the game',
    slotsHeading: 'Game times',
    noSlotsSet: 'No game times set',
    registered: (count) => (count === 1 ? 'signed up' : 'signed up'),
    nobodyYet: 'Nobody has signed up yet.',
    listLabel: 'Signed up',
    remove: 'Remove',
    removing: 'Removing…',
    cancel: 'Cancel',
    done: 'Done',
    goalkeeperBox: 'Goalkeeper (GK)',
    goalkeeperMark: 'Goalkeeper',
    confirmRemove: (name) => `Confirm: remove ${name}`,
    cancelRemove: (name) => `Cancel: keep ${name} on the list`,
    removeNamed: (name) => `Remove ${name}`,
    markFailed: (name) => `Could not mark ${name}.`,
    removeFailed: (name) => `Could not remove ${name}.`,
    registerFailed: 'Could not sign up.',
  },
  language: {
    choose: 'Language',
    fi: 'Suomi',
    en: 'English',
    uk: 'Українська',
  },
};
