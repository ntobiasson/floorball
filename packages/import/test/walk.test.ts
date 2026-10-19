import { describe, expect, test } from 'vitest';
import { createFakeDomino, type FakePlayer } from './fake-domino.js';
import { walkActivityView } from '../src/walk.js';

const dates = (year: string, days: Array<[string, string]>) => ({
  year,
  dates: days.map(([date, weekday]) => ({ date: `${year}-${date}`, weekday })),
});

const DATA: FakePlayer[] = [
  {
    name: 'Matti Virtanen',
    years: [
      dates('2026', [
        ['01-12', 'Maanantai'],
        ['04-15', 'Keskiviikko'],
      ]),
      dates('2025', [['10-20', 'Maanantai']]),
    ],
  },
  { name: 'Liisa Korhonen', years: [dates('2026', [['01-12', 'Maanantai']])] },
  {
    name: 'Pekka Hämäläinen (mv)',
    years: [dates('2024', [['02-03', 'Lauantai']])],
  },
];

describe('walkActivityView', () => {
  test('harvests every player with their years and dates', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA) });

    expect(result.players.map((p) => p.name)).toEqual([
      'Matti Virtanen',
      'Liisa Korhonen',
      'Pekka Hämäläinen (mv)',
    ]);
    expect(result.players[0]?.total).toBe(3);
    expect(result.players[0]?.years).toEqual([
      { year: '2026', count: 2 },
      { year: '2025', count: 1 },
    ]);
  });

  test('emits one registration per date, tagged with its player', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA) });

    expect(result.registrations).toEqual([
      { name: 'Matti Virtanen', date: '2026-01-12', weekday: 'Maanantai' },
      { name: 'Matti Virtanen', date: '2026-04-15', weekday: 'Keskiviikko' },
      { name: 'Matti Virtanen', date: '2025-10-20', weekday: 'Maanantai' },
      { name: 'Liisa Korhonen', date: '2026-01-12', weekday: 'Maanantai' },
      { name: 'Pekka Hämäläinen (mv)', date: '2024-02-03', weekday: 'Lauantai' },
    ]);
  });

  test('works regardless of how small the page is', async () => {
    // Page size 2 forces the walker across many page turns and makes every
    // row index shift under it.
    for (const rowsPerPage of [1, 2, 3, 5, 50]) {
      const result = await walkActivityView({ client: createFakeDomino(DATA, rowsPerPage) });
      expect(result.registrations).toHaveLength(5);
      expect(result.players).toHaveLength(3);
    }
  });

  test('keeps Finnish characters and suffixes intact end to end', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA) });

    expect(result.players.map((p) => p.name)).toContain('Pekka Hämäläinen (mv)');
  });

  test('every player total equals the number of dates harvested for them', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA) });

    for (const player of result.players) {
      const harvested = result.registrations.filter((r) => r.name === player.name).length;
      expect(harvested).toBe(player.total);
    }
  });

  test('expands each node exactly once', async () => {
    const fake = createFakeDomino(DATA);

    await walkActivityView({ client: fake });

    // 3 players + 4 player-years = 7 nodes.
    expect(fake.expansions()).toBe(7);
  });

  test('reports progress as it goes', async () => {
    const seen: string[] = [];

    await walkActivityView({
      client: createFakeDomino(DATA),
      onPlayer: (player) => seen.push(player.name),
    });

    expect(seen).toEqual(['Matti Virtanen', 'Liisa Korhonen', 'Pekka Hämäläinen (mv)']);
  });

  test('a limit stops the walk early, for a dry run', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA), limit: 2 });

    expect(result.players.map((p) => p.name)).toEqual(['Matti Virtanen', 'Liisa Korhonen']);
    expect(result.registrations).toHaveLength(4);
  });

  test('handles a player with no games at all', async () => {
    const result = await walkActivityView({
      client: createFakeDomino([{ name: 'Ei Pelejä', years: [] }]),
    });

    expect(result.players).toEqual([{ name: 'Ei Pelejä', total: 0, position: '1', years: [] }]);
    expect(result.registrations).toEqual([]);
  });

  test('an empty view is not an error', async () => {
    const result = await walkActivityView({ client: createFakeDomino([]) });

    expect(result.players).toEqual([]);
    expect(result.registrations).toEqual([]);
  });

  test('refuses to finish if a player total disagrees with the dates harvested', async () => {
    const fake = createFakeDomino(DATA);
    // Simulate Domino dropping a date row: the walker must notice, because a
    // silent shortfall is exactly how 25 years of history gets quietly lost.
    const original = fake.submit.bind(fake);
    fake.submit = async (submitId: string) => {
      const html = await original(submitId);
      return html.replace('<tr><td></td><td></td><td>12.01.2026 Maanantai</td><td>1</td></tr>', '');
    };

    await expect(walkActivityView({ client: fake })).rejects.toThrow(/checksum/i);
  });
});

describe('resuming', () => {
  test('skips players already harvested, without expanding them again', async () => {
    const fake = createFakeDomino(DATA);

    const result = await walkActivityView({ client: fake, startAfterPosition: 1 });

    expect(result.players.map((p) => p.name)).toEqual(['Liisa Korhonen', 'Pekka Hämäläinen (mv)']);
    expect(result.registrations.map((r) => r.name)).toEqual([
      'Liisa Korhonen',
      'Pekka Hämäläinen (mv)',
    ]);
    // 2 remaining players + their 2 years. Matti Virtanen's 3 nodes stay closed,
    // which is the whole point: a resumed run does not redo that work.
    expect(fake.expansions()).toBe(4);
  });

  test('reports the position of each player so a run can be resumed', async () => {
    const seen: Array<[string, string]> = [];

    await walkActivityView({
      client: createFakeDomino(DATA),
      onPlayer: (player) => seen.push([player.name, player.position]),
    });

    expect(seen).toEqual([
      ['Matti Virtanen', '1'],
      ['Liisa Korhonen', '2'],
      ['Pekka Hämäläinen (mv)', '3'],
    ]);
  });

  test('skipping everything yields nothing but does not error', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA), startAfterPosition: 3 });

    expect(result.players).toEqual([]);
    expect(result.registrations).toEqual([]);
  });
});
