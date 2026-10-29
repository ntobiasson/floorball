import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlayerDetail, PlayerSummary, TodayResponse } from '@sahlykanta/shared';
import { App } from '../src/App.js';
import type { Api } from '../src/lib/api.js';
import { TEST_TURNSTILE_TOKEN } from './setup.js';

/**
 * The easter egg: seven taps on the masthead mark drop the whole page back
 * into the Lotus Domino application this one replaced. It is reached by
 * nothing else — no link, no route, no tab — and a reload leaves it.
 */

const DIRECTORY: PlayerSummary[] = [
  { playerId: 'p-mikko', displayName: 'Mikko Laine', total: 13 },
  { playerId: 'p-matti', displayName: 'Matti Virtanen', total: 94 },
  { playerId: 'p-ehka', displayName: 'Matti Virtanen (EHKÄ)', total: 1 },
  { playerId: 'p-elina', displayName: 'Elina Virtanen', total: 4 },
  { playerId: 'p-aatu', displayName: 'Antti Aalto', total: 11 },
];

const ARCHIVE: PlayerDetail[] = [
  {
    playerId: 'p-matti',
    displayName: 'Matti Virtanen',
    total: 94,
    years: [
      { year: '2026', count: 30 },
      { year: '2025', count: 64 },
    ],
  },
  {
    playerId: 'p-ehka',
    displayName: 'Matti Virtanen (EHKÄ)',
    total: 1,
    years: [{ year: '2023', count: 1 }],
  },
  {
    playerId: 'p-aatu',
    displayName: 'Antti Aalto',
    total: 11,
    years: [{ year: '2026', count: 11 }],
  },
  {
    playerId: 'p-olli',
    displayName: 'Olli Väänänen',
    total: 7,
    years: [{ year: '2009', count: 7 }],
  },
  ...Array.from({ length: 30 }, (_, index) => ({
    playerId: `p-fill-${index}`,
    // Zero-padded so name order and generated order agree.
    displayName: `Pelaaja ${String(index).padStart(2, '0')}`,
    total: index + 1,
    years: [{ year: '2024', count: index + 1 }],
  })),
];

/** The fallback rule, unchanged since nothing in these tests stores a schedule. */
const SCHEDULE = [
  { id: 'default-monday', weekday: 1 },
  { id: 'default-wednesday', weekday: 3 },
  { id: 'default-saturday', weekday: 6 },
];

const MONDAY: TodayResponse = {
  date: '2026-10-19',
  weekday: 1,
  isGameDay: true,
  registrations: [
    {
      playerId: 'p-jukka',
      displayName: 'Jukka Rantanen',
      createdAt: '2026-10-19T06:00:00Z',
      isGoalkeeper: true,
    },
    { playerId: 'p-mikko', displayName: 'Mikko Laine', createdAt: '2026-10-19T06:05:00Z' },
  ],
  announcements: [{ id: 'a1', body: 'Kenttä varattu 21.10. klo 18–19.' }],
  schedule: SCHEDULE,
};

const TUESDAY: TodayResponse = {
  date: '2026-10-20',
  weekday: 2,
  isGameDay: false,
  nextGameDate: '2026-10-21',
  registrations: [],
  announcements: [],
  schedule: SCHEDULE,
};

function fakeApi(today: TodayResponse, overrides: Partial<Api> = {}): Api {
  return {
    today: vi.fn().mockResolvedValue(today),
    players: vi.fn().mockResolvedValue({ players: DIRECTORY }),
    register: vi.fn().mockResolvedValue({ playerId: 'p-new', displayName: 'Uusi' }),
    unregister: vi.fn().mockResolvedValue(undefined),
    setGoalkeeper: vi.fn().mockResolvedValue(undefined),
    history: vi.fn().mockResolvedValue({ players: ARCHIVE }),
    playerDates: vi.fn().mockResolvedValue({
      dates: ['2026-10-28', '2026-10-26', '2025-10-20'],
    }),
    ...overrides,
  } as Api;
}

