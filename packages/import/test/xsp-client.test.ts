import { describe, expect, test } from 'vitest';
import { ACTIVITY_PAGE, createXspClient } from '../src/xsp-client.js';
import { player, renderView } from './domino-markup.js';

const level1 = renderView({
  pageCount: 16,
  rows: [player('Olli Salo', 2, '1'), player('Matti Virtanen', 278, '3')],
});

/** A second response, carrying a different view-state token. */
const playerExpanded = renderView({
  pageCount: 16,
  viewId: '!hncopjoczl!',
  rows: [player('Matti Virtanen', 278, '3', true)],
});

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

    // The two responses carry different tokens; what matters is that the
    // client adopts the newest one.
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

describe('redirects', () => {
  const redirectTo = (location: string, status = 307) =>
    async (): Promise<Response> =>
      new Response(null, { status, headers: { location } });

  test('refuses to follow a redirect rather than re-posting the body elsewhere', async () => {
    // A 307/308 preserves the method and body, so a followed redirect would
    // re-POST the multipart form to wherever Domino points. The spec's
    // anti-goal is touching the live application in a way that creates data.
    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: redirectTo(`${BASE}/pelit.xsp`),
      delayMs: 0,
      retryDelayMs: 0,
      maxAttempts: 1,
    });

    await expect(client.open()).rejects.toThrow(/redirect/i);
  });

  test('names where it was being sent, so a session expiry is diagnosable', async () => {
    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: redirectTo(`${BASE}/${ACTIVITY_PAGE}?SessionID=NEW`, 302),
      delayMs: 0,
      retryDelayMs: 0,
      maxAttempts: 1,
    });

    await expect(client.open()).rejects.toThrow(/SessionID=NEW/);
  });

  test('passes redirect: manual to fetch, so nothing is followed silently', async () => {
    let seen: RequestInit['redirect'];
    const impl = async (_url: string, init?: RequestInit): Promise<Response> => {
      seen = init?.redirect;
      return new Response(level1, { status: 200, headers: { 'content-type': 'text/html' } });
    };
    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: impl,
      delayMs: 0,
    });

    await client.open();

    expect(seen).toBe('manual');
  });
});

describe('cookies', () => {
  test('keeps every cookie the server sets, not just the first', async () => {
    // Replacing the whole jar with the first cookie drops SessionID the
    // moment Domino sets anything else, and a stale session shows up as
    // retry exhaustion hours into an unattended walk.
    const headers = new Headers();
    headers.append('set-cookie', 'SessionID=ABC123; path=/');
    headers.append('set-cookie', 'DomAuthSessId=XYZ; path=/');
    headers.set('content-type', 'text/html');

    const calls: Array<Record<string, string>> = [];
    let first = true;
    const impl = async (_url: string, init?: RequestInit): Promise<Response> => {
      calls.push((init?.headers ?? {}) as Record<string, string>);
      if (first) {
        first = false;
        return new Response(level1, { status: 200, headers });
      }
      return new Response(playerExpanded, { status: 200, headers: { 'content-type': 'text/html' } });
    };

    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: impl,
      delayMs: 0,
    });
    await client.open();
    await client.submit('anything');

    const cookie = calls[1]?.cookie ?? '';
    expect(cookie).toContain('SessionID=ABC123');
    expect(cookie).toContain('DomAuthSessId=XYZ');
  });

  test('a later value for the same cookie replaces the earlier one', async () => {
    const calls: Array<Record<string, string>> = [];
    let call = 0;
    const impl = async (_url: string, init?: RequestInit): Promise<Response> => {
      calls.push((init?.headers ?? {}) as Record<string, string>);
      call += 1;
      return new Response(level1, {
        status: 200,
        headers: { 'content-type': 'text/html', 'set-cookie': `SessionID=ROUND${call}; path=/` },
      });
    };

    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: impl,
      delayMs: 0,
    });
    await client.open();
    await client.submit('a');
    await client.submit('b');

    expect(calls[2]?.cookie).toContain('SessionID=ROUND2');
    expect(calls[2]?.cookie).not.toContain('ROUND1');
  });

  test('a response that sets only a secondary cookie does not drop the session', async () => {
    const calls: Array<Record<string, string>> = [];
    let call = 0;
    const impl = async (_url: string, init?: RequestInit): Promise<Response> => {
      calls.push((init?.headers ?? {}) as Record<string, string>);
      call += 1;
      const cookie = call === 1 ? 'SessionID=KEEPME; path=/' : 'Other=1; path=/';
      return new Response(level1, {
        status: 200,
        headers: { 'content-type': 'text/html', 'set-cookie': cookie },
      });
    };

    const client = createXspClient({
      pageUrl: `${BASE}/${ACTIVITY_PAGE}`,
      fetchImpl: impl,
      delayMs: 0,
    });
    await client.open();
    await client.submit('a');
    await client.submit('b');

    expect(calls[2]?.cookie).toContain('SessionID=KEEPME');
  });
});
