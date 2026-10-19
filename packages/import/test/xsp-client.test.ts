import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { ACTIVITY_PAGE, createXspClient } from '../src/xsp-client.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const level1 = readFileSync(path.join(fixtures, 'level1-page1.html'), 'utf8');
const playerExpanded = readFileSync(path.join(fixtures, 'player-expanded.html'), 'utf8');

const BASE = 'http://example.test/sofor/fun/sahlykanta.nsf';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: FormData | undefined;
}

function stubFetch(pages: string[]) {
  const calls: Captured[] = [];
  let index = 0;
  const impl = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body instanceof FormData ? init.body : undefined,
    });
    const page = pages[Math.min(index, pages.length - 1)] ?? '';
    index += 1;
    return new Response(page, {
      status: 200,
      headers: { 'content-type': 'text/html;charset=UTF-8', 'set-cookie': 'SessionID=ABC123; path=/' },
    });
  };
  return { calls, impl };
}

describe('the write guard', () => {
  test('refuses a base url that is not the activity page', () => {
    // A POST to pelit.xsp would push the registration button and create a
    // real entry on the live system.
    expect(() =>
      createXspClient({ pageUrl: `${BASE}/pelit.xsp`, fetchImpl: stubFetch([level1]).impl }),
    ).toThrow(/peliaktiivisuus/i);
  });

  test('refuses the kayttoaste page too', () => {
    expect(() =>
      createXspClient({ pageUrl: `${BASE}/kayttoaste.xsp`, fetchImpl: stubFetch([level1]).impl }),
    ).toThrow(/peliaktiivisuus/i);
  });

  test('accepts the activity page', () => {
    expect(() =>
      createXspClient({
        pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
        fetchImpl: stubFetch([level1]).impl,
      }),
    ).not.toThrow();
  });

  test('accepts it with a query string', () => {
    expect(() =>
      createXspClient({
        pageUrl: `${BASE}/${ACTIVITY_PAGE}?SessionID=X`,
        fetchImpl: stubFetch([level1]).impl,
      }),
    ).not.toThrow();
  });
});

describe('open', () => {
  test('issues a GET and captures the view state', async () => {
    const { calls, impl } = stubFetch([level1]);
    const client = createXspClient({ pageUrl: `${BASE}/${ACTIVITY_PAGE}`, fetchImpl: impl });

    const html = await client.open();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('GET');
    expect(html).toContain('Matti Virtanen');
    expect(client.viewId()).toMatch(/^!.+!$/);
  });
});

describe('submit', () => {
  test('posts the view state, the submit id and the exec id back to the same page', async () => {
    const { calls, impl } = stubFetch([level1, playerExpanded]);
    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: impl,
      delayMs: 0,
    });
    await client.open();
    // Captured before the POST: the response refreshes the token, so comparing
    // against client.viewId() afterwards would compare the wrong one.
    const postedViewId = client.viewId();

    await client.submit('view:_id1:_id2:callback2:viewPanel1:2:viewColumn1__expand:3');

    const post = calls[1];
    expect(post?.method).toBe('POST');
    expect(post?.url).toBe(`${BASE}/${ACTIVITY_PAGE}`);
    const body = post?.body;
    expect(body?.get('$$viewid')).toBe(postedViewId);
    expect(body?.get('$$xspsubmitid')).toBe(
      'view:_id1:_id2:callback2:viewPanel1:2:viewColumn1__expand:3',
    );
    expect(body?.get('$$xspexecid')).toBe(
      'view:_id1:_id2:callback2:viewPanel1_OUTER_TABLE',
    );
    expect(body?.get('view:_id1')).toBe('view:_id1');
  });

  test('sends the session cookie it was given', async () => {
    const { calls, impl } = stubFetch([level1, playerExpanded]);
    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: impl,
      delayMs: 0,
    });
    await client.open();

    await client.submit('anything');

    expect(calls[1]?.headers.cookie).toContain('SessionID=ABC123');
  });

  test('refuses to post before the view has been opened', async () => {
    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: stubFetch([level1]).impl,
      delayMs: 0,
    });

    await expect(client.submit('anything')).rejects.toThrow(/open/i);
  });

  test('refreshes the view state from each response', async () => {
    const { impl } = stubFetch([level1, playerExpanded]);
    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: impl,
      delayMs: 0,
    });
    await client.open();
    const before = client.viewId();

    await client.submit('anything');

    // The fixtures were captured in different sessions, so their tokens
    // differ; what matters is that the client adopts the newest one.
    expect(client.viewId()).not.toBe(before);
    expect(client.viewId()).toMatch(/^!.+!$/);
  });
});

describe('retries', () => {
  test('retries a failed request and then succeeds', async () => {
    let attempts = 0;
    const impl = async (): Promise<Response> => {
      attempts += 1;
      if (attempts < 3) return new Response('upstream hiccup', { status: 503 });
      return new Response(level1, { status: 200, headers: { 'content-type': 'text/html' } });
    };
    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: impl,
      delayMs: 0,
      retryDelayMs: 0,
    });

    await expect(client.open()).resolves.toContain('Matti Virtanen');
    expect(attempts).toBe(3);
  });

  test('gives up after the retry budget and says which status it saw', async () => {
    const impl = async (): Promise<Response> => new Response('nope', { status: 500 });
    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: impl,
      delayMs: 0,
      retryDelayMs: 0,
      maxAttempts: 2,
    });

    await expect(client.open()).rejects.toThrow(/500/);
  });
});

describe('politeness', () => {
  test('waits between requests, because this is someone else production server', async () => {
    const { impl } = stubFetch([level1, playerExpanded, playerExpanded]);
    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: impl,
      delayMs: 50,
    });

    const started = Date.now();
    await client.open();
    await client.submit('a');
    await client.submit('b');

    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });
});