/** Taps the masthead mark `times` times, as a thumb would. */
async function tapMark(times: number): Promise<void> {
  const mark = await screen.findByRole('button', { name: 'Peleille' });
  for (let i = 0; i < times; i += 1) await userEvent.click(mark);
}

describe('the way in', () => {
  test('seven taps on the mark bring the old application back', async () => {
    render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('heading', { name: 'maanantai' });

    await tapMark(7);

    expect(screen.getByText(/on pelip/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'maanantai' })).not.toBeInTheDocument();
  });

  test('six taps leave the modern page alone', async () => {
    render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('heading', { name: 'maanantai' });

    await tapMark(6);

    expect(screen.getByRole('heading', { name: 'maanantai' })).toBeInTheDocument();
    expect(screen.queryByText(/on pelip/)).not.toBeInTheDocument();
  });

  test('taps spread across the tab bar do not count towards it', async () => {
    render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('heading', { name: 'maanantai' });

    await tapMark(4);
    await userEvent.click(screen.getByRole('link', { name: 'Historia' }));
    await userEvent.click(screen.getByRole('link', { name: 'Tänään' }));
    await tapMark(3);

    expect(screen.queryByText(/on pelip/)).not.toBeInTheDocument();
  });
});

describe('the old page', () => {
  const open = async (today: TodayResponse, overrides: Partial<Api> = {}): Promise<Api> => {
    const api = fakeApi(today, overrides);
    render(<App api={api} />);
    await screen.findByRole('button', { name: 'Peleille' });
    await tapMark(7);
    return api;
  };

  test('says the day the way Domino said it', async () => {
    await open(MONDAY);

    expect(screen.getByText(/Tänään/)).toHaveTextContent('Tänään 19.10.2026 on pelipäivä');
  });

  test('counts the registrations in kpl', async () => {
    await open(MONDAY);

    expect(screen.getByText(/kpl/)).toHaveTextContent('Ilmoittautuneita 2 kpl');
  });

  test('prints the names comma-separated, with no spaces, as the old one did', async () => {
    await open(MONDAY);

    expect(screen.getByText('Jukka Rantanen (MV),Mikko Laine')).toBeInTheDocument();
  });

  test('shows the day in red when it is not a game day', async () => {
    await open(TUESDAY);

    expect(screen.getByText(/Tänään/)).toHaveTextContent('Tänään 20.10.2026 ei ole pelipäivä');
  });

  test('carries the announcements under Tiedotteita', async () => {
    await open(MONDAY);

    expect(screen.getByText('Tiedotteita / uutisia:')).toBeInTheDocument();
    expect(screen.getByText('Kenttä varattu 21.10. klo 18–19.')).toBeInTheDocument();
  });

  test('Käyttöaste leads nowhere, there being no such thing here', async () => {
    await open(MONDAY);

    const item = screen.getByText('Käyttöaste');
    expect(item.closest('a')).toBeNull();
    expect(item.closest('button')).toBeNull();
  });
});

