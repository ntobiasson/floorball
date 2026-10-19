import { afterEach, describe, expect, test, vi } from 'vitest';
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

    await expect(api.register('Matti', '2026-10-19')).rejects.toThrow('nimi on jo listalla');
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
