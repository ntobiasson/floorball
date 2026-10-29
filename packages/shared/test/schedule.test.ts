import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE,
  GameSlotInputSchema,
  GameSlotSchema,
  effectiveSchedule,
  hasSameSlot,
  isGameDay,
  nextGameDay,
  orderSlots,
  slotsOn,
} from '../src/schedule.js';

const MON = { id: 'a', weekday: 1, startTime: '20:00', endTime: '21:30' };
const WED = { id: 'b', weekday: 3, startTime: '20:00' };
const SAT = { id: 'c', weekday: 6, startTime: '18:00' };

describe('GameSlotInputSchema', () => {
  it('accepts a weekday and a start time', () => {
    expect(GameSlotInputSchema.safeParse({ weekday: 1, startTime: '20:00' }).success).toBe(true);
  });

  it('requires a start time', () => {
    expect(GameSlotInputSchema.safeParse({ weekday: 1 }).success).toBe(false);
  });

  it.each(['24:00', '7:00', '20:60', '20.00', '', 'klo 20'])('rejects %s as a time', (time) => {
    expect(GameSlotInputSchema.safeParse({ weekday: 1, startTime: time }).success).toBe(false);
  });

  it('rejects an end that is not after the start', () => {
    const same = { weekday: 1, startTime: '20:00', endTime: '20:00' };
    expect(GameSlotInputSchema.safeParse(same).success).toBe(false);
    expect(GameSlotInputSchema.safeParse({ ...same, endTime: '19:00' }).success).toBe(false);
  });

  it.each([-1, 7, 1.5])('rejects %s as a weekday', (weekday) => {
    expect(GameSlotInputSchema.safeParse({ weekday, startTime: '20:00' }).success).toBe(false);
  });

  it('has no place for a validity window', () => {
    const windowed = { weekday: 1, startTime: '20:00', validFrom: '2026-12-01' };
    expect(GameSlotInputSchema.parse(windowed)).not.toHaveProperty('validFrom');
  });
});

describe('GameSlotSchema', () => {
  it('accepts a slot with no time, as the fallback schedule carries', () => {
    expect(GameSlotSchema.safeParse({ id: 'a', weekday: 1 }).success).toBe(true);
  });
});

describe('effectiveSchedule', () => {
  it('is the Monday, Wednesday and Saturday rule until something is stored', () => {
    expect(effectiveSchedule([], false)).toEqual(DEFAULT_SCHEDULE);
  });

  it('carries no times in the fallback, rather than inventing one', () => {
    expect(DEFAULT_SCHEDULE.map((s) => s.weekday)).toEqual([1, 3, 6]);
    expect(DEFAULT_SCHEDULE.every((s) => s.startTime === undefined)).toBe(true);
  });

  it('is the stored slots once the partition has been written', () => {
    expect(effectiveSchedule([SAT], true)).toEqual([SAT]);
  });

  it('is empty once every slot has been removed — not the fallback again', () => {
    expect(effectiveSchedule([], true)).toEqual([]);
  });
});

describe('orderSlots', () => {
  it('is Monday first, then by start time', () => {
    const early = { id: 'd', weekday: 1, startTime: '18:00' };
    const sunday = { id: 'e', weekday: 0, startTime: '12:00' };
    const order = orderSlots([sunday, SAT, WED, MON, early]);
    expect(order.map((s) => s.id)).toEqual(['d', 'a', 'b', 'c', 'e']);
  });

  it('puts a slot with no time before one with a time on the same day', () => {
    const untimed = { id: 'd', weekday: 1 };
    expect(orderSlots([MON, untimed]).map((s) => s.id)).toEqual(['d', 'a']);
  });
});

describe('slotsOn', () => {
  it('is only the slots for that date’s weekday', () => {
    // 19.10.2026 is a Monday.
    expect(slotsOn([MON, WED, SAT], '2026-10-19').map((s) => s.id)).toEqual(['a']);
  });

  it('returns both of two slots sharing a weekday, in time order', () => {
    const late = { id: 'd', weekday: 1, startTime: '21:45' };
    expect(slotsOn([late, MON], '2026-10-19').map((s) => s.id)).toEqual(['a', 'd']);
  });

  it('is empty on a day nobody plays', () => {
    expect(slotsOn([MON, WED, SAT], '2026-10-20')).toEqual([]);
  });
});

describe('isGameDay', () => {
  it.each([
    ['2026-10-19', true],
    ['2026-10-20', false],
    ['2026-10-21', true],
    ['2026-10-24', true],
    ['2026-10-25', false],
  ])('%s under the default schedule is %s', (iso, expected) => {
    expect(isGameDay(DEFAULT_SCHEDULE, iso)).toBe(expected);
  });

  it('follows a schedule that is not the default one', () => {
    const thursdays = [{ id: 'a', weekday: 4, startTime: '20:00' }];
    expect(isGameDay(thursdays, '2026-10-22')).toBe(true);
    expect(isGameDay(thursdays, '2026-10-19')).toBe(false);
  });

  it('is false for every day under an empty schedule', () => {
    expect(isGameDay([], '2026-10-19')).toBe(false);
  });
});

describe('nextGameDay', () => {
  it('is the next day a slot falls on, never the given day itself', () => {
    expect(nextGameDay(DEFAULT_SCHEDULE, '2026-10-19')).toBe('2026-10-21');
    expect(nextGameDay(DEFAULT_SCHEDULE, '2026-10-20')).toBe('2026-10-21');
  });

  it('crosses a month boundary', () => {
    expect(nextGameDay(DEFAULT_SCHEDULE, '2026-10-31')).toBe('2026-11-02');
  });

  it('wraps the week for a single weekday', () => {
    const mondays = [{ id: 'a', weekday: 1, startTime: '20:00' }];
    expect(nextGameDay(mondays, '2026-10-19')).toBe('2026-10-26');
  });

  it('is undefined when the schedule is empty', () => {
    expect(nextGameDay([], '2026-10-19')).toBeUndefined();
  });
});

describe('hasSameSlot', () => {
  it('finds a slot with the same weekday and the same times', () => {
    expect(hasSameSlot([MON], { weekday: 1, startTime: '20:00', endTime: '21:30' })).toBe(true);
  });

  it('does not count a different end time as the same slot', () => {
    expect(hasSameSlot([MON], { weekday: 1, startTime: '20:00' })).toBe(false);
    expect(hasSameSlot([MON], { weekday: 1, startTime: '20:00', endTime: '22:00' })).toBe(false);
  });

  it('does not count another weekday or another start as the same slot', () => {
    expect(hasSameSlot([MON], { weekday: 2, startTime: '20:00', endTime: '21:30' })).toBe(false);
    expect(hasSameSlot([MON], { weekday: 1, startTime: '18:00', endTime: '21:30' })).toBe(false);
  });
});
