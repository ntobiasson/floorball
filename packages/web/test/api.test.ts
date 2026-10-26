import { afterEach, describe, expect, test, vi } from 'vitest';
import { TURNSTILE_TOKEN_FIELD } from '@sahlykanta/shared';
import { ApiError, api } from '../src/lib/api.js';

const respondWith = (body: string, init: ResponseInit) => {
  // A 204 may not carry a body at all, per the Response constructor.
  const payload = init.status === 204 ? null : body;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(payload, init)));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a well-formed error response', () => {
  test('becomes an ApiError carrying the server message', async () => {
    respondWith(JSON.stringify({ error: 'nimi on jo listalla' }), { status: 409 });

    await expect(api.register('Matti', '2026-10-19', 'a-token')).rejects.toThrow(
      'nimi on jo listalla',
    );
  });

  test('carries the status', async () => {
    respondWith(JSON.stringify({ error: 'ei löytynyt' }), { status: 404 });

    await expect(api.unregister('p1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('a response that is not JSON at all', () => {
  test('becomes an ApiError rather than a raw SyntaxError', async () => {
    // A misconfigured CDN, an error page from a proxy, a captive portal: the
    // body is HTML with a 200. Parsing it must not escape as SyntaxError,
    // which the UI has no handler for.
    respondWith('<!DOCTYPE html><html><body>Hello</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });

    const failure = await api.today().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toMatch(/odottamatto/i);
  });

  test('an HTML body with an error status still reports the status', async () => {
    respondWith('<!DOCTYPE html><html><body>Gateway timeout</body></html>', {
      status: 504,
      headers: { 'content-type': 'text/html' },
    });

    await expect(api.today()).rejects.toMatchObject({ status: 504 });
  });

  test('truncated JSON is an ApiError too', async () => {
    respondWith('{"date":"2026-10-1', { status: 200, headers: { 'content-type': 'application/json' } });

    await expect(api.today()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('a 204', () => {
  test('resolves without trying to parse a body', async () => {
    respondWith('', { status: 204 });

    await expect(api.unregister('p1')).resolves.toBeUndefined();
  });
});

describe('a successful response', () => {
  test('is returned parsed', async () => {
    respondWith(JSON.stringify({ players: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(api.players()).resolves.toEqual({ players: [] });
  });
});

describe('marking a goalkeeper', () => {
  const sentTo = (): { url: string; method: string; body: string } => {
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    return { url: String(url), method: String(init.method), body: String(init.body ?? '') };
  };

  test('PATCHes the one night that player is registered for', async () => {
    respondWith('', { status: 204 });

    await api.setGoalkeeper('p1', true);

    const { url, method, body } = sentTo();
    expect(method).toBe('PATCH');
    expect(url).toBe('/api/registrations/p1/goalkeeper');
    expect(JSON.parse(body)).toEqual({ isGoalkeeper: true });
  });

  test('carries false when unmarking', async () => {
    respondWith('', { status: 204 });

    await api.setGoalkeeper('p1', false);

    expect(JSON.parse(sentTo().body)).toEqual({ isGoalkeeper: false });
  });

  test('escapes the player id, as the other calls do', async () => {
    respondWith('', { status: 204 });

    await api.setGoalkeeper('a/b', true);

    expect(sentTo().url).toBe('/api/registrations/a%2Fb/goalkeeper');
  });
});

describe('the Turnstile token', () => {
  const sentWith = (): { body: string; headers: Record<string, string> } => {
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    return {
      body: String(init.body ?? ''),
      headers: init.headers as Record<string, string>,
    };
  };

  test('rides in the body when registering', async () => {
    respondWith(JSON.stringify({ playerId: 'p1', displayName: 'Matti' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });

    await api.register('Matti', '2026-10-19', 'a-token');

    expect(JSON.parse(sentWith().body)).toEqual({
      name: 'Matti',
      gameDate: '2026-10-19',
      [TURNSTILE_TOKEN_FIELD]: 'a-token',
    });
  });

  test('rides in the body when adding an announcement, beside its fields', async () => {
    respondWith(JSON.stringify({ id: 'a1', body: 'Kenttä varattu' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });

    await api.addAnnouncement({ body: 'Kenttä varattu' }, 'a-token');

    expect(JSON.parse(sentWith().body)).toEqual({
      body: 'Kenttä varattu',
      [TURNSTILE_TOKEN_FIELD]: 'a-token',
    });
  });

  test('rides in a header when removing one, a DELETE having no body', async () => {
    respondWith('', { status: 204 });

    await api.removeAnnouncement('a1', 'a-token');

    const { body, headers } = sentWith();
    expect(headers[TURNSTILE_TOKEN_FIELD]).toBe('a-token');
    expect(body).toBe('');
  });

  test('is not sent when removing a name, which is not gated', async () => {
    respondWith('', { status: 204 });

    await api.unregister('p1');

    const { body, headers } = sentWith();
    expect(body).toBe('');
    expect(Object.keys(headers)).not.toContain(TURNSTILE_TOKEN_FIELD);
  });
});

describe('the history call', () => {
  test('asks the archive endpoint and returns the players', async () => {
    const players = [
      { playerId: 'p1', displayName: 'Matti Virtanen', total: 2, years: [{ year: '2026', count: 2 }] },
    ];
    respondWith(JSON.stringify({ players }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const result = await api.history();

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/history');
    expect(result.players).toEqual(players);
  });

  test('a failure surfaces as an ApiError', async () => {
    respondWith(JSON.stringify({ error: 'historiaa ei saatu' }), { status: 500 });

    await expect(api.history()).rejects.toThrow('historiaa ei saatu');
  });
});
