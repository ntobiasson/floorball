/**
 * The two names the browser and the API have to agree on for bot
 * verification. Both are spelled once here rather than twice in two
 * packages, because a typo on either side fails closed — the API would
 * reject every submission and the form would look broken for everyone.
 */

/**
 * The field Cloudflare's widget writes its token into, and the field the
 * canonical siteverify call reads back out. The POST routes carry it in the
 * JSON body; the announcement delete and the schedule delete, neither of
 * which has a body, carry it in a header of the same name.
 */
export const TURNSTILE_TOKEN_FIELD = 'cf-turnstile-response';

/**
 * A widget renders with exactly one action and siteverify echoes it back, so
 * the API can tell a token minted for the registration form from one minted
 * for the announcements page. A token is therefore not transferable between
 * the two surfaces.
 *
 * Both announcement writes share a single widget on the unlisted page — one
 * widget cannot render with two actions — so they share one action.
 *
 * The schedule editor is a third surface with its own widget, so it gets a
 * third action: a token minted there is no more usable against `register` or
 * `announce` than theirs are against each other.
 */
export const TURNSTILE_ACTIONS = {
  register: 'register',
  announce: 'announce',
  settings: 'settings',
} as const;

export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
