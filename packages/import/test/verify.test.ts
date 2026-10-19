import { describe, expect, test } from 'vitest';
import { verifyHarvest } from '../src/verify.js';
import type { PlayerIndexEntry } from '../src/walk.js';

const INDEX: PlayerIndexEntry[] = [
  { position: '1', name: 'Matti Virtanen', total: 2 },
  { position: '2', name: 'Liisa Korhonen', total: 1 },
];

const PLAYERS = [
  { name: 'Matti Virtanen', total: 2, years: [{ year: '2026', count: 2 }] },
  { name: 'Liisa Korhonen', total: 1, years: [{ year: '2026', count: 1 }] },
];

const REGISTRATIONS = [
  { name: 'Matti Virtanen', date: '2026-01-12', weekday: 'Maanantai' },
  { name: 'Matti Virtanen', date: '2026-04-15', weekday: 'Keskiviikko' },
  { name: 'Liisa Korhonen', date: '2026-01-12', weekday: 'Maanantai' },
];

describe('verifyHarvest', () => {
  test('a complete harvest has no problems', () => {
    expect(
      verifyHarvest({ expected: INDEX, players: PLAYERS, registrations: REGISTRATIONS }),
    ).toEqual([]);
  });

  test('catches a player the walk never reached', () => {
    const problems = verifyHarvest({
      expected: INDEX,
      players: [PLAYERS[0]!],
      registrations: REGISTRATIONS.slice(0, 2),
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe('missing-player');
    expect(problems[0]?.detail).toContain('Liisa Korhonen');
  });

  test('catches a total that disagrees with the collapsed index', () => {
    const problems = verifyHarvest({
      expected: INDEX,
      players: [{ name: 'Matti Virtanen', total: 1, years: [{ year: '2026', count: 1 }] }, PLAYERS[1]!],
      registrations: [REGISTRATIONS[0]!, REGISTRATIONS[2]!],
    });

    expect(problems.map((p) => p.kind)).toContain('count-mismatch');
  });

  test('catches a total that disagrees with the registrations harvested', () => {
    const problems = verifyHarvest({
      expected: INDEX,
      players: PLAYERS,
      registrations: [REGISTRATIONS[0]!, REGISTRATIONS[2]!],
    });

    expect(problems.map((p) => p.detail).join(' ')).toMatch(/Matti Virtanen.*2.*1 registrations/);
  });

  test('catches a registration whose player has no row', () => {
    const problems = verifyHarvest({
      expected: INDEX,
      players: PLAYERS,
      registrations: [
        ...REGISTRATIONS,
        { name: 'Kuka Tahansa', date: '2026-01-12', weekday: 'Maanantai' },
      ],
    });

    expect(problems.map((p) => p.kind)).toContain('unknown-player');
  });

  test('catches a player that is not in the collapsed index', () => {
    const problems = verifyHarvest({
      expected: [INDEX[0]!],
      players: PLAYERS,
      registrations: REGISTRATIONS,
    });

    expect(problems.map((p) => p.kind)).toContain('extra-player');
  });
});
