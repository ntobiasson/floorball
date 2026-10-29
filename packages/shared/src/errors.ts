/**
 * What went wrong, as something both sides can agree on without agreeing on
 * a language.
 *
 * The API answers a refused write with `{ code, error }`. `error` is Finnish
 * prose and stays that way: it is what any caller that is not this app's
 * browser gets, and it is the last resort when a client meets a code it does
 * not know. `code` is what a translated page actually reads, because a page
 * speaking Ukrainian cannot put a Finnish sentence in front of somebody and
 * call it an error message.
 *
 * Added alongside `error` rather than in place of it, so there is no moment
 * where one side has been deployed and the other has not.
 */
export const API_ERROR_CODES = [
  /** The body was not JSON, or not the shape the route takes. */
  'invalid-request',
  'invalid-registration',
  'name-missing',
  'already-registered',
  'not-registered',
  'not-a-game-day',
  /** Registration is open, but for today only — the client asked for another date. */
  'wrong-day',
  'player-not-found',
  'invalid-announcement',
  'announcement-not-found',
  'invalid-slot',
  'slot-already-listed',
  'slot-not-found',
  /** Turnstile refused, or was never solved. */
  'verification-failed',
  /** Two people claimed the same new name at once; it is worth another go. */
  'try-again',
  'corrupted-player',
  'server-error',
  'not-found',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
