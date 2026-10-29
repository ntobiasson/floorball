import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSlot } from '@sahlykanta/shared';
import { App } from '../src/App.js';
import type { Api } from '../src/lib/api.js';
import { SETTINGS_PATH } from '../src/lib/routes.js';
import { TEST_TURNSTILE_TOKEN } from './setup.js';

const MONDAY_SLOT: GameSlot = { id: 's1', weekday: 1, startTime: '20:00', endTime: '21:30' };
const SATURDAY_SLOT: GameSlot = { id: 's2', weekday: 6, startTime: '18:00' };
const SLOTS: GameSlot[] = [MONDAY_SLOT, SATURDAY_SLOT];

function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    today: vi.fn(),
    players: vi.fn().mockResolvedValue({ players: [] }),
    register: vi.fn(),
    unregister: vi.fn(),
    allAnnouncements: vi.fn().mockResolvedValue({ announcements: [] }),
    addAnnouncement: vi.fn(),
    removeAnnouncement: vi.fn(),
    schedule: vi.fn().mockResolvedValue({ slots: SLOTS, initialised: true }),
    addSlot: vi.fn().mockResolvedValue({ id: 's3', weekday: 2, startTime: '19:00' }),
    removeSlot: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Api;
}

const openPage = (api: Api) => {
  window.history.pushState({}, '', SETTINGS_PATH);
  return render(<App api={api} />);
};

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

