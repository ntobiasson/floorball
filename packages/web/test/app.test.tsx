import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlayerDetail, PlayerSummary, TodayResponse } from '@sahlykanta/shared';
import { App } from '../src/App.js';
import type { Api } from '../src/lib/api.js';
import { TEST_TURNSTILE_TOKEN } from './setup.js';

const DIRECTORY: PlayerSummary[] = [
  { playerId: 'p-aatu', displayName: 'Matti Virtanen', total: 278 },
  { playerId: 'p-sivula', displayName: 'Liisa Korhonen', total: 233 },
  { playerId: 'p-katja', displayName: 'Riikka Mäkelä', total: 5 },
];

/**
 * Shaped like the real archive: a regular, somebody who stopped in 2009 and
 * survives only in the imported directory, and the `(EHKÄ)` duplicate that is
 * its own player.
 */
const ARCHIVE: PlayerDetail[] = [
  {
    playerId: 'p-sivula',
    displayName: 'Liisa Korhonen',
    total: 30,
    years: [
      { year: '2026', count: 10 },
      { year: '2025', count: 20 },
    ],
  },
  {
    playerId: 'p-aatu',
    displayName: 'Matti Virtanen',
    total: 45,
    years: [
      { year: '2026', count: 5 },
      { year: '2025', count: 25 },
      { year: '2024', count: 15 },
    ],
  },
  {
    playerId: 'p-olli',
    displayName: 'Olli Väänänen',
    total: 7,
    years: [{ year: '2009', count: 7 }],
  },
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
    { playerId: 'p-mikko', displayName: 'Mikko Laine', createdAt: '2026-10-19T06:00:00Z' },
    { playerId: 'p-jukka', displayName: 'Jukka Rantanen', createdAt: '2026-10-19T06:05:00Z' },
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

/** Monday carries a time, the way a schedule saved through settings would. */
const MONDAY_WITH_TIME: TodayResponse = {
  ...MONDAY,
  schedule: [
    { id: 's-monday', weekday: 1, startTime: '20:00', endTime: '21:30' },
    { id: 's-wednesday', weekday: 3, startTime: '19:00' },
    { id: 's-saturday', weekday: 6, startTime: '10:00' },
  ],
};

/** Two slots on the same Monday evening, to check they join rather than stack. */
const MONDAY_TWO_SLOTS: TodayResponse = {
  ...MONDAY,
  schedule: [
    { id: 's-monday-early', weekday: 1, startTime: '18:00' },
    { id: 's-monday-late', weekday: 1, startTime: '20:00' },
  ],
};

/** Tuesday's next game day (Wednesday) carries a time. */
const TUESDAY_NEXT_WITH_TIME: TodayResponse = {
  ...TUESDAY,
  schedule: MONDAY_WITH_TIME.schedule,
};

/** A schedule that plays only on Thursday — nothing like the Mon/Wed/Sat fallback. */
const TUESDAY_THURSDAY_ONLY: TodayResponse = {
  ...TUESDAY,
  nextGameDate: '2026-10-22',
  schedule: [{ id: 's-thursday', weekday: 4, startTime: '19:00' }],
};

/** The schedule was configured and then emptied: no slots at all. */
const TUESDAY_EMPTY_SCHEDULE: TodayResponse = {
  ...TUESDAY,
  nextGameDate: undefined,
  schedule: [],
};

// Navigating pushes history state, and jsdom keeps the URL for the whole
// file, so every test starts from the root route explicitly.
beforeEach(() => {
  window.history.pushState({}, '', '/');
});

function fakeApi(today: TodayResponse, overrides: Partial<Api> = {}): Api {
  return {
    today: vi.fn().mockResolvedValue(today),
    players: vi.fn().mockResolvedValue({ players: DIRECTORY }),
    register: vi.fn().mockResolvedValue({ playerId: 'p-new', displayName: 'Uusi' }),
    unregister: vi.fn().mockResolvedValue(undefined),
    setGoalkeeper: vi.fn().mockResolvedValue(undefined),
    history: vi.fn().mockResolvedValue({ players: ARCHIVE }),
    ...overrides,
  } as Api;
}

/** Opens the history page through the tab bar, as a visitor would. */
async function openHistory(api: Api): Promise<void> {
  render(<App api={api} />);
  await userEvent.click(await screen.findByRole('link', { name: 'Historia' }));
  await screen.findByRole('heading', { name: 'Peliaktiivisuus' });
}

/**
 * The names the history list is showing, in the order it shows them. Each row
 * is one toggle button whose accessible name is "<player>, <n> peliä", so
 * reading the list back needs no knowledge of its markup.
 */
function listedNames(): string[] {
  return within(screen.getByRole('list', { name: 'Pelaajat' }))
    .getAllByRole('button')
    .map((button) => (button.getAttribute('aria-label') ?? '').split(',')[0] ?? '');
}

/** What each row reports as its count, in list order. */
function listedCounts(): string[] {
  return within(screen.getByRole('list', { name: 'Pelaajat' }))
    .getAllByRole('button')
    .map((button) => (button.getAttribute('aria-label') ?? '').split(', ')[1] ?? '');
}

describe('a game day', () => {
  test('shows the weekday, the date and who is registered', async () => {
    render(<App api={fakeApi(MONDAY)} />);

    expect(await screen.findByRole('heading', { name: 'maanantai' })).toBeInTheDocument();
    expect(screen.getByText('19.10.2026')).toBeInTheDocument();
    expect(screen.getByText('Mikko Laine')).toBeInTheDocument();
    expect(screen.getByText('Jukka Rantanen')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  test('shows tonight’s time after the date on the same line', async () => {
    render(<App api={fakeApi(MONDAY_WITH_TIME)} />);

    await screen.findByRole('heading', { name: 'maanantai' });
    // The time is a nested span, so RTL's default text match (which looks
    // only at an element's own text nodes) finds the date paragraph by its
    // date alone; toHaveTextContent then reads the whole line, nested span
    // included, to confirm the time really followed it on that same line.
    expect(screen.getByText('19.10.2026')).toHaveTextContent('19.10.2026 klo 20–21.30');
  });

  test('shows both times when two slots fall on the same evening', async () => {
    render(<App api={fakeApi(MONDAY_TWO_SLOTS)} />);

    await screen.findByRole('heading', { name: 'maanantai' });
    expect(screen.getByText('19.10.2026')).toHaveTextContent('19.10.2026 klo 18, klo 20');
  });

  test('shows no time for a slot that carries none', async () => {
    render(<App api={fakeApi(MONDAY)} />);

    await screen.findByRole('heading', { name: 'maanantai' });
    const date = screen.getByText('19.10.2026');
    expect(date).toBeInTheDocument();
    expect(date).not.toHaveTextContent('klo');
  });

  test('offers the registration form', async () => {
    render(<App api={fakeApi(MONDAY)} />);

    expect(await screen.findByLabelText('Nimi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ilmoittaudu' })).toBeInTheDocument();
  });

  test('shows the announcement', async () => {
    render(<App api={fakeApi(MONDAY)} />);

    expect(await screen.findByText('Kenttä varattu 21.10. klo 18–19.')).toBeInTheDocument();
  });

  test('registers a typed name for today, never another date', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'Uusi Pelaaja');
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu' }));

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(
        'Uusi Pelaaja',
        '2026-10-19',
        TEST_TURNSTILE_TOKEN,
        false,
      ),
    );
  });

  test('does not call the API for an empty name', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);

    await screen.findByLabelText('Nimi');
    expect(screen.getByRole('button', { name: 'Ilmoittaudu' })).toBeDisabled();
    expect(api.register).not.toHaveBeenCalled();
  });

  test('does not call the API for a whitespace-only name', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), '   ');
    expect(screen.getByRole('button', { name: 'Ilmoittaudu' })).toBeDisabled();
    expect(api.register).not.toHaveBeenCalled();
  });

  test('suggests known players as you type and registers the one picked', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'makel');
    const suggestions = screen.getByRole('list', { name: 'Ehdotukset' });
    await userEvent.click(within(suggestions).getByRole('button', { name: 'Riikka Mäkelä' }));

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(
        'Riikka Mäkelä',
        '2026-10-19',
        TEST_TURNSTILE_TOKEN,
        false,
      ),
    );
  });

  test('shows the API message when registering is refused', async () => {
    const api = fakeApi(MONDAY, {
      register: vi.fn().mockRejectedValue(new Error('nimi on jo listalla')),
    });
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'Mikko Laine');
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('nimi on jo listalla');
  });
});

