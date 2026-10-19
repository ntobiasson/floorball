import { describe, expect, test } from 'vitest';
import { filterPlayers } from '../src/lib/search.js';
import type { PlayerSummary } from '@sahlykanta/shared';

const player = (displayName: string, total: number): PlayerSummary => ({
  playerId: displayName,
  displayName,
  total,
});

// Real names from the Domino export, messiness included.
const DIRECTORY: PlayerSummary[] = [
  player('Matti Virtanen', 278),
  player('Matti Virtanen (EHKÄ)', 1),
  player('Liisa Korhonen', 233),
  player('Liisa Heinonen', 107),
  player('liisa lahtinen', 13),
  player('Pekka N', 1),
  player('Pekka Nurmi', 28),
  player('Pekka Hämäläinen (mv)', 1),
  player('Riikka Mäkelä', 5),
  player('antti aalto', 1),
  player('Olli Väänänen', 63),
];

describe('filterPlayers', () => {
  test('an empty query returns everyone', () => {
    expect(filterPlayers(DIRECTORY, '')).toHaveLength(DIRECTORY.length);
  });

  test('whitespace only returns everyone', () => {
    expect(filterPlayers(DIRECTORY, '   ')).toHaveLength(DIRECTORY.length);
  });

  test('ignores case', () => {
    expect(filterPlayers(DIRECTORY, 'AATU').map((p) => p.displayName)).toEqual([
      'Matti Virtanen',
      'Matti Virtanen (EHKÄ)',
    ]);
  });

  test('finds a name typed without its diacritics', () => {
    expect(filterPlayers(DIRECTORY, 'makela').map((p) => p.displayName)).toEqual([
      'Riikka Mäkelä',
    ]);
    expect(filterPlayers(DIRECTORY, 'vaananen').map((p) => p.displayName)).toEqual([
      'Olli Väänänen',
    ]);
  });

  test('finds a name typed with its diacritics', () => {
    expect(filterPlayers(DIRECTORY, 'Mäkelä').map((p) => p.displayName)).toEqual([
      'Riikka Mäkelä',
    ]);
  });

  test('matches a token prefix, so a partial surname works', () => {
    expect(filterPlayers(DIRECTORY, 'pekka n').map((p) => p.displayName)).toEqual([
      'Pekka N',
      'Pekka Nurmi',
    ]);
  });

  test('matches on the surname alone', () => {
    expect(filterPlayers(DIRECTORY, 'sivula').map((p) => p.displayName)).toEqual(['Liisa Korhonen']);
  });

  test('matches a partial word from its start', () => {
    expect(filterPlayers(DIRECTORY, 'lehtor').map((p) => p.displayName)).toEqual([
      'liisa lahtinen',
    ]);
  });

  test('does not match mid-word, which is what keeps a one-letter term useful', () => {
    // 'pekka n' must not drag in Pekka Hämäläinen via the k in "sompinmaki".
    expect(filterPlayers(DIRECTORY, 'pekka n').map((p) => p.displayName)).not.toContain(
      'Pekka Hämäläinen (mv)',
    );
    expect(filterPlayers(DIRECTORY, 'ehtorinne')).toEqual([]);
  });

  test('finds a lowercase entry from a capitalised query', () => {
    expect(filterPlayers(DIRECTORY, 'Antti').map((p) => p.displayName)).toEqual(['antti aalto']);
  });

  test('matches across the words in any order', () => {
    expect(filterPlayers(DIRECTORY, 'harju aatu').map((p) => p.displayName)).toEqual([
      'Matti Virtanen',
      'Matti Virtanen (EHKÄ)',
    ]);
  });

  test('finds a goalkeeper suffix when searched for', () => {
    expect(filterPlayers(DIRECTORY, 'mv').map((p) => p.displayName)).toEqual([
      'Pekka Hämäläinen (mv)',
    ]);
  });

  test('returns nothing for a name nobody has', () => {
    expect(filterPlayers(DIRECTORY, 'zorro')).toEqual([]);
  });

  test('preserves the order it was given', () => {
    expect(filterPlayers(DIRECTORY, 'aleksi').map((p) => p.displayName)).toEqual([
      'Liisa Korhonen',
      'Liisa Heinonen',
      'liisa lahtinen',
    ]);
  });
});

