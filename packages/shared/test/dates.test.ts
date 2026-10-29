import { describe, expect, test, vi, afterEach } from 'vitest';
import { addDays, InvalidDateError, isGameDay, nextGameDay, todayInHelsinki, weekdayOf } from '../src/dates.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('weekdayOf', () => {
  // 2026-10-19 is a Monday; the old Domino view prints "19.10.2026 Maanantai".
  const week: Array<[string, number]> = [
    ['2026-10-19', 1],
    ['2026-10-20', 2],
    ['2026-10-21', 3],
    ['2026-10-22', 4],
    ['2026-10-23', 5],
    ['2026-10-24', 6],
    ['2026-10-25', 0],
  ];

  for (const [iso, day] of week) {
    test(`${iso} is weekday ${day}`, () => {
      expect(weekdayOf(iso)).toBe(day);
    });
  }
});

describe('isGameDay', () => {
  const expected: Array<[string, boolean]> = [
    ['2026-10-19', true], // Monday
    ['2026-10-20', false], // Tuesday
    ['2026-10-21', true], // Wednesday
    ['2026-10-22', false], // Thursday
    ['2026-10-23', false], // Friday
    ['2026-10-24', true], // Saturday
    ['2026-10-25', false], // Sunday
  ];

  for (const [iso, isGame] of expected) {
    test(`${iso} -> ${isGame}`, () => {
      expect(isGameDay(iso)).toBe(isGame);
    });
  }
});

describe('todayInHelsinki', () => {
  const at = (instant: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    return todayInHelsinki();
  };

  test('late summer evening UTC is already tomorrow in Helsinki', () => {
    // UTC+3. A UTC implementation would answer 2026-06-13 and register the
    // wrong day.
    expect(at('2026-06-13T21:30:00Z')).toBe('2026-06-14');
  });

  test('late winter evening UTC is already tomorrow in Helsinki', () => {
    // UTC+2.
    expect(at('2026-01-13T21:30:00Z')).toBe('2026-01-13');
  });

  test('just before midnight Helsinki, winter', () => {
    expect(at('2026-01-13T21:59:59Z')).toBe('2026-01-13');
  });

  test('just after midnight Helsinki, winter', () => {
    expect(at('2026-01-13T22:00:00Z')).toBe('2026-01-14');
  });

  test('spring DST transition day resolves to the Helsinki date', () => {
    expect(at('2026-03-29T00:30:00Z')).toBe('2026-03-29');
  });

  test('autumn DST transition day resolves to the Helsinki date', () => {
    expect(at('2026-10-25T00:30:00Z')).toBe('2026-10-25');
  });

  test('midnight rolls into the spring DST transition day while still UTC+2', () => {
    expect(at('2026-03-28T22:30:00Z')).toBe('2026-03-29');
  });

  test('midnight rolls into the autumn DST transition day while still UTC+3', () => {
    expect(at('2026-10-24T21:30:00Z')).toBe('2026-10-25');
  });
});

describe('nextGameDay', () => {
  test('from a Tuesday the next game day is Wednesday', () => {
    expect(nextGameDay('2026-10-20')).toBe('2026-10-21');
  });

  test('from a Thursday the next game day is Saturday', () => {
    expect(nextGameDay('2026-10-22')).toBe('2026-10-24');
  });

  test('from a Sunday the next game day is Monday', () => {
    expect(nextGameDay('2026-10-25')).toBe('2026-10-26');
  });

  test('from a game day the next game day is strictly later', () => {
    expect(nextGameDay('2026-10-19')).toBe('2026-10-21');
  });

  test('crosses a month boundary', () => {
    // 2026-10-31 is a Saturday; the next game day is Monday 2026-11-02.
    expect(nextGameDay('2026-10-31')).toBe('2026-11-02');
  });
});

describe('addDays', () => {
  test('steps forward a day', () => {
    expect(addDays('2026-10-19', 1)).toBe('2026-10-20');
  });

  test('crosses a month boundary', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });

  test('crosses the end of a year', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  test('is unmoved by the autumn clock change', () => {
    // Finland turns the clocks back in the small hours of 25.10.2026.
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  test('steps backwards', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  test('rejects a date that is not ISO', () => {
    expect(() => addDays('19.10.2026', 1)).toThrow(InvalidDateError);
  });
});