describe('registering as the goalkeeper', () => {
  /** The form's box. The chips carry one too, under a different name. */
  const box = (): HTMLElement =>
    screen.getByRole('checkbox', { name: 'Ilmoittaudun maalivahdiksi' });

  test('the box is on the form before a name is, and starts empty', async () => {
    render(<App api={fakeApi(MONDAY)} />);

    await screen.findByLabelText('Nimi');
    expect(box()).not.toBeChecked();
  });

  test('a ticked box registers a typed name as the goalkeeper', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'Jukka Rantanen');
    await userEvent.click(box());
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu' }));

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(
        'Jukka Rantanen',
        '2026-10-19',
        TEST_TURNSTILE_TOKEN,
        true,
      ),
    );
  });

  /**
   * Tapping a suggestion registers that name on the spot, so the box has to
   * be reachable — and tickable — before the tap. This is why it sits above
   * the suggestions rather than beside the submit button.
   */
  test('a ticked box is carried into a name picked from the suggestions', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'makel');
    await userEvent.click(box());
    const suggestions = screen.getByRole('list', { name: 'Ehdotukset' });
    await userEvent.click(within(suggestions).getByRole('button', { name: 'Riikka Mäkelä' }));

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(
        'Riikka Mäkelä',
        '2026-10-19',
        TEST_TURNSTILE_TOKEN,
        true,
      ),
    );
  });

  test('the box empties after a registration, so the next name is not marked by accident', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'Jukka Rantanen');
    await userEvent.click(box());
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu' }));

    await waitFor(() => expect(box()).not.toBeChecked());
  });

  /**
   * The box follows the name field, which this form has always cleared once a
   * submission has been answered — refused or not. A box left ticked after a
   * refusal is how the next name typed into an empty field would end up in
   * goal without anyone asking for it.
   */
  test('a refused registration leaves neither the name nor the box behind', async () => {
    const api = fakeApi(MONDAY, {
      register: vi.fn().mockRejectedValue(new Error('nimi on jo listalla')),
    });
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'Mikko Laine');
    await userEvent.click(box());
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu' }));

    await screen.findByRole('alert');
    expect(screen.getByLabelText('Nimi')).toHaveValue('');
    expect(box()).not.toBeChecked();
  });

  test('the not-a-game-day screen has no box, having no form', async () => {
    render(<App api={fakeApi(TUESDAY)} />);

    await screen.findByRole('heading', { name: 'Tänään ei pelata' });
    expect(
      screen.queryByRole('checkbox', { name: 'Ilmoittaudun maalivahdiksi' }),
    ).not.toBeInTheDocument();
  });
});

