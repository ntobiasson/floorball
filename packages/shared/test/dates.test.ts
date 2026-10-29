import { describe, expect, test, vi, afterEach } from 'vitest';
import { addDays, InvalidDateError, todayInHelsinki, weekdayOf } from '../src/dates.js';

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
