import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TodayResponse } from '@sahlykanta/shared';
import { App } from '../src/App.js';
import type { Api } from '../src/lib/api.js';
import { LOCALE_STORAGE_KEY } from '../src/lib/i18n/locale.js';

const MONDAY: TodayResponse = {
  date: '2026-10-19',
  weekday: 1,
  isGameDay: true,
  registrations: [],
  announcements: [],
  schedule: [{ id: 's1', weekday: 1, startTime: '20:00', endTime: '21:30' }],
};

function fakeApi(): Api {
  return {
    today: vi.fn().mockResolvedValue(MONDAY),
    players: vi.fn().mockResolvedValue({ players: [] }),
    register: vi.fn(),
    unregister: vi.fn(),
    setGoalkeeper: vi.fn(),
    history: vi.fn(),
    playerDates: vi.fn(),
    allAnnouncements: vi.fn(),
    addAnnouncement: vi.fn(),
    removeAnnouncement: vi.fn(),
    schedule: vi.fn(),
    addSlot: vi.fn(),
    removeSlot: vi.fn(),
  } as unknown as Api;
}

/** What the browser claims to want, for one test. */
function browserAsks(...languages: string[]): void {
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true,
  });
}

describe('which language the app opens in', () => {
  test('follows the browser when nobody has chosen', async () => {
    browserAsks('uk-UA');
    render(<App api={fakeApi()} />);

    expect(await screen.findByRole('link', { name: 'Сьогодні' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('uk');
  });

  test('falls back to Finnish for a language the app does not have', async () => {
    // Swedish is the obvious one to try here, and it is not offered.
    browserAsks('sv-SE', 'de-DE');
    render(<App api={fakeApi()} />);

    expect(await screen.findByRole('link', { name: 'Tänään' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('fi');
  });

  test('a stored choice beats the browser', async () => {
    // Which is what makes the switcher an override rather than a suggestion.
    browserAsks('fi-FI');
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    render(<App api={fakeApi()} />);

    expect(await screen.findByRole('link', { name: 'Today' })).toBeInTheDocument();
  });
});

describe('the switcher', () => {
  beforeEach(() => {
    browserAsks('fi-FI');
  });

  test('offers each language under its own name', async () => {
    render(<App api={fakeApi()} />);
    const chooser = await screen.findByRole('combobox', { name: 'Kieli' });

    // Somebody hunting for their language is looking for the word they would
    // recognise, not its Finnish name.
    expect([...chooser.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Suomi',
      'English',
      'Українська',
    ]);
  });

  test('changes the page, and says so in the document', async () => {
    render(<App api={fakeApi()} />);
    await screen.findByRole('link', { name: 'Tänään' });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kieli' }), 'uk');

    expect(await screen.findByRole('link', { name: 'Сьогодні' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('uk');
  });

  test('remembers the choice for the next visit', async () => {
    render(<App api={fakeApi()} />);
    await screen.findByRole('link', { name: 'Tänään' });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kieli' }), 'en');

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  test('still switches when storage refuses to remember', async () => {
    // A private window. The choice holds for this tab and is forgotten on
    // the next visit, which beats the click doing nothing.
    const denied = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    render(<App api={fakeApi()} />);
    await screen.findByRole('link', { name: 'Tänään' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kieli' }), 'en');

    expect(await screen.findByRole('link', { name: 'Today' })).toBeInTheDocument();
    denied.mockRestore();
  });
});
