import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TURNSTILE_ACTIONS } from '@sahlykanta/shared';
import { createTurnstile, isTestingSecret, parseHostnames } from '../src/turnstile.js';

/**
 * Verification itself, against a stubbed siteverify. The shape of the
 * responses here is the real one: it was taken from a live call to
 * challenges.cloudflare.com with Cloudflare's published testing secret, which
 * is why the testing-key case below has no `action` field at all rather than
 * an empty one.
 */

/** Deliberately unlike a real key, so a leak scan never stops here. */
const SECRET = 'not-a-real-turnstile-secret';
const TESTING_SECRET = '1x0000000000000000000000000000000AA';
const HOSTNAMES = ['d111111abcdef8.cloudfront.net'];

const siteverify = (body: unknown, ok = true): typeof fetch =>
  vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 502,
    json: async () => body,
  }) as unknown as typeof fetch;

const verifierWith = (fetchImpl: typeof fetch, secret = SECRET, hostnames = HOSTNAMES) =>
  createTurnstile({ secret: async () => secret, hostnames, fetchImpl });

const solved = {
  token: 'a-real-looking-token',
  action: TURNSTILE_ACTIONS.register,
  remoteIp: '203.0.113.7',
};

beforeEach(() => {
  // The failure paths log the reason on purpose; the tests do not need it.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('a token Cloudflare accepts', () => {
  test('passes when the action and the hostname both match', async () => {
    const verify = verifierWith(
      siteverify({ success: true, action: 'register', hostname: HOSTNAMES[0] }),
    );

    expect(await verify(solved)).toBe(true);
  });

  test('is redeemed at the canonical endpoint, with the secret in the body', async () => {
    const fetchImpl = siteverify({ success: true, action: 'register', hostname: HOSTNAMES[0] });
    await verifierWith(fetchImpl)(solved);

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');

    const sent = new URLSearchParams(init.body as string);
    expect(sent.get('secret')).toBe(SECRET);
    expect(sent.get('response')).toBe(solved.token);
    expect(sent.get('remoteip')).toBe('203.0.113.7');
  });

  test('omits remoteip entirely when the caller address is unknown', async () => {
    const fetchImpl = siteverify({ success: true, action: 'register', hostname: HOSTNAMES[0] });
    await verifierWith(fetchImpl)({ ...solved, remoteIp: undefined });

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(new URLSearchParams(init.body as string).has('remoteip')).toBe(false);
  });

  test('is refused when it was minted for the other form', async () => {
    // A token solved on the announcements page must not register a name.
    const verify = verifierWith(
      siteverify({ success: true, action: 'announce', hostname: HOSTNAMES[0] }),
    );

    expect(await verify(solved)).toBe(false);
  });

  test('is refused when it was solved on a page this deployment does not serve', async () => {
    const verify = verifierWith(
      siteverify({ success: true, action: 'register', hostname: 'attacker.example' }),
    );

    expect(await verify(solved)).toBe(false);
  });

  test('is refused when siteverify reports no hostname at all', async () => {
    const verify = verifierWith(siteverify({ success: true, action: 'register' }));

    expect(await verify(solved)).toBe(false);
  });
});

describe('a token Cloudflare rejects', () => {
  test('is refused', async () => {
    const verify = verifierWith(
      siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    );

    expect(await verify(solved)).toBe(false);
  });

  test('a replayed one is refused, because siteverify only redeems it once', async () => {
    // Nothing in this file holds that state: Cloudflare does.
    const verify = verifierWith(
      siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    );

    expect(await verify(solved)).toBe(false);
  });
});

describe('a token that never reaches siteverify', () => {
  const notCalled = siteverify({ success: true, action: 'register', hostname: HOSTNAMES[0] });

  test.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a string', 1234],
    ['an object', { token: 'x' }],
    ['absurdly long', 'x'.repeat(2049)],
  ])('is refused when it is %s, without a network call', async (_label, token) => {
    const fetchImpl = notCalled;
    const verify = verifierWith(fetchImpl);

    expect(await verify({ ...solved, token })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('is refused when there is no hostname allowlist to compare against', async () => {
    // Fail closed: an empty allowlist is a configuration error, not
    // permission to accept a token solved anywhere at all.
    const fetchImpl = siteverify({ success: true, action: 'register', hostname: HOSTNAMES[0] });
    const verify = verifierWith(fetchImpl, SECRET, []);

    expect(await verify(solved)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('when siteverify cannot be reached', () => {
  test('a refusal is the answer, not an exception the route has to catch', async () => {
    const verify = verifierWith(
      vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch,
    );

    expect(await verify(solved)).toBe(false);
  });

  test('an upstream error status is a refusal too', async () => {
    const verify = verifierWith(siteverify({}, false));

    expect(await verify(solved)).toBe(false);
  });

  test('the reason is logged, because a refused token looks identical from outside', async () => {
    await verifierWith(
      vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch,
    )(solved);

    expect(console.error).toHaveBeenCalled();
  });
});

describe("Cloudflare's published testing secrets", () => {
  test('are recognised, so the Lambda can refuse to run on one', () => {
    expect(isTestingSecret(TESTING_SECRET)).toBe(true);
    expect(isTestingSecret('2x0000000000000000000000000000000AA')).toBe(true);
    expect(isTestingSecret(SECRET)).toBe(false);
  });

  test('accept a dummy token, which carries no action to echo back', async () => {
    // What local development runs on. The real response for a dummy token
    // has no `action` key and reports example.com as the hostname.
    const verify = verifierWith(
      siteverify({
        success: true,
        hostname: 'example.com',
        metadata: { result_with_testing_key: true },
      }),
      TESTING_SECRET,
      ['example.com'],
    );

    expect(await verify(solved)).toBe(true);
  });

  test('still check the hostname', async () => {
    const verify = verifierWith(
      siteverify({ success: true, hostname: 'example.com' }),
      TESTING_SECRET,
      HOSTNAMES,
    );

    expect(await verify(solved)).toBe(false);
  });

  test('still check an action when siteverify does echo one', async () => {
    const verify = verifierWith(
      siteverify({ success: true, action: 'announce', hostname: 'example.com' }),
      TESTING_SECRET,
      ['example.com'],
    );

    expect(await verify(solved)).toBe(false);
  });

  test('do not relax anything for a real secret', async () => {
    // The allowance is keyed on the configured secret, never on the response
    // claiming to be a testing result — so this cannot be talked into
    // skipping the action check in production.
    const verify = verifierWith(
      siteverify({
        success: true,
        hostname: HOSTNAMES[0],
        metadata: { result_with_testing_key: true },
      }),
      SECRET,
    );

    expect(await verify(solved)).toBe(false);
  });
});

describe('parseHostnames', () => {
  test('splits, trims and drops the blanks', () => {
    expect(parseHostnames(' a.example , b.example ,, ')).toEqual(['a.example', 'b.example']);
  });

  test('is empty for nothing at all, which the callers treat as misconfigured', () => {
    expect(parseHostnames(undefined)).toEqual([]);
    expect(parseHostnames('')).toEqual([]);
    expect(parseHostnames(' , ')).toEqual([]);
  });
});
