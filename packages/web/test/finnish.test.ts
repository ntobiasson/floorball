import { describe, test, expect } from 'vitest';
import { finnishTime, finnishTimeRange, slotTime } from '../src/lib/finnish.js';

describe('finnishTime', () => {
  test('drops the minutes from a whole hour', () => {
    expect(finnishTime('20:00')).toBe('20');
  });

  test('separates the minutes with a period', () => {
    expect(finnishTime('21:30')).toBe('21.30');
  });

  test('keeps a leading zero off the hour', () => {
    expect(finnishTime('09:15')).toBe('9.15');
  });

  test('hands back anything it does not recognise', () => {
    expect(finnishTime('kahdeksalta')).toBe('kahdeksalta');
  });
});

describe('finnishTimeRange', () => {
  test('joins the two with an en dash', () => {
    expect(finnishTimeRange('20:00', '21:30')).toBe('klo 20–21.30');
  });

  test('is a single time when there is no end', () => {
    expect(finnishTimeRange('20:00')).toBe('klo 20');
  });
});

describe('slotTime', () => {
  test("is the slot's range", () => {
    expect(slotTime({ id: 'a', weekday: 1, startTime: '20:00', endTime: '21:30' })).toBe(
      'klo 20–21.30',
    );
  });

  test('is nothing at all for a slot with no time', () => {
    expect(slotTime({ id: 'a', weekday: 1 })).toBeUndefined();
  });
});
