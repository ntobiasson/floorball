import { describe, expect, it, test } from 'vitest';
import {
  AnnouncementSchema,
  HistoryResponseSchema,
  PlayerDetailSchema,
  PlayerSummarySchema,
  RegistrationInputSchema,
  TodayResponseSchema,
} from '../src/schemas.js';

describe('RegistrationInputSchema', () => {
  test('accepts a plain name with the game date', () => {
    const parsed = RegistrationInputSchema.parse({
      name: 'Matti Virtanen',
      gameDate: '2026-10-19',
    });
    expect(parsed).toEqual({ name: 'Matti Virtanen', gameDate: '2026-10-19' });
  });

  test('trims surrounding whitespace', () => {
    expect(
      RegistrationInputSchema.parse({ name: '  Matti Virtanen  ', gameDate: '2026-10-19' }).name,
    ).toBe('Matti Virtanen');
  });

  test('rejects an empty name', () => {
    expect(RegistrationInputSchema.safeParse({ name: '', gameDate: '2026-10-19' }).success).toBe(
      false,
    );
  });

  test('rejects a whitespace-only name', () => {
    expect(RegistrationInputSchema.safeParse({ name: '   ', gameDate: '2026-10-19' }).success).toBe(
      false,
    );
  });

  test('accepts a name of exactly 60 characters', () => {
    expect(
      RegistrationInputSchema.safeParse({ name: 'a'.repeat(60), gameDate: '2026-10-19' }).success,
    ).toBe(true);
  });

  test('rejects a name of 61 characters', () => {
    expect(
      RegistrationInputSchema.safeParse({ name: 'a'.repeat(61), gameDate: '2026-10-19' }).success,
    ).toBe(false);
  });

  test('rejects a malformed game date', () => {
    expect(
      RegistrationInputSchema.safeParse({ name: 'Matti', gameDate: '19.10.2026' }).success,
    ).toBe(false);
  });

  test('rejects a missing game date', () => {
    expect(RegistrationInputSchema.safeParse({ name: 'Matti' }).success).toBe(false);
  });
});

describe('response schemas', () => {
  const gameDayResponse = {
    date: '2026-10-19',
    weekday: 1,
    isGameDay: true,
    registrations: [
      { playerId: 'p1', displayName: 'Matti Virtanen', createdAt: '2026-10-19T06:00:00Z' },
    ],
    announcements: [],
    schedule: [{ id: 'default-monday', weekday: 1 }],
  };

  test('TodayResponse describes a game day with registrations', () => {
    expect(TodayResponseSchema.parse(gameDayResponse)).toEqual(gameDayResponse);
  });

  test('TodayResponse describes a non-game day with the next game day', () => {
    const value = {
      date: '2026-10-20',
      weekday: 2,
      isGameDay: false,
      nextGameDate: '2026-10-21',
      registrations: [],
      announcements: [],
      schedule: [],
    };
    expect(TodayResponseSchema.parse(value)).toEqual(value);
  });

  it('requires the schedule on a day response', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- discarded on purpose, by rest
    const { schedule, ...withoutSchedule } = gameDayResponse;
    expect(TodayResponseSchema.safeParse(withoutSchedule).success).toBe(false);
  });

  it('accepts a day response whose slots carry no times', () => {
    const body = { ...gameDayResponse, schedule: [{ id: 'a', weekday: 1 }] };
    expect(TodayResponseSchema.safeParse(body).success).toBe(true);
  });

  test('PlayerSummary carries the total', () => {
    const value = { playerId: 'p1', displayName: 'Matti Virtanen', total: 278 };
    expect(PlayerSummarySchema.parse(value)).toEqual(value);
  });

  test('PlayerSummary rejects a negative total', () => {
    expect(
      PlayerSummarySchema.safeParse({ playerId: 'p1', displayName: 'A', total: -1 }).success,
    ).toBe(false);
  });

  test('PlayerDetail carries the per-year breakdown', () => {
    const value = {
      playerId: 'p1',
      displayName: 'Matti Virtanen',
      total: 278,
      years: [
        { year: '2026', count: 25 },
        { year: '2025', count: 47 },
      ],
    };
    expect(PlayerDetailSchema.parse(value)).toEqual(value);
  });

  test('Announcement requires a body', () => {
    expect(AnnouncementSchema.safeParse({ id: 'a1', body: '' }).success).toBe(false);
  });

  test('HistoryResponse carries every player with their years', () => {
    const value = {
      players: [
        {
          playerId: 'p1',
          displayName: 'Matti Virtanen',
          total: 72,
          years: [
            { year: '2026', count: 25 },
            { year: '2025', count: 47 },
          ],
        },
        { playerId: 'p2', displayName: 'Olli Väänänen', total: 0, years: [] },
      ],
    };
    expect(HistoryResponseSchema.parse(value)).toEqual(value);
  });

  test('HistoryResponse rejects a player whose years are missing', () => {
    expect(
      HistoryResponseSchema.safeParse({
        players: [{ playerId: 'p1', displayName: 'Matti Virtanen', total: 72 }],
      }).success,
    ).toBe(false);
  });
});
