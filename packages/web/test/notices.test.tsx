import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Announcement } from '@sahlykanta/shared';
import { App } from '../src/App.js';
import type { Api } from '../src/lib/api.js';
import { NOTICES_PATH } from '../src/lib/routes.js';

const ANNOUNCEMENTS: Announcement[] = [
  { id: 'a1', body: 'Kenttä varattu 21.10. klo 18-19.' },
  { id: 'a2', body: 'Joulutauko', validFrom: '2026-12-20', validTo: '2026-12-28' },
];

function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    today: vi.fn().mockResolvedValue({
      date: '2026-10-19',
      weekday: 1,
      isGameDay: true,
      registrations: [],
      announcements: [ANNOUNCEMENTS[0]],
    }),
    players: vi.fn().mockResolvedValue({ players: [] }),
    register: vi.fn(),
    unregister: vi.fn(),
    allAnnouncements: vi.fn().mockResolvedValue({ announcements: ANNOUNCEMENTS }),
    addAnnouncement: vi.fn().mockResolvedValue({ id: 'a3', body: 'Uusi' }),
    removeAnnouncement: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Api;
}

const openPage = (api: Api) => {
  window.history.pushState({}, '', NOTICES_PATH);
  render(<App api={api} />);
};

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

describe('the unlisted announcements page', () => {
  test('is reachable only by knowing its address', async () => {
    // No link to it anywhere: that address is the whole access control.
    render(<App api={fakeApi()} />);
    await screen.findByRole('heading', { name: 'maanantai' });

    expect(screen.queryByRole('link', { name: /tiedot/i })).not.toBeInTheDocument();
    // With the history page gone there is no navigation at all.
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  test('lists every announcement, including ones not currently showing', async () => {
    openPage(fakeApi());

    expect(await screen.findByText('Kenttä varattu 21.10. klo 18-19.')).toBeInTheDocument();
    expect(screen.getByText('Joulutauko')).toBeInTheDocument();
  });

  test('shows the validity window when one is set', async () => {
    openPage(fakeApi());
    await screen.findByText('Joulutauko');

    expect(screen.getByText(/20\.12\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/28\.12\.2026/)).toBeInTheDocument();
  });

  test('adds an announcement', async () => {
    const api = fakeApi();
    openPage(api);
    await screen.findByText('Joulutauko');

    await userEvent.type(await screen.findByLabelText('Tiedote'), 'Uusi tiedote');
    await userEvent.click(screen.getByRole('button', { name: 'Lisää tiedote' }));

    await waitFor(() =>
      expect(api.addAnnouncement).toHaveBeenCalledWith({ body: 'Uusi tiedote' }),
    );
  });

  test('passes the validity dates when they are given', async () => {
    const api = fakeApi();
    openPage(api);
    await screen.findByText('Joulutauko');

    await userEvent.type(await screen.findByLabelText('Tiedote'), 'Talvitauko');
    await userEvent.type(screen.getByLabelText('Näytetään alkaen'), '2026-12-01');
    await userEvent.type(screen.getByLabelText('Näytetään asti'), '2026-12-31');
    await userEvent.click(screen.getByRole('button', { name: 'Lisää tiedote' }));

    await waitFor(() =>
      expect(api.addAnnouncement).toHaveBeenCalledWith({
        body: 'Talvitauko',
        validFrom: '2026-12-01',
        validTo: '2026-12-31',
      }),
    );
  });

  test('will not add an empty announcement', async () => {
    const api = fakeApi();
    openPage(api);
    await screen.findByText('Joulutauko');

    expect(screen.getByRole('button', { name: 'Lisää tiedote' })).toBeDisabled();
    expect(api.addAnnouncement).not.toHaveBeenCalled();
  });

  test('asks before removing, and the first tap removes nothing', async () => {
    const api = fakeApi();
    openPage(api);
    await screen.findByText('Joulutauko');

    await userEvent.click(screen.getByRole('button', { name: /Poista.*Joulutauko/ }));

    expect(api.removeAnnouncement).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Vahvista.*Joulutauko/ })).toBeInTheDocument();
  });

  test('removes the announcement once confirmed', async () => {
    const api = fakeApi();
    openPage(api);
    await screen.findByText('Joulutauko');

    await userEvent.click(screen.getByRole('button', { name: /Poista.*Joulutauko/ }));
    await userEvent.click(screen.getByRole('button', { name: /Vahvista.*Joulutauko/ }));

    await waitFor(() => expect(api.removeAnnouncement).toHaveBeenCalledWith('a2'));
  });

  test('cancelling leaves it alone', async () => {
    const api = fakeApi();
    openPage(api);
    await screen.findByText('Joulutauko');

    await userEvent.click(screen.getByRole('button', { name: /Poista.*Joulutauko/ }));
    await userEvent.click(screen.getByRole('button', { name: /Peruuta.*Joulutauko/ }));

    expect(api.removeAnnouncement).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Poista.*Joulutauko/ })).toBeInTheDocument();
  });

  test('reports a failure instead of pretending it worked', async () => {
    const api = fakeApi({
      removeAnnouncement: vi.fn().mockRejectedValue(new Error('tiedotetta ei löytynyt')),
    });
    openPage(api);
    await screen.findByText('Joulutauko');

    await userEvent.click(screen.getByRole('button', { name: /Poista.*Joulutauko/ }));
    await userEvent.click(screen.getByRole('button', { name: /Vahvista.*Joulutauko/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('tiedotetta ei löytynyt');
  });

  test('says so when there are none yet', async () => {
    openPage(fakeApi({ allAnnouncements: vi.fn().mockResolvedValue({ announcements: [] }) }));

    expect(await screen.findByText(/Ei tiedotteita/i)).toBeInTheDocument();
  });
});

describe('the address', () => {
  test('is the fixed, readable one', () => {
    expect(NOTICES_PATH).toBe('/tiedotteet');
  });

  test('opens the page', async () => {
    window.history.pushState({}, '', '/tiedotteet');
    render(<App api={fakeApi()} />);

    expect(await screen.findByRole('button', { name: 'Lisää tiedote' })).toBeInTheDocument();
  });

  test('keeps the page out of search results while it is open', async () => {
    openPage(fakeApi());
    await screen.findByText('Joulutauko');

    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toMatch(
      /noindex/,
    );
  });
});