describe('a day that is not a game day', () => {
  test('says so and names the next game day', async () => {
    render(<App api={fakeApi(TUESDAY)} />);

    expect(await screen.findByRole('heading', { name: 'Tänään ei pelata' })).toBeInTheDocument();
    expect(screen.getByText('tiistai 20.10.2026')).toBeInTheDocument();
    expect(screen.getByText('21.10.2026')).toBeInTheDocument();
  });

  test('offers no registration form at all', async () => {
    render(<App api={fakeApi(TUESDAY)} />);

    await screen.findByRole('heading', { name: 'Tänään ei pelata' });
    expect(screen.queryByLabelText('Nimi')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ilmoittaudu' })).not.toBeInTheDocument();
  });

  test('shows which weekdays are game days', async () => {
    render(<App api={fakeApi(TUESDAY)} />);

    await screen.findByRole('heading', { name: 'Tänään ei pelata' });
    for (const day of ['Ma', 'Ke', 'La']) {
      expect(screen.getByText(day)).toHaveClass('weekstrip__day--game');
    }
    for (const day of ['Ti', 'To', 'Pe', 'Su']) {
      expect(screen.getByText(day)).not.toHaveClass('weekstrip__day--game');
    }
  });

  test('shows the next playing day’s time beside its date', async () => {
    render(<App api={fakeApi(TUESDAY_NEXT_WITH_TIME)} />);

    await screen.findByRole('heading', { name: 'Tänään ei pelata' });
    expect(screen.getByText('21.10.2026 klo 19')).toBeInTheDocument();
  });

  test('draws the week strip from the schedule, not from Monday-Wednesday-Saturday', async () => {
    render(<App api={fakeApi(TUESDAY_THURSDAY_ONLY)} />);

    await screen.findByRole('heading', { name: 'Tänään ei pelata' });
    expect(screen.getByText('To')).toHaveClass('weekstrip__day--game');
    for (const day of ['Ma', 'Ti', 'Ke', 'Pe', 'La', 'Su']) {
      expect(screen.getByText(day)).not.toHaveClass('weekstrip__day--game');
    }
  });

  test('lists each slot under the strip with its weekday and time', async () => {
    render(<App api={fakeApi(TUESDAY_NEXT_WITH_TIME)} />);

    await screen.findByRole('heading', { name: 'Tänään ei pelata' });
    // The weekday and the time are separate spans in the same row; find the
    // row by its weekday, then confirm the time sits in that same row.
    expect(screen.getByText('maanantai').closest('.weekslots__row')).toHaveTextContent(
      'maanantai klo 20–21.30',
    );
    expect(screen.getByText('keskiviikko').closest('.weekslots__row')).toHaveTextContent(
      'keskiviikko klo 19',
    );
    expect(screen.getByText('lauantai').closest('.weekslots__row')).toHaveTextContent(
      'lauantai klo 10',
    );
  });

  test('offers no next playing day when the schedule is empty', async () => {
    render(<App api={fakeApi(TUESDAY_EMPTY_SCHEDULE)} />);

    await screen.findByRole('heading', { name: 'Tänään ei pelata' });
    expect(screen.queryByText('Seuraava pelipäivä')).not.toBeInTheDocument();
    expect(screen.getByText('Pelivuoroja ei ole asetettu')).toBeInTheDocument();
  });
});

describe('accessibility floor', () => {
  test('the name input has a real label', async () => {
    render(<App api={fakeApi(MONDAY)} />);

    const input = await screen.findByLabelText('Nimi');
    expect(input.tagName).toBe('INPUT');
  });

  test('every remove control is a button with an accessible name', async () => {
    render(<App api={fakeApi(MONDAY)} />);

    const remove = await screen.findByRole('button', { name: 'Poista Mikko Laine' });
    expect(remove.tagName).toBe('BUTTON');
  });

  test('nothing interactive is a div or span with a click handler', async () => {
    const { container } = render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('heading', { name: 'maanantai' });

    // Tab skips a clickable div, so every control must be a real element.
    expect(container.querySelectorAll('div[onclick], span[onclick]')).toHaveLength(0);
    expect(container.querySelectorAll('div[role="button"], span[role="button"]')).toHaveLength(0);
  });

  test('decorative graphics are hidden from assistive technology', async () => {
    const { container } = render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('heading', { name: 'maanantai' });

    for (const svg of container.querySelectorAll('svg')) {
      const labelled = svg.getAttribute('role') === 'img' && svg.hasAttribute('aria-label');
      expect(labelled || svg.getAttribute('aria-hidden') === 'true').toBe(true);
    }
  });
});

describe('when the API is unreachable', () => {
  test('says so instead of rendering an empty page', async () => {
    const api = fakeApi(MONDAY, {
      today: vi.fn().mockRejectedValue(new Error('verkko ei vastaa')),
    });
    render(<App api={api} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('verkko ei vastaa');
  });
});

describe('removing a name asks first', () => {
  const openConfirm = async (name: string) => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: `Poista ${name}` }));
    return api;
  };

  test('the first tap removes nothing', async () => {
    // The whole point: a mis-tap on a phone must not delete a teammate.
    const api = await openConfirm('Mikko Laine');

    expect(api.unregister).not.toHaveBeenCalled();
    expect(screen.getByText('Mikko Laine')).toBeInTheDocument();
  });

  test('the first tap asks for confirmation', async () => {
    await openConfirm('Mikko Laine');

    expect(screen.getByRole('button', { name: /Vahvista.*Mikko Laine/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Peruuta.*Mikko Laine/ })).toBeInTheDocument();
  });

  test('confirming removes that player', async () => {
    const api = await openConfirm('Mikko Laine');

    await userEvent.click(screen.getByRole('button', { name: /Vahvista.*Mikko Laine/ }));

    await waitFor(() => expect(api.unregister).toHaveBeenCalledWith('p-mikko'));
  });

  test('cancelling removes nothing and puts the chip back', async () => {
    const api = await openConfirm('Mikko Laine');

    await userEvent.click(screen.getByRole('button', { name: /Peruuta.*Mikko Laine/ }));

    expect(api.unregister).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Poista Mikko Laine' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Vahvista/ })).not.toBeInTheDocument();
  });

  test('the prompt names the player, so it cannot be confirmed for the wrong one', async () => {
    await openConfirm('Jukka Rantanen');

    expect(screen.getByRole('button', { name: /Vahvista.*Jukka Rantanen/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Vahvista.*Mikko Laine/ })).not.toBeInTheDocument();
  });

  test('confirming removes the player asked about, not the first on the list', async () => {
    const api = await openConfirm('Jukka Rantanen');

    await userEvent.click(screen.getByRole('button', { name: /Vahvista.*Jukka Rantanen/ }));

    await waitFor(() => expect(api.unregister).toHaveBeenCalledWith('p-jukka'));
    expect(api.unregister).not.toHaveBeenCalledWith('p-mikko');
  });

  test('asking about a second player drops the first prompt', async () => {
    await openConfirm('Mikko Laine');

    await userEvent.click(screen.getByRole('button', { name: 'Poista Jukka Rantanen' }));

    expect(screen.getByRole('button', { name: /Vahvista.*Jukka Rantanen/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Vahvista.*Mikko Laine/ })).not.toBeInTheDocument();
  });

  test('a failed removal reports the reason and leaves the name in place', async () => {
    const api = fakeApi(MONDAY, {
      unregister: vi.fn().mockRejectedValue(new Error('nimeä ei löytynyt')),
    });
    render(<App api={api} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Poista Mikko Laine' }));
    await userEvent.click(screen.getByRole('button', { name: /Vahvista.*Mikko Laine/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('nimeä ei löytynyt');
    expect(screen.getByText('Mikko Laine')).toBeInTheDocument();
  });

  test('the confirm and cancel controls are real buttons', async () => {
    await openConfirm('Mikko Laine');

    expect(screen.getByRole('button', { name: /Vahvista.*Mikko Laine/ }).tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: /Peruuta.*Mikko Laine/ }).tagName).toBe('BUTTON');
  });
});