describe('the unlisted settings page', () => {
  test('offers the start and the end in half hours', async () => {
    openPage(fakeApi());

    // A string name is a full match, so this is the form card's heading and
    // not the "Pelivuorot" list card below it.
    await screen.findByRole('heading', { name: 'Pelivuoro' });
    // A games slot starts on the hour or the half hour; the browser's own
    // picker is what enforces it, and `step` in seconds is how it is told.
    expect(screen.getByLabelText('Alkaa')).toHaveAttribute('step', '1800');
    expect(screen.getByLabelText('Päättyy')).toHaveAttribute('step', '1800');
  });

  test('lists the stored slots, Monday first, with their times', async () => {
    // Fed to the page in the opposite order from how `SLOTS` is declared
    // above: the API, not this fixture's declaration order, guarantees
    // Monday-first. Asserting the rendered order against this reversed input
    // is what actually catches a page that re-sorts (even a sort that would
    // coincidentally match the default fixture's order) instead of simply
    // rendering what `load` handed it, in sequence.
    openPage(
      fakeApi({
        schedule: vi
          .fn()
          .mockResolvedValue({ slots: [SATURDAY_SLOT, MONDAY_SLOT], initialised: true }),
      }),
    );

    await screen.findByText('Lauantai klo 18');
    // Scoped to the list card: the weekday <select> in the form above also
    // renders "Maanantai" and "Lauantai" as option text, which a page-wide
    // query would pick up too.
    const list = within(screen.getByRole('region', { name: 'Pelivuorot' }));
    expect(list.getAllByText(/^(Maanantai|Lauantai)/).map((row) => row.textContent)).toEqual([
      'Lauantai klo 18',
      'Maanantai klo 20–21.30',
    ]);
  });

  test('says the fallback is in use when no slot has been stored, and that saving replaces it', async () => {
    openPage(fakeApi({ schedule: vi.fn().mockResolvedValue({ slots: [], initialised: false }) }));

    expect(
      await screen.findByText(
        'Pelivuoroja ei ole vielä asetettu. Käytössä oletuksena: maanantai, keskiviikko, lauantai — ensimmäinen tallennettu pelivuoro korvaa ne.',
      ),
    ).toBeInTheDocument();
  });

  test('says so when every slot has been removed', async () => {
    openPage(fakeApi({ schedule: vi.fn().mockResolvedValue({ slots: [], initialised: true }) }));

    expect(
      await screen.findByText('Yhtään pelivuoroa ei ole — tällä hetkellä ei pelata.'),
    ).toBeInTheDocument();
  });

  test('makes no claim about the schedule when the load fails', async () => {
    openPage(fakeApi({ schedule: vi.fn().mockRejectedValue(new Error('verkko katkesi')) }));

    expect(await screen.findByRole('alert')).toHaveTextContent('verkko katkesi');
    // Neither of the two conclusive claims — the fallback is in force, or
    // nobody plays — is true here: the load simply failed. The list card
    // must assert neither.
    const list = within(screen.getByRole('region', { name: 'Pelivuorot' }));
    expect(list.queryByText(/ei pelata/)).not.toBeInTheDocument();
    expect(list.queryByText(/ei ole vielä asetettu/)).not.toBeInTheDocument();
  });

  test('adds a slot from the form', async () => {
    const api = fakeApi();
    openPage(api);
    await screen.findByText('Maanantai klo 20–21.30');

    await userEvent.selectOptions(screen.getByLabelText('Viikonpäivä'), 'Tiistai');
    await userEvent.type(screen.getByLabelText('Alkaa'), '19:00');
    await userEvent.type(screen.getByLabelText('Päättyy'), '20:30');
    await userEvent.click(screen.getByRole('button', { name: 'Lisää pelivuoro' }));

    await waitFor(() =>
      expect(api.addSlot).toHaveBeenCalledWith(
        { weekday: 2, startTime: '19:00', endTime: '20:30' },
        TEST_TURNSTILE_TOKEN,
      ),
    );
  });

  test('leaves out an end time that was not filled in', async () => {
    const api = fakeApi();
    openPage(api);
    await screen.findByText('Maanantai klo 20–21.30');

    await userEvent.type(screen.getByLabelText('Alkaa'), '19:00');
    await userEvent.click(screen.getByRole('button', { name: 'Lisää pelivuoro' }));

    await waitFor(() => expect(api.addSlot).toHaveBeenCalled());
    const [input] = vi.mocked(api.addSlot).mock.calls[0] as [unknown, string];
    expect(input).not.toHaveProperty('endTime');
  });

  test('will not submit without a start time', async () => {
    const api = fakeApi();
    openPage(api);
    await screen.findByText('Maanantai klo 20–21.30');

    expect(screen.getByRole('button', { name: 'Lisää pelivuoro' })).toBeDisabled();
    expect(api.addSlot).not.toHaveBeenCalled();
  });

  test('shows the new slot in the list without a reload', async () => {
    const NEW: GameSlot = { id: 's3', weekday: 2, startTime: '19:00' };
    // Two distinct answers in sequence: the first is what the page opens
    // with, the second is what it must re-render after the add. A mock that
    // returned the same list forever would let this test pass against a
    // page that re-fetches and throws the result away.
    const api = fakeApi({
      schedule: vi
        .fn()
        .mockResolvedValueOnce({ slots: SLOTS, initialised: true })
        .mockResolvedValueOnce({ slots: [...SLOTS, NEW], initialised: true }),
      addSlot: vi.fn().mockResolvedValue(NEW),
    });
    openPage(api);
    await screen.findByText('Maanantai klo 20–21.30');

    await userEvent.selectOptions(screen.getByLabelText('Viikonpäivä'), 'Tiistai');
    await userEvent.type(screen.getByLabelText('Alkaa'), '19:00');
    await userEvent.click(screen.getByRole('button', { name: 'Lisää pelivuoro' }));

    const list = within(screen.getByRole('region', { name: 'Pelivuorot' }));
    await waitFor(() => expect(list.getByText('Tiistai klo 19')).toBeInTheDocument());
  });

  test('asks before removing, and removes on the second tap', async () => {
    const api = fakeApi();
    openPage(api);
    await screen.findByText('Lauantai klo 18');

    await userEvent.click(screen.getByRole('button', { name: /Poista.*Lauantai/ }));
    expect(api.removeSlot).not.toHaveBeenCalled();
    expect(screen.getByText('Poistetaanko?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Vahvista.*Lauantai/ }));
    await waitFor(() => expect(api.removeSlot).toHaveBeenCalledWith('s2', TEST_TURNSTILE_TOKEN));
  });

  test('leaves the slot alone when the question is cancelled', async () => {
    const api = fakeApi();
    openPage(api);
    await screen.findByText('Lauantai klo 18');

    await userEvent.click(screen.getByRole('button', { name: /Poista.*Lauantai/ }));
    await userEvent.click(screen.getByRole('button', { name: /Peruuta.*Lauantai/ }));

    expect(api.removeSlot).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Poista.*Lauantai/ })).toBeInTheDocument();
  });

  test('waits for the bot check before enabling the form', async () => {
    window.turnstile = {
      render: vi.fn(() => 'never-solved'),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    openPage(fakeApi());
    await screen.findByText('Maanantai klo 20–21.30');

    expect(screen.getByText('Odotetaan varmistusta…')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Alkaa'), '19:00');
    expect(screen.getByRole('button', { name: 'Lisää pelivuoro' })).toBeDisabled();
  });

  test('reports a refused duplicate without losing what was typed', async () => {
    const api = fakeApi({
      addSlot: vi.fn().mockRejectedValue(new Error('pelivuoro on jo listalla')),
    });
    openPage(api);
    await screen.findByText('Maanantai klo 20–21.30');

    await userEvent.selectOptions(screen.getByLabelText('Viikonpäivä'), 'Keskiviikko');
    await userEvent.type(screen.getByLabelText('Alkaa'), '19:00');
    await userEvent.click(screen.getByRole('button', { name: 'Lisää pelivuoro' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('pelivuoro on jo listalla');
    expect(screen.getByLabelText('Viikonpäivä')).toHaveValue('3');
    expect(screen.getByLabelText('Alkaa')).toHaveValue('19:00');
  });
});
