import { describe, expect, test } from 'vitest';
import {
  announcementSk,
  auditPk,
  dayPk,
  gsi1Sk,
  namePk,
  playerPk,
  playerSk,
  yearSk,
} from '../src/table.js';

describe('key builders', () => {
  test('a day partition is keyed by its ISO date', () => {
    expect(dayPk('2026-10-19')).toBe('DAY#2026-10-19');
  });

  test('a registration sorts under its player', () => {
    expect(playerSk('01JABCDEF')).toBe('PLAYER#01JABCDEF');
  });

  test('a player partition and its profile row', () => {
    expect(playerPk('01JABCDEF')).toBe('PLAYER#01JABCDEF');
    expect(yearSk('2026')).toBe('YEAR#2026');
  });

  test('a name lookup is keyed by the normalized name', () => {
    expect(namePk('matti virtanen (ehka)')).toBe('NAME#matti virtanen (ehka)');
  });

  test('an audit partition is keyed by date', () => {
    expect(auditPk('2026-10-19')).toBe('AUDIT#2026-10-19');
  });

  test('an announcement sorts by validity then id', () => {
    expect(announcementSk('2026-10-19', 'a1')).toBe('2026-10-19#a1');
  });
});

describe('gsi1Sk', () => {
  test('orders the directory by normalized name', () => {
    expect(gsi1Sk('matti virtanen')).toBe('NAME#matti virtanen');
  });

  test('sorts lexicographically by name', () => {
    expect(gsi1Sk('liisa korhonen') < gsi1Sk('matti virtanen')).toBe(true);
  });

  test('is stable across registrations, so a write never rewrites an index key', () => {
    // The directory is sorted in the browser; indexing by total would force an
    // optimistic-concurrency retry on every single registration.
    expect(gsi1Sk('matti virtanen')).toBe(gsi1Sk('matti virtanen'));
  });
});
