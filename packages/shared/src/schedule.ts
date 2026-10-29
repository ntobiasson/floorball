import { z } from 'zod';
import { addDays, weekdayOf } from './dates.js';

/**
 * The schedule is which weekdays this group plays, and at what time — a
 * value the calendar functions below are asked about, rather than a
 * constant they close over, so the API can hand them whatever is stored in
 * the database without touching this module's logic.
 *
 * A slot's time, like every date in this codebase, is never a `Date`: it is
 * an `HH:MM` string in the Helsinki wall clock, and nothing here converts it
 * to one.
 */

/** `HH:MM`, 24-hour, in the Helsinki wall clock. */
export const IsoTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

/**
 * A slot as it may be read. `startTime` is optional because `DEFAULT_SCHEDULE`
 * carries none — it only ever says which weekdays are played, as the
 * constant it replaces did — which mirrors `isGoalkeeper` in `schemas.ts`:
 * a field absent rather than filled with a value nobody chose, for rows that
 * predate it.
 *
 * A slot carries no validity window, "shown from" date or pending state: it
 * is simply in force, start to finish.
 */
export const GameSlotSchema = z.object({
  id: z.string().min(1),
  weekday: z.number().int().min(0).max(6),
  startTime: IsoTimeSchema.optional(),
  endTime: IsoTimeSchema.optional(),
});
export type GameSlot = z.infer<typeof GameSlotSchema>;

/**
 * A slot as the settings form creates one. Unlike `GameSlotSchema`, a start
 * time is required: a slot with no time is a historical artefact of the
 * fallback schedule, never something a form submits. `id` is absent too —
 * the store assigns it.
 */
export const GameSlotInputSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: IsoTimeSchema,
    endTime: IsoTimeSchema.optional(),
  })
  .refine((slot) => slot.endTime === undefined || slot.endTime > slot.startTime, {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  });
export type GameSlotInput = z.infer<typeof GameSlotInputSchema>;

/**
 * The Monday/Wednesday/Saturday rule this group has always played, carried
 * forward as the answer for a group whose schedule has never been saved.
 * No times, because the constant it replaces (`GAME_WEEKDAYS`) never had one
 * either — inventing one here would claim a decision nobody made.
 */
export const DEFAULT_SCHEDULE: readonly GameSlot[] = [
  { id: 'default-monday', weekday: 1 },
  { id: 'default-wednesday', weekday: 3 },
  { id: 'default-saturday', weekday: 6 },
];

/**
 * What the app actually plays by: the stored slots once a schedule has been
 * written, even if that is now an empty list — an empty schedule is a
 * decision, not a reason to fall back. Before that first write, `initialised`
 * is false and the default rule above stands in instead.
 */
export function effectiveSchedule(
  slots: readonly GameSlot[],
  initialised: boolean,
): readonly GameSlot[] {
  return initialised ? slots : DEFAULT_SCHEDULE;
}

/** Weekday numbers are Sunday-first; display is always Monday-first. */
function mondayFirst(weekday: number): number {
  return (weekday + 6) % 7;
}

/**
 * Monday first, then by start time within a day — a slot with no time sorts
 * before one that has it, so the fallback schedule orders sensibly too.
 */
export function orderSlots(slots: readonly GameSlot[]): GameSlot[] {
  return [...slots].sort((a, b) => {
    const dayDiff = mondayFirst(a.weekday) - mondayFirst(b.weekday);
    if (dayDiff !== 0) return dayDiff;
    const aTime = a.startTime ?? '';
    const bTime = b.startTime ?? '';
    return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
  });
}

/** The slots that fall on `iso`'s weekday, in display order. */
export function slotsOn(slots: readonly GameSlot[], iso: string): GameSlot[] {
  const weekday = weekdayOf(iso);
  return orderSlots(slots.filter((slot) => slot.weekday === weekday));
}

/** Whether any slot falls on `iso`'s weekday. */
export function isGameDay(slots: readonly GameSlot[], iso: string): boolean {
  return slots.some((slot) => slot.weekday === weekdayOf(iso));
}

/**
 * The first date strictly after `iso` that a slot falls on. Seven steps are
 * enough to find one: there are no validity windows, so a non-empty
 * schedule recurs every week. An empty schedule has no next game day at
 * all, so it returns `undefined` rather than walking anywhere.
 */
export function nextGameDay(slots: readonly GameSlot[], iso: string): string | undefined {
  if (slots.length === 0) return undefined;
  let cursor = iso;
  for (let step = 0; step < 7; step += 1) {
    cursor = addDays(cursor, 1);
    if (isGameDay(slots, cursor)) return cursor;
  }
  // Unreachable: every 7-day window contains every weekday once.
  return undefined;
}

/**
 * Whether `input` describes a slot already in `slots` — same weekday, same
 * start, same end — so the settings page can refuse a duplicate entry.
 */
export function hasSameSlot(slots: readonly GameSlot[], input: GameSlotInput): boolean {
  return slots.some(
    (slot) =>
      slot.weekday === input.weekday &&
      slot.startTime === input.startTime &&
      slot.endTime === input.endTime,
  );
}
