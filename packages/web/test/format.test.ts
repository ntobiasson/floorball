import { describe, expect, test } from 'vitest';
import {
  formatDate,
  formatDateWithWeekday,
  formatTime,
  formatTimeRange,
  slotTime,
  weekdayName,
} from '../src/lib/format.js';

/** 19.10.2026 is a Monday. */
const MONDAY = '2026-10-19';

describe('weekdayName', () => {
  test('is the language’s own word, lower case where the language is', () => {
    expect(weekdayName('fi', 1)).toBe('maanantai');
    expect(weekdayName('en', 1)).toBe('Monday');
    expect(weekdayName('uk', 1)).toBe('понеділок');
  });

  test('counts from Sunday, as weekdayOf does', () => {
    expect(weekdayName('fi', 0)).toBe('sunnuntai');
    expect(weekdayName('fi', 6)).toBe('lauantai');
  });
});

describe('formatDate', () => {
  test('is unchanged for Finnish', () => {
    // Byte-identical to the hand-rolled formatter this replaced: every
    // existing assertion in this suite depends on it.
    expect(formatDate('fi', MONDAY)).toBe('19.10.2026');
  });

  test('puts the day first in English, not the month', () => {
    // Plain `en` means American to Intl — 10/19/2026 — which would read as
    // the wrong day to everybody in the hall this app is for.
    expect(formatDate('en', MONDAY)).toBe('19/10/2026');
  });

  test('is dotted in Ukrainian', () => {
    expect(formatDate('uk', MONDAY)).toBe('19.10.2026');
  });

  test('hands back anything it cannot read, as the old one did', () => {
    expect(formatDate('fi', '19.10.2026')).toBe('19.10.2026');
  });
});

describe('formatDateWithWeekday', () => {
  test('names the day before the date', () => {
    expect(formatDateWithWeekday('fi', MONDAY, 1)).toBe('maanantai 19.10.2026');
    expect(formatDateWithWeekday('en', MONDAY, 1)).toBe('Monday 19/10/2026');
  });
});

describe('formatTime', () => {
  test('drops a whole hour’s minutes in Finnish, and separates with a period', () => {
    expect(formatTime('fi', '20:00')).toBe('20');
    expect(formatTime('fi', '21:30')).toBe('21.30');
    expect(formatTime('fi', '09:15')).toBe('9.15');
  });

  test('is a plain 24-hour clock elsewhere', () => {
    // "20" alone reads as a quantity in English and Ukrainian; only Finnish
    // prose drops the minutes.
    expect(formatTime('en', '20:00')).toBe('20:00');
    expect(formatTime('en', '21:30')).toBe('21:30');
    expect(formatTime('uk', '20:00')).toBe('20:00');
  });

  test('hands back anything it does not recognise', () => {
    expect(formatTime('fi', 'kahdeksalta')).toBe('kahdeksalta');
    expect(formatTime('en', '')).toBe('');
  });
});

describe('formatTimeRange', () => {
  test('joins with an en dash and carries no word of its own', () => {
    // The particle — "klo", "at", "о" — belongs to the language and lives in
    // its catalogue, not here.
    expect(formatTimeRange('fi', '20:00', '21:30')).toBe('20–21.30');
    expect(formatTimeRange('en', '20:00', '21:30')).toBe('20:00–21:30');
    expect(formatTimeRange('uk', '20:00', '21:30')).toBe('20:00–21:30');
  });

  test('is a single time when there is no end', () => {
    expect(formatTimeRange('fi', '20:00')).toBe('20');
    expect(formatTimeRange('en', '20:00')).toBe('20:00');
  });
});

describe('slotTime', () => {
  test('is the slot’s range', () => {
    const slot = { id: 'a', weekday: 1, startTime: '20:00', endTime: '21:30' };
    expect(slotTime('fi', slot)).toBe('20–21.30');
    expect(slotTime('en', slot)).toBe('20:00–21:30');
  });

  test('is nothing at all for a slot with no time', () => {
    // The fallback schedule carries none, and inventing one is an anti-goal.
    expect(slotTime('fi', { id: 'a', weekday: 1 })).toBeUndefined();
  });
});
