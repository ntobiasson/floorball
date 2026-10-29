import { z } from 'zod';
import { MAX_NAME_LENGTH } from './names.js';
import { GameSlotSchema } from './schedule.js';

/** Shared by every boundary: `YYYY-MM-DD` in the Helsinki calendar. */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const PlayerNameSchema = z
  .string()
  .trim()
  .min(1, 'nimi puuttuu')
  .max(MAX_NAME_LENGTH, `nimi on yli ${MAX_NAME_LENGTH} merkkiä`);

/**
 * The client sends the date it believes it is registering for. The API checks
 * it against the server's own Helsinki date and rejects a mismatch, so a tab
 * left open overnight cannot write to yesterday.
 */
export const RegistrationInputSchema = z.object({
  name: PlayerNameSchema,
  gameDate: IsoDateSchema,
  /**
   * The form's goalkeeper box. Optional because it is absent from every
   * request a client sent before the box existed, and because an empty box is
   * the ordinary case: the mark is only ever carried when it is true.
   */
  isGoalkeeper: z.boolean().optional(),
});

export const AnnouncementSchema = z.object({
  id: z.string().min(1),
  body: z.string().trim().min(1).max(500),
  validFrom: IsoDateSchema.optional(),
  validTo: IsoDateSchema.optional(),
});

export const RegistrationSchema = z.object({
  playerId: z.string().min(1),
  displayName: z.string().min(1),
  createdAt: z.string().min(1),
  /**
   * Who is in goal tonight. Optional rather than a required `false`, because
   * it is absent from every registration ever written before this existed and
   * from most of them since — a normal evening has nobody marked. Omitted
   * rather than stored false, so unmarking leaves no trace.
   *
   * It belongs to the night, not to the player: it is settled shortly before
   * the game, sometimes after people have already registered, and Wednesday
   * knows nothing of Monday.
   */
  isGoalkeeper: z.boolean().optional(),
});

/** The body of the request that marks or unmarks tonight's goalkeeper. */
export const GoalkeeperInputSchema = z.object({
  isGoalkeeper: z.boolean(),
});

export const TodayResponseSchema = z.object({
  date: IsoDateSchema,
  weekday: z.number().int().min(0).max(6),
  isGameDay: z.boolean(),
  nextGameDate: IsoDateSchema.optional(),
  registrations: z.array(RegistrationSchema),
  announcements: z.array(AnnouncementSchema),
  /**
   * The whole schedule, every weekday, in display order — not just today's
   * slots. No slot carries a validity window, so today's times and the next
   * playing day's times are both just a weekday filter (`slotsOn`) away on
   * this one list; the "Pelivuorot" card on the landing page draws all of it.
   */
  schedule: z.array(GameSlotSchema),
});

export const PlayerSummarySchema = z.object({
  playerId: z.string().min(1),
  displayName: z.string().min(1),
  total: z.number().int().nonnegative(),
});

export const PlayerYearSchema = z.object({
  year: z.string().regex(/^\d{4}$/),
  count: z.number().int().nonnegative(),
});

export const PlayerDetailSchema = PlayerSummarySchema.extend({
  years: z.array(PlayerYearSchema),
});

export const PlayerDirectorySchema = z.object({
  players: z.array(PlayerSummarySchema),
});

/**
 * The whole archive in one response: every player with their per-year counts.
 *
 * The directory (above) carries lifetime totals only, which is all the
 * registration form's suggestions need. The history page also ranks players
 * within a chosen year, so it needs the breakdown for everybody at once —
 * fetching it a player at a time would be ~500 requests.
 */
export const HistoryResponseSchema = z.object({
  players: z.array(PlayerDetailSchema),
});

export const AnnouncementInputSchema = z.object({
  body: z.string().trim().min(1).max(500),
  validFrom: IsoDateSchema.optional(),
  validTo: IsoDateSchema.optional(),
});

export type IsoDate = z.infer<typeof IsoDateSchema>;
export type RegistrationInput = z.infer<typeof RegistrationInputSchema>;
export type Registration = z.infer<typeof RegistrationSchema>;
export type GoalkeeperInput = z.infer<typeof GoalkeeperInputSchema>;
export type TodayResponse = z.infer<typeof TodayResponseSchema>;
export type PlayerSummary = z.infer<typeof PlayerSummarySchema>;
export type PlayerYear = z.infer<typeof PlayerYearSchema>;
export type PlayerDetail = z.infer<typeof PlayerDetailSchema>;
export type PlayerDirectory = z.infer<typeof PlayerDirectorySchema>;
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;
export type Announcement = z.infer<typeof AnnouncementSchema>;
export type AnnouncementInput = z.infer<typeof AnnouncementInputSchema>;