describe('registering from 2002', () => {
  const open = async (overrides: Partial<Api> = {}): Promise<Api> => {
    const api = fakeApi(MONDAY, overrides);
    render(<App api={api} />);
    await screen.findByRole('button', { name: 'Peleille' });
    await tapMark(7);
    return api;
  };

  test('the old button registers through the current API', async () => {
    const api = await open();

    await userEvent.type(screen.getByLabelText('Nimesi'), 'Uusi Pelaaja');
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu tästä' }));

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(
        'Uusi Pelaaja',
        '2026-10-19',
        TEST_TURNSTILE_TOKEN,
        false,
      ),
    );
  });

  test('a name that is already on the list reports the API s refusal', async () => {
    await open({ register: vi.fn().mockRejectedValue(new Error('nimi on jo listalla')) });

    await userEvent.type(screen.getByLabelText('Nimesi'), 'Mikko Laine');
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu tästä' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('nimi on jo listalla');
  });

  /**
   * The old button went straight to the server; this one cannot until
   * Cloudflare has answered. A button that looks ready and does nothing when
   * pressed is worse than one that is plainly not ready yet.
   */
  test('the old button is held until the bot check has answered', async () => {
    window.turnstile = { render: vi.fn(() => 'never-solved'), reset: vi.fn(), remove: vi.fn() };
    const api = await open();

    await userEvent.type(screen.getByLabelText('Nimesi'), 'Uusi Pelaaja');

    expect(screen.getByRole('button', { name: 'Ilmoittaudu tästä' })).toBeDisabled();
    expect(screen.getByText('Odotetaan varmistusta...')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu tästä' }));
    expect(api.register).not.toHaveBeenCalled();
  });

  test('an empty name never reaches the API', async () => {
    const api = await open();

    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu tästä' }));

    expect(api.register).not.toHaveBeenCalled();
  });
});

/**
 * The old page had no name field at all — Domino knew who you were — so this
 * is an invention: one box, which suggests the names the archive knows as it
 * is typed into, and takes a name it has never heard of just the same.
 */
describe('finding a name in 2002', () => {
  const open = async (): Promise<Api> => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);
    await screen.findByRole('button', { name: 'Peleille' });
    await tapMark(7);
    return api;
  };

  test('typing lists the matching names under the box', async () => {
    await open();

    await userEvent.type(screen.getByLabelText('Nimesi'), 'virt');

    const matches = screen.getByRole('list', { name: 'Ehdotukset' });
    expect(
      within(matches)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Matti Virtanen', 'Matti Virtanen (EHKÄ)', 'Elina Virtanen']);
  });

  test('clicking a match fills the box, and the old button still does the registering', async () => {
    const api = await open();

    await userEvent.type(screen.getByLabelText('Nimesi'), 'elin');
    await userEvent.click(screen.getByRole('button', { name: 'Elina Virtanen' }));

    expect(screen.getByLabelText('Nimesi')).toHaveValue('Elina Virtanen');
    expect(api.register).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu tästä' }));
    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(
        'Elina Virtanen',
        '2026-10-19',
        TEST_TURNSTILE_TOKEN,
        false,
      ),
    );
  });

  test('one letter is not enough to list anything', async () => {
    await open();

    await userEvent.type(screen.getByLabelText('Nimesi'), 'v');

    expect(screen.queryByRole('list', { name: 'Ehdotukset' })).not.toBeInTheDocument();
  });

  test('somebody already on tonight s list is not suggested again', async () => {
    await open();

    await userEvent.type(screen.getByLabelText('Nimesi'), 'laine');

    expect(screen.queryByRole('list', { name: 'Ehdotukset' })).not.toBeInTheDocument();
  });

  test('the name is one box and nothing else', async () => {
    const { container } = render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('button', { name: 'Peleille' });
    await tapMark(7);

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.retro input[type="text"]')).toHaveLength(1);
  });

  /**
   * The suggestions are a convenience, never a gate: anyone can register
   * anyone, including somebody who has never played before and is in no
   * list to be picked from.
   */
  test('a name the archive has never heard of is accepted as typed', async () => {
    const api = await open();

    await userEvent.type(screen.getByLabelText('Nimesi'), 'Tuntematon Tulokas');
    expect(screen.queryByRole('list', { name: 'Ehdotukset' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu tästä' }));

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(
        'Tuntematon Tulokas',
        '2026-10-19',
        TEST_TURNSTILE_TOKEN,
        false,
      ),
    );
  });

  test('the list empties once the name has been registered', async () => {
    await open();

    await userEvent.type(screen.getByLabelText('Nimesi'), 'aalto');
    await userEvent.click(screen.getByRole('button', { name: 'Antti Aalto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu tästä' }));

    await waitFor(() => expect(screen.getByLabelText('Nimesi')).toHaveValue(''));
    expect(screen.queryByRole('list', { name: 'Ehdotukset' })).not.toBeInTheDocument();
  });
});

