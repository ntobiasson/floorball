import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlayerSummary, TodayResponse } from '@sahlykanta/shared';
import { App } from '../src/App.js';
import type { Api } from '../src/lib/api.js';

const DIRECTORY: PlayerSummary[] = [
  { playerId: 'p-aatu', displayName: 'Matti Virtanen', total: 278 },
  { playerId: 'p-sivula', displayName: 'Liisa Korhonen', total: 233 },
  { playerId: 'p-katja', displayName: 'Riikka Mäkelä', total: 5 },
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
};

const TUESDAY: TodayResponse = {
  date: '2026-10-20',
  weekday: 2,
  isGameDay: false,
  nextGameDate: '2026-10-21',
  registrations: [],
  announcements: [],
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
    ...overrides,
  } as Api;
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

    await waitFor(() => expect(api.register).toHaveBeenCalledWith('Uusi Pelaaja', '2026-10-19'));
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

    await userEvent.type(await screen.findByLabelText('Nimi'), 'kankaan');
    const suggestions = screen.getByRole('list', { name: 'Ehdotukset' });
    await userEvent.click(
      within(suggestions).getByRole('button', { name: 'Riikka Mäkelä' }),
    );

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith('Riikka Mäkelä', '2026-10-19'),
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
    const api = fakeApi(MONDAY, { today: vi.fn().mockRejectedValue(new Error('verkko ei vastaa')) });
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

    expect(
      screen.getByRole('button', { name: /Vahvista.*Mikko Laine/ }),
    ).toBeInTheDocument();
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

describe('history is kept but not shown', () => {
  test('there is no history page to navigate to', async () => {
    render(<App api={fakeApi(MONDAY)} />);
    await screen.findByRole('heading', { name: 'maanantai' });

    expect(screen.queryByRole('link', { name: /peliaktiivisuus/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /peliaktiivisuus/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hae pelaajan nimellä')).not.toBeInTheDocument();
  });

  test('the old history address falls back to the registration page', async () => {
    window.history.pushState({}, '', '/peliaktiivisuus');
    render(<App api={fakeApi(MONDAY)} />);

    expect(await screen.findByRole('heading', { name: 'maanantai' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Hae pelaajan nimellä')).not.toBeInTheDocument();
  });

  test('no total or per-year figure is rendered anywhere', async () => {
    const api = fakeApi(MONDAY);
    render(<App api={api} />);
    await screen.findByRole('heading', { name: 'maanantai' });

    // Matti Virtanen's 278 games are in the directory the suggestions come from;
    // the count on screen is today's list, nothing historical.
    expect(screen.queryByText('278')).not.toBeInTheDocument();
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

    await userEvent.type(await screen.findByLabelText('Nimi'), 'kankaan');

    const suggestions = screen.getByRole('list', { name: 'Ehdotukset' });
    expect(within(suggestions).getByRole('button', { name: 'Riikka Mäkelä' })).toBeVisible();
  });
});