describe('the day keeps the history off its own page', () => {
  test('the day shows no search box and no historical figures', async () => {
    render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('heading', { name: 'maanantai' });

    expect(screen.queryByLabelText('Hae pelaajan nimellä')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Vuosi' })).not.toBeInTheDocument();
  });

  test('the archive is not fetched until the history is opened', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);
    await screen.findByRole('heading', { name: 'maanantai' });

    expect(api.history).not.toHaveBeenCalled();
  });

  test('no total or per-year figure is rendered on the day', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);
    await screen.findByRole('heading', { name: 'maanantai' });

    // Matti Virtanen's 278 games are in the directory the suggestions come from;
    // the count on screen is today's list, nothing historical.
    expect(screen.queryByText('278')).not.toBeInTheDocument();
    // There is still no per-player call: the history page takes the archive
    // in one response rather than a request per name.
    expect(Object.keys(api)).not.toContain('player');
  });

  test('the directory is still fetched, because the name suggestions need it', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);
    await screen.findByRole('heading', { name: 'maanantai' });

    await waitFor(() => expect(api.players).toHaveBeenCalled());
  });

  test('suggestions still work from that directory', async () => {
    render(<App api={fakeApi(MONDAY)} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'makel');

    const suggestions = screen.getByRole('list', { name: 'Ehdotukset' });
    expect(within(suggestions).getByRole('button', { name: 'Riikka Mäkelä' })).toBeVisible();
  });
});