/**
 * Peliaktiivisuus, the view the importer scraped the whole archive out of: an
 * XPages view panel of Nimi | Vuosi | Pvm | Kpl, in name order, every name
 * collapsed until it is opened, thirty to a page.
 */
describe('the old Peliaktiivisuus view', () => {
  const openView = async (): Promise<Api> => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);
    await screen.findByRole('button', { name: 'Peleille' });
    await tapMark(7);
    await userEvent.click(screen.getByRole('button', { name: 'Peliaktiivisuus' }));
    await screen.findByRole('columnheader', { name: 'Nimi' });
    return api;
  };

  /** The names in the leftmost column, in the order the view prints them. */
  const listed = (): string[] =>
    within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('.retro__viewName')?.textContent ?? '')
      .filter((text) => text.length > 0);

  test('the link opens the view, with the four columns the old one had', async () => {
    await openView();

    for (const column of ['Nimi', 'Vuosi', 'Pvm', 'Kpl']) {
      expect(screen.getByRole('columnheader', { name: column })).toBeInTheDocument();
    }
  });

  test('it asks the API for the archive', async () => {
    const api = await openView();

    expect(api.history).toHaveBeenCalled();
  });

  test('the names are in name order, not in order of games played', async () => {
    await openView();

    expect(listed().slice(0, 2)).toEqual(['Antti Aalto', 'Matti Virtanen']);
  });

  test('every name carries its lifetime total in Kpl', async () => {
    await openView();

    const row = screen.getByRole('row', { name: /Antti Aalto/ });
    expect(within(row).getByText('11')).toBeInTheDocument();
  });

  test('thirty names to a page, as the old pager counted them', async () => {
    await openView();

    expect(listed()).toHaveLength(30);
    const second = screen.getByRole('button', { name: '2' });
    expect(second).toHaveAttribute('title', 'Go to page 2');
  });

  test('the pager walks to the next page', async () => {
    await openView();
    const first = listed();

    await userEvent.click(screen.getByRole('button', { name: '2' }));

    expect(listed()).not.toEqual(first);
    expect(listed().length).toBeGreaterThan(0);
  });

  /**
   * The Nimi column used to take every pixel the table had spare, which on a
   * wide window put the counts a hand's width away from the names.
   */
  test('the Nimi column is twice the longest name and no wider', async () => {
    await openView();

    // 'Matti Virtanen (EHKÄ)' is the longest in the archive, at 21.
    const longest = Math.max(...ARCHIVE.map((player) => player.displayName.length));
    const column = screen.getByRole('table').querySelector('col');
    expect(column).toHaveStyle({ width: `${longest * 2}ch` });
  });

  test('the column does not change width from page to page', async () => {
    await openView();
    const before = screen.getByRole('table').querySelector('col')?.getAttribute('style');

    await userEvent.click(screen.getByRole('button', { name: '2' }));

    expect(screen.getByRole('table').querySelector('col')?.getAttribute('style')).toBe(before);
  });

  test('a name opens into its years', async () => {
    await openView();

    await userEvent.click(screen.getByRole('button', { name: 'Avaa Matti Virtanen' }));

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    const years = rows
      .map((row) => row.querySelector('.xspColumnViewMiddle')?.textContent ?? '')
      .filter((text) => text.length > 0);
    expect(years).toEqual(['2026', '2025']);
  });

  /**
   * Pvm is the date column: the level under a year, which is where the old
   * view ended and where this one now ends too.
   */
  test('a year opens into the dates that made it up', async () => {
    const api = await openView();

    await userEvent.click(screen.getByRole('button', { name: 'Avaa Matti Virtanen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Avaa 2026' }));

    expect(await screen.findByText('28.10.2026')).toBeInTheDocument();
    expect(screen.getByText('26.10.2026')).toBeInTheDocument();
    expect(api.playerDates).toHaveBeenCalledWith('p-matti');
  });

  test('a year shows only its own dates', async () => {
    await openView();

    await userEvent.click(screen.getByRole('button', { name: 'Avaa Matti Virtanen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Avaa 2025' }));

    expect(await screen.findByText('20.10.2025')).toBeInTheDocument();
    expect(screen.queryByText('28.10.2026')).not.toBeInTheDocument();
  });

  test('every date counts as the one game it was', async () => {
    await openView();

    await userEvent.click(screen.getByRole('button', { name: 'Avaa Matti Virtanen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Avaa 2026' }));

    const row = (await screen.findByText('28.10.2026')).closest('tr');
    expect(within(row as HTMLElement).getByText('1')).toBeInTheDocument();
  });

  test('the dates are asked for once, however often a year is opened', async () => {
    const api = await openView();

    await userEvent.click(screen.getByRole('button', { name: 'Avaa Matti Virtanen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Avaa 2026' }));
    await screen.findByText('28.10.2026');
    await userEvent.click(screen.getByRole('button', { name: 'Sulje 2026' }));
    await userEvent.click(screen.getByRole('button', { name: 'Avaa 2025' }));

    await screen.findByText('20.10.2025');
    expect(vi.mocked(api.playerDates).mock.calls).toHaveLength(1);
  });

  test('and closes again', async () => {
    await openView();

    await userEvent.click(screen.getByRole('button', { name: 'Avaa Matti Virtanen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sulje Matti Virtanen' }));

    expect(screen.queryByText('2026')).not.toBeInTheDocument();
  });

  test('Ilmoittautumiset goes back to the registration page', async () => {
    await openView();

    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittautumiset' }));

    expect(screen.getByLabelText('Nimesi')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Kpl' })).not.toBeInTheDocument();
  });

  test('Esc still leaves 2002 from in here', async () => {
    await openView();

    await userEvent.keyboard('{Escape}');

    expect(await screen.findByRole('heading', { name: 'maanantai' })).toBeInTheDocument();
  });
});

