import { describe, expect, test } from 'vitest';
import type { PlayerDetail } from '@sahlykanta/shared';
import { countForYear, historyYears, rankHistory } from '../src/lib/history.js';

/**
 * Shaped like the real archive: a long-standing regular, somebody who stopped
 * years ago, a rare visitor, and the `(EHKÄ)` duplicate that is its own
 * player.
 */
const ARCHIVE: PlayerDetail[] = [
  {
    playerId: 'p-liisa',
    displayName: 'Liisa Korhonen',
    total: 30,
    years: [
      { year: '2026', count: 10 },
      { year: '2025', count: 20 },
    ],
  },
  {
    playerId: 'p-matti',
    displayName: 'Matti Virtanen',
    total: 45,
    years: [
      { year: '2026', count: 5 },
      { year: '2025', count: 25 },
      { year: '2024', count: 15 },
    ],
  },
  {
    playerId: 'p-matti-ehka',
    displayName: 'Matti Virtanen (EHKÄ)',
    total: 1,
    years: [{ year: '2024', count: 1 }],
  },
  {
    playerId: 'p-olli',
    displayName: 'Olli Väänänen',
    total: 7,
    years: [{ year: '2009', count: 7 }],
  },
];

describe('historyYears', () => {
  test('lists every year anyone played, newest first', () => {
    expect(historyYears(ARCHIVE)).toEqual(['2026', '2025', '2024', '2009']);
  });

  test('is empty when there is no history at all', () => {
    expect(historyYears([])).toEqual([]);
  });
});

describe('countForYear', () => {
  test('is the lifetime total when no year is chosen', () => {
    expect(countForYear(ARCHIVE[1]!, undefined)).toBe(45);
  });

  test('is that year count when a year is chosen', () => {
    expect(countForYear(ARCHIVE[1]!, '2024')).toBe(15);
  });

  test('is zero for a year the player did not play', () => {
    expect(countForYear(ARCHIVE[1]!, '2009')).toBe(0);
  });
});

describe('rankHistory', () => {
  const names = (players: PlayerDetail[]): string[] => players.map((p) => p.displayName);

  test('orders by name, Finnish collation, with no filter', () => {
    expect(names(rankHistory(ARCHIVE, { query: '', sort: 'name' }))).toEqual([
      'Liisa Korhonen',
      'Matti Virtanen',
      'Matti Virtanen (EHKÄ)',
      'Olli Väänänen',
    ]);
  });

  test('orders by lifetime total, most games first, with no year', () => {
    expect(names(rankHistory(ARCHIVE, { query: '', sort: 'total' }))).toEqual([
      'Matti Virtanen',
      'Liisa Korhonen',
      'Olli Väänänen',
      'Matti Virtanen (EHKÄ)',
    ]);
  });

  test("orders by the chosen year's count, not the lifetime total", () => {
    // Over 2025 Matti leads; over 2026 Liisa does, although Matti has played
    // more games in total.
    expect(names(rankHistory(ARCHIVE, { query: '', sort: 'total', year: '2026' }))).toEqual([
      'Liisa Korhonen',
      'Matti Virtanen',
    ]);
  });

  test('a chosen year leaves out everyone who did not play it', () => {
    expect(names(rankHistory(ARCHIVE, { query: '', sort: 'name', year: '2009' }))).toEqual([
      'Olli Väänänen',
    ]);
  });

  test('filters by name and year together', () => {
    expect(names(rankHistory(ARCHIVE, { query: 'virtanen', sort: 'name', year: '2024' }))).toEqual([
      'Matti Virtanen',
      'Matti Virtanen (EHKÄ)',
    ]);
  });

  test('filters by name alone across every year', () => {
    expect(names(rankHistory(ARCHIVE, { query: 'virtanen', sort: 'total' }))).toEqual([
      'Matti Virtanen',
      'Matti Virtanen (EHKÄ)',
    ]);
  });

  test('keeps the per-year breakdown on the players it returns', () => {
    const [first] = rankHistory(ARCHIVE, { query: 'korhonen', sort: 'name' });
    expect(first?.years).toEqual([
      { year: '2026', count: 10 },
      { year: '2025', count: 20 },
    ]);
  });

  test('breaks a tie on count by name, so the list never reshuffles', () => {
    const tied: PlayerDetail[] = [
      { playerId: 'b', displayName: 'Bertta', total: 3, years: [{ year: '2026', count: 3 }] },
      { playerId: 'a', displayName: 'Aapo', total: 3, years: [{ year: '2026', count: 3 }] },
    ];
    expect(names(rankHistory(tied, { query: '', sort: 'total' }))).toEqual(['Aapo', 'Bertta']);
  });

  test('is empty when nothing matches the query', () => {
    expect(rankHistory(ARCHIVE, { query: 'zzz', sort: 'name' })).toEqual([]);
  });
});
