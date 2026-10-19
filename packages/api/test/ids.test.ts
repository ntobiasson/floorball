import { describe, expect, test, vi, afterEach } from 'vitest';
import { newId } from '../src/ids.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('newId', () => {
  test('never repeats', () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => newId()));
    expect(ids.size).toBe(20_000);
  });

  test('is a fixed length, so ids compare as strings without padding', () => {
    const lengths = new Set(Array.from({ length: 500 }, () => newId().length));
    expect(lengths.size).toBe(1);
  });

  test('uses only characters that are safe in a URL and a sort key', () => {
    for (const id of Array.from({ length: 200 }, () => newId())) {
      expect(id).toMatch(/^[0-9A-Z]+$/);
    }
  });

  test('sorts in creation order across time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T06:00:00Z'));
    const first = newId();
    vi.setSystemTime(new Date('2026-10-19T06:00:01Z'));
    const second = newId();
    vi.setSystemTime(new Date('2026-10-19T06:00:02Z'));
    const third = newId();

    expect([third, first, second].sort()).toEqual([first, second, third]);
  });

  test('sorts in creation order WITHIN a millisecond', () => {
    // This is the property an audit row depends on: two rows written in the
    // same request share an ISO timestamp, so the id alone has to keep
    // 'register' before 'unregister'.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T06:00:00.000Z'));

    const ids = Array.from({ length: 50 }, () => newId());

    expect([...ids].sort()).toEqual(ids);
  });

  test('stays ordered when the clock does not move between two calls', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T06:00:00.000Z'));
    const a = newId();
    const b = newId();

    expect(a < b).toBe(true);
  });

  test('carries a random component, so two processes do not collide', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T06:00:00.000Z'));
    // Same millisecond, same sequence position: only randomness separates them.
    const suffixes = new Set(Array.from({ length: 500 }, () => newId().slice(-8)));
    expect(suffixes.size).toBeGreaterThan(400);
  });
});