describe('marking tonight s goalkeeper', () => {
  /** The chip is the row; the name inside it is what you tap. */
  const chipFor = (name: string): HTMLElement =>
    screen.getByText(name).closest('li') as HTMLElement;

  const withKeeper: TodayResponse = {
    ...MONDAY,
    registrations: [
      { playerId: 'p-mikko', displayName: 'Mikko Laine', createdAt: '2026-10-19T06:00:00Z' },
      {
        playerId: 'p-jukka',
        displayName: 'Jukka Rantanen',
        createdAt: '2026-10-19T06:05:00Z',
        isGoalkeeper: true,
      },
    ],
  };

  test('a goalkeeper is marked MV on the list, and nobody else is', async () => {
    render(<App api={fakeApi(withKeeper)} />);
    await screen.findByLabelText('Nimi');

    expect(within(chipFor('Jukka Rantanen')).getByText('MV')).toBeInTheDocument();
    expect(within(chipFor('Mikko Laine')).queryByText('MV')).not.toBeInTheDocument();
  });

  test('tapping a name opens the goalkeeper checkbox', async () => {
    render(<App api={fakeApi(MONDAY)} />);
    await screen.findByLabelText('Nimi');

    await userEvent.click(screen.getByRole('button', { name: 'Mikko Laine' }));

    expect(screen.getByRole('checkbox', { name: 'Maalivahti (MV)' })).not.toBeChecked();
  });

  test('ticking it marks that player for tonight', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);
    await screen.findByLabelText('Nimi');

    await userEvent.click(screen.getByRole('button', { name: 'Mikko Laine' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Maalivahti (MV)' }));

    await waitFor(() => expect(api.setGoalkeeper).toHaveBeenCalledWith('p-mikko', true));
  });

  test('unticking it takes the mark off again', async () => {
    const api = fakeApi(withKeeper);
    render(<App api={api} />);
    await screen.findByLabelText('Nimi');

    await userEvent.click(screen.getByRole('button', { name: 'Jukka Rantanen' }));
    expect(screen.getByRole('checkbox', { name: 'Maalivahti (MV)' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Maalivahti (MV)' }));

    await waitFor(() => expect(api.setGoalkeeper).toHaveBeenCalledWith('p-jukka', false));
  });

  test('the list is refetched, so the mark shows without a reload', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);
    await screen.findByLabelText('Nimi');
    vi.mocked(api.today).mockResolvedValue(withKeeper);

    await userEvent.click(screen.getByRole('button', { name: 'Mikko Laine' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Maalivahti (MV)' }));

    await waitFor(() =>
      expect(within(chipFor('Jukka Rantanen')).getByText('MV')).toBeInTheDocument(),
    );
  });

  test('several people can be in goal on the same night', async () => {
    const both: TodayResponse = {
      ...MONDAY,
      registrations: withKeeper.registrations.map((r) => ({ ...r, isGoalkeeper: true })),
    };
    render(<App api={fakeApi(both)} />);
    await screen.findByLabelText('Nimi');

    expect(within(chipFor('Jukka Rantanen')).getByText('MV')).toBeInTheDocument();
    expect(within(chipFor('Mikko Laine')).getByText('MV')).toBeInTheDocument();
  });

  test('the remove prompt and the goalkeeper checkbox do not open together', async () => {
    render(<App api={fakeApi(MONDAY)} />);
    await screen.findByLabelText('Nimi');

    await userEvent.click(screen.getByRole('button', { name: 'Mikko Laine' }));
    expect(screen.getByRole('checkbox', { name: 'Maalivahti (MV)' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Poista Jukka Rantanen' }));

    expect(screen.queryByRole('checkbox', { name: 'Maalivahti (MV)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Vahvista.*Jukka Rantanen/ })).toBeInTheDocument();
  });

  test('removing a name still works, and is still asked about first', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);
    await screen.findByLabelText('Nimi');

    await userEvent.click(screen.getByRole('button', { name: 'Poista Mikko Laine' }));
    await userEvent.click(screen.getByRole('button', { name: /Vahvista.*Mikko Laine/ }));

    await waitFor(() => expect(api.unregister).toHaveBeenCalledWith('p-mikko'));
  });
});

describe('the bot check in front of registering', () => {
  const widget = () => window.turnstile as NonNullable<typeof window.turnstile>;

  test('the form renders one widget, for the registration action', async () => {
    render(<App api={fakeApi(MONDAY)} />);
    await screen.findByLabelText('Nimi');

    await waitFor(() => expect(widget().render).toHaveBeenCalledTimes(1));
    expect(widget().render).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'register' }),
    );
  });

  test('the token it produces is what gets submitted', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'Uusi Pelaaja');
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu' }));

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(
        'Uusi Pelaaja',
        '2026-10-19',
        TEST_TURNSTILE_TOKEN,
        false,
      ),
    );
  });

  test('the widget is reset afterwards, because a token is spent by one submission', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'Uusi Pelaaja');
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu' }));

    await waitFor(() => expect(widget().reset).toHaveBeenCalledTimes(1));
    // Reset in place, not rebuilt: a second render would issue a new
    // challenge and shift the layout under whoever is looking at it.
    expect(widget().render).toHaveBeenCalledTimes(1);
  });

  test('it is reset after a refused submission too', async () => {
    const api = fakeApi(MONDAY, {
      register: vi.fn().mockRejectedValue(new Error('nimi on jo listalla')),
    });
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'Mikko Laine');
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu' }));

    await screen.findByRole('alert');
    await waitFor(() => expect(widget().reset).toHaveBeenCalledTimes(1));
  });

  test('nothing is submitted until a token has arrived', async () => {
    // The widget resolves on a microtask, so this is the state the page is in
    // for the first moment of its life.
    window.turnstile = {
      render: vi.fn(() => 'never-solved'),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    const api = fakeApi(MONDAY);
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'Uusi Pelaaja');

    expect(screen.getByRole('button', { name: 'Ilmoittaudu' })).toBeDisabled();
    expect(screen.getByText('Odotetaan varmistusta…')).toBeInTheDocument();
    expect(api.register).not.toHaveBeenCalled();
  });

  test('a widget that cannot load says so instead of failing silently', async () => {
    // What a blocked challenges.cloudflare.com looks like.
    window.turnstile = {
      render: vi.fn(() => {
        throw new Error('blocked');
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    render(<App api={fakeApi(MONDAY)} />);

    await screen.findByLabelText('Nimi');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Varmistusta ei saatu ladattua/);
  });

  test('it is the last thing on the page, under every card', async () => {
    // It is a footnote, not another control on the way to the button. The
    // position is a property of the page now, so it is easy to undo by
    // accident; this is what catches that.
    const { container } = render(<App api={fakeApi(MONDAY)} />);
    await screen.findByLabelText('Nimi');

    const main = container.querySelector('main') as HTMLElement;
    expect(main.lastElementChild).toHaveClass('turnstile');

    const widget = container.querySelector('.turnstile') as HTMLElement;
    const form = container.querySelector('form.card') as HTMLElement;
    const notices = screen.getByText('Kenttä varattu 21.10. klo 18–19.');
    // DOCUMENT_POSITION_FOLLOWING: the widget comes after both.
    expect(form.compareDocumentPosition(widget) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notices.compareDocumentPosition(widget) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('the button and its explanation stay together, away from the widget', async () => {
    // The hint says why the button is disabled, so it belongs beside the
    // button and not beside the widget at the foot of the page.
    window.turnstile = { render: vi.fn(() => 'never-solved'), reset: vi.fn(), remove: vi.fn() };
    const { container } = render(<App api={fakeApi(MONDAY)} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'Uusi Pelaaja');

    const form = container.querySelector('form.card') as HTMLElement;
    expect(form).toContainElement(screen.getByText('Odotetaan varmistusta…'));
    expect(form).not.toContainElement(container.querySelector('.turnstile'));
  });

  test('the Cloudflare error code reaches the page, so a refusal can be diagnosed', async () => {
    // The code is the only thing that names the cause — 110200 is "domain not
    // allowed" — and a check that fails without it is a silent one.
    window.turnstile = {
      render: vi.fn((_host, options) => {
        queueMicrotask(() => options['error-callback']?.('110200'));
        return 'failed-widget';
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    render(<App api={fakeApi(MONDAY)} />);

    await screen.findByLabelText('Nimi');
    expect(await screen.findByRole('alert')).toHaveTextContent(/110200/);
  });

  test('a check that fails offers a retry rather than waiting for ever', async () => {
    // The dead end this replaces: the button disabled behind "Odotetaan
    // varmistusta…" — waiting for verification — when nothing further is
    // coming and there is nothing on the page to press.
    window.turnstile = {
      render: vi.fn((_host, options) => {
        queueMicrotask(() => options['error-callback']?.('110200'));
        return 'failed-widget';
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    const { container } = render(<App api={fakeApi(MONDAY)} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'Uusi Pelaaja');

    const retry = await screen.findByRole('button', { name: 'Yritä varmistusta uudelleen' });
    const form = container.querySelector('form.card') as HTMLElement;
    // Beside the button it unblocks, not at the foot of the page by the widget.
    expect(form).toContainElement(retry);
    expect(screen.queryByText('Odotetaan varmistusta…')).not.toBeInTheDocument();
  });

  test('retrying builds the widget again and unblocks the button', async () => {
    let attempt = 0;
    window.turnstile = {
      render: vi.fn((_host, options) => {
        attempt += 1;
        // Fails once, then succeeds — a dropped connection, not a
        // misconfiguration.
        if (attempt === 1) queueMicrotask(() => options['error-callback']?.('300030'));
        else queueMicrotask(() => options.callback?.(TEST_TURNSTILE_TOKEN));
        return `widget-${attempt}`;
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    const api = fakeApi(MONDAY);
    render(<App api={api} />);

    await userEvent.type(await screen.findByLabelText('Nimi'), 'Uusi Pelaaja');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Yritä varmistusta uudelleen' }),
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Ilmoittaudu' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Ilmoittaudu' }));
    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(
        'Uusi Pelaaja',
        '2026-10-19',
        TEST_TURNSTILE_TOKEN,
        false,
      ),
    );
  });

  test('the not-a-game-day screen has no widget, having no form to protect', async () => {
    render(<App api={fakeApi(TUESDAY)} />);

    await screen.findByRole('heading', { name: 'Tänään ei pelata' });
    expect(widget().render).not.toHaveBeenCalled();
  });

  test('removing a name needs no token: it was never gated', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Poista Mikko Laine' }));
    await userEvent.click(screen.getByRole('button', { name: /Vahvista.*Mikko Laine/ }));

    await waitFor(() => expect(api.unregister).toHaveBeenCalledWith('p-mikko'));
  });
});

describe('getting to the history', () => {
  test('both pages are offered in the tab bar', async () => {
    render(<App api={fakeApi(MONDAY)} />);

    await screen.findByRole('heading', { name: 'maanantai' });
    const tabs = screen.getByRole('navigation', { name: 'Sivut' });
    expect(within(tabs).getByRole('link', { name: 'Tänään' })).toHaveAttribute('href', '/');
    expect(within(tabs).getByRole('link', { name: 'Historia' })).toHaveAttribute(
      'href',
      '/peliaktiivisuus',
    );
  });

  test('the day is the tab marked as current to begin with', async () => {
    render(<App api={fakeApi(MONDAY)} />);

    await screen.findByRole('heading', { name: 'maanantai' });
    expect(screen.getByRole('link', { name: 'Tänään' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Historia' })).not.toHaveAttribute('aria-current');
  });

  test('tapping the history tab opens it without leaving the page', async () => {
    await openHistory(fakeApi(MONDAY));

    expect(screen.getByRole('link', { name: 'Historia' })).toHaveAttribute('aria-current', 'page');
    expect(window.location.pathname).toBe('/peliaktiivisuus');
  });

  test('the address opens the history directly', async () => {
    window.history.pushState({}, '', '/peliaktiivisuus');
    render(<App api={fakeApi(MONDAY)} />);

    expect(await screen.findByRole('heading', { name: 'Peliaktiivisuus' })).toBeInTheDocument();
  });

  test('the back button returns to the day', async () => {
    await openHistory(fakeApi(MONDAY));

    window.history.back();

    expect(await screen.findByRole('heading', { name: 'maanantai' })).toBeInTheDocument();
  });

  test('the unlisted announcements page stays out of the tab bar', async () => {
    window.history.pushState({}, '', '/tiedotteet');
    render(<App api={fakeApi(MONDAY)} />);

    await screen.findByRole('heading', { name: 'Tiedote' });
    expect(screen.queryByRole('navigation', { name: 'Sivut' })).not.toBeInTheDocument();
  });

  test('the day is fetched once, not again on the way back', async () => {
    const api = fakeApi(MONDAY);
    await openHistory(api);
    await userEvent.click(screen.getByRole('link', { name: 'Tänään' }));

    await screen.findByRole('heading', { name: 'maanantai' });
    expect(api.today).toHaveBeenCalledTimes(1);
  });
});

describe('the history list', () => {
  test('ranks everyone by lifetime games to begin with', async () => {
    await openHistory(fakeApi(MONDAY));

    expect(listedNames()).toEqual(['Matti Virtanen', 'Liisa Korhonen', 'Olli Väänänen']);
    expect(listedCounts()).toEqual(['45 peliä', '30 peliä', '7 peliä']);
  });

  test('says which years the archive covers', async () => {
    await openHistory(fakeApi(MONDAY));

    expect(screen.getByText('Kaikki pelikerrat 2009–2026')).toBeInTheDocument();
  });

  test('says so when the archive holds nothing yet', async () => {
    const api = fakeApi(MONDAY, { history: vi.fn().mockResolvedValue({ players: [] }) });
    await openHistory(api);

    expect(screen.queryByRole('list', { name: 'Pelaajat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Vuosi' })).not.toBeInTheDocument();
    expect(screen.getByText('Ei vielä pelikertoja.')).toBeInTheDocument();
  });

  test('switches to Finnish name order', async () => {
    await openHistory(fakeApi(MONDAY));

    await userEvent.click(screen.getByRole('button', { name: 'Nimi A–Ö' }));

    expect(listedNames()).toEqual(['Liisa Korhonen', 'Matti Virtanen', 'Olli Väänänen']);
  });

  test('filters by name as you type', async () => {
    await openHistory(fakeApi(MONDAY));

    await userEvent.type(screen.getByLabelText('Hae pelaajan nimellä'), 'korho');

    expect(listedNames()).toEqual(['Liisa Korhonen']);
  });

  test('says so when a search matches nobody', async () => {
    await openHistory(fakeApi(MONDAY));

    await userEvent.type(screen.getByLabelText('Hae pelaajan nimellä'), 'zzzz');

    expect(screen.queryByRole('list', { name: 'Pelaajat' })).not.toBeInTheDocument();
    expect(screen.getByText(/zzzz/)).toBeInTheDocument();
  });

  test('expanding a player shows the per-year breakdown', async () => {
    await openHistory(fakeApi(MONDAY));

    await userEvent.click(screen.getByRole('button', { name: 'Matti Virtanen, 45 peliä' }));

    const rows = screen.getByRole('list', { name: 'Matti Virtanen vuosittain' });
    expect(
      within(rows)
        .getAllByRole('listitem')
        .map((li) => li.getAttribute('aria-label')),
    ).toEqual(['2026: 5 peliä', '2025: 25 peliä', '2024: 15 peliä']);
  });

  test('collapses the player again', async () => {
    await openHistory(fakeApi(MONDAY));

    const toggle = screen.getByRole('button', { name: 'Matti Virtanen, 45 peliä' });
    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(
      screen.queryByRole('list', { name: 'Matti Virtanen vuosittain' }),
    ).not.toBeInTheDocument();
  });

  test('the archive is fetched once, not per player', async () => {
    const api = fakeApi(MONDAY);
    await openHistory(api);

    await userEvent.click(screen.getByRole('button', { name: 'Matti Virtanen, 45 peliä' }));
    await userEvent.click(screen.getByRole('button', { name: 'Liisa Korhonen, 30 peliä' }));

    expect(api.history).toHaveBeenCalledTimes(1);
  });

  test('says so when the archive cannot be fetched', async () => {
    const api = fakeApi(MONDAY, {
      history: vi.fn().mockRejectedValue(new Error('historiaa ei saatu')),
    });
    render(<App api={api} />);
    await userEvent.click(await screen.findByRole('link', { name: 'Historia' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('historiaa ei saatu');
  });
});

describe('filtering the history by year', () => {
  test('offers every year anyone played, newest first, plus all of them', async () => {
    await openHistory(fakeApi(MONDAY));

    const years = screen.getByRole('group', { name: 'Vuosi' });
    expect(
      within(years)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Kaikki', '2026', '2025', '2024', '2009']);
  });

  test('ranks by that year count, not the lifetime total', async () => {
    await openHistory(fakeApi(MONDAY));

    await userEvent.click(screen.getByRole('button', { name: '2026' }));

    // Matti has played more in total; Liisa played more in 2026.
    expect(listedNames()).toEqual(['Liisa Korhonen', 'Matti Virtanen']);
    expect(listedCounts()).toEqual(['10 peliä', '5 peliä']);
  });

  test('leaves out everyone who did not play that year', async () => {
    await openHistory(fakeApi(MONDAY));

    await userEvent.click(screen.getByRole('button', { name: '2009' }));

    expect(listedNames()).toEqual(['Olli Väänänen']);
  });

  test('the subtitle names the chosen year instead of the whole span', async () => {
    await openHistory(fakeApi(MONDAY));

    await userEvent.click(screen.getByRole('button', { name: '2025' }));
    expect(screen.getByText('Pelikerrat vuonna 2025')).toBeInTheDocument();
    expect(screen.queryByText('Kaikki pelikerrat 2009–2026')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Kaikki' }));
    expect(screen.getByText('Kaikki pelikerrat 2009–2026')).toBeInTheDocument();
  });

  test('marks the chosen year as pressed, and only that one', async () => {
    await openHistory(fakeApi(MONDAY));

    await userEvent.click(screen.getByRole('button', { name: '2025' }));

    expect(screen.getByRole('button', { name: '2025' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Kaikki' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('combines with the name search', async () => {
    await openHistory(fakeApi(MONDAY));

    await userEvent.click(screen.getByRole('button', { name: '2025' }));
    await userEvent.type(screen.getByLabelText('Hae pelaajan nimellä'), 'virtanen');

    expect(listedNames()).toEqual(['Matti Virtanen']);
    expect(listedCounts()).toEqual(['25 peliä']);
  });

  test('combines with name ordering', async () => {
    await openHistory(fakeApi(MONDAY));

    await userEvent.click(screen.getByRole('button', { name: '2025' }));
    await userEvent.click(screen.getByRole('button', { name: 'Nimi A–Ö' }));

    expect(listedNames()).toEqual(['Liisa Korhonen', 'Matti Virtanen']);
  });

  test('going back to Kaikki restores the lifetime ranking', async () => {
    await openHistory(fakeApi(MONDAY));

    await userEvent.click(screen.getByRole('button', { name: '2009' }));
    await userEvent.click(screen.getByRole('button', { name: 'Kaikki' }));

    expect(listedNames()).toEqual(['Matti Virtanen', 'Liisa Korhonen', 'Olli Väänänen']);
  });
});