describe('the way out', () => {
  test('Esc returns to the modern application', async () => {
    render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('button', { name: 'Peleille' });
    await tapMark(7);

    await userEvent.keyboard('{Escape}');

    expect(await screen.findByRole('heading', { name: 'maanantai' })).toBeInTheDocument();
  });

  test('the banner is a real button back, not a clickable image', async () => {
    render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('button', { name: 'Peleille' });
    await tapMark(7);

    const back = screen.getByRole('button', { name: 'Takaisin nykyaikaan' });
    expect(back.tagName).toBe('BUTTON');
    await userEvent.click(back);

    expect(await screen.findByRole('heading', { name: 'maanantai' })).toBeInTheDocument();
  });

  test('the seven taps have to be earned again afterwards', async () => {
    render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('button', { name: 'Peleille' });
    await tapMark(7);
    await userEvent.keyboard('{Escape}');
    await screen.findByRole('heading', { name: 'maanantai' });

    await tapMark(1);

    expect(screen.queryByText(/on pelip/)).not.toBeInTheDocument();
  });
});

describe('the easter egg keeps the accessibility floor', () => {
  test('nothing interactive is a div or span with a click handler', async () => {
    const { container } = render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('button', { name: 'Peleille' });
    await tapMark(7);

    expect(container.querySelectorAll('div[onclick], span[onclick]')).toHaveLength(0);
    expect(container.querySelectorAll('div[role="button"], span[role="button"]')).toHaveLength(0);
  });

  test('the period images carry no meaning, so they are hidden', async () => {
    const { container } = render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('button', { name: 'Peleille' });
    await tapMark(7);

    for (const img of container.querySelectorAll('img')) {
      expect(img.getAttribute('alt')).toBe('');
    }
  });
});
