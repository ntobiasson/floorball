import type { TurnstileAction } from '@sahlykanta/shared';

/**
 * Server-side verification of a Cloudflare Turnstile token.
 *
 * The browser never talks to Cloudflare's verification endpoint — it only
 * renders the widget and hands the resulting token to this API, which
 * redeems it here. A token is good for exactly one redemption, so a replayed
 * one is refused by Cloudflare rather than by anything in this file.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Long enough for any real token, short enough to not forward junk. */
const MAX_TOKEN_LENGTH = 2048;

/**
 * Cloudflare can be slow to answer under load, and a registration that hangs
 * for a minute is worse than one that is refused: the form is in front of
 * someone standing in a hall deciding whether to play tonight.
 */
const SITEVERIFY_TIMEOUT_MS = 10_000;

/**
 * Cloudflare publishes these dummy secrets so an integration can be exercised
 * without a real widget. They are not credentials — they are in the public
 * documentation — and the first of them accepts every token unconditionally,
 * which is exactly why `isTestingSecret` exists: the Lambda refuses to start
 * on one, so a dummy cannot quietly end up protecting the deployed form.
 */
const TESTING_SECRETS = new Set([
  '1x0000000000000000000000000000000AA', // always passes
  '2x0000000000000000000000000000000AA', // always fails
  '3x0000000000000000000000000000000AA', // token already spent
]);

export function isTestingSecret(secret: string): boolean {
  return TESTING_SECRETS.has(secret);
}

export interface TurnstileConfig {
  /**
   * Resolved lazily, not at construction: on Lambda the value lives in
   * Secrets Manager and the unprotected read routes must not pay for a
   * fetch they never use.
   */
  secret: () => Promise<string>;
  /**
   * The exact hostnames siteverify may report as the page the widget was
   * solved on. A deployment's own frontend hostname only — never
   * `localhost` or `127.0.0.1` in production, or a widget solved on an
   * attacker's local copy of the page would be accepted here.
   */
  hostnames: readonly string[];
  /** Injected by the tests; the real one is global `fetch`. */
  fetchImpl?: typeof fetch;
}

export type VerifyTurnstile = (input: {
  token: unknown;
  action: TurnstileAction;
  remoteIp: string | undefined;
}) => Promise<boolean>;

interface SiteverifyResponse {
  success?: unknown;
  action?: unknown;
  hostname?: unknown;
  metadata?: { result_with_testing_key?: unknown };
}

export function createTurnstile({
  secret,
  hostnames,
  fetchImpl = fetch,
}: TurnstileConfig): VerifyTurnstile {
  const allowed = new Set(hostnames.map((hostname) => hostname.trim()).filter(Boolean));

  return async ({ token, action, remoteIp }) => {
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.length > MAX_TOKEN_LENGTH ||
      allowed.size === 0
    ) {
      return false;
    }

    const configured = await secret();

    let result: SiteverifyResponse;
    try {
      const response = await fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
        body: new URLSearchParams({
          secret: configured,
          response: token,
          ...(remoteIp === undefined ? {} : { remoteip: remoteIp }),
        }),
      });
      if (!response.ok) throw new Error(`siteverify ${response.status}`);
      result = (await response.json()) as SiteverifyResponse;
    } catch (error) {
      // Fail closed, but say so in the log: a verification that cannot be
      // reached looks identical to a refused one from the client's side,
      // and the difference is the whole diagnosis.
      console.error('turnstile siteverify failed', error);
      return false;
    }

    if (result.success !== true) return false;
    if (typeof result.hostname !== 'string' || !allowed.has(result.hostname)) return false;

    /**
     * A dummy token carries no action for siteverify to echo back, so the
     * action check cannot apply to one. The allowance is keyed on the
     * configured secret being a published dummy — never on the response
     * saying so — which makes it unreachable in production, where the secret
     * is a real one and the Lambda refuses to start on anything else.
     */
    if (isTestingSecret(configured) && result.action === undefined) return true;

    return result.action === action;
  };
}

/**
 * Parses the comma-separated `TURNSTILE_HOSTNAMES` setting. Empty is a
 * configuration error rather than "allow everything": with no allowlist
 * there is nothing to compare siteverify's hostname against, and a token
 * solved on any page at all would pass.
 */
export function parseHostnames(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((hostname) => hostname.trim())
    .filter((hostname) => hostname.length > 0);
}
